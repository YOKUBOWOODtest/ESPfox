"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  onStrokeCommit?: (stroke: Stroke) => void;
  /** Called when strokes are removed, by the eraser or by undo. */
  onStrokesRemove?: (strokeIds: string[]) => void;
  /** Called when a stroke's transform changes. */
  onStrokeTransform?: (strokeId: string, transform: Transform) => void;
  onItemAdd?: (item: ImportedItem) => void;
  /**
   * Called when an imported item changes.
   *
   * The patch is what changed, not the whole item: an imported image can be
   * megabytes of data URL, and sending that on every pointer move would swamp
   * the connection.
   */
  onItemUpdate?: (itemId: string, patch: Partial<ImportedItem>) => void;
  onItemRemove?: (itemId: string) => void;
  onItemsReorder?: (orderedIds: string[]) => void;
}

export interface BoardDocOptions extends BoardDocCallbacks {
  /** This device, stamped on new ink so ownership survives a reload. */
  selfId: string;
  /**
   * Whether this device is the board's host.
   *
   * A function rather than a value: the host is decided by the collaboration
   * server after the document hook has been created.
   */
  isHost?: () => boolean;
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

export function useBoardDoc(options?: BoardDocOptions) {
  const callbacksRef = useRef<BoardDocCallbacks | undefined>(options);
  const selfRef = useRef(options?.selfId ?? "");
  const isHostRef = useRef(options?.isHost);
  // The board re-renders while a gesture is in progress, so the refs are kept
  // current after every commit rather than during render.
  useEffect(() => {
    callbacksRef.current = options;
    selfRef.current = options?.selfId ?? "";
    isHostRef.current = options?.isHost;
  });

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

  /**
   * Whether this device may change or delete a record.
   *
   * Your own ink is always yours; the board's host can also manage everybody
   * else's. Records saved before collaboration have no author and stay shared.
   */
  const mayManage = useCallback((authorId?: string): boolean => {
    if (!authorId) {
      return true;
    }
    return authorId === selfRef.current || Boolean(isHostRef.current?.());
  }, []);

  /** Copies the document deeply enough to be restored later. */
  const capture = useCallback(
    (): DocSnapshot => ({
      strokes: strokes.current.map((stroke) => ({
        ...stroke,
        transform: { ...stroke.transform },
      })),
      items: items.current.map((item) => ({ ...item })),
      selectedIds: new Set(selectedIds.current),
      selectedItemId: selectedItemId.current,
    }),
    [],
  );

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
      const newStroke = createStroke(points, style, selfRef.current || undefined);
      strokes.current = [...strokes.current, newStroke];
      bump();
      callbacksRef.current?.onStrokeCommit?.(newStroke);
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
   *
   * Only the strokes this device may manage are hit: normally that is your own
   * ink, with the host additionally able to erase anybody's.
   */
  const eraseAt = useCallback(
    (worldX: number, worldY: number, radius: number): number => {
      const removedStrokes: Stroke[] = [];
      const remaining = strokes.current.filter((stroke) => {
        const hit = hitStroke(stroke, worldX, worldY, radius);
        if (hit && mayManage(stroke.authorId)) {
          removedStrokes.push(stroke);
          return false;
        }
        return true;
      });
      if (removedStrokes.length > 0) {
        strokes.current = remaining;
        // An erased stroke must not stay in the selection.
        if (selectedIds.current.size > 0) {
          const alive = new Set(strokes.current.map((stroke) => stroke.id));
          selectedIds.current = new Set(
            [...selectedIds.current].filter((id) => alive.has(id)),
          );
        }
        bump();
        callbacksRef.current?.onStrokesRemove?.(
          removedStrokes.map((stroke) => stroke.id),
        );
      }
      return removedStrokes.length;
    },
    [bump, mayManage],
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
      const stored: ImportedItem = {
        ...item,
        authorId: item.authorId ?? selfRef.current,
      };
      items.current = [...items.current, stored];
      bump();
      callbacksRef.current?.onItemAdd?.(stored);
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
      let updated: ImportedItem | null = null;
      items.current = items.current.map((item) => {
        if (item.id !== id) {
          return item;
        }
        updated = { ...item, ...patch };
        return updated;
      });
      if (!live) {
        bump();
      }
      if (updated) {
        callbacksRef.current?.onItemUpdate?.(id, patch);
      }
    },
    [bump],
  );

