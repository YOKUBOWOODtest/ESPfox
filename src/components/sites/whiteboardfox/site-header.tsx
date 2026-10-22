"use client";

import Link from "next/link";
import { Column } from "./column";
import { UserChip } from "./user-chip";

/**
 * Brand constants. The clone is "Whiteboard Mod"; the upstream origin is kept
 * only for the few links that were never rebuilt (privacy, terms).
 */
export const WHITEBOARDMOD_NAME = "Whiteboard Mod";
/** Canonical origin for this build, used when a link must be absolute. */
export const WHITEBOARDMOD_ORIGIN = "https://whiteboardmod.com";

const navLink =
  "text-[20px] font-[300] text-brand no-underline hover:underline";

export function SiteHeader() {
  return (
    <div className="w-full bg-[#eeeeee]">
      <Column>
        <div className="flex items-center justify-between bg-[#eeeeee] px-[50px] pt-[20px] pb-[10px]">
          <Link
            href="/"
            className="flex items-center text-[32px] font-[300] text-brand no-underline"
            style={{ fontFamily: "'Hammersmith One', sans-serif", wordSpacing: "-8px" }}
          >
            {WHITEBOARDMOD_NAME}
          </Link>

          <div className="grow" />

          <Link href="/lobby" className={`${navLink} mr-[20px]`}>
            Lobby
          </Link>

          <UserChip />
        </div>
      </Column>
    </div>
  );
}
