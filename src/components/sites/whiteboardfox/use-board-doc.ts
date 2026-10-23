"use client";

import { useCallback, useRef, useState } from "react";
import {
  createStroke,
  hitStroke,
  lassoHitsStroke,
  multiply,
  rotateAbout,
  scaleAbout,
  translation,
  type Point,
  type Stroke,
  type StrokeStyle,
  type Transform,
} from "@/lib/board/stroke";
import type { ImportedItem } from "@/lib/board/imported";

/**
 * Board document.
 *
 * Holds the strokes and the current selection. Kept in a ref rather than state
 * because it changes on every pointermove: routing that through React would
 * re-render the whole board dozens of times a second. Components read the ref
 * directly from the animation loop, and only "structural" changes (a stroke
 * finishing, a selection changing) bump a counter to trigger a repaint.
 */

export interface BoardDocCallbacks {
  /** Called when a new stroke is committed. */
  onStrokeCommit?: (stroke: import("@/lib/board/stroke").Stroke) => void;
  /** Called when strokes are removed (by erase). */
  onStrokesRemove?: (strokeIds: string[]) => void;
  /** Called when a stroke's transform changes. */
  onStrokeTransform?: (strokeId: string, transform: import("@/lib/board/stroke").Transform) => void;
  /** Called when items change. */
  onItemsChange?: (items: import("@/lib/board/imported").ImportedItem[]) => void;
}

/** How many steps the undo history keeps. */
const HISTORY_LIMIT = 50;

/** The document as it was before an edit, so undo can come back to it. */
interface DocSnapshot {
  strokes: Stroke[];
  items: ImportedItem[];
  selectedIds: Set<string>;
  selectedItemId: string | null;
}

