"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CogIcon,
  EraserIcon,
  MoveIcon,
  PencilIcon,
  SelectIcon,
  TrashIcon,
  UndoIcon,
} from "./board-icons";
import { DrawPanel } from "./draw-panel";
import { ImportMenu } from "./import-menu";
import { ItemMenu, type ItemMenuAction } from "./item-menu";
import { OptionsMenu } from "./options-menu";
import { MobileToolbar } from "./mobile-toolbar";
import { RoomBar } from "./room-bar";
import { RoomChatBar, RoomMessages, RoomReactions } from "./room-chat";
import { markJoined, useBoard } from "./use-board";
import { claimBoardHost, useBoardHost } from "./use-board-host";
import { useBoardDoc } from "./use-board-doc";
import {
  useBoardSettings,
  useFlipColors,
  writeSettings,
  type BoardSettings,
} from "./use-board-settings";
import { useDeviceUser, displayName, setAvatar } from "./use-device-user";
import { useLobbyGate } from "./use-lobby-gate";
import { usePro } from "./use-pro";
import { useRoom } from "./use-room";
import { useRoomMic } from "./use-room-mic";
import { useIsMobile, useTouchGestures, multiTouchActiveRef } from "./use-mobile";
import { WHITEBOARDMOD_ORIGIN } from "./site-header";
import {
  clampScale,
  formatZoom,
  initialCamera,
  panBy,
  screenToWorld,
  zoomAt,
  type Camera,
} from "@/lib/board/camera";
import { gridStep } from "@/lib/board/grid";
import {
  createImportedItem,
  itemHitTest,
  itemPlayButtonHit,
  itemsInPaintOrder,
  type ImportedItem,
  type ImportedMedia,
} from "@/lib/board/imported";
import {
  itemChromePositions,
  render,
  selectionBounds,
  selectionHandlePositions,
  type ItemHandle,
  type SelectionBox,
  type Viewport,
  type LassoPath,
} from "@/lib/board/render";
import {
  applyTransform,
  handleAnchor,
  hitStroke,
  pointInPolygon,
  type Bounds,
  type Point,
  type SelectionHandle,
  type StrokeStyle,
  type DrawStyle,
} from "@/lib/board/stroke";
import {
  readBoardDocument,
  saveBoardDocument,
} from "@/lib/board/document";

/**
 * Whiteboard surface.
 *
 * A faithful rebuild of the source's board screen (`/diagramName` on
 * whiteboardfox.com): a 140px grey menu strip with the same tools, and
 * the canvas filling the rest of the viewport.
 *
 * The drawing model is stroke-based. The document is a list of strokes
 * (see `use-board-doc`), so the eraser deletes whole strokes and the
 * lasso can transform them.
 *
 * The camera lives in a ref and is repainted from a rAF loop, so panning
 * and zooming never route through React state.
 */

type Tool = "draw" | "erase" | "move" | "select";

/**
 * Corner and edge handles, in the order `selectionHandlePositions` returns them.
 *
 * The type lives in the stroke library because the scale geometry needs it
 * too: the pivot of a scale is the opposite edge or corner.
 */
type HandleId = SelectionHandle;

/** Board ids look like the source's: three uppercase hex-ish blocks. */
function mintBoardId(): string {
  const block = (length: number) =>
    Array.from({ length }, () =>
      "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16)),
    ).join("");
  return `${block(5)}-${block(4)}-${block(4)}`;
}

/**
 * Resolves the effective board id during render.
 *
 * `/board/new` has to mint an id, but doing that in an effect would trigger a
 * second render via state. Instead the id is minted once and memoised in module
 * scope, so every render of the same navigation sees the same value.
 */
let newBoardId: string | null = null;

function resolveBoardId(boardId: string): string {
  if (boardId !== "new") {
    return boardId;
  }
  newBoardId = newBoardId ?? mintBoardId();
  return newBoardId;
}

const DEFAULT_STYLE: StrokeStyle = {
  color: "#4a4a4aff",
  gradientType: "linear",
  gradientStops: [
    { color: "#4a4a4aff", position: 0 },
    { color: "#0000ffff", position: 1 },
  ],
  width: 4,
  opacity: 1,
  drawStyle: "marker",
};

const DEFAULT_DRAW_STYLE: DrawStyle = "marker";

/** Hit tolerance in world units, added to a stroke's own half-width. */
const ERASE_TOLERANCE = 6;
const ERASE_BRUSH_RADIUS = 12;

/** Extra slack, in world units, when grabbing a selected stroke to move it. */
const MOVE_TOLERANCE = 6;

