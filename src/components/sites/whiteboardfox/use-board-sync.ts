"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { Stroke, Point, StrokeStyle, Transform } from "@/lib/board/stroke";
import type { ImportedItem } from "@/lib/board/imported";
import type { RoomMessage, RoomReaction } from "@/lib/board/room";

interface UserInfo {
  id: string;
  name: string;
  hue: number;
  isHost: boolean;
  cursor?: { x: number; y: number; color: string };
}

interface BoardState {
  strokes: Stroke[];
  items: ImportedItem[];
  users: UserInfo[];
  hostId: string | null;
  isHost: boolean;
  settings: any;
  myId: string;
}

interface UseBoardSyncOptions {
  boardId: string;
  userId: string;
  userName: string;
  userHue: number;
  onStrokesChange: (strokes: Stroke[]) => void;
  onItemsChange: (items: ImportedItem[]) => void;
  onUsersChange: (users: UserInfo[]) => void;
  onHostChange: (isHost: boolean, hostId: string | null) => void;
  onSettingsChange: (settings: any) => void;
  onCursorUpdate: (userId: string, x: number, y: number, color: string, name: string) => void;
  onCursorRemove: (userId: string) => void;
  onMessage: (message: any) => void;
  onReaction: (reaction: any) => void;
  onKicked: () => void;
  onBanned: () => void;
  onError: (message: string) => void;
}

