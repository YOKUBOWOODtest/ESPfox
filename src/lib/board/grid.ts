/**
 * Infinite grid.
 *
 * A naive grid drawn at a fixed world step collapses into a solid grey block as
 * soon as the user zooms out, because the on-screen spacing shrinks below a
 * pixel. The step is therefore derived from the zoom: the base world step is
 * doubled until the spacing on screen is at least `MIN_SCREEN_STEP`. This keeps
 * a roughly constant line density at every zoom level, and makes the grid look
 * genuinely infinite rather than tiled.
 */

import type { Camera } from "./camera";

/** Base spacing in world units at 100% zoom. */
export const BASE_STEP = 40;

/** Smallest on-screen spacing tolerated before the step doubles. */
export const MIN_SCREEN_STEP = 18;

/** Every Nth line is drawn heavier, giving the board a readable rhythm. */
export const MAJOR_EVERY = 5;

export const GRID_MINOR_COLOR = "#e8e8e8";
export const GRID_MAJOR_COLOR = "#d5d5d5";

/**
 * World-space grid step that keeps on-screen spacing legible at this zoom.
 *
 * `base` is the board's own grid size, which the Settings tab can change; the
 * doubling rule still applies on top of it, so a small grid does not turn into
 * a solid block when the user zooms out.
 */
export function gridStep(scale: number, base: number = BASE_STEP): number {
  let step = base > 0 ? base : BASE_STEP;
  // Doubling (not free scaling) keeps lines on a stable lattice, so they do not
  // shimmer or slide as the zoom changes.
  while (step * scale < MIN_SCREEN_STEP) {
    step *= 2;
  }
  return step;
}

export interface GridLines {
  step: number;
  /** Screen-space x offsets of vertical lines, plus their world index. */
  vertical: { screen: number; index: number }[];
  horizontal: { screen: number; index: number }[];
}

/**
 * Visible grid lines for a camera and viewport.
 *
 * Indices are carried through so the renderer can tell major lines from minor
 * ones without re-deriving them from float positions.
 */
export function gridLines(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  base: number = BASE_STEP,
): GridLines {
  const step = gridStep(camera.scale, base);

  // World bounds of the viewport.
  const worldLeft = camera.x;
  const worldTop = camera.y;
  const worldRight = camera.x + viewportWidth / camera.scale;
  const worldBottom = camera.y + viewportHeight / camera.scale;

  const vertical: { screen: number; index: number }[] = [];
  const horizontal: { screen: number; index: number }[] = [];

  const firstX = Math.floor(worldLeft / step);
  const lastX = Math.ceil(worldRight / step);
  for (let index = firstX; index <= lastX; index += 1) {
    vertical.push({
      screen: (index * step - camera.x) * camera.scale,
      index,
    });
  }

  const firstY = Math.floor(worldTop / step);
  const lastY = Math.ceil(worldBottom / step);
  for (let index = firstY; index <= lastY; index += 1) {
    horizontal.push({
      screen: (index * step - camera.y) * camera.scale,
      index,
    });
  }

  return { step, vertical, horizontal };
}

export function isMajor(index: number): boolean {
  return index % MAJOR_EVERY === 0;
}
