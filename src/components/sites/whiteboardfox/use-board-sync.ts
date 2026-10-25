"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Stroke, Transform } from "@/lib/board/stroke";
import type { ImportedItem } from "@/lib/board/imported";

/**
 * Live collaboration.
 *
 * One Socket.io connection per board. Every finished stroke, imported item and
 * cursor position goes through the server, which broadcasts it to the other
 * people on the same board — whether they are on a laptop or a phone.
 *
 * The callbacks the board passes in change on every render, so they are kept
 * in a ref: the effect itself only depends on the board's identity. Without
 * that, the board re-rendering twice a second would tear the socket down and
 * reconnect it just as often.
 */

export interface SyncUser {
  id: string;
  name: string;
  hue: number;
  isHost: boolean;
}

export interface SyncServerState {
  strokes: Stroke[];
  items: ImportedItem[];
  users: SyncUser[];
  hostId: string | null;
  isHost: boolean;
}

export interface UseBoardSyncOptions {
  boardId: string;
  userId: string;
  userName: string;
  userHue: number;
  /** The socket is only opened once the local document has been restored. */
  enabled: boolean;
  /** What this browser has on the board, used to seed an empty server. */
  getLocalDocument: () => { strokes: Stroke[]; items: ImportedItem[] };
  /** Full board state from the server, or from the host's seed. */
  onServerState: (state: SyncServerState) => void;
  onStrokeAdd: (stroke: Stroke) => void;
  onStrokesRemove: (strokeIds: string[]) => void;
  onStrokeTransform: (strokeId: string, transform: Transform) => void;
  onItemAdd: (item: ImportedItem) => void;
  onItemUpdate: (item: ImportedItem) => void;
  onItemRemove: (itemId: string) => void;
  onItemsReorder: (orderedIds: string[]) => void;
  onBoardCleared: () => void;
  onCursorUpdate: (
    userId: string,
    x: number,
    y: number,
    color: string,
    name: string,
  ) => void;
  onCursorRemove: (userId: string) => void;
  onKicked: () => void;
  onBanned: () => void;
  /** Somebody started or stopped an audio item. */
  onAudioPlay: (itemId: string, position: number, playing: boolean) => void;
  onError?: (message: string) => void;
}

export interface BoardSync {
  connected: boolean;
  users: SyncUser[];
  hostId: string | null;
  /** Whether this device is the board's host, as the server sees it. */
  isHost: boolean;
  sendStroke: (stroke: Stroke) => void;
  sendStrokeRemove: (strokeIds: string[]) => void;
  sendStrokeTransform: (strokeId: string, transform: Transform) => void;
  sendItemAdd: (item: ImportedItem) => void;
  sendItemUpdate: (itemId: string, patch: Partial<ImportedItem>) => void;
  sendItemRemove: (itemId: string) => void;
  sendItemsReorder: (orderedIds: string[]) => void;
  sendCursor: (x: number, y: number, color: string) => void;
  sendClear: () => void;
  sendKick: (targetUserId: string) => void;
  sendBan: (targetUserId: string) => void;
  sendAudioPlay: (
    itemId: string,
    position: number,
    playing: boolean,
  ) => void;
}

/** How often cursor and transform updates leave the device, at most. */
const CURSOR_INTERVAL_MS = 50;
const LIVE_UPDATE_INTERVAL_MS = 40;

