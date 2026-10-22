import type { ImportedItem } from "./imported";
import type { Stroke } from "./stroke";

/**
 * Saving a board.
 *
 * The board is a document — the ink and the imported media — and the Settings
 * tab promises that it saves itself every so often. There is no server, so the
 * document is written to `localStorage`, keyed by board id.
 *
 * Media is inlined in the document itself: an imported picture is stored as the
 * data URL it was imported from, so a board that is reopened still shows it.
 * That makes the document big, so the size is checked before writing and a
 * board that would not fit is left alone rather than half-saved.
 */

/** The document as it is stored. */
export interface BoardDocument {
  strokes: Stroke[];
  items: ImportedItem[];
}

/** How much of the browser's storage a single board may use. */
const MAX_DOCUMENT_BYTES = 4_000_000;

const DOCUMENT_PREFIX = "wf_board_document_";

/** The storage key of a board's document. */
export function boardDocumentKey(boardId: string): string {
  return `${DOCUMENT_PREFIX}${boardId}`;
}

/**
 * Whether a media source can still be shown.
 *
 * A data URL always can. An object URL cannot: the browser frees it when the
 * tab closes, so an item that carries one is dropped when the board is
 * reopened.
 */
function isRestorable(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("http:") || src.startsWith("https:");
}

/** Writes the board's document, if it fits. */
export function saveBoardDocument(
  boardId: string,
  document: BoardDocument,
): boolean {
  try {
    const raw = JSON.stringify(document);
    if (raw.length > MAX_DOCUMENT_BYTES) {
      // Too big for the browser's storage: the previous copy is kept.
      return false;
    }
    window.localStorage.setItem(boardDocumentKey(boardId), raw);
    return true;
  } catch {
    // Storage unavailable or full: the board simply is not saved.
    return false;
  }
}

/** Reads a board's document, or null when there is nothing to restore. */
export function readBoardDocument(boardId: string): BoardDocument | null {
  try {
    const raw = window.localStorage.getItem(boardDocumentKey(boardId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Partial<BoardDocument>;
    const strokes = Array.isArray(record.strokes) ? record.strokes : [];
    const items = Array.isArray(record.items)
      ? record.items.filter(
          (item): item is ImportedItem =>
            typeof item === "object" &&
            item !== null &&
            typeof item.id === "string" &&
            typeof item.src === "string" &&
            isRestorable(item.src),
        )
      : [];
    return { strokes, items };
  } catch {
    return null;
  }
}
