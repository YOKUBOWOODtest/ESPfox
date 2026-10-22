"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { hasProfile, useDeviceUser } from "./use-device-user";

/**
 * Lobby gate.
 *
 * A whiteboard cannot be useful without knowing who is drawing, and this build
 * has no accounts — identity is the device profile. So a browser that has never
 * chosen a nickname is redirected to the Lobby before any board opens.
 *
 * `ready` is derived from the identity store rather than effect-driven state: an
 * empty id means the store is still on its server snapshot, so the board must
 * not render (or join) yet. The effect only performs the external navigation.
 */
export function useLobbyGate(): { ready: boolean } {
  const router = useRouter();
  const user = useDeviceUser();

  useEffect(() => {
    if (!hasProfile()) {
      router.replace("/lobby?from=board");
    }
  }, [router]);

  return { ready: user.id !== "" && hasProfile() };
}