export function useBoardSync(options: UseBoardSyncOptions): BoardSync {
  const optionsRef = useRef(options);
  // Callbacks change on every render; store them after commit so the socket
  // effect can keep its short dependency list and stay connected.
  useEffect(() => {
    optionsRef.current = options;
  });

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<SyncUser[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);

  const cursorSentAt = useRef(0);
  const pendingItems = useRef(new Map<string, Partial<ImportedItem>>());
  const itemTimers = useRef(new Map<string, number>());
  const pendingTransforms = useRef(new Map<string, Transform>());
  const transformTimers = useRef(new Map<string, number>());

  const { boardId, userId, userName, userHue, enabled } = options;

  useEffect(() => {
    if (!enabled || !boardId || !userId) {
      return;
    }

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim() || undefined;
    const socketPath = process.env.NEXT_PUBLIC_SOCKET_PATH?.trim() || "/socket.io";
    const socket = io(socketUrl, {
      path: socketPath,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
    });
    socketRef.current = socket;

    const applyState = (state: SyncServerState) => {
      optionsRef.current.onServerState(state);
      setUsers(state.users ?? []);
      setHostId(state.hostId ?? null);
      setIsHost(Boolean(state.isHost));
    };

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("board:join", {
        boardId,
        userId,
        name: userName,
        hue: userHue,
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", () => {
      setConnected(false);
    });

    socket.on("board:state", (state: unknown) => {
      const incoming = (state ?? {}) as Partial<SyncServerState> & { boardId?: string };
      const boardState: SyncServerState = {
        strokes: Array.isArray(incoming.strokes) ? incoming.strokes : [],
        items: Array.isArray(incoming.items) ? incoming.items : [],
        users: Array.isArray(incoming.users) ? incoming.users : [],
        hostId: typeof incoming.hostId === "string" ? incoming.hostId : null,
        isHost: Boolean(incoming.isHost),
      };
      const empty = boardState.strokes.length === 0 && boardState.items.length === 0;

      if (!empty) {
        applyState(boardState);
        return;
      }

      setUsers(boardState.users);
      setHostId(boardState.hostId);
      setIsHost(boardState.isHost);

      if (boardState.isHost) {
        // The board predates the server: upload what this browser has instead
        // of wiping it. Everybody else receives it through `board:seeded`.
        const local = optionsRef.current.getLocalDocument();
        if (local.strokes.length > 0 || local.items.length > 0) {
          socket.emit("board:seed", {
            boardId,
            strokes: local.strokes,
            items: local.items,
          });
        }
      } else {
        // A stale local copy must not leak onto the shared board.
        optionsRef.current.onServerState(boardState);
      }
    });

    socket.on("board:seeded", (state: unknown) => {
      const incoming = (state ?? {}) as { strokes?: Stroke[]; items?: ImportedItem[] };
      optionsRef.current.onServerState({
        strokes: Array.isArray(incoming.strokes) ? incoming.strokes : [],
        items: Array.isArray(incoming.items) ? incoming.items : [],
        users: [],
        hostId: null,
        isHost: false,
      });
    });

    socket.on("stroke:add", (stroke: Stroke) => {
      optionsRef.current.onStrokeAdd(stroke);
    });

    socket.on("stroke:remove", (strokeIds: string[]) => {
      if (Array.isArray(strokeIds)) {
        optionsRef.current.onStrokesRemove(strokeIds);
      }
    });

    socket.on("stroke:transform", (data: { strokeId: string; transform: Transform }) => {
      optionsRef.current.onStrokeTransform(data.strokeId, data.transform);
    });

    socket.on("item:add", (item: ImportedItem) => {
      optionsRef.current.onItemAdd(item);
    });

    socket.on("item:update", (item: ImportedItem) => {
      optionsRef.current.onItemUpdate(item);
    });

    socket.on("item:remove", (itemId: string) => {
      optionsRef.current.onItemRemove(itemId);
    });

    socket.on("item:reorder", (data: { order: string[] }) => {
      if (Array.isArray(data?.order)) {
        optionsRef.current.onItemsReorder(data.order);
      }
    });

    socket.on("board:cleared", () => {
      optionsRef.current.onBoardCleared();
    });

    socket.on("cursor:update", (data: {
      userId: string;
      x: number;
      y: number;
      color: string;
      name: string;
    }) => {
      optionsRef.current.onCursorUpdate(data.userId, data.x, data.y, data.color, data.name);
    });

    const syncUsers = (list: SyncUser[]) => {
      setUsers(list);
      setHostId((current) => {
        const host = list.find((user) => user.isHost);
        return host ? host.id : current;
      });
      setIsHost((current) => {
        const self = list.find((user) => user.id === userId);
        return self ? self.isHost : current;
      });
    };

    socket.on("users:update", (list: SyncUser[]) => {
      if (Array.isArray(list)) {
        syncUsers(list);
      }
    });

    socket.on("user:joined", (user: SyncUser) => {
      setUsers((current) => {
        const without = current.filter((entry) => entry.id !== user.id);
        return [...without, user];
      });
    });

    socket.on("user:left", (data: { userId: string }) => {
      optionsRef.current.onCursorRemove(data.userId);
      setUsers((current) => current.filter((user) => user.id !== data.userId));
    });

    socket.on("host:changed", (data: { hostId: string | null }) => {
      setHostId(data.hostId);
      setIsHost(data.hostId === userId);
      setUsers((current) =>
        current.map((user) => ({ ...user, isHost: user.id === data.hostId })),
      );
    });

    socket.on("audio:play", (data: {
      itemId: string;
      position: number;
      playing: boolean;
    }) => {
      if (typeof data?.itemId === "string") {
        optionsRef.current.onAudioPlay(
          data.itemId,
          Number.isFinite(data.position) ? data.position : 0,
          Boolean(data.playing),
        );
      }
    });

    socket.on("board:kicked", () => {
      optionsRef.current.onKicked();
    });

    socket.on("board:banned", () => {
      optionsRef.current.onBanned();
    });

    socket.on("error", (data: { message?: string }) => {
      if (data?.message) {
        optionsRef.current.onError?.(data.message);
      }
    });

    const itemTimersAtUnmount = itemTimers.current;
    const transformTimersAtUnmount = transformTimers.current;

    return () => {
      socket.emit("board:leave", { boardId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      for (const timer of itemTimersAtUnmount.values()) {
        window.clearTimeout(timer);
      }
      for (const timer of transformTimersAtUnmount.values()) {
        window.clearTimeout(timer);
      }
      itemTimersAtUnmount.clear();
      transformTimersAtUnmount.clear();
    };
  }, [boardId, userId, userName, userHue, enabled]);

  const sendStroke = useCallback(
    (stroke: Stroke) => {
      socketRef.current?.emit("stroke:add", { boardId, stroke });
    },
    [boardId],
  );

  const sendStrokeRemove = useCallback(
    (strokeIds: string[]) => {
      if (strokeIds.length > 0) {
        socketRef.current?.emit("stroke:remove", { boardId, strokeIds });
      }
    },
    [boardId],
  );

  const sendStrokeTransform = useCallback(
    (strokeId: string, transform: Transform) => {
      const socket = socketRef.current;
      if (!socket) {
        return;
      }
      pendingTransforms.current.set(strokeId, transform);
      if (transformTimers.current.has(strokeId)) {
        return;
      }
      const timer = window.setTimeout(() => {
        transformTimers.current.delete(strokeId);
        const latest = pendingTransforms.current.get(strokeId);
        pendingTransforms.current.delete(strokeId);
        if (latest) {
          socket.emit("stroke:transform", { boardId, strokeId, transform: latest });
        }
      }, LIVE_UPDATE_INTERVAL_MS);
      transformTimers.current.set(strokeId, timer);
    },
    [boardId],
  );

  const sendItemAdd = useCallback(
    (item: ImportedItem) => {
      socketRef.current?.emit("item:add", { boardId, item });
    },
    [boardId],
  );

  const sendItemUpdate = useCallback(
    (itemId: string, patch: Partial<ImportedItem>) => {
      const socket = socketRef.current;
      if (!socket) {
        return;
      }
      const previous = pendingItems.current.get(itemId);
      pendingItems.current.set(itemId, { ...previous, ...patch });
      if (itemTimers.current.has(itemId)) {
        return;
      }
      const timer = window.setTimeout(() => {
        itemTimers.current.delete(itemId);
        const latest = pendingItems.current.get(itemId);
        pendingItems.current.delete(itemId);
        if (latest) {
          socket.emit("item:update", { boardId, itemId, patch: latest });
        }
      }, LIVE_UPDATE_INTERVAL_MS);
      itemTimers.current.set(itemId, timer);
    },
    [boardId],
  );

  const sendItemRemove = useCallback(
    (itemId: string) => {
      socketRef.current?.emit("item:remove", { boardId, itemId });
    },
    [boardId],
  );

  const sendItemsReorder = useCallback(
    (order: string[]) => {
      socketRef.current?.emit("item:reorder", { boardId, order });
    },
    [boardId],
  );

  const sendCursor = useCallback(
    (x: number, y: number, color: string) => {
      const socket = socketRef.current;
      if (!socket) {
        return;
      }
      const now = Date.now();
      if (now - cursorSentAt.current < CURSOR_INTERVAL_MS) {
        return;
      }
      cursorSentAt.current = now;
      socket.emit("cursor:move", { boardId, x, y, color });
    },
    [boardId],
  );

  const sendClear = useCallback(() => {
    socketRef.current?.emit("board:clear", { boardId });
  }, [boardId]);

  const sendKick = useCallback(
    (targetUserId: string) => {
      socketRef.current?.emit("user:kick", { boardId, targetUserId });
    },
    [boardId],
  );

  const sendBan = useCallback(
    (targetUserId: string) => {
      socketRef.current?.emit("user:ban", { boardId, targetUserId });
    },
    [boardId],
  );

  const sendAudioPlay = useCallback(
    (itemId: string, position: number, playing: boolean) => {
      socketRef.current?.emit("audio:play", {
        boardId,
        itemId,
        position,
        playing,
      });
    },
    [boardId],
  );

  return {
    connected,
    users,
    hostId,
    isHost,
    sendAudioPlay,
    sendStroke,
    sendStrokeRemove,
    sendStrokeTransform,
    sendItemAdd,
    sendItemUpdate,
    sendItemRemove,
    sendItemsReorder,
    sendCursor,
    sendClear,
    sendKick,
    sendBan,
  };
}
