"use client";

import { useSyncExternalStore } from "react";

/**
 * Board settings.
 *
 * These are the options behind the board's Options panel: the background
 * colour, the grid and how the board behaves while drawing, plus the
 * auto-save interval.
 *
 * There is no server, so the settings live in `localStorage`, keyed by board
 * id: two tabs of the same board share them, and the `storage` event keeps
 * them in step. "Flip colours" is deliberately *not* here — that one is a
 * personal view of the board, so it is stored per device.
 */

/** The board's own settings, shared by everybody who opens the board. */
export interface BoardSettings {
  /** The colour behind the ink. */
  backgroundColor: string;
  /** Whether the grid is drawn. */
  showGrid: boolean;
  /** Whether strokes snap to the grid. */
  snapToGrid: boolean;
  /** The grid's spacing, in world units. */
  gridSize: number;
  /** How often the board saves itself, in seconds. */
  autoSaveInterval: number;
}

export const DEFAULT_SETTINGS: BoardSettings = {
  backgroundColor: "#ffffff",
  showGrid: true,
  snapToGrid: false,
  gridSize: 80,
  autoSaveInterval: 30,
};

const SETTINGS_PREFIX = "wf_board_settings_";
const FLIP_KEY = "wf_flip_colors";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function settingsKey(boardId: string): string {
  return `${SETTINGS_PREFIX}${boardId}`;
}

/** Reads the settings of a board, filling in the defaults. */
function readSettings(boardId: string): BoardSettings {
  try {
    const raw = window.localStorage.getItem(settingsKey(boardId));
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_SETTINGS };
    }
    const record = parsed as Partial<Record<keyof BoardSettings, unknown>>;
    return {
      backgroundColor:
        typeof record.backgroundColor === "string"
          ? record.backgroundColor
          : DEFAULT_SETTINGS.backgroundColor,
      showGrid:
        typeof record.showGrid === "boolean" ? record.showGrid : DEFAULT_SETTINGS.showGrid,
      snapToGrid:
        typeof record.snapToGrid === "boolean"
          ? record.snapToGrid
          : DEFAULT_SETTINGS.snapToGrid,
      gridSize:
        typeof record.gridSize === "number" && Number.isFinite(record.gridSize)
          ? record.gridSize
          : DEFAULT_SETTINGS.gridSize,
      autoSaveInterval:
        typeof record.autoSaveInterval === "number" &&
        Number.isFinite(record.autoSaveInterval)
          ? record.autoSaveInterval
          : DEFAULT_SETTINGS.autoSaveInterval,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes the settings of a board and wakes every subscriber. */
export function writeSettings(boardId: string, settings: BoardSettings): void {
  try {
    window.localStorage.setItem(settingsKey(boardId), JSON.stringify(settings));
  } catch {
    // Storage unavailable: the settings simply do not persist.
  }
  listeners.forEach((listener) => listener());
}

/* The snapshots are cached by their raw text, so the store never loops. */
const settingsCache = new Map<string, { raw: string; value: BoardSettings }>();

export function useBoardSettings(boardId: string): BoardSettings {
  const getSnapshot = () => {
    let raw = "";
    try {
      raw = window.localStorage.getItem(settingsKey(boardId)) ?? "";
    } catch {
      raw = "";
    }
    const cached = settingsCache.get(boardId);
    if (cached && cached.raw === raw) {
      return cached.value;
    }
    const value = readSettings(boardId);
    settingsCache.set(boardId, { raw, value });
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SETTINGS);
}

/* --- Flip colours: a personal view of the board ---------------------------- */

/**
 * Whether this device sees the board with inverted colours.
 *
 * The setting is personal on purpose: one person can flip the board for
 * themselves without changing what everybody else sees.
 */
export function useFlipColors(): [boolean, (value: boolean) => void] {
  const getSnapshot = () => {
    try {
      return window.localStorage.getItem(FLIP_KEY) === "1";
    } catch {
      return false;
    }
  };
  const flip = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  );
  const setFlip = (value: boolean) => {
    try {
      window.localStorage.setItem(FLIP_KEY, value ? "1" : "0");
    } catch {
      // Storage unavailable: the flip lasts for this render only.
    }
    listeners.forEach((listener) => listener());
  };
  return [flip, setFlip];
}
