/**
 * Imported items — the media a board can carry.
 *
 * A whiteboard is not only ink: here.fm lets a room drop in an image, an audio
 * file or a recorded voice note, and those pieces then behave like little
 * objects on the board. They are not strokes, so they cannot live in the
 * stroke array; they carry their own geometry instead.
 *
 * The geometry is deliberately simple and explicit:
 *   - `x`/`y` are the *centre* of the item, in world units;
 *   - `width`/`height` are the intrinsic size, before `scale`;
 *   - `scale` is a uniform factor on top of that;
 *   - `rotation` is in radians, around the centre.
 *
 * Keeping the pieces separate (rather than folding them into an affine matrix
 * like a stroke) means the panel can show a scale percentage and an angle
 * without having to decompose a matrix, and the undo history can restore them
 * by value.
 */

export type ImportedKind = "image" | "file" | "audio" | "voice";

export interface ImportedItem {
  /** Stable id, used as the React key and in the undo history. */
  id: string;
  kind: ImportedKind;
  /** The file name, shown on the card. */
  name: string;
  /**
   * Where the media lives.
   *
   * A data URL when the file was small enough to inline, an object URL
   * otherwise. Object URLs die with the tab, so an item that carries one cannot
   * be restored from a saved board.
   */
  src: string;
  /** Centre of the item, in world units. */
  x: number;
  y: number;
  /** Intrinsic size in world units, before `scale`. */
  width: number;
  height: number;
  /** Uniform scale applied to the intrinsic size. */
  scale: number;
  /** Rotation in radians, around the centre. */
  rotation: number;
  /** Whether the item is drawn mirrored; only images can be. */
  mirrored: boolean;
  /** Pinned items are drawn on top of the others. */
  pinned: boolean;
  /** Locked items cannot be moved, scaled or rotated. */
  locked: boolean;
  /** Playback length in seconds; zero for images. */
  duration: number;
  createdAt: number;
}

/** The media a file or a recording contributes, before it is placed. */
export interface ImportedMedia {
  kind: ImportedKind;
  name: string;
  src: string;
  width: number;
  height: number;
  duration: number;
}

let nextItemId = 0;

/** Monotonic ids; items never cross a serialisation boundary in this build. */
export function importedItemId(): string {
  nextItemId += 1;
  return `i${nextItemId}`;
}

/** The size of the card an audio or voice item is drawn on. */
export const AUDIO_CARD_WIDTH = 240;
export const AUDIO_CARD_HEIGHT = 72;

/** Creates an item, centred on the given point. */
export function createImportedItem(
  media: ImportedMedia,
  x: number,
  y: number,
): ImportedItem {
  return {
    id: importedItemId(),
    kind: media.kind,
    name: media.name,
    src: media.src,
    x,
    y,
    width: media.width,
    height: media.height,
    scale: 1,
    rotation: 0,
    mirrored: false,
    pinned: false,
    locked: false,
    duration: media.duration,
    createdAt: Date.now(),
  };
}

/** Half-extent of the item, after its scale. */
export function itemHalfSize(item: ImportedItem): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: (item.width * item.scale) / 2,
    halfHeight: (item.height * item.scale) / 2,
  };
}

/**
 * The four corners of the item, in world space.
 *
 * The order is the one the selection box uses: north-west, north-east,
 * south-east, south-west.
 */
export function itemCorners(item: ImportedItem): { x: number; y: number }[] {
  const { halfWidth, halfHeight } = itemHalfSize(item);
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const local = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];
  return local.map((point) => ({
    x: item.x + point.x * cos - point.y * sin,
    y: item.y + point.x * sin + point.y * cos,
  }));
}

/** Whether a world point lands on the item. */
export function itemHitTest(item: ImportedItem, worldX: number, worldY: number): boolean {
  const { halfWidth, halfHeight } = itemHalfSize(item);
  // Into the item's own frame: undo the rotation, then the scale.
  const dx = worldX - item.x;
  const dy = worldY - item.y;
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const localX = (dx * cos + dy * sin) / (item.scale || 1);
  const localY = (-dx * sin + dy * cos) / (item.scale || 1);
  return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight;
}

/** Formats a duration as `m:ss`, the way a voice note is labelled. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Where the play button of an audio card sits.
 *
 * The button is part of the card, so it is placed in the item's own frame:
 * a fixed distance from the card's left edge, on its vertical middle.
 */
export function itemPlayButton(item: ImportedItem): { x: number; y: number } {
  return { x: -item.width / 2 + 30, y: 0 };
}

/** Whether a world point lands on an item's play button. */
export function itemPlayButtonHit(
  item: ImportedItem,
  worldX: number,
  worldY: number,
): boolean {
  if (item.kind === "image" || item.kind === "file") {
    return false;
  }
  const dx = worldX - item.x;
  const dy = worldY - item.y;
  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const scale = item.scale || 1;
  const localX = (dx * cos + dy * sin) / scale;
  const localY = (-dx * sin + dy * cos) / scale;
  const button = itemPlayButton(item);
  return Math.hypot(localX - button.x, localY - button.y) <= 18;
}
