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

/**
 * Board document.
 *
 * Holds the strokes and the current selection. Kept in a ref rather than state
 * because it changes on every pointermove: routing that through React would
 * re-render the whole board dozens of times a second. Components read the ref
 * directly from the animation loop, and only "structural" changes (a stroke
 * finishing, a selection changing) bump a counter to trigger a repaint.
 */

/** How many steps the undo history keeps. */
const HISTORY_LIMIT = 50;

/** The document as it was before an edit, so undo can come back to it. */
interface DocSnapshot {
  strokes: Stroke[];
  selectedIds: Set<string>;
}

export function useBoardDoc() {
  const strokes = useRef<Stroke[]>([]);
  const selectedIds = useRef<Set<string>>(new Set());
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
    selectedIds: new Set(selectedIds.current),
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
      before.strokes.every((stroke, index) => stroke === strokes.current[index]);
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
      strokes.current = [...strokes.current, createStroke(points, style)];
      bump();
    },
    [bump, capture],
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
        strokes.current = remaining;
        // An erased stroke must not stay in the selection.
        if (selectedIds.current.size > 0) {
          const alive = new Set(strokes.current.map((stroke) => stroke.id));
          selectedIds.current = new Set(
            [...selectedIds.current].filter((id) => alive.has(id)),
          );
        }
        bump();
      }
      return removed;
    },
    [bump],
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
      strokes.current = strokes.current.map((stroke) =>
        selectedIds.current.has(stroke.id)
          ? { ...stroke, transform: multiply(transform, stroke.transform) }
          : stroke,
      );
      if (!live) {
        bump();
      }
    },
    [bump],
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
    selectedIds.current = previous.selectedIds;
    bump();
    return true;
  }, [bump]);

  const clearAll = useCallback(() => {
    if (strokes.current.length === 0 && selectedIds.current.size === 0) {
      return;
    }
    // Clearing the board is undoable too.
    history.current.push(capture());
    if (history.current.length > HISTORY_LIMIT) {
      history.current.shift();
    }
    strokes.current = [];
    selectedIds.current = new Set();
    bump();
  }, [bump, capture]);

  return {
    strokes,
    selectedIds,
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
  };
}

export type BoardDoc = ReturnType<typeof useBoardDoc>;
