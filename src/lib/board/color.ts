/**
 * Colour maths for the pencil's colour wheel.
 *
 * The wheel works in HSV, not HSL. That is not an arbitrary choice: a painter
 * thinks in hue, how saturated it is, and how bright it is, and HSV is the model
 * where "keep the hue, drop the brightness" is a single multiply. HSL's
 * lightness would desaturate towards white *and* black at once, so a pure hue
 * could never be reached at full brightness.
 *
 * Everything here is pure and dependency-free, so it can be unit-tested without
 * a DOM and reused by anything that needs a colour space conversion.
 */

export interface Hsv {
  /** Hue in degrees, 0-360. */
  h: number;
  /** Saturation, 0-1. */
  s: number;
  /** Value (brightness), 0-1. */
  v: number;
}

export interface Rgb {
  /** Channels 0-255. */
  r: number;
  g: number;
  b: number;
}

/** Expands `#rgb`, `#rrggbb` or a bare `rrggbb` into `Rgb`, defaulting to black. */
export function hexToRgb(input: string): Rgb {
  let hex = input.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }
  if (hue < 0) {
    hue += 360;
  }

  return {
    h: hue,
    // A black pixel has no meaningful hue or saturation, so they stay at zero
    // rather than reporting NaN.
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = v - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;
  if (hue < 60) {
    [red, green, blue] = [chroma, secondary, 0];
  } else if (hue < 120) {
    [red, green, blue] = [secondary, chroma, 0];
  } else if (hue < 180) {
    [red, green, blue] = [0, chroma, secondary];
  } else if (hue < 240) {
    [red, green, blue] = [0, secondary, chroma];
  } else if (hue < 300) {
    [red, green, blue] = [secondary, 0, chroma];
  } else {
    [red, green, blue] = [chroma, 0, secondary];
  }

  return {
    r: (red + offset) * 255,
    g: (green + offset) * 255,
    b: (blue + offset) * 255,
  };
}

export function hexToHsv(hex: string): Hsv {
  // Strokes store 8-digit hex (`#4a4a4aff`); the trailing alpha is ignored here
  // because opacity is a separate stroke property.
  return rgbToHsv(hexToRgb(hex.slice(0, 7)));
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/**
 * Rotates a colour's hue by `degrees`, keeping its saturation and brightness.
 *
 * Used when a gradient stop is added, so each new stop lands on a visibly
 * different colour instead of repeating the previous one.
 */
export function rotateHue(hex: string, degrees: number): string {
  const hsv = hexToHsv(hex);
  const h = ((hsv.h + degrees) % 360 + 360) % 360;
  return hsvToHex({ ...hsv, h });
}

/**
 * `#rrggbbaa` from a hex colour and a 0-1 opacity.
 *
 * The board's stroke colours carry their alpha inline, matching the values
 * copied from the source's live DOM, so the wheel has to emit the same shape.
 */
export function withAlpha(hex: string, opacity: number): string {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${alpha}`;
}

/** Relative luminance, used to pick a readable foreground for a swatch. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
