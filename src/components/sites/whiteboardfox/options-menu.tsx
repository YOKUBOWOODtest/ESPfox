"use client";

import { useState } from "react";
import { BoardUsersPanel } from "./board-users-panel";
import { ColorPicker } from "./color-wheel";
import type { Participant } from "./use-board";
import type { BoardSettings } from "./use-board-settings";

/**
 * Options panel — replaces the source's "Opciones" modal.
 *
 * Contains:
 *   - Colours: the colour of the board itself
 *   - Participants: the users list (moved here from the toolbar)
 *   - Settings: the grid, the snapping and the auto-save
 *
 * Every control here does something. The background colour belongs to the
 * board's host; the rest of the settings belong to the board, except "Flip
 * colours", which is a personal view of it.
 */
export interface OptionsMenuProps {
  participants: Participant[];
  search: string;
  onSearchChange: (search: string) => void;
  onClose: () => void;
  /** The board's settings. */
  settings: BoardSettings;
  /** Applies a change to the board's settings. */
  onSettingsChange: (patch: Partial<BoardSettings>) => void;
  /** Whether this browser sees the board with inverted colours. */
  flipColors: boolean;
  /** Turns the personal colour flip on or off. */
  onFlipColorsChange: (value: boolean) => void;
  /** Whether this device is the board's host. */
  isHost: boolean;
}

export function OptionsMenu({
  participants,
  search,
  onSearchChange,
  onClose,
  settings,
  onSettingsChange,
  flipColors,
  onFlipColorsChange,
  isHost,
}: OptionsMenuProps) {
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
            data-testid={`options-tab-${tab.key}`}
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
            <label
              htmlFor="bg-color-preview"
              style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}
            >
              BG color
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                id="bg-color-preview"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #a6a6a6",
                  background: settings.backgroundColor,
                }}
                data-testid="bg-color-preview"
              />
              <span style={{ fontSize: 12, color: "#555" }}>{settings.backgroundColor}</span>
            </div>

            <div style={{ width: "100%" }}>
              <ColorPicker
                value={settings.backgroundColor}
                onChange={(hex) => onSettingsChange({ backgroundColor: hex })}
                disabled={!isHost}
              />
            </div>

            {!isHost && (
              <p
                style={{ marginTop: 8, fontSize: 12, color: "#8a5a52" }}
                data-testid="bg-color-host-only"
              >
                Only the board host can change the background colour.
              </p>
            )}
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
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={settings.showGrid}
                  onChange={(event) => onSettingsChange({ showGrid: event.target.checked })}
                  data-testid="settings-show-grid"
                />
                <span>Show grid</span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={settings.snapToGrid}
                  onChange={(event) => onSettingsChange({ snapToGrid: event.target.checked })}
                  data-testid="settings-snap-to-grid"
                />
                <span>Snap to grid</span>
              </label>
            </div>
            <div style={{ marginBottom: 4 }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={flipColors}
                  onChange={(event) => onFlipColorsChange(event.target.checked)}
                  data-testid="settings-flip-colors"
                />
                <span>Flip colors</span>
              </label>
            </div>
            <p style={{ margin: "0 0 16px 24px", fontSize: 12, color: "#666" }}>
              Inverts the board for you only; everybody else sees it as it is.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                Grid size <em style={{ fontStyle: "normal", color: "#666" }}>{settings.gridSize}px</em>
              </label>
              <input
                type="range"
                min={20}
                max={200}
                step={10}
                value={settings.gridSize}
                onChange={(event) => onSettingsChange({ gridSize: Number(event.target.value) })}
                style={{ width: "100%", accentColor: "#e0533f" }}
                data-testid="settings-grid-size"
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                Auto-save interval (seconds){" "}
                <em style={{ fontStyle: "normal", color: "#666" }}>{settings.autoSaveInterval}s</em>
              </label>
              <input
                type="range"
                min={10}
                max={300}
                step={10}
                value={settings.autoSaveInterval}
                onChange={(event) => onSettingsChange({ autoSaveInterval: Number(event.target.value) })}
                style={{ width: "100%", accentColor: "#e0533f" }}
                data-testid="settings-auto-save"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
