"use client";

import { useSyncExternalStore } from "react";

/**
 * The board's host.
 *
 * A board has one host and everybody else is a user. The host is the device
 * that opened the board first — in practice the device that created it, since
 * that is the one that lands on `/board/new` and mints the id.
 *
 * There is no server, so the claim lives in `localStorage`: the first device
 * to open a board records itself as its host, and the claim is permanent. The
 * `storage` event keeps other tabs of the same browser in step.
 */

const HOSTS_KEY = "wf_board_hosts";

/** Host and user, as the participants list shows them. */
export type BoardRole = "host" | "user";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readHosts(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(HOSTS_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const hosts: Record<string, string> = {};
    for (const [boardId, deviceId] of Object.entries(parsed)) {
      if (typeof deviceId === "string" && deviceId) {
        hosts[boardId] = deviceId;
      }
    }
    return hosts;
  } catch {
    return {};
  }
}

function writeHosts(hosts: Record<string, string>): void {
  try {
    window.localStorage.setItem(HOSTS_KEY, JSON.stringify(hosts));
  } catch {
    // Storage unavailable: the claim lasts for this session only.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Records this device as the host of a board.
 *
 * The first claim wins: a board that already has a host keeps it, so the
 * creator cannot be displaced by somebody who joins later.
 */
export function claimBoardHost(boardId: string, deviceId: string): void {
  if (!boardId || !deviceId) {
    return;
  }
  const hosts = readHosts();
  if (hosts[boardId]) {
    return;
  }
  hosts[boardId] = deviceId;
  writeHosts(hosts);
}

/* The snapshot is cached by its raw text, so the store never loops. */
let cachedRaw: string | null = null;
let cachedHosts: Record<string, string> = {};

function getSnapshot(): Record<string, string> {
  let raw = "";
  try {
    raw = window.localStorage.getItem(HOSTS_KEY) ?? "";
  } catch {
    raw = "";
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedHosts = readHosts();
  }
  return cachedHosts;
}

const emptyHosts: Record<string, string> = {};

export interface BoardHost {
  /** The device id of the host, or null while the board has none. */
  hostId: string | null;
  /** Whether this device is the host. */
  isHost: boolean;
}

/** Who is the host of a board, and whether it is this device. */
export function useBoardHost(boardId: string, deviceId: string): BoardHost {
  const hosts = useSyncExternalStore(subscribe, getSnapshot, () => emptyHosts);
  const hostId = hosts[boardId] ?? null;
  return {
    hostId,
    isHost: Boolean(deviceId) && hostId === deviceId,
  };
}