export function useBoardSync({
  boardId,
  userId,
  userName,
  userHue,
  onStrokesChange,
  onItemsChange,
  onUsersChange,
  onHostChange,
  onSettingsChange,
  onCursorUpdate,
  onCursorRemove,
  onMessage,
  onReaction,
  onKicked,
  onBanned,
  onError,
}: UseBoardSyncOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const cursorThrottleRef = useRef<Map<string, number>>(new Map());
  const strokesRef = useRef<Stroke[]>([]);
  const itemsRef = useRef<ImportedItem[]>([]);
  const usersRef = useRef<UserInfo[]>([]);

  useEffect(() => {
    // Helper to resolve functional updates
    const resolveStrokes = (updater: Stroke[] | ((prev: Stroke[]) => Stroke[])) => {
      const resolved = typeof updater === "function" ? updater(strokesRef.current) : updater;
      strokesRef.current = resolved;
      onStrokesChange(resolved);
    };

    const resolveItems = (updater: ImportedItem[] | ((prev: ImportedItem[]) => ImportedItem[])) => {
      const resolved = typeof updater === "function" ? updater(itemsRef.current) : updater;
      itemsRef.current = resolved;
      onItemsChange(resolved);
    };

    const resolveUsers = (updater: UserInfo[] | ((prev: UserInfo[]) => UserInfo[])) => {
      const resolved = typeof updater === "function" ? updater(usersRef.current) : updater;
      usersRef.current = resolved;
      onUsersChange(resolved);
    };

    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket] Connected:", socket.id);
      setConnected(true);
      socket.emit("board:join", { boardId, userId, name: userName, hue: userHue });
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected:", reason);
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err);
      setConnected(false);
    });

    // Initial board state
    socket.on("board:state", (state: any) => {
      console.log("[Socket] Received board state");
      resolveStrokes(state.strokes);
      resolveItems(state.items);
      resolveUsers(state.users);
      onHostChange(state.isHost, state.hostId);
      onSettingsChange(state.settings);
    });

    // Stroke events
    socket.on("stroke:add", (stroke: any) => {
      resolveStrokes((prev: Stroke[]) => [...prev, stroke]);
    });

    socket.on("stroke:remove", (strokeIds: string[]) => {
      resolveStrokes((prev: Stroke[]) => prev.filter((s: Stroke) => !strokeIds.includes(s.id)));
    });

    socket.on("stroke:transform", (data: { strokeId: string; transform: any }) => {
      resolveStrokes((prev: Stroke[]) =>
        prev.map((s: Stroke) => (s.id === data.strokeId ? { ...s, transform: data.transform } : s))
      );
    });

    // Item events
    socket.on("item:add", (item: any) => {
      resolveItems((prev: ImportedItem[]) => [...prev, item]);
    });

    socket.on("item:update", (item: any) => {
      resolveItems((prev: ImportedItem[]) => prev.map((i: ImportedItem) => (i.id === item.id ? item : i)));
    });

    socket.on("item:remove", (itemId: string) => {
      resolveItems((prev: ImportedItem[]) => prev.filter((i: ImportedItem) => i.id !== itemId));
    });

    // Board clear
    socket.on("board:cleared", () => {
      resolveStrokes([]);
      resolveItems([]);
    });

    // User events
    socket.on("user:joined", (user: any) => {
      resolveUsers((prev: UserInfo[]) => [...prev, user]);
    });

    socket.on("user:left", (data: { userId: string }) => {
      resolveUsers((prev: UserInfo[]) => prev.filter((u: UserInfo) => u.id !== data.userId));
      onCursorRemove(data.userId);
    });

    socket.on("users:update", (users: UserInfo[]) => {
      resolveUsers(users);
    });

    socket.on("host:changed", (data: { newHostId: string }) => {
      resolveUsers((prev: UserInfo[]) =>
        prev.map((u: UserInfo) => (u.id === data.newHostId ? { ...u, isHost: true } : u))
      );
    });

    // Cursor updates
    socket.on("cursor:update", (data: { userId: string; x: number; y: number; color: string; name: string }) => {
      onCursorUpdate(data.userId, data.x, data.y, data.color, data.name);
    });

    // Settings
    socket.on("settings:update", (settings: any) => {
      onSettingsChange(settings);
    });

    // Moderation
    socket.on("board:kicked", () => {
      onKicked();
    });

    socket.on("board:banned", () => {
      onBanned();
    });

    socket.on("error", (data: { message: string }) => {
      onError(data.message);
    });

    return () => {
      socket.emit("board:leave", { boardId });
      socket.disconnect();
    };
  }, [boardId, userId, userName, userHue, onStrokesChange, onItemsChange, onUsersChange, onHostChange, onSettingsChange, onCursorUpdate, onCursorRemove, onMessage, onReaction, onKicked, onBanned, onError]);

  // Send stroke to server
  const sendStroke = useCallback((stroke: any) => {
    socketRef.current?.emit("stroke:add", { boardId, stroke });
  }, [boardId]);

  const sendStrokeRemove = useCallback((strokeIds: string[]) => {
    socketRef.current?.emit("stroke:remove", { boardId, strokeIds });
  }, [boardId]);

  const sendStrokeTransform = useCallback((strokeId: string, transform: any) => {
    socketRef.current?.emit("stroke:transform", { boardId, strokeId, transform });
  }, [boardId]);

  // Send item events
  const sendItemAdd = useCallback((item: any) => {
    socketRef.current?.emit("item:add", { boardId, item });
  }, [boardId]);

  const sendItemUpdate = useCallback((item: any) => {
    socketRef.current?.emit("item:update", { boardId, item });
  }, [boardId]);

  const sendItemRemove = useCallback((itemId: string) => {
    socketRef.current?.emit("item:remove", { boardId, itemId });
  }, [boardId]);

  // Cursor position (throttled)
  const sendCursor = useCallback((x: number, y: number, color: string) => {
    const now = Date.now();
    const lastSent = cursorThrottleRef.current.get(userId) || 0;
    if (now - lastSent < 50) return; // 20fps max
    cursorThrottleRef.current.set(userId, now);
    socketRef.current?.emit("cursor:move", { boardId, x, y, color });
  }, [boardId, userId]);

  // Board actions
  const sendClear = useCallback(() => {
    socketRef.current?.emit("board:clear", { boardId });
  }, [boardId]);

  const sendKick = useCallback((targetUserId: string) => {
    socketRef.current?.emit("user:kick", { boardId, targetUserId });
  }, [boardId]);

  const sendBan = useCallback((targetUserId: string) => {
    socketRef.current?.emit("user:ban", { boardId, targetUserId });
  }, [boardId]);

  const sendSettings = useCallback((settings: any) => {
    socketRef.current?.emit("settings:update", { boardId, settings });
  }, [boardId]);

  return {
    connected,
    sendStroke,
    sendStrokeRemove,
    sendStrokeTransform,
    sendItemAdd,
    sendItemUpdate,
    sendItemRemove,
    sendCursor,
    sendClear,
    sendKick,
    sendBan,
    sendSettings,
  };
}