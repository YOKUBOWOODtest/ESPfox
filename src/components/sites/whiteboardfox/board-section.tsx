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
import { OptionsMenu } from "./options-menu";
import { RoomBar } from "./room-bar";
import { RoomChatBar, RoomMessages, RoomReactions } from "./room-chat";
import { markJoined, useBoard } from "./use-board";
import { useBoardDoc } from "./use-board-doc";
import { useDeviceUser, displayName } from "./use-device-user";
import { useLobbyGate } from "./use-lobby-gate";
import { usePro } from "./use-pro";
import { useRoom } from "./use-room";
import { useRoomMic } from "./use-room-mic";
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
import {
  render,
  selectionBounds,
  selectionHandlePositions,
  type SelectionBox,
  type Viewport,
  type LassoPath,
} from "@/lib/board/render";
import {
  applyTransform,
  hitStroke,
  pointInPolygon,
  type Point,
  type StrokeStyle,
  type DrawStyle,
} from "@/lib/board/stroke";

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

/** Corner and edge handles, in the order `selectionHandlePositions` returns them. */
type HandleId = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rotate";

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
  const board = useBoard(effectiveId, user, pro);
  const doc = useBoardDoc();
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

  const [tool, setTool] = useState<Tool>("draw");
  const [style, setStyle] = useState<StrokeStyle>(DEFAULT_STYLE);
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [drawPanelOpen, setDrawPanelOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [zoomLabel, setZoomLabel] = useState("100%");

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
        handle: HandleId;
        startWorld: { x: number; y: number };
        pivot: { x: number; y: number };
        lastAngle: number;
        lastScale: number;
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
  /**
   * The document's own refs, taken out of the returned object so the paint
   * loop can depend on them. `useBoardDoc` hands back a fresh object on every
   * render, but these two refs never change identity.
   */
  const docStrokes = doc.strokes;
  const docSelectedIds = doc.selectedIds;

  useEffect(() => {
    styleRef.current = style;
    drawStyleRef.current = drawStyle;
  }, [style, drawStyle]);

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
   * Paints one frame from the current refs.
   *
   * Reads everything through refs, so the animation loop can keep the single
   * closure it was created with and still draw the latest state.
   */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const strokes = docStrokes.current;
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
      selection: box,
      lasso: lasso.current ?? null,
      cursor: cursor.current,
    });
  }, [docStrokes, docSelectedIds]);

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

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (and some touch stacks) have no capturable id; the
      // board must still start the gesture rather than abort.
    }

    const screen = screenPosition(event);
    const world = screenToWorld(camera.current, screen.x, screen.y);

    if (tool === "move") {
      gesture.current = { kind: "pan", lastX: screen.x, lastY: screen.y };
      return;
    }

    if (tool === "select") {
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
          gesture.current = {
            kind: "transform",
            handle,
            startWorld: world,
            pivot,
            lastAngle: Math.atan2(world.y - pivot.y, world.x - pivot.x),
            lastScale: 1,
          };
          return;
        }
      }

      // A press on the selection drags it around.
      if (hitsSelection(world.x, world.y)) {
        gesture.current = { kind: "move", lastWorld: world };
        return;
      }

      // Anywhere else begins a lasso. The Select tool always selects, even
      // when the Draw panel happens to be set to a fill style.
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
      const removed = doc.eraseAt(world.x, world.y, ERASE_TOLERANCE);
      if (removed > 0) {
        schedulePaint();
      }
      return;
    }

    // Fill / Gradient Fill: work like lasso - draw closed shape, then fill it.
    if (drawStyle === "fill" || drawStyle === "gradient-fill") {
      lasso.current = { points: [world], done: false };
      gesture.current = { kind: "lasso", fillType: drawStyle };
      schedulePaint();
      return;
    }

    // Draw (marker, fill, gradient-fill, calligraphy).
    gesture.current = { kind: "draw", startTime: performance.now(), drawStyle };
    drafting.current = [
      {
        x: world.x,
        y: world.y,
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
      lasso.current = {
        points: [...(lasso.current?.points ?? []), world],
        done: false,
      };
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
      const bounds = selectionBounds(
        doc.strokes.current.filter((stroke) => doc.selectedIds.current.has(stroke.id)),
      );
      if (!bounds) {
        return;
      }
      const { pivot, handle } = active;

      if (handle === "rotate") {
        const angle = Math.atan2(world.y - pivot.y, world.x - pivot.x);
        const delta = angle - active.lastAngle;
        active.lastAngle = angle;
        doc.rotateSelection(delta, pivot.x, pivot.y, true);
        schedulePaint();
        return;
      }

      // Scale factor relative to the opposite edge/corner, normalised by the
      // starting extent so the drag feels linear rather than compounding.
      const halfWidth = Math.max(1, (bounds.maxX - bounds.minX) / 2);
      const halfHeight = Math.max(1, (bounds.maxY - bounds.minY) / 2);
      const offsetX = world.x - pivot.x;
      const offsetY = world.y - pivot.y;

      const affectsX =
        handle === "nw" ||
        handle === "ne" ||
        handle === "se" ||
        handle === "sw" ||
        handle === "e" ||
        handle === "w";
      const affectsY =
        handle === "nw" ||
        handle === "ne" ||
        handle === "se" ||
        handle === "sw" ||
        handle === "n" ||
        handle === "s";

      const scaleX = affectsX ? offsetX / halfWidth : 1;
      const scaleY = affectsY ? offsetY / halfHeight : 1;

      // Guard against a degenerate (zero-width) scale, which would flatten the
      // selection irrecoverably.
      const safeX = Math.abs(scaleX) < 0.05 ? (scaleX < 0 ? -0.05 : 0.05) : scaleX;
      const safeY = Math.abs(scaleY) < 0.05 ? (scaleY < 0 ? -0.05 : 0.05) : scaleY;

      // Apply the incremental ratio so repeated moves compose correctly.
      const stepX = safeX / active.lastScale;
      const stepY = safeY / active.lastScale;
      active.lastScale = affectsX && affectsY ? Math.max(safeX, safeY) : 1;

      doc.scaleSelection(
        affectsX ? stepX : 1,
        affectsY ? stepY : 1,
        pivot.x,
        pivot.y,
        true,
      );
      schedulePaint();
      return;
    }

    // Draw.
    const started = active.startTime;
    const next = {
      x: world.x,
      y: world.y,
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
      doc.bump();
      return;
    }

    if (active?.kind === "erase") {
      cursor.current = null;
      schedulePaint();
      return;
    }

    if (active?.kind === "transform") {
      // The live transforms already mutated the document; commit one repaint.
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

  const clearAll = () => {
    doc.clearAll();
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
      {/* --- Left menu strip: 140px, tools ------------------- */}
      <div id="menuStrip">
        <button
          type="button"
          className="menu-button"
          title="Undo the previous operation (Key Z)"
          onClick={undo}
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
          title="Clear several drawing items in one action"
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

      {/* --- Canvas ------------------------------------------------------- */}
      <div className="wm-stage">
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
          mic={mic}
        />
      </div>

      {drawPanelOpen && (
        <DrawPanel
          style={style}
          drawStyle={drawStyle}
          onStyleChange={setStyle}
          onDrawStyleChange={setDrawStyle}
          onClose={() => setDrawPanelOpen(false)}
        />
      )}

      {optionsOpen && (
        <OptionsMenu
          participants={board.participants}
          search={search}
          onSearchChange={setSearch}
          onClose={() => setOptionsOpen(false)}
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