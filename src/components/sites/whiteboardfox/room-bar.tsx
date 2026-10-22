"use client";

import { useEffect, useRef, useState } from "react";
import { RoomEmojiPicker } from "./room-emoji-picker";
import type { MicApi } from "./use-room-mic";
import type { RoomApi } from "./use-room";

/**
 * The room controls, which sit under the board's own tools.
 *
 * Whiteboard Mod borrows here.fm's room bar: an invite button that hands out
 * the room link, a chat button that counts what was said while it was closed,
 * a reaction button and the microphone with its level meter. The shapes are
 * here.fm's (round buttons, white glyphs) and the colour is Whiteboard Mod's
 * coral.
 */

export function RoomBar({
  roomUrl,
  room,
  mic,
  chatOpen,
  onToggleChat,
}: {
  /** The shareable address of this board. */
  roomUrl: string;
  room: RoomApi;
  mic: MicApi;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  // The popovers are the only overlays in the strip, so a click anywhere else
  // closes them.
  useEffect(() => {
    if (!inviteOpen && !emojiOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".roomPopover") || target?.closest(".roomIconButton")) {
        return;
      }
      setInviteOpen(false);
      setEmojiOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [emojiOpen, inviteOpen]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(roomUrl);
      setCopied(true);
      return;
    } catch {
      // No clipboard access: fall through to the manual copy below.
    }
    linkRef.current?.focus();
    linkRef.current?.select();
  };

  return (
    <div className="roomBar" data-testid="room-bar">
      <div className="roomBarTitle">Room</div>

      <div className="roomBarRow">
        <div className="roomButtonWrap">
          <button
            type="button"
            className="roomIconButton"
            title="Invite people to this room"
            aria-label="Invite"
            aria-expanded={inviteOpen}
            onClick={() => {
              setInviteOpen((open) => !open);
              setEmojiOpen(false);
            }}
            data-testid="room-invite"
          >
            <InviteIcon />
          </button>

          {inviteOpen && (
            <div className="roomPopover roomInvite" data-testid="room-invite-popover">
              <div className="roomPopoverTitle">Invite people</div>
              <p className="roomPopoverText">
                Anyone with this link can open the board and talk in the room.
              </p>
              <input
                ref={linkRef}
                className="roomInviteLink"
                readOnly
                value={roomUrl}
                onFocus={(event) => event.currentTarget.select()}
                data-testid="room-invite-link"
              />
              <button
                type="button"
                className="roomPopoverButton"
                onClick={() => void copyLink()}
                data-testid="room-invite-copy"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="roomIconButton"
          title="Show the room chat"
          aria-label="Chat"
          aria-pressed={chatOpen}
          onClick={onToggleChat}
          data-testid="room-chat"
        >
          <ChatIcon />
          {room.unread > 0 && (
            <span className="roomBadge" data-testid="room-unread">
              {room.unread > 9 ? "9+" : room.unread}
            </span>
          )}
        </button>

        <div className="roomButtonWrap">
          <button
            type="button"
            className="roomIconButton"
            title="Send a reaction"
            aria-label="Reaction"
            aria-expanded={emojiOpen}
            onClick={() => {
              setEmojiOpen((open) => !open);
              setInviteOpen(false);
            }}
            data-testid="room-emoji"
          >
            <EmojiIcon />
          </button>

          {emojiOpen && (
            <RoomEmojiPicker
              onPick={(emoji) => {
                room.sendReaction(emoji);
                setEmojiOpen(false);
              }}
              onClose={() => setEmojiOpen(false)}
            />
          )}
        </div>

        <button
          type="button"
          className={`roomIconButton ${mic.state === "on" ? "is-live" : ""}`}
          title={
            mic.state === "denied"
              ? "Microphone permission was denied"
              : mic.state === "unavailable"
                ? "This browser cannot open a microphone"
                : mic.state === "on"
                  ? "Turn the microphone off"
                  : "Turn the microphone on"
          }
          aria-label="Microphone"
          aria-pressed={mic.state === "on"}
          onClick={mic.toggle}
          data-testid="room-mic"
        >
          <MicIcon muted={mic.state !== "on"} />
        </button>
      </div>

      <div
        className="roomMicMeter"
        data-testid="room-mic-meter"
        data-level={mic.state === "on" ? "live" : "idle"}
      >
        <div
          className="roomMicFill"
          style={{ transform: `scaleX(${mic.state === "on" ? Math.max(0.04, mic.level) : 0.04})` }}
        />
      </div>
    </div>
  );
}

function InviteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13 3H17V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 3L9 11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 12V16C14 17.1 13.1 18 12 18H4C2.9 18 2 17.1 2 16V8C2 6.9 2.9 6 4 6H8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M17 9.5C17 13.64 13.42 17 9 17C8.35 17 7.71 16.93 7.1 16.79L3 18L4.21 14.1C3.07 12.87 2.4 11.29 2.4 9.5C2.4 5.36 5.98 2 10.4 2C14.82 2 17 5.36 17 9.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmojiIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6.8 12.2C7.6 13.4 8.7 14 10 14C11.3 14 12.4 13.4 13.2 12.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="7.4" cy="8.4" r="1" fill="currentColor" />
      <circle cx="12.6" cy="8.4" r="1" fill="currentColor" />
    </svg>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="7"
        y="2"
        width="6"
        height="10"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4 9.5C4 12 6.24 14 9 14C11.76 14 14 12 14 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M9 14V18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {muted && (
        <path
          d="M3 3L17 17"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
