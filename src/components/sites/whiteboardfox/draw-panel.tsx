"use client";

import { useState } from "react";
import { ColorPicker } from "./color-wheel";
import type {
  DrawStyle,
  GradientStop,
  GradientType,
  StrokeStyle,
} from "@/lib/board/stroke";
import { normalizeGradientStops } from "@/lib/board/stroke";
import { rotateHue, withAlpha } from "@/lib/board/color";

/**
 * Draw tool options panel.
 *
 * Mirrors the source's pencil pop-up but expanded with:
 *   - Color wheel (artist's HSV wheel)
 *   - Style selector: Marker | Fill | Gradient Fill | Calligraphy
 *   - Size presets (Finest/Correcto/Medio/Grande/Enorme ×4)
 *   - Shape tools
 */
export interface DrawPanelProps {
  style: StrokeStyle;
  drawStyle: DrawStyle;
  onStyleChange: (style: StrokeStyle) => void;
  onDrawStyleChange: (drawStyle: DrawStyle) => void;
  onClose: () => void;
}

const STYLE_LABELS: Record<DrawStyle, string> = {
  marker: "Marker",
  fill: "Rellenar",
  "gradient-fill": "Relleno degradado",
  calligraphy: "Caligrafía",
};

const SIZE_PRESETS = [
  { group: "Finest", sizes: [1, 2, 3, 4] },
  { group: "Correcto", sizes: [5, 6, 7, 8] },
  { group: "Medio", sizes: [9, 10, 11, 12] },
  { group: "Grande", sizes: [13, 14, 15, 16] },
  { group: "Enorme", sizes: [17, 18, 19, 20] },
] as const;

const WIDTH_MIN = 1;
const WIDTH_MAX = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The CSS gradient that mirrors what the renderer will paint.
 *
 * Only the rgb prefix of each stop is used, because the alpha lives in the
 * stroke's opacity — exactly as the canvas renderer treats it.
 */
function gradientPreviewCss(
  stops: GradientStop[],
  type: GradientType,
  angle?: number,
  center?: { x: number; y: number }
): string {
  const parts = stops.map(
    (stop) => `${stop.color.slice(0, 7)} ${Math.round(stop.position * 100)}%`,
  );
  if (type === "radial") {
    const cx = 50 + (center?.x ?? 0) * 50;
    const cy = 50 + (center?.y ?? 0) * 50;
    return `radial-gradient(circle at ${cx}% ${cy}%, ${parts.join(", ")})`;
  }
  // Preview shows gradient centered, using angle (0° = horizontal left-to-right)
  // The preview is a square, so we use the angle directly
  return `linear-gradient(${angle ?? 0}deg, ${parts.join(", ")})`;
}

