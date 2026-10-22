"use client";

import { useEffect, useRef } from "react";
import type { ImportedItem } from "@/lib/board/imported";

/**
 * The three-dot menu of an imported item.
 *
 * here.fm gives every element in a room the same overflow menu, and this is
 * the same list, minus the two entries that cannot mean anything on a
 * whiteboard:
 *
 *   - "Make Deck" turns a picture into a stack of cards (a here.fm feature);
 *   - the lock submenu splits locking into position and interaction, which
 *     only matters when several people share the room.
 *
 * What is left is the list here.fm actually shows: move it to the front or
 * the back of the stack, pin it, lock it, duplicate it, mirror it, download the
 * original file, set it as your avatar (pictures only), or delete it. The
 * delete entry is red, as it is there.
 */

/** What the user picked from the menu. */
export type ItemMenuAction =
  | "front"
  | "back"
  | "pin"
  | "lock"
  | "duplicate"
  | "mirror"
  | "download"
  | "avatar"
  | "delete";

export interface ItemMenuProps {
  /** The item the menu belongs to. */
  item: ImportedItem;
  /** Where the menu opens, in the stage's coordinates. */
  x: number;
  y: number;
  /** Called with the chosen action. */
  onAction: (action: ItemMenuAction) => void;
  /** Called when the menu is dismissed without a choice. */
  onClose: () => void;
}

export function ItemMenu({ item, x, y, onAction, onClose }: ItemMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape closes the menu, the way every other menu on the board does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * A press anywhere else on the page puts the menu away.
   *
   * The board itself also closes it when it deselects the item, but the menu
   * floats over the whole stage: pressing the toolbar, the room bar or another
   * picture has to dismiss it too, or it would hang there over a board it no
   * longer belongs to.
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const choose = (action: ItemMenuAction) => {
    onAction(action);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="itemMenu"
      data-testid="item-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label={`Options for ${item.name}`}
    >
      <button
        type="button"
        className="itemMenuOption"
        role="menuitem"
        onClick={() => choose("front")}
        data-testid="item-menu-front"
      >
        Move to front
      </button>
      <button
        type="button"
        className="itemMenuOption"
        role="menuitem"
        onClick={() => choose("back")}
        data-testid="item-menu-back"
      >
        Move to back
      </button>
      <button
        type="button"
        className="itemMenuOption"
        role="menuitem"
        onClick={() => choose("pin")}
        data-testid="item-menu-pin"
      >
        {item.pinned ? "Unpin" : "Pin"}
      </button>
      <button
        type="button"
        className="itemMenuOption"
        role="menuitem"
        onClick={() => choose("lock")}
        data-testid="item-menu-lock"
      >
        {item.locked ? "Unlock" : "Lock"}
      </button>
      {item.kind === "image" && (
        <button
          type="button"
          className="itemMenuOption"
          role="menuitem"
          onClick={() => choose("mirror")}
          data-testid="item-menu-mirror"
        >
          Mirror
        </button>
      )}
      <button
        type="button"
        className="itemMenuOption"
        role="menuitem"
        onClick={() => choose("duplicate")}
        data-testid="item-menu-duplicate"
      >
        Duplicate
      </button>
      <button
        type="button"
        className="itemMenuOption"
        role="menuitem"
        onClick={() => choose("download")}
        data-testid="item-menu-download"
      >
        Download Original
      </button>
      {item.kind === "image" && (
        <button
          type="button"
          className="itemMenuOption"
          role="menuitem"
          onClick={() => choose("avatar")}
          data-testid="item-menu-avatar"
        >
          Set as my avatar
        </button>
      )}
      <button
        type="button"
        className="itemMenuOption itemMenuDelete"
        role="menuitem"
        onClick={() => choose("delete")}
        data-testid="item-menu-delete"
      >
        Delete
      </button>
    </div>
  );
}
