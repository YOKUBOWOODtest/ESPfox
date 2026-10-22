/**
 * Room model — the here.fm half of Whiteboard Mod.
 *
 * A board is a room: people join it, they talk in it and they react in it.
 * here.fm does that over a websocket; this build has no server, so the room
 * lives in `localStorage` and is mirrored to the other tabs of the same
 * browser through the `storage` event. The model is the same either way:
 * an append-only list of messages plus a short-lived list of reactions.
 *
 * Every record carries an id, so the same message is never shown twice when
 * two tabs merge their views of the room.
 */

/** A line of chat. */
export interface RoomMessage {
  /** Unique id, so a message is never shown twice. */
  id: string;
  /** Nickname of whoever wrote it. */
  author: string;
  /** Device id of whoever wrote it. */
  deviceId: string;
  /** The text itself. */
  text: string;
  /** When it was written, in epoch milliseconds. */
  ts: number;
}

/** An emoji reaction that floats up over the board. */
export interface RoomReaction {
  /** Unique id. */
  id: string;
  /** The emoji. */
  emoji: string;
  /** Nickname of whoever sent it. */
  author: string;
  /** When it was sent, in epoch milliseconds. */
  ts: number;
}

/** Everything the room holds. */
export interface RoomSnapshot {
  messages: RoomMessage[];
  reactions: RoomReaction[];
}

/** Older messages fall off the end of the list. */
export const MAX_MESSAGES = 200;

/** Reactions are short-lived, so only a handful are kept. */
export const MAX_REACTIONS = 30;

/** How long a reaction stays on the board. */
export const REACTION_TTL_MS = 45_000;

/** An empty room. */
export function emptyRoom(): RoomSnapshot {
  return { messages: [], reactions: [] };
}

/** Where a board's room is stored. */
export function roomStorageKey(boardId: string): string {
  return `wf_room_${boardId}`;
}

/**
 * Mints an id that is unique across the tabs of one browser.
 *
 * The timestamp keeps ids ordered, and the random suffix keeps two messages
 * written in the same millisecond apart.
 */
export function roomId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isMessage(value: unknown): value is RoomMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RoomMessage>;
  return (
    typeof record.id === "string" &&
    typeof record.author === "string" &&
    typeof record.deviceId === "string" &&
    typeof record.text === "string" &&
    typeof record.ts === "number"
  );
}

function isReaction(value: unknown): value is RoomReaction {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RoomReaction>;
  return (
    typeof record.id === "string" &&
    typeof record.emoji === "string" &&
    typeof record.author === "string" &&
    typeof record.ts === "number"
  );
}

/** Reads the raw stored room, or an empty string when storage is unavailable. */
export function readRaw(boardId: string): string {
  try {
    return window.localStorage.getItem(roomStorageKey(boardId)) ?? "";
  } catch {
    return "";
  }
}

/** Parses a stored room; a missing or broken room reads empty. */
export function parseRoom(raw: string): RoomSnapshot {
  if (!raw) return emptyRoom();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyRoom();
    const record = parsed as Partial<RoomSnapshot>;
    const messages = Array.isArray(record.messages) ? record.messages.filter(isMessage) : [];
    const reactions = Array.isArray(record.reactions) ? record.reactions.filter(isReaction) : [];
    return mergeRoom({ messages, reactions }, emptyRoom());
  } catch {
    return emptyRoom();
  }
}

/** Reads a board's room out of storage. */
export function readRoom(boardId: string): RoomSnapshot {
  return parseRoom(readRaw(boardId));
}

/** Writes a board's room back to storage. */
export function writeRoom(boardId: string, snapshot: RoomSnapshot): void {
  try {
    window.localStorage.setItem(roomStorageKey(boardId), JSON.stringify(snapshot));
  } catch {
    // Storage unavailable: the room stays in memory for this session only.
  }
}

/**
 * Merges two views of the room.
 *
 * Records are keyed by id, so the union of both snapshots is taken and the
 * oldest ones are dropped. Reactions that have outlived their welcome are
 * dropped too.
 */
export function mergeRoom(a: RoomSnapshot, b: RoomSnapshot): RoomSnapshot {
  const messages = new Map<string, RoomMessage>();
  for (const message of [...a.messages, ...b.messages]) {
    messages.set(message.id, message);
  }
  const now = Date.now();
  const reactions = new Map<string, RoomReaction>();
  for (const reaction of [...a.reactions, ...b.reactions]) {
    if (now - reaction.ts < REACTION_TTL_MS) {
      reactions.set(reaction.id, reaction);
    }
  }
  return {
    messages: [...messages.values()].sort((x, y) => x.ts - y.ts).slice(-MAX_MESSAGES),
    reactions: [...reactions.values()].sort((x, y) => x.ts - y.ts).slice(-MAX_REACTIONS),
  };
}

/**
 * Merges a change into the stored room and writes it back.
 *
 * The stored room is read first, so two tabs writing at the same time cannot
 * drop each other's messages.
 */
export function commitRoom(
  boardId: string,
  patch: Partial<RoomSnapshot>,
): RoomSnapshot {
  const next = mergeRoom(readRoom(boardId), {
    messages: patch.messages ?? [],
    reactions: patch.reactions ?? [],
  });
  writeRoom(boardId, next);
  return next;
}
