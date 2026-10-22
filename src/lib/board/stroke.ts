/**
 * Stroke model and pure geometry.
 *
 * The previous board kept one flat array of points and "erased" by painting
 * white over them. That cannot support stroke-based erasure or lasso selection,
 * because there is no notion of *which* stroke a point belongs to. Here a
 * stroke is a first-class object: an ordered list of points plus its own style
 * and an affine transform, which is what lets selection scale, move and rotate
 * a whole stroke without touching its points.
 *
 * Everything in this file is pure: no DOM, no React, no canvas.
 */

export interface Point {
  x: number;
  y: number;
  /** Stylus force 0-1; 0 for mouse, exactly as the source passes it. */
  pressure: number;
  /** Milliseconds since the stroke began, used by the smoothing pass. */
  t: number;
}

/** 2D affine transform, stored as the six meaningful canvas matrix values. */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Drawing style variants within the Draw tool. */
export type DrawStyle = "marker" | "fill" | "gradient-fill" | "calligraphy";

/** How a gradient ramp is projected onto the filled shape. */
export type GradientType = "linear" | "radial";

/** One colour stop of a gradient ramp. */
export interface GradientStop {
  /** `#rrggbbaa`; the alpha is redundant with the stroke opacity but kept whole. */
  color: string;
  /** Position along the ramp, 0..1. */
  position: number;
}

export interface StrokeStyle {
  color: string;
  /** Width in world units at 100% pressure. */
  width: number;
  opacity: number;
  /** Current draw style variant. */
  drawStyle: DrawStyle;
  /** Ramp projection; only read by "gradient-fill". */
  gradientType?: GradientType;
  /**
   * Colour stops of the gradient, ordered by position.
   *
   * Supporting more than two colours is a whiteboardMOD extension of the
   * source, which only ever ramps between a pair; the source also only ramps
   * along a straight axis, whereas a radial ramp is a whiteboardMOD extension
   * too.
   */
  gradientStops?: GradientStop[];
}

/**
 * Sorts, clamps and pads a stop list so the renderer always gets a usable ramp.
 *
 * The canvas gradient API needs offsets in 0..1 and non-decreasing, and it
 * refuses a ramp with fewer than two stops, so both are enforced here rather
 * than at every call site.
 *
 * Stops that are already in range keep their identity, so a caller can still
 * find the stop it just inserted after the list has been reordered.
 */
export function normalizeGradientStops(
  stops: GradientStop[] | undefined,
  fallback: string,
): GradientStop[] {
  const cleaned = (stops ?? [])
    .filter((stop) => stop && typeof stop.color === "string" && stop.color.length > 0)
    .map((stop) => {
      const position = Math.min(
        1,
        Math.max(0, Number.isFinite(stop.position) ? stop.position : 0),
      );
      return position === stop.position ? stop : { ...stop, position };
    })
    .sort((a, b) => a.position - b.position);

  if (cleaned.length === 0) {
    return [
      { color: fallback, position: 0 },
      { color: fallback, position: 1 },
    ];
  }
  if (cleaned.length === 1) {
    return [
      { ...cleaned[0], position: 0 },
      { ...cleaned[0], position: 1 },
    ];
  }
  return cleaned;
}

export interface Stroke {
  id: string;
  points: Point[];
  style: StrokeStyle;
  transform: Transform;
}

let nextId = 0;

/** Monotonic ids; strokes never cross a serialisation boundary in this build. */
export function strokeId(): string {
  nextId += 1;
  return `s${nextId}`;
}

export function createStroke(
  points: Point[],
  style: StrokeStyle,
): Stroke {
  return { id: strokeId(), points, style, transform: { ...IDENTITY } };
}

/* --- Transform maths ------------------------------------------------------ */

/** Applies a transform to a point. */
export function applyTransform(t: Transform, x: number, y: number): { x: number; y: number } {
  return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
}

/**
 * Composition, returning the transform that applies `inner` and then `outer`
 * (i.e. `outer ∘ inner`), matching how canvas `transform()` accumulates.
 */
export function multiply(outer: Transform, inner: Transform): Transform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function translation(dx: number, dy: number): Transform {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Scale/rotate about an arbitrary pivot, which is how selection handles work. */
export function scaleAbout(scaleX: number, scaleY: number, pivotX: number, pivotY: number): Transform {
  return multiply(
    translation(pivotX, pivotY),
    multiply(
      { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 },
      translation(-pivotX, -pivotY),
    ),
  );
}

export function rotateAbout(radians: number, pivotX: number, pivotY: number): Transform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return multiply(
    translation(pivotX, pivotY),
    multiply({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }, translation(-pivotX, -pivotY)),
  );
}

/* --- Bounds --------------------------------------------------------------- */

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * World-space bounds of a stroke.
 *
 * The half-width is padded onto the box because the visible stroke extends that
 * far past its centreline; without it a selected thick stroke would have its
 * handles sitting *inside* the ink.
 */
