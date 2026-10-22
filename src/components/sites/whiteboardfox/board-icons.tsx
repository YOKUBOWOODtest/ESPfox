"use client";

import Image from "next/image";

/**
 * Board toolbar glyphs.
 *
 * The source's menu strip is built by GWT: each button is a 32x32 icon above a
 * 13px label. Six of the seven icons are plain PNGs served from its own
 * `images/` directory, which are kept byte-for-byte here. The pencil is an
 * inline SVG (the only button with no image), so its path is reproduced
 * verbatim, including the source's rotation/scale group.
 */

/** The source's pencil path, shared by the toolbar and every colour swatch. */
const PENCIL_PATH =
  "M 98.075 17.228 C 96.832 14.873 93 10.9 91 8.9 C 89.2 7.2 86.6 5.2 84.8 4 C 81.8 1.9 77.7 2.3 75.2 4.8 L 11.5 68.4 C 11.3 68.6 11.1 68.9 11 69.2 C 11 69.2 3.127 96.561 4.027 97.461 C 4.727 98.161 5.13 98.902 6.03 98.902 C 6.43 98.902 33.05 90.428 33.05 90.428 C 33.35 90.328 98.164 26.735 98.164 26.735 C 100.764 24.235 99.817 20.528 98.075 17.228 Z M 14.9 71.3 C 24.183 72.312 27.184 75.656 29.664 86.468 L 16.164 90.876 C 15.664 89.876 11 85.4 10 84.9 L 14.9 71.3 Z";

export function PencilIcon({ fill, size = 32 }: { fill: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="12 0 100 105"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <g transform="rotate(-45 50 62.5) scale(1.1 1.15) rotate(45 50 62.5)">
        <path d={PENCIL_PATH} fill={fill} />
      </g>
    </svg>
  );
}

/** The PNGs the source ships, kept at their original paths. */
const ICON_SRC = "/sites/whiteboardfox/board";

export function UndoIcon() {
  return <Image src={`${ICON_SRC}/Undo.png`} alt="" width={32} height={32} />;
}

export function EraserIcon() {
  return <Image src={`${ICON_SRC}/Eraser.png`} alt="" width={32} height={32} />;
}

export function MoveIcon() {
  return <Image src={`${ICON_SRC}/Move.png`} alt="" width={32} height={32} />;
}

export function SelectIcon() {
  return <Image src={`${ICON_SRC}/Select.png`} alt="" width={32} height={32} />;
}

export function CogIcon() {
  return <Image src={`${ICON_SRC}/Cog.png`} alt="" width={32} height={32} />;
}

export function TrashIcon() {
  return <Image src={`${ICON_SRC}/Trash.png`} alt="" width={32} height={32} />;
}

/**
 * The Import glyph.
 *
 * The source has no import button — here.fm's room does — so this is a small
 * inline SVG: a picture with an arrow pointing into it, the way a file is
 * brought onto a board.
 */
export function ImportIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="5.5"
        width="25"
        height="21"
        rx="3"
        fill="none"
        stroke="#4a4a4a"
        strokeWidth="2"
      />
      <path
        d="M16 9v9m0 0 4-4m-4 4-4-4"
        fill="none"
        stroke="#4a4a4a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Generated placeholder avatar.
 *
 * The source renders a `w-8 h-8` SVG when a user has no uploaded picture: two
 * stacked circles plus the generic silhouette path. Members with a picture use
 * an `<img>` instead, so the same two shapes are exposed here.
 */
export function Avatar({
  hue,
  imageUrl,
}: {
  hue: number;
  /** When set, the source would show a real picture instead of the silhouette. */
  imageUrl?: string;
}) {
  if (imageUrl) {
    return (
      // Remote avatars are user-uploaded, so this is deliberately a plain img.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
    );
  }
  return (
    <svg
      className="w-8 h-8 max-w-full max-h-full"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      aria-hidden="true"
    >
      <circle cx="256" cy="256" r="256" fill="#FFFFFF88" />
      <circle cx="256" cy="256" r="256" fill={`hsl(${hue}, 75%, 43%)`} />
      <path
        d="M399 384.2C376.9 345.8 335.4 320 288 320H224c-47.4 0-88.9 25.8-111 64.2c35.2 39.2 86.2 63.8 143 63.8s107.8-24.7 143-63.8zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256 16a72 72 0 1 0 0-144 72 72 0 1 0 0 144z"
        fill="#FFFFFF88"
      />
    </svg>
  );
}
