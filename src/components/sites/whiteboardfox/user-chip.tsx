"use client";

import { useState } from "react";
import { ProfilePanel } from "./profile-panel";
import { displayName, hasProfile, useDeviceUser } from "./use-device-user";
import { usePro } from "./use-pro";

/**
 * Header identity control. Identity is the device, and the only thing to edit is
 * the nickname — the first-run prompt lives in the Lobby, not here.
 */
export function UserChip() {
  const user = useDeviceUser();
  const pro = usePro();
  const [open, setOpen] = useState(false);
  /** Bumped on every open so the panel remounts and reseeds its draft. */
  const [openCount, setOpenCount] = useState(0);

  const label = displayName(user);

  return (
    <>
      <button
        type="button"
        id="userChip"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-has-profile={hasProfile() ? "true" : "false"}
        onClick={() => {
          setOpenCount((count) => count + 1);
          setOpen(true);
        }}
        className="flex cursor-pointer items-center gap-[8px] rounded-[5px] border border-solid border-brand-border bg-white px-[12px] py-[4px] text-[18px] font-[300] text-brand"
        style={{ fontFamily: "Roboto, sans-serif" }}
      >
        <UserIcon />
        <span data-testid="chip-nickname">@{label}</span>
        {pro && (
          <span
            data-testid="pro-badge"
            className="rounded-[3px] bg-[#ff6a00] px-[6px] py-[1px] text-[12px] text-white"
          >
            PRO
          </span>
        )}
      </button>

      <ProfilePanel
        // Remount on each open so the draft reseeds from the stored nickname.
        key={open ? openCount : "profile-closed"}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function UserIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}