export function DrawPanel({ style, drawStyle, onStyleChange, onDrawStyleChange, onClose }: DrawPanelProps) {
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"main" | "shapes">("main");
  /** Index of the gradient stop being edited, or -1 for none. */
  const [editingStop, setEditingStop] = useState(-1);

  const currentWidth = widthDraft !== null ? Number(widthDraft) : style.width;
  const displayWidth = Number.isFinite(currentWidth) ? currentWidth : style.width;
  const baseHex = style.color.slice(0, 7);
  /** The ramp's stops, sorted by position; always at least two. */
  const gradientStops = normalizeGradientStops(style.gradientStops, style.color);
  const gradientType: GradientType = style.gradientType ?? "linear";

  /**
   * The main colour is the ramp's first stop, so the two never drift apart.
   *
   * "First" means lowest position: moving a stop past another swaps them, and
   * the new leader becomes the main colour.
   */
  const setMainColor = (hex: string) => {
    const color = withAlpha(hex, style.opacity);
    onStyleChange({
      ...style,
      color,
      gradientStops: gradientStops.map((stop, index) =>
        index === 0 ? { ...stop, color } : stop,
      ),
    });
  };

  const updateStopColor = (index: number, hex: string) => {
    const color = withAlpha(hex, style.opacity);
    onStyleChange({
      ...style,
      color: index === 0 ? color : style.color,
      gradientStops: gradientStops.map((stop, current) =>
        current === index ? { ...stop, color } : stop,
      ),
    });
  };

  const updateStopPosition = (index: number, position: number) => {
    const sorted = normalizeGradientStops(
      gradientStops.map((stop, current) =>
        current === index ? { ...stop, position } : stop,
      ),
      style.color,
    );
    onStyleChange({
      ...style,
      color: sorted[0].color,
      gradientStops: sorted,
    });
  };

  const removeStop = (index: number) => {
    if (gradientStops.length <= 2) {
      return;
    }
    const sorted = normalizeGradientStops(
      gradientStops.filter((_, current) => current !== index),
      style.color,
    );
    onStyleChange({ ...style, color: sorted[0].color, gradientStops: sorted });
    setEditingStop(-1);
  };

  /**
   * Inserts a stop after the given one.
   *
   * The new colour is the anchor's rotated around the wheel, so every click
   * lands on a visibly different colour rather than the same one again, and
   * its position is dropped halfway to the next stop.
   *
   * On the last stop there is no gap to drop into, so the anchor slides back
   * to the middle of the gap it already occupied and the new stop takes the
   * end of the ramp. Two stops can never share a position.
   */
  const addStopAfter = (index: number) => {
    const anchor = gradientStops[index];
    const following = gradientStops[index + 1];
    const previous = gradientStops[index - 1];
    const inserted: GradientStop = {
      color: withAlpha(rotateHue(anchor.color.slice(0, 7), 60), style.opacity),
      position: following ? (anchor.position + following.position) / 2 : 1,
    };
    const movedAnchor =
      following || !previous
        ? anchor
        : { ...anchor, position: (previous.position + anchor.position) / 2 };
    const sorted = normalizeGradientStops(
      [
        ...gradientStops.slice(0, index),
        movedAnchor,
        inserted,
        ...gradientStops.slice(index + 1),
      ],
      style.color,
    );
    onStyleChange({ ...style, color: sorted[0].color, gradientStops: sorted });
    setEditingStop(sorted.indexOf(inserted));
  };

  const commitWidth = () => {
    if (widthDraft === null || widthDraft.trim() === "") {
      setWidthDraft(null);
      return;
    }
    const parsed = Number(widthDraft);
    if (!Number.isFinite(parsed)) {
      setWidthDraft(null);
      return;
    }
    const next = clamp(Math.round(parsed), WIDTH_MIN, WIDTH_MAX);
    setWidthDraft(String(next));
    if (next !== style.width) {
      onStyleChange({ ...style, width: next });
    }
  };

  const handleWidthChange = (value: number) => {
    setWidthDraft(null);
    if (value !== style.width) {
      onStyleChange({ ...style, width: value });
    }
  };

  const handleDrawStyleChange = (newStyle: DrawStyle) => {
    onDrawStyleChange(newStyle);
  };

  return (
    <div
      className="panel-plate"
      id="drawPanel"
      data-testid="draw-panel"
      style={{
        position: "absolute",
        left: 140,
        top: 108,
        width: 640,
        zIndex: 6,
        padding: 12,
        maxHeight: "calc(100vh - 130px)",
        overflow: "auto",
      }}
    >
      <div className="pencilMenuHeader" style={{ marginBottom: 12 }}>
        <strong>Draw Options</strong>
        <button
          type="button"
          className="pencilMenuClose"
          aria-label="Close draw options"
          onClick={onClose}
          data-testid="draw-panel-close"
        >
          ✕
        </button>
      </div>

      {/* Tab strip */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #a6a6a6" }}>
        {[
          { key: "main", label: "Main" },
          { key: "shapes", label: "Shapes" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            style={{
              padding: "6px 12px",
              border: "1px solid #a6a6a6",
              borderBottom: "none",
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
              background: activeTab === tab.key ? "#fff" : "#f5f5f5",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div style={{ border: "1px solid #a6a6a6", borderTop: "none", borderRadius: "0 0 4 4", background: "#fff" }}>
        {/* MAIN TAB: Color, Styles, Size, Opacity */}
        {activeTab === "main" && (
          <div style={{ padding: 12 }}>
            {/* Color Wheel */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Colour
              </label>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <ColorPicker
                    value={baseHex}
                    onChange={setMainColor}
                  />
                </div>
              </div>
            </div>

            {/* Gradient settings: ramp type, preview, and one row per stop */}
            {drawStyle === "gradient-fill" && (
              <div className="gradientSettings" style={{ marginBottom: 16 }}>
                <div className="gradientSettingsTitle">Ajustes del degradado</div>

                <div className="gradientTypeRow">
                  {(
                    [
                      { value: "linear", label: "Lineal" },
                      { value: "radial", label: "Radial" },
                    ] as { value: GradientType; label: string }[]
                  ).map((option) => (
                    <label
                      key={option.value}
                      className="gradientTypeOption"
                      data-testid={`gradient-type-${option.value}`}
                    >
                      <input
                        type="radio"
                        name="gradient-type"
                        checked={gradientType === option.value}
                        onChange={() =>
                          onStyleChange({ ...style, gradientType: option.value })
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>

                {/* Angle control for linear gradient */}
                {gradientType === "linear" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                      Ángulo: <span style={{ fontWeight: 400, color: "#666" }}>{Math.round(style.gradientAngle ?? 0)}°</span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={style.gradientAngle ?? 0}
                        onChange={(e) =>
                          onStyleChange({ ...style, gradientAngle: Number(e.target.value) })
                        }
                        style={{ flex: 1, accentColor: "#e0533f" }}
                        aria-label="Ángulo del degradado lineal"
                        data-testid="gradient-angle"
                      />
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        value={style.gradientAngle ?? 0}
                        onChange={(e) =>
                          onStyleChange({ ...style, gradientAngle: Number(e.target.value) || 0 })
                        }
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) onStyleChange({ ...style, gradientAngle: Math.max(-180, Math.min(180, v)) });
                        }}
                        style={{ width: 70, padding: "4px 8px", fontSize: 13, border: "1px solid #a6a6a6", borderRadius: 4 }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      {[-90, -45, 0, 45, 90, 135, 180].map((ang) => (
                        <button
                          key={ang}
                          type="button"
                          onClick={() => onStyleChange({ ...style, gradientAngle: ang })}
                          style={{
                            padding: "4px 10px",
                            border: `1px solid ${style.gradientAngle === ang ? "#e0533f" : "#a6a6a6"}`,
                            borderRadius: 4,
                            background: style.gradientAngle === ang ? "#e0533f" : "#fff",
                            color: style.gradientAngle === ang ? "#fff" : "#000",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          {ang}°
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Center offset control for radial gradient */}
                {gradientType === "radial" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                      Centro (desplazamiento):
                    </label>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>X: <span style={{ fontWeight: 400, color: "#666" }}>{(style.gradientCenter?.x ?? 0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.05}
                          value={style.gradientCenter?.x ?? 0}
                          onChange={(e) =>
                            onStyleChange({
                              ...style,
                              gradientCenter: { x: Number(e.target.value), y: style.gradientCenter?.y ?? 0 },
                            })
                          }
                          style={{ width: "100%", accentColor: "#e0533f" }}
                          aria-label="Desplazamiento horizontal del centro"
                          data-testid="gradient-center-x"
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Y: <span style={{ fontWeight: 400, color: "#666" }}>{(style.gradientCenter?.y ?? 0).toFixed(2)}</span></label>
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.05}
                          value={style.gradientCenter?.y ?? 0}
                          onChange={(e) =>
                            onStyleChange({
                              ...style,
                              gradientCenter: { x: style.gradientCenter?.x ?? 0, y: Number(e.target.value) },
                            })
                          }
                          style={{ width: "100%", accentColor: "#e0533f" }}
                          aria-label="Desplazamiento vertical del centro"
                          data-testid="gradient-center-y"
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      {[
                        { x: 0, y: 0, label: "Centro" },
                        { x: -0.5, y: 0, label: "Izq" },
                        { x: 0.5, y: 0, label: "Der" },
                        { x: 0, y: -0.5, label: "Arriba" },
                        { x: 0, y: 0.5, label: "Abajo" },
                        { x: -0.5, y: -0.5, label: "↖" },
                        { x: 0.5, y: -0.5, label: "↗" },
                        { x: -0.5, y: 0.5, label: "↙" },
                        { x: 0.5, y: 0.5, label: "↘" },
                      ].map((pos) => (
                        <button
                          key={`${pos.x},${pos.y}`}
                          type="button"
                          onClick={() => onStyleChange({ ...style, gradientCenter: { x: pos.x, y: pos.y } })}
                          style={{
                            padding: "4px 10px",
                            border: `1px solid ${style.gradientCenter?.x === pos.x && style.gradientCenter?.y === pos.y ? "#e0533f" : "#a6a6a6"}`,
                            borderRadius: 4,
                            background: style.gradientCenter?.x === pos.x && style.gradientCenter?.y === pos.y ? "#e0533f" : "#fff",
                            color: style.gradientCenter?.x === pos.x && style.gradientCenter?.y === pos.y ? "#fff" : "#000",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  className="gradientPreview"
                  style={{
                    background: gradientPreviewCss(
                      gradientStops,
                      gradientType,
                      gradientType === "linear" ? style.gradientAngle : undefined,
                      gradientType === "radial" ? style.gradientCenter : undefined,
                    ),
                  }}
                  data-testid="gradient-preview"
                />

                {gradientStops.map((stop, index) => (
                  <div className="gradientStopRow" key={`${index}-${stop.color}`}>
                    <button
                      type="button"
                      className="gradientSwatch"
                      style={{
                        background: stop.color,
                        outline:
                          editingStop === index ? "2px solid #e0533f" : undefined,
                      }}
                      title={`Stop ${index + 1} — ${stop.color.slice(0, 7)}`}
                      aria-label={`Edit gradient stop ${index + 1}`}
                      onClick={() => setEditingStop(index)}
                      data-testid={`gradient-swatch-${index}`}
                    />
                    <input
                      type="range"
                      className="gradientStopSlider"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(stop.position * 100)}
                      onChange={(event) =>
                        updateStopPosition(index, Number(event.target.value) / 100)
                      }
                      aria-label={`Position of gradient stop ${index + 1}`}
                      data-testid={`gradient-position-${index}`}
                    />
                    <button
                      type="button"
                      className="gradientAddButton"
                      onClick={() => addStopAfter(index)}
                      aria-label="Add a gradient stop"
                      title="Add a gradient stop"
                      data-testid={`gradient-add-stop-${index}`}
                    >
                      +
                    </button>
                  </div>
                ))}

                {/* Editing a stop's colour */}
                {editingStop >= 0 && editingStop < gradientStops.length && (
                  <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 280 }}>
                      <ColorPicker
                        value={gradientStops[editingStop].color.slice(0, 7)}
                        onChange={(hex) => updateStopColor(editingStop, hex)}
                      />
                    </div>
                    <button
                      type="button"
                      className="gradientStopRemove"
                      onClick={() => removeStop(editingStop)}
                      disabled={gradientStops.length <= 2}
                      data-testid="gradient-remove-stop"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Style Selector */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Style
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(STYLE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDrawStyleChange(key as DrawStyle)}
                    style={{
                      padding: "8px 16px",
                      border: `2px solid ${drawStyle === key ? "#e0533f" : "#a6a6a6"}`,
                      borderRadius: 4,
                      background: drawStyle === key ? "#fff" : "#f5f5f5",
                      color: drawStyle === key ? "#e0533f" : "#000",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: drawStyle === key ? 600 : 400,
                      transition: "all 0.15s ease",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Size Presets */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Size Presets
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {SIZE_PRESETS.map(({ group, sizes }) => (
                  <div key={group} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ width: 80, fontSize: 12, color: "#555", fontWeight: 500 }}>
                      {group}
                    </span>
                    <div style={{ display: "flex", gap: 4, flex: 1 }}>
                      {sizes.map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => handleWidthChange(size)}
                          style={{
                            flex: 1,
                            padding: "6px 4px",
                            border: `2px solid ${displayWidth === size ? "#e0533f" : "#a6a6a6"}`,
                            borderRadius: 4,
                            background: displayWidth === size ? "#e0533f" : "#fff",
                            color: displayWidth === size ? "#fff" : "#000",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: displayWidth === size ? 600 : 400,
                            transition: "all 0.1s ease",
                          }}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Width */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Custom Width
              </label>
              <div className="pencilWidthControl" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <input
                  type="range"
                  min={WIDTH_MIN}
                  max={WIDTH_MAX}
                  step={1}
                  value={clamp(displayWidth, WIDTH_MIN, WIDTH_MAX)}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                  style={{ flex: 1, accentColor: "#e0533f" }}
                  data-testid="draw-width-slider"
                />
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    min={WIDTH_MIN}
                    max={WIDTH_MAX}
                    step={1}
                    value={widthDraft !== null ? widthDraft : String(displayWidth)}
                    onChange={(e) => setWidthDraft(e.target.value)}
                    onBlur={commitWidth}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitWidth();
                    }}
                    style={{
                      width: 60,
                      height: 28,
                      padding: "0 4px",
                      fontSize: 14,
                      textAlign: "right",
                      border: "1px solid #a6a6a6",
                      borderRadius: 4,
                    }}
                    data-testid="draw-width-number"
                  />
                  <span style={{ fontSize: 11, color: "#555" }}>px</span>
                </div>
              </div>
              <div className="pencilWidthPreview" style={{ height: 26, background: "#fff", border: "1px solid #a6a6a6", borderRadius: 4, overflow: "hidden" }}>
                <div
                  className="pencilWidthPreviewLine"
                  style={{
                    height: clamp(displayWidth, WIDTH_MIN, WIDTH_MAX),
                    width: "100%",
                    background: style.color,
                    borderRadius: "999px",
                    minHeight: 1,
                    transition: "height 0.1s ease",
                  }}
                />
              </div>
            </div>

            {/* Opacity */}
            <div style={{ marginBottom: 16 }}>
              <label className="pencilMenuSlider" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="pencilMenuLabel" style={{ fontSize: 13, fontWeight: 500 }}>
                  Opacity <em style={{ fontSize: 12, color: "#555" }}>{Math.round(style.opacity * 100)}%</em>
                </span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={Math.round(style.opacity * 100)}
                  onChange={(e) => {
                    const opacity = Number(e.target.value) / 100;
                    onStyleChange({
                      ...style,
                      opacity,
                      color: withAlpha(baseHex, opacity),
                    });
                  }}
                  style={{ accentColor: "#e0533f", width: "100%" }}
                  data-testid="draw-opacity"
                />
              </label>
            </div>
          </div>
        )}

        {/* SHAPES TAB */}
        {activeTab === "shapes" && (
          <div style={{ padding: 12 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Shape Tools
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {[
                  "Línea",
                  "Círculo",
                  "Elipse",
                  "Cuadrado",
                  "Rectángulo",
                  "Diamante",
                  "Flecha",
                  "Estrella",
                  "Corazón",
                  "Globo de diálogo",
                  "Estilo libre",
                  "Snap",
                ].map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => {
                      // Shape tool selection logic would go here
                      console.log("Shape selected:", shape);
                    }}
                    style={{
                      padding: "8px 4px",
                      border: "1px solid #a6a6a6",
                      borderRadius: 4,
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: 11,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shape}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Size & Snap
              </label>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Shape Size</label>
                  <input type="range" min={10} max={200} step={10} defaultValue={80} style={{ width: "100%", accentColor: "#e0533f" }} />
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Snap Distance</label>
                  <input type="range" min={0} max={50} step={5} defaultValue={10} style={{ width: "100%", accentColor: "#e0533f" }} />
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" defaultChecked />
                <span>Enable Snap to Grid</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}