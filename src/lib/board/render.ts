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
import { invertColor } from "./color";
import { GRID_MAJOR_COLOR, GRID_MINOR_COLOR, gridLines, isMajor } from "./grid";
import {
  formatDuration,
  itemCorners,
  itemHalfSize,
  itemsInPaintOrder,
  type ImportedItem,
} from "./imported";
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
  /** The media the board carries, drawn on top of the ink. */
  items?: ImportedItem[];
  /** The board's background colour; white when not set. */
  background?: string;
  /**
   * Whether the board is drawn with inverted colours.
   *
   * This is a personal setting: the board itself is untouched, only this
   * browser's view of it is flipped.
   */
  flipColors?: boolean;
  /** Whether the grid is drawn. */
  showGrid?: boolean;
  /** The board's grid size, in world units. */
  gridSize?: number;
  /** The imported item that is selected, if any. */
  selectedItemId?: string | null;
  /** The imported item that is playing, if any. */
  playingItemId?: string | null;
  selection?: SelectionBox | null;
  lasso?: LassoPath | null;
  /** Draw the eraser brush ring under the cursor. */
  cursor?: { x: number; y: number; radius: number } | null;
  /** The spawn zone for user avatars, if any. */
  spawnZone?: { center: { x: number; y: number }; cols: number; rows: number; spacing: number } | null;
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

  const flip = input.flipColors === true;
  /** Every colour the board paints goes through here, so "flip" is one rule. */
  const tint = (hex: string) => (flip ? invertColor(hex) : hex);

  context.save();
  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  // The board's own colour, not the page's: the host can change it.
  context.fillStyle = tint(input.background ?? "#ffffff");
  context.fillRect(0, 0, viewport.width, viewport.height);

  // Painter's algorithm: the grid sits underneath everything.
  if (input.showGrid !== false) {
    drawGrid(context, camera, viewport, input.gridSize, tint);
  }

  // Draw spawn zone (in world space)
  if (input.spawnZone) {
    drawSpawnZone(context, camera, viewport, input.spawnZone, tint);
  }

  // World space: translate then scale, so stroke coordinates are untouched by
  // the zoom and remain stable when the camera moves.
  context.save();
  context.translate(-camera.x * camera.scale, -camera.y * camera.scale);
  context.scale(camera.scale, camera.scale);

  context.lineCap = "round";
  context.lineJoin = "round";

  for (const stroke of strokes) {
    drawStroke(context, stroke, camera.scale, tint);
  }

  // Imported media sits on top of the ink, the way a sticker does. Pinned
  // items go last, so they stay in front of the rest of the stack.
  for (const item of itemsInPaintOrder(input.items ?? [])) {
    drawItem(context, item, flip, item.id === input.playingItemId);
  }

  context.restore();

  // Overlays are drawn in screen space so their line widths and handle sizes do
  // not grow with the zoom.
  const selected = (input.items ?? []).find((item) => item.id === input.selectedItemId);
  if (selected) {
    drawItemChrome(context, camera, selected, tint);
  }
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
  gridSize: number | undefined,
  tint: (hex: string) => string,
): void {
  const { vertical, horizontal } = gridLines(
    camera,
    viewport.width,
    viewport.height,
    gridSize,
  );
  context.lineWidth = 1;

  // Minor and major lines are drawn in two passes so each can use one path and
  // one colour, instead of switching strokeStyle per line.
  for (const major of [false, true]) {
    context.strokeStyle = tint(major ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR);
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

/** Draws the spawn zone rectangle for user avatars. */
function drawSpawnZone(
  context: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Viewport,
  spawnZone: { center: { x: number; y: number }; cols: number; rows: number; spacing: number },
  tint: (hex: string) => string,
): void {
  const { center, cols, rows, spacing } = spawnZone;
  const halfWidth = ((cols - 1) * spacing) / 2;
  const halfHeight = ((rows - 1) * spacing) / 2;
  const left = center.x - halfWidth - spacing / 2;
  const right = center.x + halfWidth + spacing / 2;
  const top = center.y - halfHeight - spacing / 2;
  const bottom = center.y + halfHeight + spacing / 2;

  // Convert to screen coordinates
  const screenLeft = (left - camera.x) * camera.scale;
  const screenRight = (right - camera.x) * camera.scale;
  const screenTop = (top - camera.y) * camera.scale;
  const screenBottom = (bottom - camera.y) * camera.scale;

  context.save();
  context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  context.strokeStyle = tint("#e0533f");
  context.lineWidth = 2 / viewport.dpr;
  context.setLineDash([10 / viewport.dpr, 6 / viewport.dpr]);
  context.beginPath();
  context.rect(screenLeft, screenTop, screenRight - screenLeft, screenBottom - screenTop);
  context.stroke();
  context.restore();
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  tint: (hex: string) => string,
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
        gradient.addColorStop(stop.position, tint(stop.color.slice(0, 7)));
      }
      context.fillStyle = gradient;
    } else {
      context.fillStyle = tint(style.color);
    }

    context.fill();
    context.restore();
    return;
  }

  // Normal stroke drawing (marker, calligraphy, ink-pen)
  context.save();
  context.globalAlpha = style.opacity;
  context.strokeStyle = tint(style.color);
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

