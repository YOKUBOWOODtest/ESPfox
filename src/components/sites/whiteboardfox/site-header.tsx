"use client";

import Image from "next/image";
import Link from "next/link";
import { Column } from "./column";
import { UserChip } from "./user-chip";
import { usePro } from "./use-pro";

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
  const pro = usePro();

  return (
    <div className="w-full bg-[#eeeeee]">
      <Column>
        <div className="flex items-center justify-between bg-[#eeeeee] px-[50px] pt-[20px] pb-[10px]">
          <Link
            href="/"
            className="flex items-center text-[32px] font-[300] text-brand no-underline"
            style={{ fontFamily: "'Hammersmith One', sans-serif", wordSpacing: "-8px" }}
          >
            <Image
              src="/sites/whiteboardfox/icon.png"
              alt=""
              width={64}
              height={64}
              className="pr-[3px] align-middle"
              priority
            />
            {WHITEBOARDMOD_NAME}
          </Link>

          <div className="grow" />

          <Link href="/lobby" className={`${navLink} mr-[20px]`}>
            Lobby
          </Link>

          <Link
            href="/pro"
            id="proButton"
            className={`${navLink} mr-[20px] ${pro ? "" : "font-[400]"}`}
          >
            {pro ? "Pro activo" : "Activa tu pro"}
          </Link>

          <UserChip />
        </div>
      </Column>
    </div>
  );
}
