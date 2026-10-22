"use client";

import { useSyncExternalStore } from "react";

/**
 * "Pro" state.
 *
 * Pro is free on this clone: there is no plan picker and no payment gateway, so
 * activating it is a single click that flips a persisted flag. Once on, the
 * options panel stops asking for an account and unlocks the unrestricted
 * invitation target.
 */

const STORAGE_KEY = "wf_pro";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Server and first client render agree on "not active yet". */
function getServerSnapshot(): boolean {
  return false;
}

export function activatePro() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Storage unavailable: the in-memory listeners still update this session.
  }
  listeners.forEach((listener) => listener());
}

export function deactivatePro() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above.
  }
  listeners.forEach((listener) => listener());
}

export function usePro(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
