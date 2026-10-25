"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/board/color";

/**
 * Artist's colour wheel.
 *
 * The source offers seven fixed swatches, which cannot express an arbitrary
 * colour. This replaces them with the model painting tools actually use:
 *
 *   - the **ring** is hue (0-360°), constant saturation and value;
 *   - the **square** is saturation (x) against value (y) for the hue on the
 *     ring, which is the classic "HSV box" layout;
 *   - a **brightness** slider scales value independently, so a colour can be
 *     dialled down without leaving the square;
 *   - a **hex field** accepts a value typed or pasted, and a row of recent
 *     colours keeps the last few picks one click away.
 *
 * HSV rather than HSL is the right model here: it is what a painter means by
 * "this blue, but darker", and it keeps a pure hue reachable at full value.
 */

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /**
   * When true the wheel is shown but cannot be used.
   *
   * The board's background colour belongs to the host, so everybody else sees
   * the wheel greyed out rather than missing.
   */
  disabled?: boolean;
  /**
   * Callback to activate eyedropper. When provided, a pipette button is shown.
   */
  onEyedropper?: () => void;
}

const WHEEL_SIZE = 200;
const RING_THICKNESS = 22;
const SQUARE_SIZE = 122;

/** Where the square sits inside the ring, as a fraction of the wheel. */
const OUTER_RADIUS = WHEEL_SIZE / 2;
const INNER_RADIUS = OUTER_RADIUS - RING_THICKNESS;
const SQUARE_HALF = SQUARE_SIZE / 2;

const MAX_RECENT = 8;

/**
 * The RGB part of a colour, lower-cased.
 *
 * Stroke colours are `#rrggbbaa`; the wheel only ever deals in the `#rrggbb`
 * prefix, so comparisons between the two have to ignore case and alpha or the
 * derived value above will thrash.
 */
function normalise(hex: string): string {
  return hex.slice(0, 7).toLowerCase();
}

/** Draws the hue ring once per size; it never changes with the selection. */
function paintRing(canvas: HTMLCanvasElement, dpr: number): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const size = WHEEL_SIZE * dpr;
  canvas.width = size;
  canvas.height = size;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

  const center = OUTER_RADIUS;
  // One thin wedge per degree is plenty at this size and avoids banding.
  for (let angle = 0; angle < 360; angle += 1) {
    const start = ((angle - 1) * Math.PI) / 180;
    const end = ((angle + 1) * Math.PI) / 180;
    context.beginPath();
    context.arc(center, center, OUTER_RADIUS, start, end);
    context.arc(center, center, INNER_RADIUS, end, start, true);
    context.closePath();
    context.fillStyle = hsvToHex({ h: angle, s: 1, v: 1 });
    context.fill();
  }
}

/** Draws the saturation/value square for a hue. */
function paintSquare(canvas: HTMLCanvasElement, dpr: number, hue: number): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const size = SQUARE_SIZE * dpr;
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Horizontal: white -> pure hue at full saturation.
  const horizontal = context.createLinearGradient(0, 0, SQUARE_SIZE, 0);
  horizontal.addColorStop(0, "#ffffff");
  horizontal.addColorStop(1, hsvToHex({ h: hue, s: 1, v: 1 }));
  context.fillStyle = horizontal;
  context.fillRect(0, 0, SQUARE_SIZE, SQUARE_SIZE);

  // Vertical: transparent -> black, which is exactly a value ramp.
  const vertical = context.createLinearGradient(0, 0, 0, SQUARE_SIZE);
  vertical.addColorStop(0, "rgba(0,0,0,0)");
  vertical.addColorStop(1, "#000000");
  context.fillStyle = vertical;
  context.fillRect(0, 0, SQUARE_SIZE, SQUARE_SIZE);
}