export function strokeBounds(stroke: Stroke): Bounds {
  const half = stroke.style.width / 2;
  // The padding follows the stroke's own scale. Without that the box would
  // keep a constant margin while the shape grows, and the handle would drift
  // away from the pointer it is being dragged with.
  const scaleX = Math.hypot(stroke.transform.a, stroke.transform.b) || 1;
  const scaleY = Math.hypot(stroke.transform.c, stroke.transform.d) || 1;
  const padX = half * scaleX;
  const padY = half * scaleY;
  if (stroke.points.length === 0) {
    const origin = applyTransform(stroke.transform, 0, 0);
    return {
      minX: origin.x - padX,
      minY: origin.y - padY,
      maxX: origin.x + padX,
      maxY: origin.y + padY,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of stroke.points) {
    const world = applyTransform(stroke.transform, point.x, point.y);
    if (world.x < minX) minX = world.x;
    if (world.y < minY) minY = world.y;
    if (world.x > maxX) maxX = world.x;
    if (world.y > maxY) maxY = world.y;
  }
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  };
}

/** Union of several bounds; `null` for an empty list. */
export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) {
    return null;
  }
  let out = { ...list[0] };
  for (const bounds of list.slice(1)) {
    out = {
      minX: Math.min(out.minX, bounds.minX),
      minY: Math.min(out.minY, bounds.minY),
      maxX: Math.max(out.maxX, bounds.maxX),
      maxY: Math.max(out.maxY, bounds.maxY),
    };
  }
  return out;
}

/* --- Selection handles ---------------------------------------------------- */

/** The handles a selection offers. */
export type SelectionHandle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rotate";

/**
 * Where a handle sits and what stays put while it moves.
 *
 * Scaling a selection from a handle means the *opposite* edge or corner stays
 * where it is, so the pivot is that opposite edge and the anchor is where the
 * handle started. The factor is then `(current - pivot) / (anchor - pivot)`:
 * it is 1 while the handle has not moved, it grows as the handle is pulled
 * away from the pivot, and it turns negative — a flip — when the handle is
 * dragged past the pivot.
 */
export function handleAnchor(
  handle: SelectionHandle,
  bounds: Bounds,
): { pivot: { x: number; y: number }; anchor: { x: number; y: number } } {
  const { minX, minY, maxX, maxY } = bounds;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  switch (handle) {
    case "nw":
      return { pivot: { x: maxX, y: maxY }, anchor: { x: minX, y: minY } };
    case "ne":
      return { pivot: { x: minX, y: maxY }, anchor: { x: maxX, y: minY } };
    case "se":
      return { pivot: { x: minX, y: minY }, anchor: { x: maxX, y: maxY } };
    case "sw":
      return { pivot: { x: maxX, y: minY }, anchor: { x: minX, y: maxY } };
    case "n":
      return { pivot: { x: centerX, y: maxY }, anchor: { x: centerX, y: minY } };
    case "s":
      return { pivot: { x: centerX, y: minY }, anchor: { x: centerX, y: maxY } };
    case "w":
      return { pivot: { x: maxX, y: centerY }, anchor: { x: minX, y: centerY } };
    case "e":
      return { pivot: { x: minX, y: centerY }, anchor: { x: maxX, y: centerY } };
    default:
      // The rotate handle never scales; it spins about the middle.
      return { pivot: { x: centerX, y: centerY }, anchor: { x: centerX, y: centerY } };
  }
}

/* --- Hit testing ---------------------------------------------------------- */

/** Shortest distance from a point to a line segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  // Projection parameter, clamped to the segment.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Whether a world-space point touches a stroke.
 *
 * The threshold is the stroke's own half-width plus a tolerance, so a fat
 * stroke is easier to hit than a hairline one. This is the basis of stroke-based
 * erasure: a hit deletes the whole stroke rather than a patch of pixels.
 */
export function hitStroke(
  stroke: Stroke,
  worldX: number,
  worldY: number,
  tolerance: number,
): boolean {
  const threshold = stroke.style.width / 2 + tolerance;
  const { points, transform } = stroke;

  if (points.length === 0) {
    return false;
  }
  if (points.length === 1) {
    const only = applyTransform(transform, points[0].x, points[0].y);
    return Math.hypot(worldX - only.x, worldY - only.y) <= threshold;
  }
  for (let index = 1; index < points.length; index += 1) {
    const a = applyTransform(transform, points[index - 1].x, points[index - 1].y);
    const b = applyTransform(transform, points[index].x, points[index].y);
    if (distanceToSegment(worldX, worldY, a.x, a.y, b.x, b.y) <= threshold) {
      return true;
    }
  }
  return false;
}

/** Whether a point is inside a closed polygon (even-odd rule). */
export function pointInPolygon(
  x: number,
  y: number,
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    // The `!==` guards keep a vertex exactly on the ray from double-counting.
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a stroke should be selected by a lasso.
 *
 * The source selects anything the lasso touches, so a stroke counts when *any*
 * of its sampled points falls inside the polygon, or when the polygon itself
 * sits entirely inside a large stroke's box.
 */
export function lassoHitsStroke(
  stroke: Stroke,
  polygon: { x: number; y: number }[],
): boolean {
  if (polygon.length < 3) {
    return false;
  }
  const tolerance = stroke.style.width / 2;
  for (const point of stroke.points) {
    const world = applyTransform(stroke.transform, point.x, point.y);
    if (pointInPolygon(world.x, world.y, polygon)) {
      return true;
    }
    // Near-misses still count, matching the source's forgiving lasso.
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      if (distanceToSegment(world.x, world.y, a.x, a.y, b.x, b.y) <= tolerance) {
        return true;
      }
    }
  }
  return false;
}