export function BoardSection({ boardId }: { boardId: string }) {
  const user = useDeviceUser();
  const pro = usePro();
  const { ready } = useLobbyGate();
  const effectiveId = resolveBoardId(boardId);
  /**
   * The board's host.
   *
   * The device that opened the board first owns it — in practice the one that
   * created it — and everybody else is a user. The host keeps the board's
   * destructive tools: clearing it and changing its background colour.
   */
  const { hostId, isHost } = useBoardHost(effectiveId, user.id);
  const board = useBoard(effectiveId, user, pro, hostId);
  const doc = useBoardDoc();
  /** The board's own settings: background, grid, snapping and auto-save. */
  const settings = useBoardSettings(effectiveId);
  /** Whether this browser sees the board with inverted colours. */
  const [flipColors, setFlipColors] = useFlipColors();
  /**
   * Whether the room's conversation is on screen.
   *
   * The bar itself is always there — it is part of the board's layout — but the
   * messages float over the canvas, so they can be put away.
   */
  const [chatOpen, setChatOpen] = useState(true);
  /**
   * The room around the board: chat, reactions and the microphone.
   *
   * here.fm's half of the mix. The room is per board and lives in this
   * browser, so it is shared with the other tabs of the same board.
   */
  const room = useRoom(effectiveId, displayName(user), user.id, chatOpen);
  const mic = useRoomMic();

  /** Detecta si estamos en móvil para cambiar la UI. */
  const isMobile = useIsMobile();

  const [tool, setTool] = useState<Tool>("draw");
  const [style, setStyle] = useState<StrokeStyle>(DEFAULT_STYLE);
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [drawPanelOpen, setDrawPanelOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [zoomLabel, setZoomLabel] = useState("100%");
  /**
   * The three-dot menu of an imported item, and where it opens.
   *
   * The menu itself is HTML rather than canvas, so it can use real buttons and
   * real text; the position is the screen position of the item's dots handle.
   */
  const [itemMenu, setItemMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * Mirror of the canvas element.
   *
   * The board shows a "loading" gate until the device profile is known, so the
   * canvas is not mounted on the first render. Effects that need the element
   * therefore depend on this state instead of only on the ref, or they would
   * run once against a `null` canvas and never observe it.
   */
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const attachCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
    setCanvasEl(element);
  }, []);
  const camera = useRef<Camera>(initialCamera());
  /** Viewport in CSS pixels, refreshed by the resize observer. */
  const viewport = useRef<Viewport>({ width: 1, height: 1, dpr: 1 });
  /** The in-progress stroke, kept out of the document until it is committed. */
  const drafting = useRef<Point[] | null>(null);
  /** Brush ring shown while erasing. */
  const cursor = useRef<{ x: number; y: number; radius: number } | null>(null);
  /** Lasso path while selecting, in world space. */
  const lasso = useRef<LassoPath | null>(null);
  /** Active pointer gesture, so a drag knows what it is manipulating. */
  const gesture = useRef<
    | { kind: "pan"; lastX: number; lastY: number }
    | { kind: "draw"; startTime: number; drawStyle: DrawStyle }
    | { kind: "erase" }
    /**
     * A lasso is either a selection or a fill, and the difference has to be
     * remembered: the Draw tool's style can change between the press and the
     * release, and the Select tool always selects, whatever the style says.
     */
    | { kind: "lasso"; fillType: "fill" | "gradient-fill" | null }
    /** Dragging a selected stroke or shape, which moves the whole selection. */
    | { kind: "move"; lastWorld: { x: number; y: number } }
    | {
        kind: "transform";
        handle: SelectionHandle;
        startWorld: { x: number; y: number };
        /**
         * The selection's bounds when the drag began.
         *
         * The scale is measured against these, not against the live bounds:
         * the selection grows as it is dragged, so a live denominator would
         * make the shape chase its own tail.
         */
        startBounds: Bounds;
        pivot: { x: number; y: number };
        lastAngle: number;
        /** The factor applied to each axis so far, so the next move is a ratio. */
        lastScaleX: number;
        lastScaleY: number;
      }
    /** Dragging an imported item around the board. */
    | { kind: "item-move"; itemId: string; lastWorld: { x: number; y: number } }
    /** Turning an imported item around its own centre. */
    | {
        kind: "item-rotate";
        itemId: string;
        center: { x: number; y: number };
        startAngle: number;
        startRotation: number;
      }
    /** Growing or shrinking an imported item. */
    | {
        kind: "item-scale";
        itemId: string;
        center: { x: number; y: number };
        startDistance: number;
        startScale: number;
      }
    | null
  >(null);
  const rafPending = useRef(false);
  /**
   * Mirror of the style state.
   *
   * The paint loop is started once and therefore keeps the `paint` closure it
   * was created with, so anything `paint` needs has to be read through a ref.
   * Without these mirrors the live preview of a stroke would be drawn with the
   * style that was active when the board mounted.
   */
  const styleRef = useRef<StrokeStyle>(DEFAULT_STYLE);
  const drawStyleRef = useRef<DrawStyle>(DEFAULT_DRAW_STYLE);
  /** The board's settings, mirrored for the paint loop. */
  const settingsRef = useRef<BoardSettings>(settings);
  /** Whether this browser flips the colours, mirrored for the paint loop. */
  const flipColorsRef = useRef(flipColors);
  /**
   * The document's own refs, taken out of the returned object so the paint
   * loop can depend on them. `useBoardDoc` hands back a fresh object on every
   * render, but these two refs never change identity.
   */
  const docStrokes = doc.strokes;
  const docSelectedIds = doc.selectedIds;
  /** The imported media the board carries. */
  const docItems = doc.items;
  /** The imported item that is selected, if any. */
  const docSelectedItemId = doc.selectedItemId;
  /** The stage the canvas sits in; the item menu opens inside it. */
  const stageRef = useRef<HTMLDivElement>(null);
  /** The imported item that is playing, if any. */
  const playingItemIdRef = useRef<string | null>(null);
  /** The audio element that plays an imported clip. */
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    styleRef.current = style;
    drawStyleRef.current = drawStyle;
  }, [style, drawStyle]);

  useEffect(() => {
    settingsRef.current = settings;
    flipColorsRef.current = flipColors;
  }, [settings, flipColors]);

  // Keep the minted id in the URL so the link is shareable and a reload reopens
  // the same board. `replaceState` is an external-system write, not state.
  useEffect(() => {
    if (boardId !== "new") {
      return;
    }
    window.history.replaceState(null, "", `/board/${effectiveId}`);
  }, [boardId, effectiveId]);

  // Remember this board so the Lobby can list it under "recent".
  useEffect(() => {
    if (ready && effectiveId && effectiveId !== "new") {
      markJoined(effectiveId);
    }
  }, [ready, effectiveId]);

  /**
   * The first device to open a board owns it.
   *
   * The claim is permanent, so the device that created the board keeps it for
   * good; a board that is opened by somebody else first is owned by whoever
   * got there first.
   */
  useEffect(() => {
    if (ready && effectiveId && user.id) {
      claimBoardHost(effectiveId, user.id);
    }
  }, [ready, effectiveId, user.id]);

  /**
   * Restores the board's saved document.
   *
   * The restore is deferred by a tick: the board is still mounting, and the
   * document should not be swapped under it in the same breath.
   */
  const importDocument = doc.importDocument;
  useEffect(() => {
    if (!ready || !effectiveId) {
      return;
    }
    const saved = readBoardDocument(effectiveId);
    if (!saved) {
      return;
    }
    const timer = window.setTimeout(() => importDocument(saved), 0);
    return () => window.clearTimeout(timer);
  }, [ready, effectiveId, importDocument]);

  /**
   * Saves the board on the interval the Settings tab asks for.
   *
   * The document is the ink plus the imported media, so a board that is
   * reopened comes back as it was left.
   */
  const exportDocument = doc.exportDocument;
  useEffect(() => {
    const seconds = Math.max(5, settings.autoSaveInterval);
    const timer = window.setInterval(() => {
      saveBoardDocument(effectiveId, exportDocument());
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [effectiveId, exportDocument, settings.autoSaveInterval]);

  /**
   * Paints one frame from the current refs.
   *
   * The painter lives for as long as the board does, and it is made during the
   * first render. That is safe because everything it reads is a ref: a ref
   * never changes identity, so a painter made once still draws the latest
   * state of the document, the camera and the settings.
   */
  const [paint] = useState(() => () => {
    const canvas = canvasRef.current;
    const strokes = docStrokes.current;
    const items = docItems.current;
    const selectedItemId = docSelectedItemId.current;
    const draftingPoints = drafting.current;

    // The stroke being drawn is not in the document yet, so it is appended for
    // the frame only. Its id is irrelevant because it is never hit-tested here.
    const display = draftingPoints
      ? [
          ...strokes,
          {
            id: "__drafting__",
            points: draftingPoints,
            style: { ...styleRef.current, drawStyle: drawStyleRef.current },
            transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          },
        ]
      : strokes;

    const selected = docSelectedIds.current;
    let box: SelectionBox | null = null;
    if (selected.size > 0) {
      const bounds = selectionBounds(
        strokes.filter((stroke) => selected.has(stroke.id)),
      );
      if (bounds) {
        box = {
          bounds,
          rotation: 0,
        };
      }
    }

    if (!canvas) return;
    const context = canvas.getContext("2d");

    render({
      context,
      camera: camera.current,
      viewport: viewport.current,
      strokes: display,
      items,
      selectedItemId,
      playingItemId: playingItemIdRef.current,
      background: settingsRef.current.backgroundColor,
      flipColors: flipColorsRef.current,
      showGrid: settingsRef.current.showGrid,
      gridSize: settingsRef.current.gridSize,
      selection: box,
      lasso: lasso.current ?? null,
      cursor: cursor.current,
    });
  });

  const schedulePaint = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      paint();
    });
  }, [paint]);

  // Start rAF loop on mount.
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      paint();
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [paint]);

  // Switching tools clears the hover cursor, which the inline style would
  // otherwise keep showing over a canvas that no longer grabs anything.
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "";
    }
  }, [tool]);

  // Resize observer keeps the canvas viewport in sync.
  useEffect(() => {
    if (!canvasEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        viewport.current = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
          dpr: window.devicePixelRatio || 1,
        };
      }
      schedulePaint();
    });
    ro.observe(canvasEl);
    return () => ro.disconnect();
  }, [canvasEl, schedulePaint]);

  /** Touch gestures: pinch-to-zoom y two-finger pan (solo en móvil). */
  useTouchGestures(canvasRef, camera, viewport, schedulePaint, isMobile);

  /** Convert a canvas pointer event to screen coordinates. */
  const screenPosition = (event: React.PointerEvent<HTMLCanvasElement>) => ({
    x: event.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0),
    y: event.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0),
  });

  /** Check if a screen point is over a selection handle. */
  const handleAt = (screenX: number, screenY: number): HandleId | null => {
    const selected = doc.selectedIds.current;
    if (selected.size === 0) return null;
    const strokes = doc.strokes.current.filter((s) => selected.has(s.id));
    const bounds = selectionBounds(strokes);
    if (!bounds) return null;
    const { corners, rotate } = selectionHandlePositions(camera.current, { bounds, rotation: 0 });
    const screen = { x: screenX, y: screenY };
    // Check corner handles (nw, ne, se, sw)
    const cornerIds: HandleId[] = ["nw", "ne", "se", "sw"];
    for (let i = 0; i < corners.length; i++) {
      const pos = corners[i];
      if (Math.hypot(screen.x - pos.x, screen.y - pos.y) < 12) {
        return cornerIds[i];
      }
    }
    // Check edge handles (n, e, s, w) - midpoints between corners
    const edgeIds: HandleId[] = ["n", "e", "s", "w"];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (Math.hypot(screen.x - midX, screen.y - midY) < 12) {
        return edgeIds[i];
      }
    }
    // Check rotate handle
    if (Math.hypot(screen.x - rotate.x, screen.y - rotate.y) < 12) {
      return "rotate";
    }
    return null;
  };

  /**
   * Whether a world point lands on the current selection.
   *
   * A selected stroke is grabbed by its ink, and a selected filled shape can
   * be grabbed from anywhere inside it, since the fill is what the user sees.
   */
  const hitsSelection = (worldX: number, worldY: number): boolean => {
    const selected = doc.selectedIds.current;
    if (selected.size === 0) {
      return false;
    }
    for (const stroke of doc.strokes.current) {
      if (!selected.has(stroke.id)) {
        continue;
      }
      if (hitStroke(stroke, worldX, worldY, MOVE_TOLERANCE)) {
        return true;
      }
      if (
        stroke.style.drawStyle === "fill" ||
        stroke.style.drawStyle === "gradient-fill"
      ) {
        const polygon = stroke.points.map((point) =>
          applyTransform(stroke.transform, point.x, point.y),
        );
        if (pointInPolygon(worldX, worldY, polygon)) {
          return true;
        }
      }
    }
    return false;
  };

  /**
   * Snaps a world point to the grid, when the board asks for it.
   *
   * The step is the one the grid is actually drawn with, so a snapped point
   * always lands on a visible line.
   */
  const snapToGrid = (world: { x: number; y: number }) => {
    if (!settingsRef.current.snapToGrid) {
      return world;
    }
    const step = gridStep(camera.current.scale, settingsRef.current.gridSize);
    return {
      x: Math.round(world.x / step) * step,
      y: Math.round(world.y / step) * step,
    };
  };

  /**
   * The imported item under a world point, if any.
   *
   * The last item of the list is the one in front, so the search runs
   * backwards.
   */
  const itemAt = (worldX: number, worldY: number): ImportedItem | null => {
    const items = itemsInPaintOrder(docItems.current);
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (itemHitTest(items[index], worldX, worldY)) {
        return items[index];
      }
    }
    return null;
  };

  /** The selected imported item, if any. */
  const selectedItem = (): ImportedItem | null => {
    const id = docSelectedItemId.current;
    if (!id) {
      return null;
    }
    return docItems.current.find((item) => item.id === id) ?? null;
  };

  /**
   * The small option under a screen point, if any.
   *
   * The options of a selected item — download, rotate, the three dots and the
   * resize handle — sit in a row under the item, in screen space, so they
   * keep their size at every zoom.
   */
  const itemHandleAt = (screenX: number, screenY: number): ItemHandle | null => {
    const item = selectedItem();
    if (!item) {
      return null;
    }
    const chrome = itemChromePositions(camera.current, item);
    const handles: { kind: ItemHandle; at: { x: number; y: number } }[] = [
      { kind: "download", at: chrome.download },
      { kind: "rotate", at: chrome.rotate },
      { kind: "dots", at: chrome.dots },
      { kind: "resize", at: chrome.resize },
    ];
    for (const handle of handles) {
      if (Math.hypot(screenX - handle.at.x, screenY - handle.at.y) < 13) {
        return handle.kind;
      }
    }
    return null;
  };

  /** Opens the three-dot menu of an item, next to its dots handle. */
  const openItemMenu = (item: ImportedItem) => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) {
      return;
    }
    const chrome = itemChromePositions(camera.current, item);
    const canvasBox = canvas.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    setItemMenu({
      id: item.id,
      x: canvasBox.left - stageBox.left + chrome.dots.x,
      y: canvasBox.top - stageBox.top + chrome.dots.y,
    });
  };

  /** Saves an imported item to the computer. */
  const downloadItem = (item: ImportedItem) => {
    const link = document.createElement("a");
    link.href = item.src;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  /**
   * Uses an imported picture as the visitor's avatar.
   *
   * The original can be a large file, so it is cropped square and shrunk to
   * 128px first: the data URL then stays small enough for localStorage and is
   * still sharp in the 30px circles the board draws.
   */
  const setItemAsAvatar = (item: ImportedItem) => {
    if (item.kind !== "image") {
      return;
    }
    const image = new Image();
    image.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        setAvatar(item.src);
        return;
      }
      const side = Math.min(image.naturalWidth, image.naturalHeight) || 1;
      const sourceX = (image.naturalWidth - side) / 2;
      const sourceY = (image.naturalHeight - side) / 2;
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, size, size);
      setAvatar(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      // A format the browser can draw but not decode at this size is rare; the
      // original still works as an avatar if storage accepts it.
      setAvatar(item.src);
    };
    image.src = item.src;
  };

  /** Plays an imported clip, or stops it when it is already playing. */
  const togglePlayback = (item: ImportedItem) => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.addEventListener("ended", () => {
        playingItemIdRef.current = null;
        schedulePaint();
      });
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    if (playingItemIdRef.current === item.id) {
      audio.pause();
      playingItemIdRef.current = null;
      schedulePaint();
      return;
    }
    audio.pause();
    audio.src = item.src;
    void audio.play().then(
      () => {
        playingItemIdRef.current = item.id;
        schedulePaint();
      },
      () => {
        playingItemIdRef.current = null;
        schedulePaint();
      },
    );
  };

  /**
   * What the user picked from an item's three-dot menu.
   *
   * Every one of these is a single undo step, like any other edit.
   */
  const handleItemAction = (action: ItemMenuAction) => {
    const menu = itemMenu;
    setItemMenu(null);
    if (!menu) {
      return;
    }
    const item = docItems.current.find((entry) => entry.id === menu.id);
    if (!item) {
      return;
    }
    doc.beginEdit();
    switch (action) {
      case "front":
        doc.reorderItem(item.id, true);
        break;
      case "back":
        doc.reorderItem(item.id, false);
        break;
      case "pin":
        doc.updateItem(item.id, { pinned: !item.pinned }, false);
        break;
      case "lock":
        doc.updateItem(item.id, { locked: !item.locked }, false);
        break;
      case "mirror":
        doc.updateItem(item.id, { mirrored: !item.mirrored }, false);
        break;
      case "duplicate":
        doc.duplicateItem(item.id);
        break;
      case "download":
        downloadItem(item);
        break;
      case "avatar":
        setItemAsAvatar(item);
        break;
      case "delete":
        doc.removeItem(item.id);
        break;
    }
    doc.endEdit();
    schedulePaint();
  };

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Ignorar eventos pointer si hay un gesto multi-touch activo (pinch/pan con 2 dedos)
    // Esto evita que el lapiz dibuje rayas mientras se hace zoom con dos dedos.
    if (multiTouchActiveRef.current) {
      return;
    }
    if (event.button !== 0) return;
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (and some touch stacks) have no capturable id; the
      // board must still start the gesture rather than abort.
    }

    const screen = screenPosition(event);
    const world = screenToWorld(camera.current, screen.x, screen.y);

    /**
     * Any press on the board itself dismisses the three-dot menu. The dots
     * handle opens it again below when that is what was pressed, and the menu
     * disappearing is what makes "click the background to put the options
     * away" work.
     */
    if (itemMenu) {
      setItemMenu(null);
    }

    /**
     * The play button of an imported clip.
     *
     * It is a control of its own, so it answers whichever tool is active.
     */
    const playable = itemsInPaintOrder(docItems.current)
      .slice()
      .reverse()
      .find((item) => itemPlayButtonHit(item, world.x, world.y));
    if (playable) {
      togglePlayback(playable);
      return;
    }

    if (tool === "move") {
      gesture.current = { kind: "pan", lastX: screen.x, lastY: screen.y };
      return;
    }

    if (tool === "select") {
      /**
       * The small options of the selected item come first: they sit on top of
       * the item, so a press there must not pick the item up again.
       */
      const itemHandle = itemHandleAt(screen.x, screen.y);
      if (itemHandle) {
        const item = selectedItem();
        if (!item) {
          return;
        }
        if (itemHandle === "dots") {
          openItemMenu(item);
          return;
        }
        if (itemHandle === "download") {
          downloadItem(item);
          return;
        }
        if (item.locked) {
          // A locked item keeps its place; it cannot be turned or resized.
          return;
        }
        if (itemHandle === "rotate") {
          doc.beginEdit();
          gesture.current = {
            kind: "item-rotate",
            itemId: item.id,
            center: { x: item.x, y: item.y },
            startAngle: Math.atan2(world.y - item.y, world.x - item.x),
            startRotation: item.rotation,
          };
          return;
        }
        doc.beginEdit();
        gesture.current = {
          kind: "item-scale",
          itemId: item.id,
          center: { x: item.x, y: item.y },
          startDistance: Math.hypot(world.x - item.x, world.y - item.y) || 1,
          startScale: item.scale,
        };
        return;
      }

      /**
       * A press on an imported item picks it up.
       *
       * The item is selected first, so its small options appear, and the drag
       * then moves it around the board.
       */
      const item = itemAt(world.x, world.y);
      if (item) {
        doc.selectItem(item.id);
        setItemMenu(null);
        if (!item.locked) {
          doc.beginEdit();
          gesture.current = {
            kind: "item-move",
            itemId: item.id,
            lastWorld: world,
          };
        }
        schedulePaint();
        return;
      }

      // A press on a handle starts a transform; anywhere else begins a lasso.
      const handle = handleAt(screen.x, screen.y);
      if (handle) {
        const selected = doc.selectedIds.current;
        const bounds = selectionBounds(
          doc.strokes.current.filter((stroke) => selected.has(stroke.id)),
        );
        if (bounds) {
          const pivot = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          };
          doc.beginEdit();
          gesture.current = {
            kind: "transform",
            handle,
            startWorld: world,
            startBounds: bounds,
            pivot,
            lastAngle: Math.atan2(world.y - pivot.y, world.x - pivot.x),
            lastScaleX: 1,
            lastScaleY: 1,
          };
          return;
        }
      }

      // A press on the selection drags it around.
      if (hitsSelection(world.x, world.y)) {
        doc.beginEdit();
        gesture.current = { kind: "move", lastWorld: world };
        return;
      }

      // Anywhere else begins a lasso. The Select tool always selects, even
      // when the Draw panel happens to be set to a fill style.
      doc.selectItem(null);
      lasso.current = { points: [world], done: false };
      gesture.current = { kind: "lasso", fillType: null };
      schedulePaint();
      return;
    }

    if (tool === "erase") {
      gesture.current = { kind: "erase" };
      cursor.current = {
        x: screen.x,
        y: screen.y,
        radius: ERASE_BRUSH_RADIUS * camera.current.scale,
      };
      // The whole drag is one undo step.
      doc.beginEdit();
      const removed = doc.eraseAt(world.x, world.y, ERASE_TOLERANCE);
      if (removed > 0) {
        schedulePaint();
      }
      return;
    }

    // Fill / Gradient Fill: work like lasso - draw closed shape, then fill it.
    if (drawStyle === "fill" || drawStyle === "gradient-fill") {
      const snapped = snapToGrid(world);
      lasso.current = { points: [snapped], done: false };
      gesture.current = { kind: "lasso", fillType: drawStyle };
      schedulePaint();
      return;
    }

    // Draw (marker, fill, gradient-fill, calligraphy).
    gesture.current = { kind: "draw", startTime: performance.now(), drawStyle };
    const start = snapToGrid(world);
    drafting.current = [
      {
        x: start.x,
        y: start.y,
        // The source passes a literal 0 pressure for mouse input.
        pressure: event.pointerType === "pen" ? event.pressure : 0,
        t: 0,
      },
    ];
    schedulePaint();
  };

  /**
   * Cursor feedback while hovering with the Select tool.
   *
   * A selected stroke or shape shows a grab cursor, which is the hint that it
   * can be dragged. The cursor is written straight to the element, so hovering
   * never re-renders the board.
   */
  const updateHoverCursor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (tool !== "select") {
      if (canvas.style.cursor !== "") {
        canvas.style.cursor = "";
      }
      return;
    }
    const screen = screenPosition(event);
    const world = screenToWorld(camera.current, screen.x, screen.y);
    const next = hitsSelection(world.x, world.y) ? "grab" : "";
    if (canvas.style.cursor !== next) {
      canvas.style.cursor = next;
    }
  };

  const extend = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Si se activa multi-touch durante un gesto, cancelarlo
    if (multiTouchActiveRef.current) {
      gesture.current = null;
      return;
    }
    const active = gesture.current;
    if (!active) {
      updateHoverCursor(event);
      return;
    }
    const screen = screenPosition(event);
    const world = screenToWorld(camera.current, screen.x, screen.y);

    if (active.kind === "pan") {
      camera.current = panBy(
        camera.current,
        screen.x - active.lastX,
        screen.y - active.lastY,
      );
      active.lastX = screen.x;
      active.lastY = screen.y;
      schedulePaint();
      return;
    }

    if (active.kind === "erase") {
      cursor.current = {
        x: screen.x,
        y: screen.y,
        radius: ERASE_BRUSH_RADIUS * camera.current.scale,
      };
      const removed = doc.eraseAt(world.x, world.y, ERASE_TOLERANCE);
      if (removed > 0) {
        schedulePaint();
      } else {
        schedulePaint();
      }
      return;
    }

    if (active.kind === "lasso") {
      // A lasso that fills a shape follows the grid; one that selects does
      // not, because it has to be able to catch a stroke exactly.
      const point = active.fillType ? snapToGrid(world) : world;
      lasso.current = {
        points: [...(lasso.current?.points ?? []), point],
        done: false,
      };
      schedulePaint();
      return;
    }

    /**
     * Dragging an imported item.
     *
     * The item follows the pointer one increment at a time, so it never drifts
     * away from the cursor.
     */
    if (active.kind === "item-move") {
      const item = docItems.current.find((entry) => entry.id === active.itemId);
      if (!item) {
        return;
      }
      const dx = world.x - active.lastWorld.x;
      const dy = world.y - active.lastWorld.y;
      active.lastWorld = world;
      if (dx !== 0 || dy !== 0) {
        doc.updateItem(item.id, { x: item.x + dx, y: item.y + dy }, true);
        schedulePaint();
      }
      return;
    }

    /** Turning an imported item around its own centre. */
    if (active.kind === "item-rotate") {
      const angle = Math.atan2(
        world.y - active.center.y,
        world.x - active.center.x,
      );
      doc.updateItem(
        active.itemId,
        { rotation: active.startRotation + (angle - active.startAngle) },
        true,
      );
      schedulePaint();
      return;
    }

    /**
     * Growing or shrinking an imported item.
     *
     * The factor is measured against where the pointer was when the drag
     * began, so the item does not chase its own tail while it grows.
     */
    if (active.kind === "item-scale") {
      const distance =
        Math.hypot(world.x - active.center.x, world.y - active.center.y) || 1;
      const scale = Math.max(0.05, active.startScale * (distance / active.startDistance));
      doc.updateItem(active.itemId, { scale }, true);
      schedulePaint();
      return;
    }

    if (active.kind === "move") {
      // The selection follows the pointer, one increment at a time, so the
      // strokes never drift away from the cursor.
      const dx = world.x - active.lastWorld.x;
      const dy = world.y - active.lastWorld.y;
      active.lastWorld = world;
      if (dx !== 0 || dy !== 0) {
        doc.moveSelection(dx, dy, true);
        schedulePaint();
      }
      return;
    }

    if (active.kind === "transform") {
      if (active.handle === "rotate") {
        const angle = Math.atan2(world.y - active.pivot.y, world.x - active.pivot.x);
        const delta = angle - active.lastAngle;
        active.lastAngle = angle;
        doc.rotateSelection(delta, active.pivot.x, active.pivot.y, true);
        schedulePaint();
        return;
      }

      /**
       * Scaling from a handle.
       *
       * The pivot is the *opposite* edge or corner, so that side stays where it
       * is and the handle follows the pointer. The factor is measured against
       * where the handle started, so it is 1 before the drag and grows from
       * there — a vertical drag can no longer flip the shape by accident.
       *
       * A negative factor is a deliberate flip, which the source allows too:
       * it only happens when the handle is dragged past the pivot.
       */
      const { pivot, anchor } = handleAnchor(active.handle, active.startBounds);
      const factorX =
        anchor.x === pivot.x ? 1 : (world.x - pivot.x) / (anchor.x - pivot.x);
      const factorY =
        anchor.y === pivot.y ? 1 : (world.y - pivot.y) / (anchor.y - pivot.y);

      // A degenerate factor would flatten the selection irrecoverably; the
      // sign is kept, because a flip is a legitimate outcome.
      const safeX = Math.abs(factorX) < 0.05 ? (factorX < 0 ? -0.05 : 0.05) : factorX;
      const safeY = Math.abs(factorY) < 0.05 ? (factorY < 0 ? -0.05 : 0.05) : factorY;

      // Each move applies the *ratio* to the factor applied so far, so the
      // total always matches the factor measured from the start of the drag.
      const stepX = active.lastScaleX === 0 ? 1 : safeX / active.lastScaleX;
      const stepY = active.lastScaleY === 0 ? 1 : safeY / active.lastScaleY;
      active.lastScaleX = safeX;
      active.lastScaleY = safeY;

      doc.scaleSelection(stepX, stepY, pivot.x, pivot.y, true);
      schedulePaint();
      return;
    }

    // Draw.
    const started = active.startTime;
    const point = snapToGrid(world);
    const next = {
      x: point.x,
      y: point.y,
      pressure: event.pointerType === "pen" ? event.pressure : 0,
      t: Math.round(performance.now() - started),
    };
    drafting.current = [...(drafting.current ?? []), next];
    schedulePaint();
  };

  /** Creates a filled polygon stroke from a lasso path. */
  const createFillStroke = (
    points: { x: number; y: number }[],
    fillType: "fill" | "gradient-fill",
  ) => {
    // Close the polygon by adding the first point at the end
    // Add required pressure and t properties for Point type
    const closedPoints = [
      ...points,
      { ...points[0], pressure: 0, t: 0 },
    ] as { x: number; y: number; pressure: number; t: number }[];

    // Create a stroke that represents the filled polygon
    // We use a special drawStyle marker so the renderer knows to fill it
    const fillStrokeStyle: StrokeStyle = {
      ...style,
      drawStyle: fillType,
      // For gradient fill, we'll need a second color - for now use a lighter version
      // The renderer will handle the gradient based on this flag
    };

    doc.commitStroke(closedPoints, fillStrokeStyle);
  };

  const finish = () => {
    const active = gesture.current;
    gesture.current = null;
    // The selection may have moved away from the pointer, so the grab cursor
    // is refreshed on the next move.
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "";
    }

    if (active?.kind === "lasso") {
      const path = lasso.current;
      lasso.current = null;
      if (path && path.points.length >= 3) {
        // The gesture remembers whether this lasso was meant to fill or to
        // select, so the Select tool never paints a shape by accident.
        if (active.fillType) {
          createFillStroke(path.points, active.fillType);
        } else {
          doc.selectWithLasso(path.points);
        }
      } else {
        doc.clearSelection();
      }
      schedulePaint();
      return;
    }

    if (active?.kind === "move") {
      // The live moves already mutated the document; commit one repaint.
      doc.endEdit();
      doc.bump();
      return;
    }

    if (active?.kind === "erase") {
      cursor.current = null;
      doc.endEdit();
      schedulePaint();
      return;
    }

    if (active?.kind === "transform") {
      // The live transforms already mutated the document; commit one repaint.
      doc.endEdit();
      doc.bump();
      return;
    }

    /**
     * The imported item gestures.
     *
     * The live moves already mutated the document; committing them is one
     * undo step, like any other edit.
     */
    if (
      active?.kind === "item-move" ||
      active?.kind === "item-rotate" ||
      active?.kind === "item-scale"
    ) {
      doc.endEdit();
      doc.bump();
      return;
    }

    if (active?.kind === "draw") {
      const points = drafting.current ?? [];
      drafting.current = null;
      // A single tap becomes a dot; anything longer is kept whole.
      if (points.length > 0) {
        doc.commitStroke(points, { ...style, drawStyle: active.drawStyle });
      }
      schedulePaint();
    }
  };

  /** Mouse wheel zooms towards the cursor. */
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const screen = screenPosition(event as unknown as React.PointerEvent<HTMLCanvasElement>);
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera.current = zoomAt(camera.current, screen.x, screen.y, factor);
    setZoomLabel(formatZoom(clampScale(camera.current.scale)));
    schedulePaint();
  };

  /** Double-clicking the Draw tool opens its options panel. */
  const handleDrawClick = () => {
    if (tool === "draw") {
      setDrawPanelOpen((open) => !open);
      return;
    }
    setTool("draw");
    setDrawPanelOpen(false);
  };

  const undo = () => {
    doc.undo();
  };

  /**
   * Clears the board.
   *
   * Only the host may do this: it throws away everything that is on the
   * board, ink and imported media alike.
   */
  const clearAll = () => {
    if (!isHost) {
      return;
    }
    doc.clearAll();
  };

  /**
   * Brings a piece of media onto the board.
   *
   * It lands in the middle of what the user is looking at, and it is selected
   * straight away, so the small options under it are there to be used.
   */
  const importMedia = (media: ImportedMedia) => {
    const centre = screenToWorld(
      camera.current,
      viewport.current.width / 2,
      viewport.current.height / 2,
    );
    const item = createImportedItem(media, centre.x, centre.y);
    doc.beginEdit();
    doc.addItem(item);
    doc.endEdit();
    doc.selectItem(item.id);
    schedulePaint();
  };

  const resetView = () => {
    camera.current = initialCamera();
    setZoomLabel("100%");
    schedulePaint();
  };

  if (!ready) {
    return (
      <div className="wm-board flex items-center justify-center text-[18px]">
        <span data-testid="board-gate">Loading whiteboard…</span>
      </div>
    );
  }

  const cursorClass =
    tool === "draw" || tool === "erase"
      ? "cursor-crosshair"
      : tool === "move"
        ? "cursor-grab"
        : "cursor-default";

  return (
    <div className="wm-board" data-testid="board">
      {/* --- Desktop menu strip (oculto en móvil via CSS) --- */}
      {!isMobile && (
        <>
        {/* --- Left menu strip: 140px, tools ------------------- */}
        <div id="menuStrip">
        <button
          type="button"
          className="menu-button"
          title="Undo the previous operation (Key Z)"
          onClick={undo}
          data-testid="tool-undo"
        >
          <span className="html-face">
            <UndoIcon />
            Undo
          </span>
        </button>

        <button
          type="button"
          className={`menu-button ${tool === "draw" ? "gwt-ToggleButton-down" : ""}`}
          title="Draw (press again to show options) (Key D)"
          aria-pressed={tool === "draw"}
          onClick={handleDrawClick}
          onDoubleClick={() => {
            setTool("draw");
            setDrawPanelOpen(true);
          }}
          data-testid="tool-draw"
        >
          <span className="html-face">
            <PencilIcon fill={style.color} />
            Draw
          </span>
        </button>

        <button
          type="button"
          className={`menu-button ${tool === "erase" ? "gwt-ToggleButton-down" : ""}`}
          title="Erase whole strokes (Key E)"
          aria-pressed={tool === "erase"}
          onClick={() => {
            setTool("erase");
            setDrawPanelOpen(false);
          }}
          data-testid="tool-erase"
        >
          <span className="html-face">
            <EraserIcon />
            Erase
          </span>
        </button>

        <ImportMenu onImport={importMedia} />

        <button
          type="button"
          className={`menu-button ${tool === "move" ? "gwt-ToggleButton-down" : ""}`}
          title="Move the view (Key A + drag)"
          aria-pressed={tool === "move"}
          onClick={() => {
            setTool("move");
            setDrawPanelOpen(false);
          }}
          data-testid="tool-move"
        >
          <span className="html-face">
            <MoveIcon />
            Move
          </span>
        </button>

        <button
          type="button"
          className={`menu-button ${tool === "select" ? "gwt-ToggleButton-down" : ""}`}
          title="Lasso-select strokes to move, scale and rotate"
          aria-pressed={tool === "select"}
          onClick={() => {
            setTool("select");
            setDrawPanelOpen(false);
          }}
          data-testid="tool-select"
        >
          <span className="html-face">
            <SelectIcon />
            Select
          </span>
        </button>

        <button
          type="button"
          className="menu-button"
          title="More board options (Key O)"
          onClick={() => {
            setOptionsOpen((open) => !open);
            setDrawPanelOpen(false);
          }}
          data-testid="tool-options"
        >
          <span className="html-face">
            <CogIcon />
            Options
          </span>
        </button>

        <button
          type="button"
          className="menu-button"
          title={
            isHost
              ? "Clear several drawing items in one action"
              : "Only the board host can clear the board"
          }
          disabled={!isHost}
          onClick={clearAll}
          data-testid="tool-clear"
        >
          <span className="html-face">
            <TrashIcon />
            Clear
          </span>
        </button>

        {/* --- The room: here.fm's half of the mix, under the board's tools --- */}
        <RoomBar
          roomUrl={`${WHITEBOARDMOD_ORIGIN}/board/${effectiveId}`}
          room={room}
          mic={mic}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((open) => !open)}
        />
      </div>
      </>
      )}

      {/* --- Mobile toolbar (solo en móvil) --- */}
      {isMobile && (
        <MobileToolbar
          tool={tool}
          setTool={setTool}
          style={style}
          drawStyle={drawStyle}
          setStyle={setStyle}
          setDrawStyle={setDrawStyle}
          onUndo={undo}
          onClear={clearAll}
          isHost={isHost}
          onImport={importMedia}
          onToggleOptions={() => setOptionsOpen((o) => !o)}
          optionsOpen={optionsOpen}
          drawPanelOpen={drawPanelOpen}
          setDrawPanelOpen={setDrawPanelOpen}
          participants={board.participants}
          search={search}
          onSearchChange={setSearch}
          settings={settings}
          onSettingsChange={(patch) => {
            const allowed = isHost
              ? patch
              : { ...patch, backgroundColor: settings.backgroundColor };
            writeSettings(effectiveId, { ...settings, ...allowed });
          }}
          flipColors={flipColors}
          onFlipColorsChange={setFlipColors}
        />
      )}

      {/* --- Canvas ------------------------------------------------------- */}
      <div className="wm-stage" ref={stageRef}>
        <canvas
          ref={attachCanvas}
          id="canvasId"
          className={cursorClass}
          onPointerDown={begin}
          onPointerMove={extend}
          onPointerUp={finish}
          onPointerCancel={finish}
          onWheel={handleWheel}
          onDoubleClick={(event) => {
            // On the canvas, a double click acts as a shortcut for the pencil.
            if (tool === "draw") {
              setDrawPanelOpen(true);
              event.preventDefault();
            }
          }}
          data-testid="boardCanvas"
        />

        {chatOpen && <RoomMessages messages={room.messages} />}

        <RoomReactions reactions={room.reactions} />

        <RoomChatBar
          room={room}
          author={displayName(user)}
          hue={board.participants[0]?.avatarHue ?? 0}
          avatar={user.avatar}
          mic={mic}
        />

        {itemMenu &&
          (() => {
            const item = docItems.current.find((entry) => entry.id === itemMenu.id);
            if (!item) {
              return null;
            }
            return (
              <ItemMenu
                item={item}
                x={itemMenu.x}
                y={itemMenu.y}
                onAction={handleItemAction}
                onClose={() => setItemMenu(null)}
              />
            );
          })()}
      </div>

      {!isMobile && drawPanelOpen && (
        <DrawPanel
          style={style}
          drawStyle={drawStyle}
          onStyleChange={setStyle}
          onDrawStyleChange={setDrawStyle}
          onClose={() => setDrawPanelOpen(false)}
        />
      )}

      {!isMobile && optionsOpen && (
        <OptionsMenu
          participants={board.participants}
          search={search}
          onSearchChange={setSearch}
          onClose={() => setOptionsOpen(false)}
          settings={settings}
          onSettingsChange={(patch) => {
            // The background colour belongs to the host: nobody else may change
            // it, whatever the panel says.
            const allowed = isHost
              ? patch
              : { ...patch, backgroundColor: settings.backgroundColor };
            writeSettings(effectiveId, { ...settings, ...allowed });
          }}
          flipColors={flipColors}
          onFlipColorsChange={setFlipColors}
          isHost={isHost}
        />
      )}

      {/* --- Board id badge and view controls --------------------------- */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 150,
          display: "flex",
          gap: 12,
          alignItems: "center",
          fontSize: 15,
          color: "#333",
        }}
        data-testid="board-badge"
      >
        <strong data-testid="board-id">{board.id}</strong>
        <button
          type="button"
          className="text-[13px] underline"
          style={{ color: "#0066cc", cursor: "pointer", background: "none", border: 0, padding: 0 }}
          onClick={() => {
            const url = `${WHITEBOARDMOD_ORIGIN}/board/${board.id}`;
            navigator.clipboard?.writeText(url).catch(() => undefined);
          }}
          data-testid="board-share-path"
        >
          {`${WHITEBOARDMOD_ORIGIN}/board/${board.id}`}
        </button>
        <button
          type="button"
          className="text-[13px] underline"
          style={{ color: "#0066cc", cursor: "pointer", background: "none", border: 0, padding: 0 }}
          onClick={resetView}
          data-testid="board-reset-view"
        >
          Reset view
        </button>
        <span
          data-testid="zoom-label"
          style={{
            fontVariantNumeric: "tabular-nums",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            minWidth: "5ch",
            textAlign: "right",
          }}
        >
          {zoomLabel}
        </span>
      </div>
    </div>
  );
}