"use client";

import { useSyncExternalStore } from "react";
import { BoardSection } from "./board-section";

/**
 * Board shell for the static build.
 *
 * A static host cannot prerender every arbitrary board id. Cloudflare Pages
 * rewrites `/board/<anything>` to this page, and the real id is read from the
 * browser URL. The URL itself never changes, so sharing and reloading still
 * work exactly like the server-rendered board.
 */

const subscribe = () => () => {};

function boardIdFromPath(): string {
  const segment = window.location.pathname.split("/").filter(Boolean).pop();
  if (!segment || segment === "board") {
    return "new";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return "new";
  }
}

export function StaticBoardRoute() {
  // The static HTML has no id; the real one only exists in the browser URL.
  // `useSyncExternalStore` keeps the server/client split explicit without a
  // state-setting effect (which React flags as a cascading render).
  const boardId = useSyncExternalStore(
    subscribe,
    boardIdFromPath,
    () => null,
  );

  if (!boardId) {
    return (
      <div
        className="flex h-dvh w-full items-center justify-center bg-white text-[14px] text-brand-soft"
        style={{ fontFamily: "Roboto, sans-serif" }}
      >
        Cargando pizarra…
      </div>
    );
  }

  return <BoardSection boardId={boardId} />;
}
