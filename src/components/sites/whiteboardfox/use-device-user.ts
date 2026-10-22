"use client";

import { useSyncExternalStore } from "react";

/**
 * Device-based identity.
 *
 * The app has no auth system and no backend, so a visitor *is* their browser.
 * On first use a random id is minted and persisted in localStorage; every later
 * visit reuses it, which is enough to recognise "the same person" without a
 * login. The only profile field a visitor can change is the nickname — the id
 * itself is read-only.
 */

const ID_KEY = "wf_device_id";
const NICKNAME_KEY = "wf_nickname";
const AVATAR_KEY = "wf_avatar";

/** Short readable prefix, so a device id is recognisable as ours at a glance. */
export const ID_PREFIX = "WM-";

/** Same-tab notifications: the `storage` event only fires in other tabs. */
const CHANGED = "wf-identity-changed";
const listeners = new Set<() => void>();

export interface DeviceUser {
  /** Stable per-browser id, e.g. `WM-A3F9-2C71`. */
  id: string;
  /** Chosen nickname, or null until the visitor picks one. */
  nickname: string | null;
  /**
   * A picture the visitor set as their avatar, as a data URL, or null for the
   * generated silhouette. Only this browser sees it: there is no backend to
   * share it with the rest of the room.
   */
  avatar: string | null;
}

/**
 * Mints a device id from a real UUID.
 *
 * A full v4 UUID is 36 characters, which is unreadable under a nickname in the
 * participants list, so the raw randomness is kept but rendered as two
 * base-16 blocks derived from the UUID's own bytes. It stays globally unique —
 * only the presentation is shortened — and `crypto.randomUUID` is the same
 * source of randomness the platform uses for identity.
 */
function randomId(): string {
  const block = (bytes: Uint8Array, from: number) =>
    Array.from(bytes.slice(from, from + 2))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  try {
    // Preferred path: a cryptographic UUID, re-encoded as two readable blocks.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      const uuid = crypto.randomUUID().replace(/-/g, "");
      const bytes = new Uint8Array(16);
      for (let index = 0; index < 16; index += 1) {
        bytes[index] = parseInt(uuid.slice(index * 2, index * 2 + 2), 16);
      }
      return `${ID_PREFIX}${block(bytes, 0)}-${block(bytes, 2)}`;
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      return `${ID_PREFIX}${block(bytes, 0)}-${block(bytes, 2)}`;
    }
  } catch {
    // Falls through to the Math.random path below.
  }
  // Last resort for hardened browsers with no Web Crypto at all.
  const fallback = () =>
    Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `${ID_PREFIX}${fallback()}-${fallback()}`;
}

/** Writes through to localStorage and wakes every subscribed component. */
function commit(key: string, value: string) {
  window.localStorage.setItem(key, value);
  listeners.forEach((listener) => listener());
}

let cachedId: string | null = null;

/**
 * Reads the device id, minting one on first use. `localStorage` access throws
 * in hardened browsers, so failures fall back to an in-memory id for the
 * session rather than breaking the render.
 */
function readId(): string {
  if (cachedId) {
    return cachedId;
  }
  try {
    const stored = window.localStorage.getItem(ID_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
    const minted = randomId();
    window.localStorage.setItem(ID_KEY, minted);
    cachedId = minted;
    return minted;
  } catch {
    cachedId = cachedId ?? randomId();
    return cachedId;
  }
}

function readNickname(): string | null {
  try {
    const value = window.localStorage.getItem(NICKNAME_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function readAvatar(): string | null {
  try {
    return window.localStorage.getItem(AVATAR_KEY) || null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGED, listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGED, listener);
  };
}

/**
 * Returns a fresh object each call, so the store caches snapshots keyed by the
 * underlying strings to keep `useSyncExternalStore` from looping.
 */
let cachedSnapshot: DeviceUser | null = null;

function getSnapshot(): DeviceUser {
  const id = readId();
  const nickname = readNickname();
  const avatar = readAvatar();
  if (
    !cachedSnapshot ||
    cachedSnapshot.id !== id ||
    cachedSnapshot.nickname !== nickname ||
    cachedSnapshot.avatar !== avatar
  ) {
    cachedSnapshot = { id, nickname, avatar };
  }
  return cachedSnapshot;
}

/** Server and first client render agree on "nothing known yet". */
const serverSnapshot: DeviceUser = { id: "", nickname: null, avatar: null };

function getServerSnapshot(): DeviceUser {
  return serverSnapshot;
}

/** Persists the nickname, or clears it when given blank text. */
export function setNickname(value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    commit(NICKNAME_KEY, trimmed);
    return;
  }
  try {
    window.localStorage.removeItem(NICKNAME_KEY);
  } catch {
    // Nothing to do: the snapshot already reports no nickname.
  }
  listeners.forEach((listener) => listener());
}

export function useDeviceUser(): DeviceUser {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Persists the avatar picture, or goes back to the silhouette when null. */
export function setAvatar(value: string | null) {
  try {
    if (value) {
      window.localStorage.setItem(AVATAR_KEY, value);
    } else {
      window.localStorage.removeItem(AVATAR_KEY);
    }
  } catch {
    // Storage may be full or blocked; the store still reports the old value.
    return;
  }
  listeners.forEach((listener) => listener());
}

/** Display form: the chosen nickname, or a neutral placeholder. */
export function displayName(user: DeviceUser): string {
  return user.nickname ?? "Invitado";
}

/**
 * Reads the nickname straight from storage.
 *
 * Used to seed editable fields: `useDeviceUser()` returns its *server* snapshot
 * during hydration, so seeding a draft from it would leave the field blank and
 * a later save would clobber the stored nickname.
 */
export function readStoredNickname(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return readNickname();
}

/**
 * Whether this device has a usable profile.
 *
 * This is the gate for the Lobby: a browser with no stored nickname must not be
 * able to open a whiteboard, because a board always has to know who you are.
 * Reads storage directly so it is correct before React hydrates.
 */
export function hasProfile(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return readNickname() !== null;
}
