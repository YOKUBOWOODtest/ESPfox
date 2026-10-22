"use client";

import { useSyncExternalStore } from "react";
import { displayName, readStoredNickname, type DeviceUser } from "./use-device-user";
import type { BoardRole } from "./use-board-host";

/**
 * Whiteboard presence.
 *
 * The source is a realtime GWT application: a server tells every client who is
 * connected. This build has no collaboration server, so the panel lists only
 * the people who are genuinely in the room — which, without a backend, is just
 * the visitor themself. The previous implementation invented deterministic fake
 * collaborators from the board id, which made the panel lie.
 *
 * When a transport is added later (WebSocket, or BroadcastChannel for
 * same-browser tabs), remote participants slot into `participants` here and
 * nothing in the panel has to change.
 */

const JOINED_KEY = "wf_joined_boards";

/** Matches the source's `.userStatus` variants. */
export type UserStatus = "online" | "offline" | "pro";

export interface Participant {
  /** Stable per-participant id, used as the React key. */
  key: string;
  /** Display nickname, as shown in `.userName`. */
  nickname: string;
  /** Device id, shown in small type under the nickname. */
  deviceId: string;
  /** Dot colour: green when online, grey when offline, purple for Pro. */
  status: UserStatus;
  /** The visitor themself. */
  self: boolean;
  /** Hue (0-359) of the generated avatar, mirroring the source's HSL avatars. */
  avatarHue: number;
  /** Whether this participant may be blocked (co-host only in the source). */
  canBlock: boolean;
  /**
   * The board's host, or a plain user.
   *
   * The host is the device that opened the board first; everybody else is a
   * user. The host keeps the board's destructive tools — clearing it and
   * changing its background colour.
   */
  role: BoardRole;
}

/** Boards this device has opened, so the Lobby can list recent whiteboards. */
export interface JoinedBoard {
  id: string;
  joinedAt: number;
}

export interface BoardState {
  id: string;
  participants: Participant[];
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Small deterministic hash, used only to pick a stable avatar colour. */
function hash(value: string): number {
  let out = 0;
  for (let index = 0; index < value.length; index += 1) {
    out = (out * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return out;
}

/** Hue of the avatar a device is given, so it looks the same everywhere. */
export function avatarHue(deviceId: string): number {
  return hash(deviceId) % 360;
}

/** Caches per-board snapshots so `useSyncExternalStore` sees stable objects. */
const snapshotCache = new Map<string, BoardState>();
const cacheSignatures = new Map<string, string>();

function boardSnapshot(
  boardId: string,
  user: DeviceUser,
  pro: boolean,
  hostId: string | null,
): BoardState {
  const selfKey = user.id || "…";
  const signature = `${boardId}|${selfKey}|${user.nickname ?? ""}|${pro}|${hostId ?? ""}`;
  const cached = snapshotCache.get(boardId);
  if (cached && cacheSignatures.get(boardId) === signature) {
    return cached;
  }
  const self: Participant = {
    key: selfKey,
    nickname: displayName(user),
    deviceId: selfKey,
    // Purple marks a subscriber in the source; here it reflects the local Pro flag.
    status: pro ? "pro" : "online",
    self: true,
    // Hue follows the device id, so a visitor keeps the same avatar everywhere.
    avatarHue: avatarHue(selfKey),
    canBlock: false,
    // The device that opened the board first is its host.
    role: hostId !== null && hostId === selfKey ? "host" : "user",
  };
  const state: BoardState = {
    id: boardId,
    participants: [self],
  };
  snapshotCache.set(boardId, state);
  cacheSignatures.set(boardId, signature);
  return state;
}

/** Records that this device opened a board, newest first. */
export function markJoined(boardId: string) {
  try {
    const raw = window.localStorage.getItem(JOINED_KEY);
    const parsed: JoinedBoard[] = raw ? JSON.parse(raw) : [];
    const next = [
      { id: boardId, joinedAt: Date.now() },
      ...parsed.filter((entry) => entry.id !== boardId),
    ].slice(0, 12);
    window.localStorage.setItem(JOINED_KEY, JSON.stringify(next));
    listeners.forEach((listener) => listener());
  } catch {
    // Storage unavailable: the Lobby falls back to an empty recent list.
  }
}

function readJoined(): JoinedBoard[] {
  try {
    const raw = window.localStorage.getItem(JOINED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is JoinedBoard =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as JoinedBoard).id === "string",
    );
  } catch {
    return [];
  }
}

let cachedJoined: JoinedBoard[] = [];
let cachedJoinedRaw = "\u0000";

/** Server and first client render agree on "nothing joined yet". */
const emptyJoined: JoinedBoard[] = [];

function getServerJoined(): JoinedBoard[] {
  return emptyJoined;
}

export function useJoinedBoards(): JoinedBoard[] {
  const getSnapshot = () => {
    let raw = "";
    try {
      raw = window.localStorage.getItem(JOINED_KEY) ?? "";
    } catch {
      raw = "";
    }
    if (raw !== cachedJoinedRaw) {
      cachedJoinedRaw = raw;
      cachedJoined = readJoined();
    }
    return cachedJoined;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getServerJoined);
}

/**
 * The board's presence.
 *
 * `hostId` is the device that owns the board; it decides whether the visitor
 * is the host or a user.
 */
export function useBoard(
  boardId: string,
  user: DeviceUser,
  pro: boolean,
  hostId: string | null,
): BoardState {
  const getSnapshot = () => boardSnapshot(boardId, user, pro, hostId);
  const getServerSnapshot = () =>
    boardSnapshot(boardId, { id: "", nickname: readStoredNickname() }, false, null);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
