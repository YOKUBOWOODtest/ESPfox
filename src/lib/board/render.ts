/**
 * Board renderer.
 *
 * Pure drawing: given a context, a camera and the document, paint one frame.
 * No React and no state, so it can be called from a rAF loop without causing
 * renders.
 *
 * Scaling rules, which are the part that is easy to get wrong:
 *   - the buffer is sized `cssPx * devicePixelRatio` and the base transform
 *     scales by DPR, so drawing commands stay in CSS pixels;
 *   - the camera's `scale` is applied on top of that.
 * Mixing the two produces the classic blurry-canvas bug.
 */

import type { Camera } from "./camera";
import { GRID_MAJOR_COLOR, GRID_MINOR_COLOR, gridLines, isMajor } from "./grid";
import {
  applyTransform,
  normalizeGradientStops,
  strokeBounds,
  unionBounds,
  type Bounds,
  type Stroke,
} from "./stroke";

/**
 * Area-weighted centroid of a polygon; the centre of a radial gradient.
 *
 * The mean of the vertices would be wrong for a lasso of uneven sampling, and
 * wrong by a visible amount for a closed path, whose last point repeats the
 * first. The signed-area formula is exact for any simple polygon and ignores
 * the repeated closing point on its own.
 */
function polygonCentre(points: { x: number; y: number }[]): { x: number; y: number } {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    // A degenerate (zero-area) path has no interior, so fall back to the mean.
    let x = 0;
    let y = 0;
    for (const point of points) {
      x += point.x;
      y += point.y;
    }
    return { x: x / Math.max(1, points.length), y: y / Math.max(1, points.length) };
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export interface SelectionBox {
  bounds: Bounds;
  /** Rotation in radians, for drawing the box itself. */
  rotation: number;
}

export interface LassoPath {
  points: { x: number; y: number }[];
  done: boolean;
}

export interface RenderInput {
  context: CanvasRenderingContext2D | null;
  camera: Camera;
  viewport: Viewport;
  strokes: Stroke[];
  selection?: SelectionBox | null;
  lasso?: LassoPath | null;
  /** Draw the eraser brush ring under the cursor. */
  cursor?: { x: number; y: number; radius: number } | null;
}

/** Sizes the buffer to the element box and resets the base transform. */
export function prepareContext(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
): void {
  const bufferWidth = Math.max(1, Math.round(viewport.width * viewport.dpr));
  const bufferHeight = Math.max(1, Math.round(viewport.height * viewport.dpr));
  if (context.canvas.width !== bufferWidth || context.canvas.height !== bufferHeight) {
    context.canvas.width = bufferWidth;
    context.canvas.height = bufferHeight;
  }
  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

export function render(input: RenderInput): void {
  const { camera, viewport, strokes } = input;
  const context = input.context;
  if (!context) {
    return;
  }
  prepareContext(context, viewport);

  context.save();
  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  // Painter's algorithm: the grid sits underneath everything.
  drawGrid(context, camera, viewport);

  // World space: translate then scale, so stroke coordinates are untouched by
  // the zoom and remain stable when the camera moves.
  context.save();
  context.translate(-camera.x * camera.scale, -camera.y * camera.scale);
  context.scale(camera.scale, camera.scale);

  context.lineCap = "round";
  context.lineJoin = "round";

  for (const stroke of strokes) {
    drawStroke(context, stroke, camera.scale);
  }

  context.restore();

  // Overlays are drawn in screen space so their line widths and handle sizes do
  // not grow with the zoom.
  if (input.lasso) {
    drawLasso(context, camera, input.lasso);
  }
  if (input.selection) {
    drawSelectionBox(context, camera, input.selection);
  }
  if (input.cursor) {
    drawCursor(context, input.cursor);
  }

  context.restore();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
): void {
  const { vertical, horizontal } = gridLines(camera, viewport.width, viewport.height);
  context.lineWidth = 1;

  // Minor and major lines are drawn in two passes so each can use one path and
  // one colour, instead of switching strokeStyle per line.
  for (const major of [false, true]) {
    context.strokeStyle = major ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
    context.beginPath();
    for (const line of vertical) {
      if (isMajor(line.index) !== major) {
        continue;
      }
      // The half-pixel offset keeps a 1px line crisp instead of straddling two.
      const x = Math.round(line.screen) + 0.5;
      context.moveTo(x, 0);
      context.lineTo(x, viewport.height);
    }
    for (const line of horizontal) {
      if (isMajor(line.index) !== major) {
        continue;
      }
      const y = Math.round(line.screen) + 0.5;
      context.moveTo(0, y);
      context.lineTo(viewport.width, y);
    }
    context.stroke();
  }
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
): void {
  const { points, style, transform } = stroke;
  if (points.length === 0) {
    return;
  }

  // Handle fill and gradient-fill styles: draw as filled polygon
  if (style.drawStyle === "fill" || style.drawStyle === "gradient-fill") {
    context.save();
    context.globalAlpha = style.opacity;

    context.beginPath();
    const first = applyTransform(transform, points[0].x, points[0].y);
    context.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      const world = applyTransform(transform, point.x, point.y);
      context.lineTo(world.x, world.y);
    }
    context.closePath();

    if (style.drawStyle === "gradient-fill") {
      // The polygon closes with a copy of its first point, so the axis runs
      // from where the lasso started to where it ended.
      const last = applyTransform(
        transform,
        points[points.length - 2].x,
        points[points.length - 2].y,
      );
      const stops = normalizeGradientStops(style.gradientStops, style.color);

      let gradient: CanvasGradient;
      if (style.gradientType === "radial") {
        const vertices = points.map((point) =>
          applyTransform(transform, point.x, point.y),
        );
        const centre = polygonCentre(vertices);
        const radius = Math.max(
          1,
          ...vertices.map((vertex) =>
            Math.hypot(vertex.x - centre.x, vertex.y - centre.y),
          ),
        );
        gradient = context.createRadialGradient(
          centre.x,
          centre.y,
          0,
          centre.x,
          centre.y,
          radius,
        );
      } else {
        gradient = context.createLinearGradient(
          first.x,
          first.y,
          last.x,
          last.y,
        );
      }

      // The alpha lives in the stroke's opacity, so only the rgb prefix is
      // used here; the stops carry their own position along the ramp.
      for (const stop of stops) {
        gradient.addColorStop(stop.position, stop.color.slice(0, 7));
      }
      context.fillStyle = gradient;
    } else {
      context.fillStyle = style.color;
    }

    context.fill();
    context.restore();
    return;
  }

  // Normal stroke drawing (marker, calligraphy, ink-pen)
  context.save();
  context.globalAlpha = style.opacity;
  context.strokeStyle = style.color;
  // Divide by the zoom so the stroke keeps its world width; the context is
  // already scaled by `scale`, so a raw width would multiply by it.
  context.lineWidth = style.width;

  context.beginPath();
  const first = applyTransform(transform, points[0].x, points[0].y);
  context.moveTo(first.x, first.y);

  if (points.length === 1) {
    // A tap is a dot: draw a zero-length segment with round caps.
    context.lineTo(first.x, first.y);
  } else {
    // Straight lines (no smoothing)
    for (const point of points.slice(1)) {
      const world = applyTransform(transform, point.x, point.y);
      context.lineTo(world.x, world.y);
    }
  }

  context.stroke();
  context.restore();
  void scale;
}

function drawLasso(
  context: CanvasRenderingContext2D,
  camera: Camera,
  lasso: LassoPath,
): void {
  if (lasso.points.length < 2) {
    return;
  }
  context.save();
  context.beginPath();
  lasso.points.forEach((point, index) => {
    const screen = {
      x: (point.x - camera.x) * camera.scale,
      y: (point.y - camera.y) * camera.scale,
    };
    if (index === 0) {
      context.moveTo(screen.x, screen.y);
    } else {
      context.lineTo(screen.x, screen.y);
    }
  });
  if (lasso.done) {
    context.closePath();
  }
  context.strokeStyle = "#e0533f";
  context.lineWidth = 1.5;
  context.setLineDash(lasso.done ? [] : [6, 4]);
  context.stroke();
  context.fillStyle = "rgba(224, 83, 63, 0.08)";
  if (lasso.done) {
    context.fill();
  }
  context.restore();
}

const HANDLE_SIZE = 9;
const ROTATE_HANDLE_DISTANCE = 26;

/** Screen-space geometry of the selection box and its handles. */
export function selectionHandlePositions(
  camera: Camera,
  box: SelectionBox,
): { corners: { x: number; y: number }[]; rotate: { x: number; y: number } } {
  const { bounds, rotation } = box;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const halfHeight = (bounds.maxY - bounds.minY) / 2;

  const local = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const corners = local.map((point) => {
    const worldX = centerX + point.x * cos - point.y * sin;
    const worldY = centerY + point.x * sin + point.y * cos;
    return {
      x: (worldX - camera.x) * camera.scale,
      y: (worldY - camera.y) * camera.scale,
    };
  });

  const top = local[0];
  const rotateLocal = {
    x: (top.x + local[1].x) / 2,
    y: (top.y + local[1].y) / 2,
  };
  const normalX = -Math.sin(rotation);
  const normalY = -Math.cos(rotation);
  const rotateWorldX = centerX + rotateLocal.x * cos - rotateLocal.y * sin;
  const rotateWorldY = centerY + rotateLocal.x * sin + rotateLocal.y * cos;
  const rotate = {
    x: (rotateWorldX - camera.x) * camera.scale + normalX * ROTATE_HANDLE_DISTANCE,
    y: (rotateWorldY - camera.y) * camera.scale + normalY * ROTATE_HANDLE_DISTANCE,
  };

  return { corners, rotate };
}

function drawSelectionBox(
  context: CanvasRenderingContext2D,
  camera: Camera,
  box: SelectionBox,
): void {
  const { corners, rotate } = selectionHandlePositions(camera, box);

  context.save();
  context.beginPath();
  corners.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.closePath();
  context.strokeStyle = "#e0533f";
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.stroke();
  context.setLineDash([]);

  // Rotation handle, on a short stem above the box.
  const topMid = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2,
  };
  context.beginPath();
  context.moveTo(topMid.x, topMid.y);
  context.lineTo(rotate.x, rotate.y);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.strokeStyle = "#e0533f";

  corners.forEach((point) => {
    context.beginPath();
    context.rect(
      point.x - HANDLE_SIZE / 2,
      point.y - HANDLE_SIZE / 2,
      HANDLE_SIZE,
      HANDLE_SIZE,
    );
    context.fill();
    context.stroke();
  });

  // The rotate handle is round so it is distinguishable at a glance.
  context.beginPath();
  context.arc(rotate.x, rotate.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // Side handles: midpoints of each edge, for single-axis scaling.
  const sides = [
    { a: corners[0], b: corners[1] },
    { a: corners[1], b: corners[2] },
    { a: corners[2], b: corners[3] },
    { a: corners[3], b: corners[0] },
  ];
  sides.forEach(({ a, b }) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    context.beginPath();
    context.rect(mid.x - HANDLE_SIZE / 2, mid.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    context.fill();
    context.stroke();
  });

  context.restore();
}

function drawCursor(
  context: CanvasRenderingContext2D,
  cursor: { x: number; y: number; radius: number },
): void {
  context.save();
  context.beginPath();
  context.arc(cursor.x, cursor.y, cursor.radius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(0,0,0,0.45)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

/** Bounds of a set of strokes, for framing the selection box. */
export function selectionBounds(strokes: Stroke[]): Bounds | null {
  return unionBounds(strokes.map(strokeBounds));
}