export function ColorPicker({ value, onChange, disabled = false, onEyedropper }: ColorPickerProps) {
  /**
   * The working HSV, tagged with the `value` it was derived from.
   *
   * When the parent sends a *different* colour — a recent swatch, or the toolbar
   * resetting — the tag no longer matches and the incoming colour wins, so the
   * wheel follows. While the user is dragging, the tag still matches and the
   * local HSV wins, which is what stops a round-tripped hex from fighting the
   * drag. Doing it here rather than in an effect avoids a cascading render.
   */
  const [picked, setPicked] = useState<{ source: string; hsv: Hsv }>(() => ({
    source: value,
    hsv: hexToHsv(value),
  }));
  // Compare on the RGB part alone. The stroke colour carries an inline alpha
  // that the wheel neither edits nor emits, so a value that differs only in its
  // trailing two digits is the *same* colour and must not knock the wheel back
  // to the parent's copy mid-drag.
  const hsv = normalise(picked.source) === normalise(value) ? picked.hsv : hexToHsv(value);

  const [recent, setRecent] = useState<string[]>([]);
  /**
   * The hex field's text, tagged with the colour it was derived from.
   *
   * The eyedropper, a gradient stop switch or the toolbar can hand the wheel a
   * colour the user never typed. While the tag matches the parent's colour the
   * typed text wins (so a half-typed value is not clobbered); once the parent
   * sends a different colour the field follows it.
   */
  const [draft, setDraft] = useState<{ source: string; text: string }>(() => ({
    source: value,
    text: value.replace("#", "").slice(0, 6).toUpperCase(),
  }));
  const draftText =
    normalise(draft.source) === normalise(value)
      ? draft.text
      : value.replace("#", "").slice(0, 6).toUpperCase();

  const ringRef = useRef<HTMLCanvasElement>(null);
  const squareRef = useRef<HTMLCanvasElement>(null);
  /** Last colour pushed into `recent`, so a drag does not flood the list. */
  const lastCommitted = useRef(value);
  /**
   * Which control a drag belongs to.
   *
   * State rather than a ref on purpose: the handlers below read it during a
   * pointer event, but the linter cannot prove that, so keeping it in state
   * makes the ownership explicit and avoids the "ref read during render" trap.
   */
  const [activeDrag, setActiveDrag] = useState<"ring" | "square" | null>(null);

  const dpr = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

  useEffect(() => {
    const canvas = ringRef.current;
    if (canvas) {
      paintRing(canvas, dpr());
    }
  }, []);

  useEffect(() => {
    const canvas = squareRef.current;
    if (canvas) {
      paintSquare(canvas, dpr(), hsv.h);
    }
  }, [hsv.h]);

  /** Applies an HSV change and pushes the resulting hex up. */
  const apply = useCallback(
    (next: Hsv, commit: boolean) => {
      // A disabled wheel still shows its colour, but it never speaks back.
      if (disabled) {
        return;
      }
      const clamped: Hsv = {
        h: ((next.h % 360) + 360) % 360,
        s: Math.min(1, Math.max(0, next.s)),
        v: Math.min(1, Math.max(0, next.v)),
      };
      const hex = hsvToHex(clamped);
      // Tag the pick with the colour being emitted, so the derived value above
      // keeps using it until the parent sends something different.
      setPicked({ source: hex, hsv: clamped });
      setDraft({ source: hex, text: hex.replace("#", "").toUpperCase() });
      onChange(hex);

      if (commit && hex.toLowerCase() !== lastCommitted.current.toLowerCase()) {
        lastCommitted.current = hex;
        setRecent((list) => [hex, ...list.filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, MAX_RECENT));
      }
    },
    [disabled, onChange],
  );

  /** Angle of a wheel point, and its distance from the centre. */
  const wheelGeometry = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WHEEL_SIZE - OUTER_RADIUS;
    const y = ((event.clientY - rect.top) / rect.height) * WHEEL_SIZE - OUTER_RADIUS;
    return { angle: (Math.atan2(y, x) * 180) / Math.PI, distance: Math.hypot(x, y) };
  };

  const ringAt = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    // The handle rides the middle of the ring band.
    const radius = (OUTER_RADIUS + INNER_RADIUS) / 2;
    return {
      left: OUTER_RADIUS + radius * Math.cos(radians),
      top: OUTER_RADIUS + radius * Math.sin(radians),
    };
  };

  const squareAt = (s: number, v: number) => ({
    left: OUTER_RADIUS + (s - 0.5) * SQUARE_SIZE,
    top: OUTER_RADIUS + (0.5 - v) * SQUARE_SIZE,
  });

  const onRingPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const { angle, distance } = wheelGeometry(event);
    // Only the ring band sets the hue. A press inside the square is handled by
    // the square itself, and the exact centre has no defined angle — testing the
    // *radius* is what tells those apart, since `atan2` returns 0 for the whole
    // right-hand side, not just the origin.
    if (distance < INNER_RADIUS && distance > 0) {
      return;
    }
    // The wheel starts on a pure grey, where changing the hue has no visible
    // effect at all: grey is grey at every angle. Picking a hue on the ring is
    // an unmistakable request for *that colour*, so a zero saturation is lifted
    // to fully vivid. Once the user has dialled saturation in the square (or
    // slid it away deliberately) their value is respected.
    const saturation = hsv.s === 0 ? 1 : hsv.s;
    apply({ ...hsv, h: angle, s: saturation }, event.type === "pointerup");
  };

  const onSquarePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * SQUARE_SIZE;
    const localY = ((event.clientY - rect.top) / rect.height) * SQUARE_SIZE;
    const s = Math.min(1, Math.max(0, localX / SQUARE_SIZE));
    const v = Math.min(1, Math.max(0, 1 - localY / SQUARE_SIZE));
    apply({ ...hsv, s, v }, event.type === "pointerup");
  };

  /**
   * Shared press/drag/release wiring for both canvases.
   *
   * The active control is decided by this component's own state, so a pointer
   * that wanders across the ring while dragging the square keeps editing the
   * square rather than jumping controls.
   */
  const isDragging = (kind: "ring" | "square") => activeDrag === kind;

  const ringHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
      setActiveDrag("ring");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers have no capturable id; the drag must still start.
      }
      onRingPointer(event);
    },
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (isDragging("ring")) {
        onRingPointer(event);
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (isDragging("ring")) {
        onRingPointer(event);
      }
      setActiveDrag(null);
    },
    onPointerCancel: () => setActiveDrag(null),
  };

  const squareHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
      setActiveDrag("square");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers have no capturable id; the drag must still start.
      }
      onSquarePointer(event);
    },
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (isDragging("square")) {
        onSquarePointer(event);
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (isDragging("square")) {
        onSquarePointer(event);
      }
      setActiveDrag(null);
    },
    onPointerCancel: () => setActiveDrag(null),
  };

  const ringHandle = ringAt(hsv.h);
  const squareHandle = squareAt(hsv.s, hsv.v);
  const hex = hsvToHex(hsv);

  const commitDraft = () => {
    // A disabled wheel never speaks back, not even through its hex field.
    if (disabled) {
      return;
    }
    const cleaned = draftText.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    // Accept 3-digit shorthand too, which artists type out of habit (#f80).
    const expanded =
      cleaned.length === 3
        ? cleaned
            .split("")
            .map((c) => c + c)
            .join("")
        : cleaned;
    if (expanded.length !== 6) {
      setDraft({ source: value, text: hex.replace("#", "").toUpperCase() });
      return;
    }
    const next = `#${expanded.toLowerCase()}`;
    setPicked({ source: next, hsv: hexToHsv(next) });
    setDraft({ source: next, text: expanded.toUpperCase() });
    onChange(next);
    lastCommitted.current = next;
    setRecent((list) => [next, ...list.filter((c) => c.toLowerCase() !== next)].slice(0, MAX_RECENT));
  };

  return (
    <div
      className={`colorWheel ${disabled ? "colorWheelDisabled" : ""}`}
      data-testid="color-wheel"
      data-disabled={disabled ? "true" : "false"}
    >
      <div className="colorWheelWheel">
        <canvas
          ref={ringRef}
          className="colorWheelRing"
          style={{
            width: WHEEL_SIZE,
            height: WHEEL_SIZE,
            pointerEvents: disabled ? "none" : "auto",
          }}
          data-testid="color-wheel-ring"
          {...ringHandlers}
        />
        <span
          className="colorWheelRingHandle"
          style={{ left: ringHandle.left, top: ringHandle.top, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
          data-testid="color-wheel-ring-handle"
        />

        {/* The square is overlaid so both share one coordinate origin. */}
        <div
          className="colorWheelSquareWrap"
          style={{
            left: OUTER_RADIUS - SQUARE_HALF,
            top: OUTER_RADIUS - SQUARE_HALF,
            width: SQUARE_SIZE,
            height: SQUARE_SIZE,
          }}
        >
          <canvas
            ref={squareRef}
            className="colorWheelSquare"
            style={{
              width: SQUARE_SIZE,
              height: SQUARE_SIZE,
              pointerEvents: disabled ? "none" : "auto",
            }}
            data-testid="color-wheel-square"
            {...squareHandlers}
          />
          <span
            className="colorWheelSquareHandle"
            style={{ left: squareHandle.left - (OUTER_RADIUS - SQUARE_HALF), top: squareHandle.top - (OUTER_RADIUS - SQUARE_HALF), background: hex }}
            data-testid="color-wheel-square-handle"
          />
        </div>
      </div>

      <div className="colorWheelControls">
        <div className="colorWheelPreviewRow">
          <span
            className="colorWheelPreview"
            style={{ background: hex, position: "relative" }}
            data-testid="color-wheel-preview"
            onClick={onEyedropper}
            title={onEyedropper ? "Coger color con gotero" : undefined}
            role={onEyedropper ? "button" : undefined}
          >
            {onEyedropper && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ position: "absolute", bottom: 2, right: 2, background: "rgba(255,255,255,0.8)", borderRadius: 2, padding: 1 }}
              >
                <path d="m9 11-6 6v3h9l3-3" />
                <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
              </svg>
            )}
          </span>
          <label className="colorWheelHexField">
            <span className="pencilMenuLabel">Hex</span>
            <input
              type="text"
              value={draftText}
              spellCheck={false}
              maxLength={7}
              readOnly={disabled}
              onChange={(event) =>
                setDraft({ source: value, text: event.target.value.toUpperCase() })
              }
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitDraft();
                }
              }}
              data-testid="color-wheel-hex"
            />
          </label>
        </div>

        {onEyedropper && (
          <button
            type="button"
            className="colorWheelEyedropper"
            onClick={onEyedropper}
            disabled={disabled}
            title="Coger un color del pizarrón"
            data-testid="color-eyedropper"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              minHeight: 44,
              marginTop: 8,
              border: "1px solid #a6a6a6",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m2 22 1-1h3l9-9" />
              <path d="M3 21v-3l9-9" />
              <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
            </svg>
            Gotero
          </button>
        )}

        <label className="pencilMenuSlider">
          <span className="pencilMenuLabel">
            Brightness <em>{Math.round(hsv.v * 100)}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            value={Math.round(hsv.v * 100)}
            onChange={(event) => apply({ ...hsv, v: Number(event.target.value) / 100 }, false)}
            onPointerUp={() => apply(hsv, true)}
            data-testid="color-wheel-brightness"
          />
        </label>

        <label className="pencilMenuSlider">
          <span className="pencilMenuLabel">
            Saturation <em>{Math.round(hsv.s * 100)}%</em>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            value={Math.round(hsv.s * 100)}
            onChange={(event) => apply({ ...hsv, s: Number(event.target.value) / 100 }, false)}
            onPointerUp={() => apply(hsv, true)}
            data-testid="color-wheel-saturation"
          />
        </label>

        {recent.length > 0 && (
          <div className="colorWheelRecent">
            <span className="pencilMenuLabel">Recent</span>
            <div className="colorWheelRecentRow" data-testid="color-wheel-recent">
              {recent.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="colorWheelRecentChip"
                  style={{ background: entry }}
                  title={entry}
                  aria-label={`Use ${entry}`}
                  disabled={disabled}
                  onClick={() => {
                    setPicked({ source: entry, hsv: hexToHsv(entry) });
                    setDraft({ source: entry, text: entry.replace("#", "").toUpperCase() });
                    onChange(entry);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <input type="hidden" value={hex} data-testid="color-wheel-hex-value" />
    </div>
  );
}
