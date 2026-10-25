"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { useState } from "react";
import { OptionsPanel } from "./options-panel";
import { hasProfile } from "./use-device-user";

/**
 * Hero. `Start Drawing` opens the Options overlay directly — the source's
 * "I'm drawing for fun / work" interstitial was removed in this build.
 */
export function Hero() {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const router = useRouter();

  const startDrawing = (event: MouseEvent<HTMLButtonElement>) => {
    // A device with no nickname must pick one in the Lobby first.
    if (!hasProfile()) {
      event.preventDefault();
      router.push("/lobby?from=board");
      return;
    }
    event.preventDefault();
    setOptionsOpen(true);
  };

  const goToId = () => {
    const input = document.getElementById("textbox_id") as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const id = input.value.trim().replace(/ /g, "");
    // Full navigation: static hosts only know the board shell, so the URL must
    // reach the server's rewrite rule instead of a client-side route lookup.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/board/${id}`;
  };

  return (
    <div className="w-full bg-white pt-0">
      <div className="mx-auto h-full w-[1010px]">
        <div
          className="grid pb-[10px] pl-[50px]"
          style={{ gridTemplateColumns: "1fr 1fr", gap: "20px" }}
        >
          <div id="left-container">
            <div className="pl-[23px]" />
            <div className="relative pl-[100px]">
              <OptionsPanel
                open={optionsOpen}
                onClose={() => setOptionsOpen(false)}
              />

              <h1 className="pt-[60px] pb-[10px] text-[52px] leading-[inherit] font-[100]">
                Simple Online
                <br />
                Whiteboard
                <br />
              </h1>

              <div style={{ lineHeight: "160%" }}>
                Share a virtual whiteboard in real-time
                <br />
                using any modern web browser
              </div>

              <div className="my-[40px]">
                <button
                  type="button"
                  id="startDrawingButton"
                  onClick={startDrawing}
                  className="cursor-pointer rounded-[5px] bg-[#ff6a00] px-[80px] py-[15px] text-center text-[28px] leading-[150%] font-[300] whitespace-nowrap text-white"
                  style={{ fontFamily: "Roboto, sans-serif", display: "inline-block" }}
                >
                  Start Drawing
                </button>
              </div>

              <div className="pb-[5px] text-[16px]" style={{ lineHeight: "140%" }}>
                Or enter a Whiteboard ID:{" "}
                <input
                  id="textbox_id"
                  type="text"
                  placeholder="eg. 34567-8901-2345"
                  className="rounded-[5px] border border-solid border-brand-border px-[4px] py-[2px] text-[14px]"
                />{" "}
                <button
                  type="button"
                  id="goToBoardButton"
                  onClick={goToId}
                  className="cursor-pointer rounded-[5px] border border-solid border-brand-border bg-brand-tint p-[5px]"
                >
                  Go
                </button>
              </div>

              <p className="pb-[20px] text-[14px]">
                <Link href="/lobby" className="text-brand underline">
                  Cambiar apodo en el Lobby
                </Link>
              </p>
            </div>
          </div>

          {/* Ad slot in the source (Fuse/publift); intentionally left empty. */}
          <div className="flex items-center justify-center bg-[#FCFCFC]" />
        </div>
      </div>
    </div>
  );
}
