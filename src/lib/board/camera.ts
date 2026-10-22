/**
 * Camera for the infinite canvas.
 *
 * The board has no fixed size: the camera holds a pan offset and a zoom, and
 * "world" coordinates are unbounded. Keeping this separate from
 * `devicePixelRatio` matters — the buffer is scaled by DPR, the view by `scale`,
 * and mixing the two is what makes a canvas grid turn into grey mush.
 */

export interface Camera {
  /** World-space point shown at the viewport's top-left corner. */
  x: number;
  y: number;
  /** Zoom factor. 1 = world units are CSS pixels. */
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/** The source starts every board at a 1:1 zoom. */
export function initialCamera(): Camera {
  return { x: 0, y: 0, scale: 1 };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Converts a viewport point (CSS px, canvas-relative) to world coordinates. */
export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: camera.x + screenX / camera.scale,
    y: camera.y + screenY / camera.scale,
  };
}

/** Converts a world point back to viewport coordinates. */
export function worldToScreen(
  camera: Camera,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * camera.scale,
    y: (worldY - camera.y) * camera.scale,
  };
}

/** Pans by a delta measured in *screen* pixels. */
export function panBy(camera: Camera, screenDx: number, screenDy: number): Camera {
  return {
    ...camera,
    x: camera.x - screenDx / camera.scale,
    y: camera.y - screenDy / camera.scale,
  };
}

/**
 * Zooms towards a fixed viewport point, so the world position under the cursor
 * stays under the cursor. Without anchoring, wheel-zoom drifts away from what
 * the user is looking at.
 */
export function zoomAt(
  camera: Camera,
  screenX: number,
  screenY: number,
  factor: number,
): Camera {
  const scale = clampScale(camera.scale * factor);
  if (scale === camera.scale) {
    return camera;
  }
  // The world point under the cursor before and after the zoom must agree.
  const before = screenToWorld(camera, screenX, screenY);
  const after = screenToWorld({ ...camera, scale }, screenX, screenY);
  return {
    scale,
    x: camera.x + (before.x - after.x),
    y: camera.y + (before.y - after.y),
  };
}

/** Centres the view on a world point at the current zoom. */
export function centerOn(
  camera: Camera,
  worldX: number,
  worldY: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  return {
    ...camera,
    x: worldX - viewportWidth / 2 / camera.scale,
    y: worldY - viewportHeight / 2 / camera.scale,
  };
}

/** Format used by the on-screen zoom readout. */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
