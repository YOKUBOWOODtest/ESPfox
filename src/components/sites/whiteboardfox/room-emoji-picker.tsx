"use client";

/**
 * The reaction palette.
 *
 * here.fm lets people answer a room with an emoji instead of a word, so the
 * same short list drives both the room bar (send a reaction) and the chat bar
 * (drop an emoji into what you are writing).
 */

export const ROOM_EMOJI = [
  "😀",
  "😂",
  "😍",
  "🤔",
  "😮",
  "👍",
  "👏",
  "🔥",
  "🎉",
  "❤️",
  "✨",
  "🙌",
];

export function RoomEmojiPicker({
  onPick,
  onClose,
  testId = "room-emoji-picker",
  placement = "down",
}: {
  /** Called with the chosen emoji. */
  onPick: (emoji: string) => void;
  /** Called when the picker should go away. */
  onClose: () => void;
  testId?: string;
  /** Which way the picker opens. */
  placement?: "up" | "down";
}) {
  return (
    <div
      className={`roomPopover roomEmojiGrid ${
        placement === "up" ? "roomPopoverUp" : ""
      }`}
      data-testid={testId}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {ROOM_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="roomEmojiButton"
          onClick={() => onPick(emoji)}
          data-testid="room-emoji-option"
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        className="roomEmojiButton roomEmojiClose"
        onClick={onClose}
        aria-label="Close the emoji picker"
      >
        ✕
      </button>
    </div>
  );
}