  /** Removes an imported item and forgets its selection. */
  const removeItem = useCallback(
    (id: string) => {
      const source = items.current.find((item) => item.id === id);
      if (!source || !mayManage(source.authorId)) {
        return;
      }
      items.current = items.current.filter((item) => item.id !== id);
      if (selectedItemId.current === id) {
        selectedItemId.current = null;
      }
      bump();
      callbacksRef.current?.onItemRemove?.(id);
    },
    [bump, mayManage],
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
        id: `${source.id}-copy-${Date.now().toString(36)}`,
        x: source.x + 24,
        y: source.y + 24,
        createdAt: Date.now(),
        authorId: selfRef.current,
      };
      items.current = [...items.current, copy];
      selectedItemId.current = copy.id;
      bump();
      callbacksRef.current?.onItemAdd?.(copy);
    },
    [bump],
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
      callbacksRef.current?.onItemsReorder?.(
        items.current.map((item) => item.id),
      );
    },
    [bump],
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

  /* --- Incoming collaboration -------------------------------------------- */

  /**
   * Merges a stroke that another device drew.
   *
   * Remote state is applied here rather than by the board reaching into the
   * document's refs: the document owns its data, and a duplicate broadcast
   * (a reconnect, for instance) must not add the same stroke twice.
   */
  const addRemoteStroke = useCallback(
    (stroke: Stroke) => {
      if (strokes.current.some((entry) => entry.id === stroke.id)) {
        return;
      }
      strokes.current = [...strokes.current, stroke];
      bump();
    },
    [bump],
  );

  /** Removes strokes that somebody else erased (or that undo removed). */
  const removeRemoteStrokes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const removed = new Set(ids);
      const next = strokes.current.filter((stroke) => !removed.has(stroke.id));
      if (next.length === strokes.current.length) {
        return;
      }
      strokes.current = next;
      if (selectedIds.current.size > 0) {
        selectedIds.current = new Set(
          [...selectedIds.current].filter((id) => !removed.has(id)),
        );
      }
      bump();
    },
    [bump],
  );

  /** Applies a transform that another device made to its own stroke. */
  const transformRemoteStroke = useCallback(
    (strokeId: string, transform: Transform) => {
      strokes.current = strokes.current.map((stroke) =>
        stroke.id === strokeId ? { ...stroke, transform } : stroke,
      );
    },
    [],
  );

  /** Merges imported media that another device added. */
  const addRemoteItem = useCallback(
    (item: ImportedItem) => {
      if (items.current.some((entry) => entry.id === item.id)) {
        return;
      }
      items.current = [...items.current, item];
      bump();
    },
    [bump],
  );

  /** Applies a move, resize, rotation or option change from another device. */
  const updateRemoteItem = useCallback((item: ImportedItem) => {
    items.current = items.current.map((entry) =>
      entry.id === item.id ? item : entry,
    );
  }, []);

  /** Removes imported media that its owner or the host deleted. */
  const removeRemoteItem = useCallback(
    (itemId: string) => {
      const next = items.current.filter((entry) => entry.id !== itemId);
      if (next.length === items.current.length) {
        return;
      }
      items.current = next;
      if (selectedItemId.current === itemId) {
        selectedItemId.current = null;
      }
      bump();
    },
    [bump],
  );

  /** Applies the stacking order another device chose. */
  const applyItemOrder = useCallback((orderedIds: string[]) => {
    const byId = new Map(items.current.map((item) => [item.id, item]));
    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((item): item is ImportedItem => Boolean(item));
    const seen = new Set(ordered.map((item) => item.id));
    items.current = [
      ...ordered,
      ...items.current.filter((item) => !seen.has(item.id)),
    ];
  }, []);

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
          callbacksRef.current?.onStrokeTransform?.(stroke.id, newTransform);
          return { ...stroke, transform: newTransform };
        }
        return stroke;
      });
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

  /**
   * Undoes the last local edit.
   *
   * Undo is personal. It rewinds this device's last action, but it never
   * deletes, restores or rewinds work that belongs to somebody else: remote
   * ink that arrived after the snapshot is kept, and remote ink that has since
   * been erased is not resurrected.
   */
  const undo = useCallback((): boolean => {
    const beforeStrokes = strokes.current;
    const beforeItems = items.current;
    const previous = history.current.pop();

    if (!previous) {
      // Nothing to restore: drop this device's most recent stroke.
      for (let index = beforeStrokes.length - 1; index >= 0; index -= 1) {
        const stroke = beforeStrokes[index];
        if (!stroke.authorId || stroke.authorId === selfRef.current) {
          strokes.current = beforeStrokes.filter((_, i) => i !== index);
          bump();
          callbacksRef.current?.onStrokesRemove?.([stroke.id]);
          return true;
        }
      }
      return false;
    }

    const restoreStrokes = (): Stroke[] => {
      const currentById = new Map(beforeStrokes.map((stroke) => [stroke.id, stroke]));
      const restored: Stroke[] = [];
      const seen = new Set<string>();
      for (const stroke of previous.strokes) {
        const remote = Boolean(stroke.authorId) && stroke.authorId !== selfRef.current;
        if (remote) {
          const live = currentById.get(stroke.id);
          if (!live) {
            continue;
          }
          restored.push(live);
        } else {
          restored.push(stroke);
        }
        seen.add(stroke.id);
      }
      for (const stroke of beforeStrokes) {
        const remote = Boolean(stroke.authorId) && stroke.authorId !== selfRef.current;
        if (remote && !seen.has(stroke.id)) {
          restored.push(stroke);
          seen.add(stroke.id);
        }
      }
      return restored;
    };

    const restoreItems = (): ImportedItem[] => {
      const currentById = new Map(beforeItems.map((item) => [item.id, item]));
      const restored: ImportedItem[] = [];
      const seen = new Set<string>();
      for (const item of previous.items) {
        const remote = Boolean(item.authorId) && item.authorId !== selfRef.current;
        if (remote) {
          const live = currentById.get(item.id);
          if (!live) {
            continue;
          }
          restored.push(live);
        } else {
          restored.push(item);
        }
        seen.add(item.id);
      }
      for (const item of beforeItems) {
        const remote = Boolean(item.authorId) && item.authorId !== selfRef.current;
        if (remote && !seen.has(item.id)) {
          restored.push(item);
          seen.add(item.id);
        }
      }
      return restored;
    };

    const restoredStrokes = restoreStrokes();
    const restoredItems = restoreItems();
    strokes.current = restoredStrokes;
    items.current = restoredItems;
    const alive = new Set(restoredStrokes.map((stroke) => stroke.id));
    selectedIds.current = new Set(
      [...previous.selectedIds].filter((id) => alive.has(id)),
    );
    selectedItemId.current = previous.selectedItemId;
    bump();

    // Push the difference to the other boards so undo is not a private lie.
    const afterStrokes = new Set(restoredStrokes.map((stroke) => stroke.id));
    const beforeStrokesById = new Map(beforeStrokes.map((stroke) => [stroke.id, stroke]));
    const removedIds = beforeStrokes
      .filter((stroke) => !afterStrokes.has(stroke.id))
      .map((stroke) => stroke.id);
    if (removedIds.length > 0) {
      callbacksRef.current?.onStrokesRemove?.(removedIds);
    }
    for (const stroke of restoredStrokes) {
      if (!beforeStrokesById.has(stroke.id)) {
        callbacksRef.current?.onStrokeCommit?.(stroke);
      } else if (
        stroke.authorId === selfRef.current &&
        beforeStrokesById.get(stroke.id)?.transform !== stroke.transform
      ) {
        callbacksRef.current?.onStrokeTransform?.(stroke.id, stroke.transform);
      }
    }

    const afterItems = new Set(restoredItems.map((item) => item.id));
    const beforeItemsById = new Map(beforeItems.map((item) => [item.id, item]));
    for (const item of beforeItems) {
      if (!afterItems.has(item.id)) {
        callbacksRef.current?.onItemRemove?.(item.id);
      }
    }
    for (const item of restoredItems) {
      const before = beforeItemsById.get(item.id);
      if (!before) {
        callbacksRef.current?.onItemAdd?.(item);
      } else if (before !== item && item.authorId === selfRef.current) {
        callbacksRef.current?.onItemUpdate?.(item.id, item);
      }
    }

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
    addRemoteStroke,
    removeRemoteStrokes,
    transformRemoteStroke,
    addRemoteItem,
    updateRemoteItem,
    removeRemoteItem,
    applyItemOrder,
  };
}

export type BoardDoc = ReturnType<typeof useBoardDoc>;
