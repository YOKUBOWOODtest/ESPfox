"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  commitRoom,
  emptyRoom,
  parseRoom,
  readRaw,
  roomId,
  roomStorageKey,
  REACTION_TTL_MS,
  type RoomMessage,
  type RoomReaction,
  type RoomSnapshot,
} from "@/lib/board/room";

/**
 * The room a board is in.
 *
 * Messages and reactions live in `localStorage` and are mirrored to the other
 * tabs of the same browser with the `storage` event, which is as far as a
 * server-less build can reach. A `storage` event only fires in *other* tabs,
 * so the tab that wrote a record reads it back itself.
 *
 * The browser's storage is the source of truth; the store in front of it is
 * only a cache, which is why the room is read with `useSyncExternalStore`
 * rather than kept in component state.
 */

/** The room, as it looks before the browser has had a chance to load it. */
const serverRoom: RoomSnapshot = emptyRoom();

interface RoomStore {
  /** The board this room belongs to. */
  boardId: string;
  /** The raw stored room, so a rewrite is only noticed once. */
  raw: string;
  /** The parsed room, as the components see it. */
  snapshot: RoomSnapshot;
  /** When the conversation was last looked at. */
  lastReadAt: number;
  /** Everyone watching this room. */
  listeners: Set<() => void>;
  /** Detaches the `storage` listener. */
  detach: (() => void) | null;
}

/** One store per board, kept for as long as the tab lives. */
const stores = new Map<string, RoomStore>();

function storeFor(boardId: string): RoomStore {
  const existing = stores.get(boardId);
  if (existing) return existing;
  const store: RoomStore = {
    boardId,
    raw: "",
    snapshot: serverRoom,
    // Whatever was said before this browser opened the board has been read.
    lastReadAt: Date.now(),
    listeners: new Set(),
    detach: null,
  };
  stores.set(boardId, store);
  refreshStore(store);
  return store;
}

/** Wakes everyone watching this room up. */
function notify(store: RoomStore): void {
  for (const listener of [...store.listeners]) listener();
}

/** Re-reads the room from storage and tells the watchers if it changed. */
function refreshStore(store: RoomStore): void {
  const raw = readRaw(store.boardId);
  if (raw === store.raw) return;
  store.raw = raw;
  store.snapshot = parseRoom(raw);
  notify(store);
}

/** Watches the browser's storage for this room's key. */
function attachStorageListener(store: RoomStore): () => void {
  const key = roomStorageKey(store.boardId);
  const onStorage = (event: StorageEvent) => {
    // A cleared storage reports a null key.
    if (event.key !== null && event.key !== key) return;
    refreshStore(store);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function subscribeStore(boardId: string, listener: () => void): () => void {
  const store = storeFor(boardId);
  store.listeners.add(listener);
  if (store.listeners.size === 1) {
    store.detach = attachStorageListener(store);
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0 && store.detach) {
      store.detach();
      store.detach = null;
    }
  };
}

export interface RoomApi {
  /** Everything said in the room, oldest first. */
  messages: RoomMessage[];
  /** The reactions still floating over the board. */
  reactions: RoomReaction[];
  /** Messages that arrived while the chat was closed. */
  unread: number;
  /** Says something in the room. */
  sendMessage: (text: string) => void;
  /** Sends a reaction. */
  sendReaction: (emoji: string) => void;
}

export function useRoom(
  boardId: string,
  author: string,
  deviceId: string,
  /** Whether the chat is on screen; unread messages are only counted when it is not. */
  active: boolean,
): RoomApi {
  const subscribe = useCallback(
    (listener: () => void) => subscribeStore(boardId, listener),
    [boardId],
  );
  const getSnapshot = useCallback(() => storeFor(boardId).snapshot, [boardId]);
  const getServerSnapshot = useCallback(() => serverRoom, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Opening the chat is what marks the conversation as read.
  useEffect(() => {
    if (!active) return;
    storeFor(boardId).lastReadAt = Date.now();
  }, [active, boardId]);

  // Reactions fade away on their own.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const store = storeFor(boardId);
      if (store.snapshot.reactions.length === 0) return;
      const now = Date.now();
      const kept = store.snapshot.reactions.filter(
        (reaction) => now - reaction.ts < REACTION_TTL_MS,
      );
      if (kept.length === store.snapshot.reactions.length) return;
      const next = commitRoom(boardId, {});
      store.raw = readRaw(boardId);
      store.snapshot = next;
      notify(store);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [boardId]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const message: RoomMessage = {
        id: roomId("m"),
        author,
        deviceId,
        text: trimmed,
        ts: Date.now(),
      };
      const store = storeFor(boardId);
      // The writer has read their own message.
      store.lastReadAt = message.ts;
      commitRoom(boardId, { messages: [message] });
      refreshStore(store);
    },
    [author, boardId, deviceId],
  );

  const sendReaction = useCallback(
    (emoji: string) => {
      const reaction: RoomReaction = {
        id: roomId("r"),
        emoji,
        author,
        ts: Date.now(),
      };
      const store = storeFor(boardId);
      commitRoom(boardId, { reactions: [reaction] });
      refreshStore(store);
    },
    [author, boardId],
  );

  const store = storeFor(boardId);
  const unread = active
    ? 0
    : snapshot.messages.filter((message) => message.ts > store.lastReadAt).length;

  return {
    messages: snapshot.messages,
    reactions: snapshot.reactions,
    unread,
    sendMessage,
    sendReaction,
  };
}
