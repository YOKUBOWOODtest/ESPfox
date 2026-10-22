"use client";

import { useState } from "react";
import { BoardUsersPanel } from "./board-users-panel";
import { ColorPicker } from "./color-wheel";
import type { Participant } from "./use-board";
import { luminance } from "@/lib/board/color";

/**
 * Options panel — replaces the source's "Opciones" modal.
 *
 * Contains:
 *   - Colours: a compact colour picker (the artist's wheel)
 *   - Participants: the users list (moved here from the toolbar)
 *   - Settings: future home for grid, snap, etc.
 */
export interface OptionsMenuProps {
  participants: Participant[];
  search: string;
  onSearchChange: (search: string) => void;
  onClose: () => void;
}

// The source's default 7 colours (kept for quick swatches in Options)
const PRESET_COLORS = [
  { name: "Black", fill: "#4a4a4aff" },
  { name: "Blue", fill: "#2761a4ff" },
  { name: "Aquamarine", fill: "#44bff2ff" },
  { name: "Red", fill: "#c1086cff" },
  { name: "Green", fill: "#98bb13ff" },
  { name: "Purple", fill: "#ac90e3ff" },
  { name: "Yellow", fill: "#e6b82eff" },
] as const;

export function OptionsMenu({ participants, search, onSearchChange, onClose }: OptionsMenuProps) {
  const [activeTab, setActiveTab] = useState<"colours" | "participants" | "settings">("colours");

  return (
    <div
      className="panel-plate"
      id="optionsPanel"
      data-testid="options-panel"
      style={{
        position: "absolute",
        left: 140,
        top: 108,
        width: 420,
        zIndex: 6,
        padding: 12,
        maxHeight: "calc(100vh - 130px)",
        overflow: "auto",
      }}
    >
      <div className="pencilMenuHeader" style={{ marginBottom: 12 }}>
        <strong>Options</strong>
        <button
          type="button"
          className="pencilMenuClose"
          aria-label="Close options"
          onClick={onClose}
          data-testid="options-menu-close"
        >
          ✕
        </button>
      </div>

      {/* Tab strip */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #a6a6a6" }}>
        {[
          { key: "colours", label: "Colours" },
          { key: "participants", label: "Participants" },
          { key: "settings", label: "Settings" },
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
        {activeTab === "colours" && (
          <div style={{ padding: 12 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Colour Picker
              </label>
              <div style={{ width: "100%" }}>
                <ColorPicker
                  value="#4a4a4a"
                  onChange={() => {}}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Quick Colours
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className="color-cell"
                    style={{
                      width: "100%",
                      height: 48,
                      background: c.fill.slice(0, 7),
                      border: "1px solid #a6a6a6",
                      cursor: "pointer",
                      borderRadius: 2,
                      position: "relative",
                    }}
                    title={c.name}
                    onClick={() => {
                      // Could emit colour change event
                    }}
                  >
                    <span style={{
                      position: "absolute",
                      bottom: 2,
                      left: 2,
                      right: 2,
                      fontSize: 9,
                      color: luminance(c.fill) > 0.5 ? "#000" : "#fff",
                      textShadow: "0 0 2px #000, 0 0 2px #000",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "participants" && (
          <div style={{ padding: 0, height: 350 }}>
            <BoardUsersPanel
              participants={participants}
              search={search}
              onSearchChange={onSearchChange}
              onClose={() => {}}
              embedded={true}
            />
          </div>
        )}

        {activeTab === "settings" && (
          <div style={{ padding: 12 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" defaultChecked />
                <span>Show grid</span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" defaultChecked />
                <span>Snap to grid</span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" />
                <span>Dark mode</span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                Grid size
              </label>
              <input
                type="range"
                min={20}
                max={200}
                step={10}
                defaultValue={80}
                style={{ width: "100%", accentColor: "#e0533f" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                Auto-save interval (seconds)
              </label>
              <input
                type="range"
                min={10}
                max={300}
                step={10}
                defaultValue={30}
                style={{ width: "100%", accentColor: "#e0533f" }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}