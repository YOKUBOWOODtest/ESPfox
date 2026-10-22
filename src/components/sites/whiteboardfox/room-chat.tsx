"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomMessage, RoomReaction } from "@/lib/board/room";
import { RoomEmojiPicker } from "./room-emoji-picker";
import type { MicApi } from "./use-room-mic";
import type { RoomApi } from "./use-room";

/**
 * The room's chat, borrowed from here.fm.
 *
 * here.fm keeps a bar along the bottom of the room — your avatar, an `@`, an
 * emoji button and a "Say something…" field — and floats the conversation
 * above it on the right. Both are reproduced here, on the board's own canvas:
 * the bar is part of the board's layout, so it never covers a drawing, and the
 * messages sit over the canvas the way they do in a here.fm room.
 */

/** The bar along the bottom of the board. */
export function RoomChatBar({
  room,
  author,
  hue,
  avatar,
  mic,
}: {
  room: RoomApi;
  /** The nickname shown next to the avatar. */
  author: string;
  /** Hue of the avatar, so it matches the participants panel. */
  hue: number;
  /** The picture the visitor set as their avatar, when there is one. */
  avatar?: string | null;
  mic: MicApi;
}) {
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    room.sendMessage(text);
    setDraft("");
  };

  return (
    <div className="roomChatBar" data-testid="room-chat-bar">
      <div className="roomChatBarInner">
        {avatar ? (
          // The avatar is a data URL the visitor chose themselves, so a plain
          // image is the right element here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="roomAvatar roomAvatarImage"
            src={avatar}
            alt=""
            data-testid="room-chat-avatar"
          />
        ) : (
          <span
            className="roomAvatar"
            style={{ backgroundColor: `hsl(${hue}, 75%, 43%)` }}
            aria-hidden="true"
          >
            {author.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="roomChatName">{author}</span>

        <div className="roomMicChip" data-testid="room-chat-mic" data-state={mic.state}>
          <span className="roomMicDot" />
        </div>

        <div className="roomChatSpacer" />

        <button
          type="button"
          className="roomChip"
          title="Mention someone"
          aria-label="Mention"
          onClick={() => {
            setDraft((text) => `${text}@`);
            inputRef.current?.focus();
          }}
          data-testid="room-chat-mention"
        >
          @
        </button>

        <div className="roomButtonWrap">
          <button
            type="button"
            className="roomChip"
            title="Add an emoji"
            aria-label="Add an emoji"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((open) => !open)}
            data-testid="room-chat-emoji"
          >
            ☺
          </button>
          {emojiOpen && (
            <RoomEmojiPicker
              testId="room-chat-emoji-picker"
              placement="up"
              onPick={(emoji) => {
                setDraft((text) => `${text}${emoji}`);
                setEmojiOpen(false);
                inputRef.current?.focus();
              }}
              onClose={() => setEmojiOpen(false)}
            />
          )}
        </div>

        <input
          ref={inputRef}
          className="roomChatInput"
          type="text"
          value={draft}
          placeholder="Say something..."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
          data-testid="room-chat-input"
        />

        <button
          type="button"
          className="roomChatSend"
          onClick={send}
          data-testid="room-chat-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/** The conversation, floating over the canvas on the right. */
export function RoomMessages({ messages }: { messages: RoomMessage[] }) {
  const listRef = useRef<HTMLDivElement>(null);

  // The newest message is the one worth reading, so the list follows it.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="roomMessages" data-testid="room-messages">
      <div className="roomMessagesInner" ref={listRef}>
        {messages.map((message) => (
          <div className="roomMessage" key={message.id} data-testid="room-message">
            <span className="roomMessageAuthor" data-testid="room-message-author">
              {message.author}
            </span>
            <span className="roomMessageText" data-testid="room-message-text">
              {message.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Emoji reactions, floating up over the board. */
export function RoomReactions({ reactions }: { reactions: RoomReaction[] }) {
  if (reactions.length === 0) {
    return null;
  }

  return (
    <div className="roomReactions" data-testid="room-reactions">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="roomReaction"
          style={{ left: `${reactionOffset(reaction.id)}%` }}
          title={reaction.author}
          data-testid="room-reaction"
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}

/**
 * Where a reaction drifts to.
 *
 * The offset is derived from the reaction's id, so every tab that shows the
 * same reaction places it in the same spot.
 */
function reactionOffset(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100000;
  }
  return 12 + (hash % 76);
}