/* --- Imported items -------------------------------------------------------- */

/**
 * Decoded images, kept by source.
 *
 * An <img> element is decoded by the browser once and then drawn many times,
 * so the board never pays for the decode on every frame.
 */
const imageCache = new Map<string, HTMLImageElement>();

function cachedImage(src: string): HTMLImageElement | null {
  if (typeof window === "undefined" || !src) {
    return null;
  }
  const existing = imageCache.get(src);
  if (existing) {
    return existing;
  }
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  imageCache.set(src, image);
  return image;
}

/** Rounds the corners of the current path. */
function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

/**
 * A stable pseudo-waveform for an audio item.
 *
 * The bars are derived from the name, so the same file always looks the same
 * and the card does not jump around between frames.
 */
function waveformBars(seed: string, count: number): number[] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    hash = (hash * 1103515245 + 12345) % 2147483648;
    bars.push(0.25 + (hash % 1000) / 1250);
  }
  return bars;
}

/** Draws one imported item, in world space. */
function drawItem(
  context: CanvasRenderingContext2D,
  item: ImportedItem,
  flip: boolean,
  playing: boolean,
): void {
  const { halfWidth, halfHeight } = itemHalfSize(item);

  context.save();
  context.translate(item.x, item.y);
  context.rotate(item.rotation);
  if (item.mirrored) {
    context.scale(-1, 1);
  }

  if (item.kind === "image") {
    const image = cachedImage(item.src);
    if (image && image.complete && image.naturalWidth > 0) {
      if (flip) {
        // A picture becomes its negative, like every other colour.
        context.filter = "invert(1)";
      }
      context.drawImage(image, -halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
      context.filter = "none";
    } else {
      // Not decoded yet: a placeholder that keeps the item's footprint.
      context.fillStyle = flip ? "#2f2f2f" : "#ececec";
      context.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
      context.strokeStyle = flip ? "#5c5c5c" : "#bdbdbd";
      context.lineWidth = 1;
      context.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    }
    context.restore();
    return;
  }

  if (item.kind === "file") {
    drawFileCard(context, item, halfWidth, halfHeight, flip);
    context.restore();
    return;
  }

  drawAudioCard(context, item, halfWidth, halfHeight, flip, playing);
  context.restore();
}

/**
 * The card a file that is not a picture is drawn on.
 *
 * here.fm shows a file that is not an image as a card with the file's name
 * on it, the same way it shows an audio file as a card with a play button.
 */
function drawFileCard(
  context: CanvasRenderingContext2D,
  item: ImportedItem,
  halfWidth: number,
  halfHeight: number,
  flip: boolean,
): void {
  const width = halfWidth * 2;
  const height = halfHeight * 2;

  context.fillStyle = flip ? "#1d1d1d" : "#ffffff";
  roundRect(context, -halfWidth, -halfHeight, width, height, 14);
  context.fill();
  context.strokeStyle = flip ? "#3d3d3d" : "#d9d9d9";
  context.lineWidth = 1;
  context.stroke();

  // A small sheet of paper, the way a file is shown on the web.
  const paperX = -halfWidth + 24;
  const paperWidth = 30;
  const paperHeight = 38;
  const paperY = -paperHeight / 2;
  context.fillStyle = flip ? "#f4f4f4" : "#f6f6f6";
  roundRect(context, paperX - paperWidth / 2, paperY, paperWidth, paperHeight, 4);
  context.fill();
  context.strokeStyle = flip ? "#5c5c5c" : "#c9c9c9";
  context.stroke();

  // The lines on the sheet.
  context.strokeStyle = flip ? "#6f6f6f" : "#bdbdbd";
  context.lineWidth = 2;
  for (let line = 0; line < 3; line += 1) {
    const lineY = paperY + 11 + line * 8;
    context.beginPath();
    context.moveTo(paperX - 9, lineY);
    context.lineTo(paperX + 9, lineY);
    context.stroke();
  }

  // The name of the file.
  const textX = -halfWidth + 50;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = flip ? "#f4f4f4" : "#222222";
  context.font = "600 15px Roboto, sans-serif";
  context.fillText(
    trimToWidth(context, item.name, halfWidth * 2 - 68),
    textX,
    -8,
  );

  context.fillStyle = flip ? "#a8a8a8" : "#6b6b6b";
  context.font = "12px Roboto, sans-serif";
  context.fillText("File", textX, 12);
}

/** The card an audio file or a voice note is drawn on. */
function drawAudioCard(
  context: CanvasRenderingContext2D,
  item: ImportedItem,
  halfWidth: number,
  halfHeight: number,
  flip: boolean,
  playing: boolean,
): void {
  const width = halfWidth * 2;
  const height = halfHeight * 2;

  context.fillStyle = flip ? "#1d1d1d" : "#ffffff";
  roundRect(context, -halfWidth, -halfHeight, width, height, 14);
  context.fill();
  context.strokeStyle = flip ? "#3d3d3d" : "#d9d9d9";
  context.lineWidth = 1;
  context.stroke();

  // The play button.
  const buttonX = -halfWidth + 30;
  context.fillStyle = flip ? invertColor("#e0533f") : "#e0533f";
  context.beginPath();
  context.arc(buttonX, 0, 15, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  if (playing) {
    context.fillRect(buttonX - 5, -7, 4, 14);
    context.fillRect(buttonX + 1, -7, 4, 14);
  } else {
    context.beginPath();
    context.moveTo(buttonX - 4, -8);
    context.lineTo(buttonX + 7, 0);
    context.lineTo(buttonX - 4, 8);
    context.closePath();
    context.fill();
  }

  // The name and the length.
  const textX = -halfWidth + 54;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = flip ? "#f4f4f4" : "#222222";
  context.font = "600 15px Roboto, sans-serif";
  const label =
    item.kind === "voice" ? `Voice note — ${item.name}` : item.name;
  context.fillText(trimToWidth(context, label, halfWidth * 2 - 70), textX, -9);

  context.fillStyle = flip ? "#a8a8a8" : "#6b6b6b";
  context.font = "12px Roboto, sans-serif";
  context.fillText(formatDuration(item.duration), textX, 11);

  // The waveform, on the right of the card.
  const bars = waveformBars(item.name, 16);
  const barWidth = 3;
  const barGap = 2;
  const barsWidth = bars.length * (barWidth + barGap);
  let barX = halfWidth - 14 - barsWidth;
  const maxBar = halfHeight - 18;
  for (const value of bars) {
    const barHeight = Math.max(3, value * maxBar);
    context.fillStyle = playing
      ? flip
        ? invertColor("#e0533f")
        : "#e0533f"
      : flip
        ? "#6f6f6f"
        : "#cfcfcf";
    context.fillRect(barX, -barHeight / 2, barWidth, barHeight);
    barX += barWidth + barGap;
  }
}

/** Cuts a label with an ellipsis so it fits the space it has. */
function trimToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/* --- The small options under an imported item -------------------------------- */

/** The buttons that sit under a selected item, as here.fm shows them. */
export type ItemHandle = "download" | "rotate" | "dots" | "resize";

export interface ItemChrome {
  /** The item's corners, in screen space. */
  corners: { x: number; y: number }[];
  download: { x: number; y: number };
  rotate: { x: number; y: number };
  dots: { x: number; y: number };
  resize: { x: number; y: number };
}

/** Screen-space geometry of an item's frame and its small options. */
export function itemChromePositions(camera: Camera, item: ImportedItem): ItemChrome {
  const corners = itemCorners(item).map((point) => ({
    x: (point.x - camera.x) * camera.scale,
    y: (point.y - camera.y) * camera.scale,
  }));
  // The options sit under the item's bottom edge, in a row.
  const bottom = {
    x: (corners[2].x + corners[3].x) / 2,
    y: (corners[2].y + corners[3].y) / 2,
  };
  const rowY = bottom.y + 26;
  return {
    corners,
    download: { x: bottom.x - 36, y: rowY },
    rotate: { x: bottom.x - 12, y: rowY },
    dots: { x: bottom.x + 12, y: rowY },
    resize: { x: bottom.x + 36, y: rowY },
  };
}

/** Draws the frame and the small options of a selected item. */
function drawItemChrome(
  context: CanvasRenderingContext2D,
  camera: Camera,
  item: ImportedItem,
  tint: (hex: string) => string,
): void {
  const chrome = itemChromePositions(camera, item);
  const accent = tint("#e0533f");

  context.save();
  context.beginPath();
  chrome.corners.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.closePath();
  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.stroke();
  context.setLineDash([]);

  // The row of small options.
  const button = (centre: { x: number; y: number }) => {
    context.beginPath();
    context.arc(centre.x, centre.y, 11, 0, Math.PI * 2);
    context.fillStyle = tint("#ffffff");
    context.fill();
    context.strokeStyle = accent;
    context.lineWidth = 1.2;
    context.stroke();
  };

  button(chrome.download);
  button(chrome.rotate);
  button(chrome.dots);
  button(chrome.resize);

  context.strokeStyle = accent;
  context.fillStyle = accent;
  context.lineWidth = 1.4;

  // Download: an arrow into a tray.
  context.beginPath();
  context.moveTo(chrome.download.x, chrome.download.y - 5);
  context.lineTo(chrome.download.x, chrome.download.y + 2);
  context.moveTo(chrome.download.x - 3, chrome.download.y - 1);
  context.lineTo(chrome.download.x, chrome.download.y + 2);
  context.lineTo(chrome.download.x + 3, chrome.download.y - 1);
  context.stroke();

  // Rotate: an open circle with an arrow head.
  context.beginPath();
  context.arc(chrome.rotate.x, chrome.rotate.y, 5, Math.PI * 0.4, Math.PI * 1.75);
  context.stroke();
  context.beginPath();
  context.moveTo(chrome.rotate.x + 4, chrome.rotate.y - 5);
  context.lineTo(chrome.rotate.x + 6, chrome.rotate.y - 1);
  context.lineTo(chrome.rotate.x + 2, chrome.rotate.y - 2);
  context.closePath();
  context.fill();

  // The three dots.
  for (const offset of [-3.5, 0, 3.5]) {
    context.beginPath();
    context.arc(chrome.dots.x + offset, chrome.dots.y, 1.3, 0, Math.PI * 2);
    context.fill();
  }

  // Resize: a diagonal arrow.
  context.beginPath();
  context.moveTo(chrome.resize.x - 5, chrome.resize.y + 5);
  context.lineTo(chrome.resize.x + 4, chrome.resize.y - 4);
  context.stroke();
  context.beginPath();
  context.moveTo(chrome.resize.x + 5, chrome.resize.y - 5);
  context.lineTo(chrome.resize.x + 5, chrome.resize.y + 0.5);
  context.lineTo(chrome.resize.x + 0.5, chrome.resize.y - 5);
  context.closePath();
  context.fill();

  context.restore();
}

function drawLasso(
  context: CanvasRenderingContext2D,
  camera: Camera,
  lasso: LassoPath,
): void {  if (lasso.points.length < 2) {
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
