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
import { useCollaboration, type RemoteUser } from "./use-collaboration";
import { useDeviceUser } from "./use-device-user";

/**
 * Board document.
 *
 * Holds the strokes and the current selection. Kept in a ref rather than state
 * because it changes on every pointermove: routing that through React would
 * re-render the whole board dozens of times a second. Components read the ref
 * directly from the animation loop, and only "structural" changes (a stroke
 * finishing, a selection changing) bump a counter to trigger a repaint.
 */

const HISTORY_LIMIT = 50;

interface DocSnapshot {
  strokes: Stroke[];
  items: ImportedItem[];
  selectedIds: Set<string>;
  selectedItemId: string | null;
}

export function useBoardDoc(boardId: string) {
  const user = useDeviceUser();
  const strokes = useRef<Stroke[]>([]);
  const selectedIds = useRef<Set<string>>(new Set());
  const items = useRef<ImportedItem[]>([]);
  const selectedItemId = useRef<string | null>(null);
  const [version, setVersion] = useState(0);
  const history = useRef<DocSnapshot[]>([]);
  const pending = useRef<DocSnapshot | null>(null);

  // Collaboration state
  const isHostRef = useRef(false);
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);

  const bump = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const capture = useCallback((): DocSnapshot => ({
    strokes: strokes.current.map((stroke) => ({
      ...stroke,
      transform: { ...stroke.transform },
    })),
    items: items.current.map((item) => ({ ...item })),
    selectedIds: new Set(selectedIds.current),
    selectedItemId: selectedItemId.current,
  }), []);

  const beginEdit = useCallback(() => {
    pending.current = capture();
  }, [capture]);

  const endEdit = useCallback(() => {
    const before = pending.current;
    pending.current = null;
    if (!before) return;
    const unchanged =
      before.strokes.length === strokes.current.length &&
      before.strokes.every((stroke, index) => stroke === strokes.current[index]) &&
      before.items.length === items.current.length &&
      before.items.every((item, index) => item === items.current[index]);
    if (unchanged) return;
    history.current.push(before);
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
  }, []);

  const commitStroke = useCallback(
    (points: Point[], style: StrokeStyle) => {
      if (points.length === 0) return;
      history.current.push(capture());
      if (history.current.length > HISTORY_LIMIT) history.current.shift();
      strokes.current = [...strokes.current, createStroke(points, style, {
        authorId: user.id,
        authorName: user.nickname ?? 'Anonymous',
        authorColor: `hsl(${user.id.split('-').pop() || '0'}, 70%, 50%)`
      })];
      bump();
    },
    [bump, capture, user.id, user.nickname],
  );

  const eraseAt = useCallback(
    (worldX: number, worldY: number, radius: number): number => {
      const remaining = strokes.current.filter(
        (stroke) => !hitStroke(stroke, worldX, worldY, radius),
      );
      const removed = strokes.current.length - remaining.length;
      if (removed > 0) {
        strokes.current = remaining;
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

  const selectWithLasso = useCallback(
    (polygon: { x: number; y: number }[]) => {
      const ids = new Set<string>();
      for (const stroke of strokes.current) {
        if (lassoHitsStroke(stroke, polygon)) {
          ids.add(stroke.id);
        }
      }
      selectedIds.current = ids;
      if (ids.size > 0 && selectedItemId.current !== null) {
        selectedItemId.current = null;
      }
      bump();
      return ids.size;
    },
    [bump],
  );

  const clearSelection = useCallback(() => {
    if (selectedIds.current.size === 0) return;
    selectedIds.current = new Set();
    bump();
  }, [bump]);

  const addItem = useCallback(
    (item: ImportedItem) => {
      items.current = [...items.current, item];
      bump();
    },
    [bump],
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<ImportedItem>, live: boolean) => {
      items.current = items.current.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      if (!live) bump();
    },
    [bump],
  );

  const removeItem = useCallback(
    (id: string) => {
      const remaining = items.current.filter((item) => item.id !== id);
      if (remaining.length === items.current.length) return;
      items.current = remaining;
      if (selectedItemId.current === id) selectedItemId.current = null;
      bump();
    },
    [bump],
  );

  const duplicateItem = useCallback(
    (id: string) => {
      const source = items.current.find((item) => item.id === id);
      if (!source) return;
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
    },
    [bump],
  );

  const reorderItem = useCallback(
    (id: string, toFront: boolean) => {
      const source = items.current.find((item) => item.id === id);
      if (!source) return;
      const rest = items.current.filter((item) => item.id !== id);
      items.current = toFront ? [...rest, source] : [source, ...rest];
      bump();
    },
    [bump],
  );

  const selectItem = useCallback(
    (id: string | null) => {
      if (selectedItemId.current === id) return;
      selectedItemId.current = id;
      if (id !== null && selectedIds.current.size > 0) selectedIds.current = new Set();
      bump();
    },
    [bump],
  );

  const selectedStrokes = useCallback(
    () => strokes.current.filter((stroke) => selectedIds.current.has(stroke.id)),
    [],
  );

  const transformSelection = useCallback(
    (transform: Transform, live: boolean) => {
      if (selectedIds.current.size === 0) return;
      strokes.current = strokes.current.map((stroke) =>
        selectedIds.current.has(stroke.id)
          ? { ...stroke, transform: multiply(transform, stroke.transform) }
          : stroke,
      );
      if (!live) bump();
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
      if (strokes.current.length === 0) return false;
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
    ) return;
    history.current.push(capture());
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    strokes.current = [];
    items.current = [];
    selectedIds.current = new Set();
    selectedItemId.current = null;
    bump();
  }, [bump, capture]);

  // --- Collaboration handlers ---
  
  const handleRemoteStroke = useCallback(
    (stroke: Stroke, authorId: string, authorName: string, authorColor: string) => {
      strokes.current = [...strokes.current, { ...stroke, authorId, authorName, authorColor }];
      bump();
    },
    [bump]
  );

  const handleRemoteStrokeBatch = useCallback(
    (incomingStrokes: Stroke[], authorId: string) => {
      strokes.current = [...strokes.current, ...incomingStrokes];
      bump();
    },
    [bump]
  );

  const handleRemoteStrokeDelete = useCallback(
    (strokeId: string, authorId: string) => {
      strokes.current = strokes.current.filter((s) => s.id !== strokeId);
      bump();
    },
    [bump]
  );

  const handleRemoteUndo = useCallback(
    (authorId: string) => {
      const lastIndex = strokes.current
        .map((s) => s.authorId)
        .lastIndexOf(authorId);
      if (lastIndex !== -1) {
        strokes.current = strokes.current.filter((_, i) => i !== lastIndex);
        bump();
      }
    },
    [bump]
  );

  const handleRemoteItem = useCallback(
    (item: ImportedItem, action: 'add' | 'update' | 'remove', authorId: string) => {
      if (action === 'add') {
        items.current = [...items.current, item];
      } else if (action === 'update') {
        items.current = items.current.map((i) => (i.id === item.id ? item : i));
      } else if (action === 'remove') {
        items.current = items.current.filter((i) => i.id !== item.id);
      }
      bump();
    },
    [bump]
  );

  const handleRemoteItemBatch = useCallback(
    (itemsList: ImportedItem[], authorId: string) => {
      items.current = [...items.current, ...itemsList];
      bump();
    },
    [bump]
  );

  const handleRemoteItemDelete = useCallback(
    (itemId: string, authorId: string) => {
      items.current = items.current.filter((i) => i.id !== itemId);
      bump();
    },
    [bump]
  );

  const handleRemoteClear = useCallback(() => {
    history.current.push(capture());
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    strokes.current = [];
    items.current = [];
    selectedIds.current = new Set();
    selectedItemId.current = null;
    bump();
  }, [bump, capture]);

  const handleRemoteCursor = useCallback(
    (userId: string, cursor: { x: number; y: number }) => {
      setRemoteUsers(prev => prev.map(u => u.userId === userId ? { ...u, cursor } : u));
    },
    []
  );

  const handleRemoteSelection = useCallback(
    (userId: string, selection: any) => {
      // Could store remote selection for display
    },
    []
  );

  const handleUserJoined = useCallback(
    (user: { userId: string; userName: string; color: string; isHost: boolean }) => {
      setRemoteUsers(prev => [...prev, { ...user, cursor: { x: 0, y: 0 } }]);
    },
    []
  );

  const handleUserLeft = useCallback(
    (userId: string) => {
      setRemoteUsers(prev => prev.filter(u => u.userId !== userId));
    },
    []
  );

  const handleHostChanged = useCallback(
    (newHostId: string) => {
      // Update host status
    },
    []
  );

  const handleBecameHost = useCallback(() => {
    // We became host
  }, []);

  const handleSyncRequest = useCallback(() => {
    // Send our document to the requesting client
  }, []);

  const handleSyncDocument = useCallback(
    (document: { strokes: any[]; items: any[] }) => {
      strokes.current = document.strokes.map((s: any) => ({
        ...s,
        points: s.points.map((p: any) => ({ ...p })),
        style: { ...s.style },
        transform: { ...s.transform }
      }));
      items.current = document.items.map((i: any) => ({ ...i }));
      bump();
    },
    [bump]
  );

  const handleError = useCallback(
    (message: string) => {
      console.error('[Collab] Error:', message);
    },
    []
  );

  // Initialize collaboration
  const collab = useCollaboration(
    boardId,
    user.id,
    user.nickname ?? 'Anonymous',
    handleRemoteStroke,
    handleRemoteStrokeBatch,
    handleRemoteStrokeDelete,
    handleRemoteUndo,
    handleRemoteItem,
    handleRemoteItemBatch,
    handleRemoteItemDelete,
    handleRemoteClear,
    handleRemoteCursor,
    handleRemoteSelection,
    handleUserJoined,
    handleUserLeft,
    handleHostChanged,
    handleBecameHost,
    handleSyncRequest,
    handleSyncDocument,
    handleError,
    isHostRef
  );

  // Wrap commitStroke to also send to network
  const commitStrokeWithSync = useCallback(
    (points: Point[], style: StrokeStyle) => {
      if (points.length === 0) return;
      history.current.push(capture());
      if (history.current.length > HISTORY_LIMIT) history.current.shift();
      
      const author = {
        authorId: user.id,
        authorName: user.nickname ?? 'Anonymous',
        authorColor: `hsl(${user.id.split('-').pop() || '0'}, 70%, 50%)`
      };
      
      const stroke = createStroke(points, style, author);
      strokes.current = [...strokes.current, stroke];
      bump();
      
      // Send to other clients
      collab.sendStroke(stroke);
    },
    [bump, capture, user.id, user.nickname, collab]
  );

  // Wrap item operations with sync
  const addItemWithSync = useCallback(
    (item: ImportedItem) => {
      items.current = [...items.current, item];
      bump();
      collab.sendItem(item, 'add');
    },
    [bump, collab]
  );

  const updateItemWithSync = useCallback(
    (id: string, patch: Partial<ImportedItem>, live: boolean) => {
      items.current = items.current.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      if (!live) bump();
      if (!live) collab.sendItem({ ...items.current.find(i => i.id === id)!, ...patch }, 'update');
    },
    [bump, collab]
  );

  const removeItemWithSync = useCallback(
    (id: string) => {
      const item = items.current.find((item) => item.id === id);
      const remaining = items.current.filter((item) => item.id !== id);
      if (remaining.length === items.current.length) return;
      items.current = remaining;
      if (selectedItemId.current === id) selectedItemId.current = null;
      bump();
      if (item) collab.sendItemDelete(id);
    },
    [bump, collab]
  );

  const clearAllWithSync = useCallback(() => {
    if (
      strokes.current.length === 0 &&
      items.current.length === 0 &&
      selectedIds.current.size === 0
    ) return;
    history.current.push(capture());
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    strokes.current = [];
    items.current = [];
    selectedIds.current = new Set();
    selectedItemId.current = null;
    bump();
    collab.sendClear();
  }, [bump, capture, collab]);

  const undoWithSync = useCallback((): boolean => {
    const previous = history.current.pop();
    if (!previous) {
      if (strokes.current.length === 0) return false;
      strokes.current = strokes.current.slice(0, -1);
      bump();
      collab.sendUndo();
      return true;
    }
    strokes.current = previous.strokes;
    items.current = previous.items;
    selectedIds.current = previous.selectedIds;
    selectedItemId.current = previous.selectedItemId;
    bump();
    collab.sendUndo();
    return true;
  }, [bump, collab]);

  return {
    strokes,
    selectedIds,
    items,
    selectedItemId,
    version,
    bump,
    beginEdit,
    endEdit,
    commitStroke: commitStrokeWithSync,
    eraseAt,
    selectWithLasso,
    clearSelection,
    selectedStrokes,
    moveSelection,
    scaleSelection,
    rotateSelection,
    undo: undoWithSync,
    clearAll: clearAllWithSync,
    addItem: addItemWithSync,
    updateItem: updateItemWithSync,
    removeItem: removeItemWithSync,
    duplicateItem,
    reorderItem,
    selectItem,
    exportDocument,
    importDocument,
    remoteUsers,
    isHost: isHostRef.current,
    collab
  };
}

export type BoardDoc = ReturnType<typeof useBoardDoc>;