export function useBoardDoc(callbacks?: BoardDocCallbacks) {
  const strokes = useRef<Stroke[]>([]);
  const selectedIds = useRef<Set<string>>(new Set());
  /** The imported media the board carries. */
  const items = useRef<ImportedItem[]>([]);
  /** The imported item that is selected, if any. */
  const selectedItemId = useRef<string | null>(null);
  /** Bumped whenever the document changes, so the canvas effect re-runs. */
  const [version, setVersion] = useState(0);
  /**
   * The undo history.
   *
   * A snapshot is taken *before* an edit and restored by undo, so the history
   * holds the past rather than the present. Select gestures are grouped: the
   * snapshot is taken when the drag starts, so sixty pointer moves are one
   * undo step rather than sixty.
   */
  const history = useRef<DocSnapshot[]>([]);
  /** The snapshot of the edit currently in progress, if any. */
  const pending = useRef<DocSnapshot | null>(null);

  const bump = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  /** Copies the document deeply enough to be restored later. */
  const capture = useCallback((): DocSnapshot => ({
    strokes: strokes.current.map((stroke) => ({
      ...stroke,
      transform: { ...stroke.transform },
    })),
    items: items.current.map((item) => ({ ...item })),
    selectedIds: new Set(selectedIds.current),
    selectedItemId: selectedItemId.current,
  }), []);

  /**
   * Starts an edit.
   *
   * Called when a gesture that changes the document begins. Everything the
   * gesture does is then undone in one step.
   */
  const beginEdit = useCallback(() => {
    pending.current = capture();
  }, [capture]);

  /**
   * Ends an edit.
   *
   * The snapshot is only kept when the document actually changed, so a click
   * that moved nothing does not eat an undo step.
   */
  const endEdit = useCallback(() => {
    const before = pending.current;
    pending.current = null;
    if (!before) {
      return;
    }
    const unchanged =
      before.strokes.length === strokes.current.length &&
      before.strokes.every((stroke, index) => stroke === strokes.current[index]) &&
      before.items.length === items.current.length &&
      before.items.every((item, index) => item === items.current[index]);
    if (unchanged) {
      return;
    }
    history.current.push(before);
    if (history.current.length > HISTORY_LIMIT) {
      history.current.shift();
    }
  }, []);

  /** Appends a finished stroke, or discards it when it drew nothing. */
  const commitStroke = useCallback(
    (points: Point[], style: StrokeStyle) => {
      if (points.length === 0) {
        return;
      }
      // The stroke is one undo step of its own.
      history.current.push(capture());
      if (history.current.length > HISTORY_LIMIT) {
        history.current.shift();
      }
      const newStroke = createStroke(points, style);
      strokes.current = [...strokes.current, newStroke];
      bump();
      callbacks?.onStrokeCommit?.(newStroke);
    },
    [bump, capture, callbacks],
  );

  /**
   * Stroke-based erasure.
   *
   * Every stroke touched by the cursor is removed *entirely*. This is the
   * behaviour the source has and the opposite of the previous implementation,
   * which painted opaque pixels over a single flat point array. Returns how
   * many strokes were removed so the caller can decide whether to flash a
   * message.
   */
  const eraseAt = useCallback(
    (worldX: number, worldY: number, radius: number): number => {
      const remaining = strokes.current.filter(
        (stroke) => !hitStroke(stroke, worldX, worldY, radius),
      );
      const removed = strokes.current.length - remaining.length;
      if (removed > 0) {
        const removedIds = strokes.current
          .filter((s) => !remaining.includes(s))
          .map((s) => s.id);
        strokes.current = remaining;
        // An erased stroke must not stay in the selection.
        if (selectedIds.current.size > 0) {
          const alive = new Set(strokes.current.map((stroke) => stroke.id));
          selectedIds.current = new Set(
            [...selectedIds.current].filter((id) => alive.has(id)),
          );
        }
        bump();
        callbacks?.onStrokesRemove?.(removedIds);
      }
      return removed;
    },
    [bump, callbacks],
  );

  /** Replaces the selection with everything the lasso touched. */
  const selectWithLasso = useCallback(
    (polygon: { x: number; y: number }[]) => {
      const ids = new Set<string>();
      for (const stroke of strokes.current) {
        if (lassoHitsStroke(stroke, polygon)) {
          ids.add(stroke.id);
        }
      }
      selectedIds.current = ids;
      // Picking up ink puts the imported media down.
      if (ids.size > 0 && selectedItemId.current !== null) {
        selectedItemId.current = null;
      }
      bump();
      return ids.size;
    },
    [bump],
  );

  const clearSelection = useCallback(() => {
    if (selectedIds.current.size === 0) {
      return;
    }
    selectedIds.current = new Set();
    bump();
  }, [bump]);

  /* --- Imported items ----------------------------------------------------- */

  /**
   * Adds an imported item.
   *
   * Like every other edit to the document, this is one undo step: the caller
   * wraps it in `beginEdit` and `endEdit`.
   */
  const addItem = useCallback(
    (item: ImportedItem) => {
      items.current = [...items.current, item];
      bump();
    },
    [bump],
  );

  /**
   * Changes an imported item.
   *
   * `live` controls whether the version counter is bumped: during a drag the
   * caller repaints from the animation loop instead.
   */
  const updateItem = useCallback(
    (id: string, patch: Partial<ImportedItem>, live: boolean) => {
      items.current = items.current.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      if (!live) {
        bump();
      }
    },
    [bump],
  );

  /** Removes an imported item and forgets its selection. */
  const removeItem = useCallback(
    (id: string) => {
      const remaining = items.current.filter((item) => item.id !== id);
      if (remaining.length === items.current.length) {
        return;
      }
      items.current = remaining;
      if (selectedItemId.current === id) {
        selectedItemId.current = null;
      }
      bump();
    },
    [bump],
  );

  /** Copies an imported item, offset a little so both stay visible. */
  const duplicateItem = useCallback(
    (id: string) => {
      const source = items.current.find((item) => item.id === id);
      if (!source) {
        return;
      }
      const copy: ImportedItem = {
        ...source,
        id: `${source.id}-copy-${items.current.length}`,
        x: source.x + 24,
        y: source.y + 24,
        createdAt: Date.now(),
      };
      items.current = [...items.current, copy];
      selectedItemId.current = copy.id;
      bump();
      callbacks?.onItemsChange?.(items.current);
    },
    [bump, callbacks],
  );

  /** Sends an imported item to the front or to the back of the stack. */
  const reorderItem = useCallback(
    (id: string, toFront: boolean) => {
      const source = items.current.find((item) => item.id === id);
      if (!source) {
        return;
      }
      const rest = items.current.filter((item) => item.id !== id);
      items.current = toFront ? [...rest, source] : [source, ...rest];
      bump();
      callbacks?.onItemsChange?.(items.current);
    },
    [bump, callbacks],
  );

  /**
   * Selects an imported item.
   *
   * The ink and the media are two different selections: picking up a picture
   * puts the stroke selection down.
   */
  const selectItem = useCallback(
    (id: string | null) => {
      if (selectedItemId.current === id) {
        return;
      }
      selectedItemId.current = id;
      if (id !== null && selectedIds.current.size > 0) {
        selectedIds.current = new Set();
      }
      bump();
    },
    [bump],
  );

  const selectedStrokes = useCallback(
    () => strokes.current.filter((stroke) => selectedIds.current.has(stroke.id)),
    [],
  );

  /**
   * Applies a transform to every selected stroke.
   *
   * `live` controls whether the version counter is bumped: during a drag the
   * caller repaints from the animation loop instead, so bumping 60 times a
   * second would force needless React renders.
   */
  const transformSelection = useCallback(
    (transform: Transform, live: boolean) => {
      if (selectedIds.current.size === 0) {
        return;
      }
      strokes.current = strokes.current.map((stroke) => {
        if (selectedIds.current.has(stroke.id)) {
          const newTransform = multiply(transform, stroke.transform);
          callbacks?.onStrokeTransform?.(stroke.id, newTransform);
          return { ...stroke, transform: newTransform };
        }
        return stroke;
      });
      if (!live) {
        bump();
      }
    },
    [bump, callbacks],
  );

  const moveSelection = useCallback(
    (dx: number, dy: number, live: boolean) => {
      transformSelection(translation(dx, dy), live);
    },
    [transformSelection],
  );

  const scaleSelection = useCallback(
    (scaleX: number, scaleY: number, pivotX: number, pivotY: number, live: boolean) => {
      transformSelection(scaleAbout(scaleX, scaleY, pivotX, pivotY), live);
    },
    [transformSelection],
  );

  const rotateSelection = useCallback(
    (radians: number, pivotX: number, pivotY: number, live: boolean) => {
      transformSelection(rotateAbout(radians, pivotX, pivotY), live);
    },
    [transformSelection],
  );

  /**
   * Undoes the last edit.
   *
   * The history holds the document *before* each edit, so undo restores the
   * last snapshot. That covers a drawn stroke, an erased one and — the point
   * of the history — a change made with the Select tool, whether it moved,
   * scaled or rotated the selection.
   */
  /**
   * The document, as it is saved.
   *
   * The auto-save writes this to the browser's storage; the strokes and the
   * imported media are copied, so a later edit cannot change what was saved.
   */
  const exportDocument = useCallback(
    () => ({
      strokes: strokes.current.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
        style: { ...stroke.style },
        transform: { ...stroke.transform },
      })),
      items: items.current.map((item) => ({ ...item })),
    }),
    [],
  );

  /**
   * Restores a saved document.
   *
   * The history is left alone: a board that is reopened starts with a clean
   * undo history rather than one full of steps the user never took.
   */
  const importDocument = useCallback(
    (document: { strokes: Stroke[]; items: ImportedItem[] }) => {
      strokes.current = document.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
        style: { ...stroke.style },
        transform: { ...stroke.transform },
      }));
      items.current = document.items.map((item) => ({ ...item }));
      selectedIds.current = new Set();
      selectedItemId.current = null;
      bump();
    },
    [bump],
  );

  const undo = useCallback((): boolean => {
    const previous = history.current.pop();
    if (!previous) {
      // Nothing to restore: fall back to the source's behaviour of dropping
      // the most recently drawn stroke.
      if (strokes.current.length === 0) {
        return false;
      }
      strokes.current = strokes.current.slice(0, -1);
      bump();
      return true;
    }
    strokes.current = previous.strokes;
    items.current = previous.items;
    selectedIds.current = previous.selectedIds;
    selectedItemId.current = previous.selectedItemId;
    bump();
    return true;
  }, [bump]);

  const clearAll = useCallback(() => {
    if (
      strokes.current.length === 0 &&
      items.current.length === 0 &&
      selectedIds.current.size === 0
    ) {
      return;
    }
    // Clearing the board is undoable too.
    history.current.push(capture());
    if (history.current.length > HISTORY_LIMIT) {
      history.current.shift();
    }
    strokes.current = [];
    items.current = [];
    selectedIds.current = new Set();
    selectedItemId.current = null;
    bump();
  }, [bump, capture]);

  return {
    strokes,
    selectedIds,
    items,
    selectedItemId,
    version,
    bump,
    beginEdit,
    endEdit,
    commitStroke,
    eraseAt,
    selectWithLasso,
    clearSelection,
    selectedStrokes,
    moveSelection,
    scaleSelection,
    rotateSelection,
    undo,
    clearAll,
    addItem,
    updateItem,
    removeItem,
    duplicateItem,
    reorderItem,
    selectItem,
    exportDocument,
    importDocument,
  };
}

export type BoardDoc = ReturnType<typeof useBoardDoc>;
