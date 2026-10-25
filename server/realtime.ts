import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

/**
 * Realtime collaboration backend.
 *
 * Extracted from `server/index.ts` so the same board logic can run either
 * behind Next.js on Render or as a tiny standalone Socket.io process on a
 * free Node host. It deliberately has no Next.js imports.
 */
export function attachRealtime(httpServer: HttpServer): Server {
  /* --- Board state ---------------------------------------------------------- */

  interface StrokeRecord {
    id: string;
    authorId?: string;
    transform?: unknown;
    [key: string]: unknown;
  }

  interface ItemRecord {
    id: string;
    authorId?: string;
    [key: string]: unknown;
  }

  interface BoardUser {
    id: string;
    name: string;
    hue: number;
    isHost: boolean;
    socketId: string;
    lastSeen: number;
  }

  interface BoardSettings {
    backgroundColor: string;
    showGrid: boolean;
    snapToGrid: boolean;
    gridSize: number;
    autoSaveInterval: number;
  }

  interface Board {
    id: string;
    strokes: Map<string, StrokeRecord>;
    items: Map<string, ItemRecord>;
    users: Map<string, BoardUser>;
    hostId: string | null;
    bannedIds: Set<string>;
    settings: BoardSettings;
    /** Last time anybody touched the board; empty boards are cleaned up. */
    lastActivity: number;
  }

  const boards = new Map<string, Board>();

  function createBoard(id: string): Board {
    return {
      id,
      strokes: new Map(),
      items: new Map(),
      users: new Map(),
      hostId: null,
      bannedIds: new Set(),
      settings: {
        backgroundColor: "#ffffff",
        showGrid: true,
        snapToGrid: true,
        gridSize: 20,
        autoSaveInterval: 30,
      },
      lastActivity: Date.now(),
    };
  }

  function boardFor(id: string): Board {
    let board = boards.get(id);
    if (!board) {
      board = createBoard(id);
      boards.set(id, board);
    }
    board.lastActivity = Date.now();
    return board;
  }

  function publicUsers(board: Board) {
    return Array.from(board.users.values()).map((user) => ({
      id: user.id,
      name: user.name,
      hue: user.hue,
      isHost: user.isHost,
    }));
  }

  /** Every event carries the board id; only strings are trusted. */
  function boardIdOf(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 && value.length <= 128
      ? value
      : null;
  }

  /** A display name that is safe to put on other people's screens. */
  function safeName(value: unknown, fallback: string): string {
    if (typeof value !== "string") {
      return fallback;
    }
    const trimmed = value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
    return trimmed || fallback;
  }

  function safeHue(value: unknown): number {
    const hue = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return ((Math.round(hue) % 360) + 360) % 360;
  }

  const socketPath = process.env.SOCKET_PATH?.trim();
  const clientOrigins = process.env.CLIENT_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const io = new Server(httpServer, {
    // An imported image travels as a data URL, so the default 1 MB is small.
    maxHttpBufferSize: 24 * 1024 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: {
      origin: clientOrigins && clientOrigins.length > 0 ? clientOrigins : "*",
      methods: ["GET", "POST"],
    },
    ...(socketPath ? { path: socketPath } : {}),
  });

  /**
   * Drop boards that nobody has opened for a day.
   *
   * The persistent hosts keep this process alive for weeks, so boards cannot
   * accumulate forever. The host's browser still has its own copy and seeds the
   * board again the next time it opens it.
   */
  const boardCleanup = setInterval(
    () => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [id, board] of boards) {
        if (board.users.size === 0 && board.lastActivity < cutoff) {
          boards.delete(id);
        }
      }
    },
    30 * 60 * 1000,
  );
  boardCleanup.unref?.();

  function broadcastUsers(board: Board) {
    io.to(board.id).emit("users:update", publicUsers(board));
  }

  function setHost(board: Board, hostId: string | null) {
    board.hostId = hostId;
    for (const user of board.users.values()) {
      user.isHost = user.id === hostId;
    }
  }

  /**
   * Removes a member.
   *
   * The host role stays with the device that opened the board first: a host
   * who reloads or loses the connection is still the host when it comes back,
   * and a guest cannot inherit moderation just by being the last one in the
   * room. If the host never returns, the board simply has no active host.
   */
  function removeMember(socketId: string, boardId: string, userId: string) {
    const board = boards.get(boardId);
    if (!board) {
      return;
    }
    const user = board.users.get(userId);
    if (!user || user.socketId !== socketId) {
      return;
    }
    board.users.delete(userId);
    broadcastUsers(board);
    io.to(boardId).emit("user:left", { userId });
  }

  io.on("connection", (socket) => {
    let joinedBoardId: string | null = null;
    let joinedUserId: string | null = null;

    function touch(board: Board) {
      board.lastActivity = Date.now();
      const user = joinedUserId ? board.users.get(joinedUserId) : null;
      if (user) {
        user.lastSeen = Date.now();
      }
    }

    /** Whether this socket may delete the given record. */
    function mayDelete(board: Board, authorId: string | undefined): boolean {
      // Records saved before collaboration have no author and stay shared.
      if (!authorId) {
        return true;
      }
      return authorId === joinedUserId || board.hostId === joinedUserId;
    }

    socket.on("board:join", (data: unknown) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      const boardId = boardIdOf(payload.boardId);
      const userId =
        typeof payload.userId === "string" && payload.userId.length > 0
          ? payload.userId.slice(0, 80)
          : null;
      if (!boardId || !userId) {
        return;
      }

      if (joinedBoardId && joinedUserId) {
        removeMember(socket.id, joinedBoardId, joinedUserId);
        socket.leave(joinedBoardId);
      }

      const board = boardFor(boardId);

      if (board.bannedIds.has(userId)) {
        socket.emit("board:banned");
        socket.disconnect(true);
        return;
      }

      socket.join(boardId);
      joinedBoardId = boardId;
      joinedUserId = userId;

      const previous = board.users.get(userId);
      if (previous && previous.socketId !== socket.id) {
        // The same device opened a second tab: the newest socket wins.
        previous.socketId = socket.id;
      }

      if (board.hostId === null) {
        setHost(board, userId);
      }

      const isHost = board.hostId === userId;
      board.users.set(userId, {
        id: userId,
        name: safeName(payload.name, "Guest"),
        hue: safeHue(payload.hue),
        isHost,
        socketId: socket.id,
        lastSeen: Date.now(),
      });
      setHost(board, board.hostId ?? userId);

      socket.emit("board:state", {
        boardId,
        strokes: Array.from(board.strokes.values()),
        items: Array.from(board.items.values()),
        users: publicUsers(board),
        hostId: board.hostId,
        isHost,
        settings: board.settings,
        myId: userId,
      });

      socket.to(boardId).emit("user:joined", {
        id: userId,
        name: board.users.get(userId)?.name ?? "Guest",
        hue: board.users.get(userId)?.hue ?? 0,
        isHost,
      });
      broadcastUsers(board);
    });

    socket.on("board:leave", () => {
      if (joinedBoardId && joinedUserId) {
        removeMember(socket.id, joinedBoardId, joinedUserId);
        socket.leave(joinedBoardId);
      }
      joinedBoardId = null;
      joinedUserId = null;
    });

    socket.on("stroke:add", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const stroke = payload.stroke as StrokeRecord | undefined;
      if (!stroke || typeof stroke.id !== "string") {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board) {
        return;
      }
      touch(board);
      const stored: StrokeRecord = { ...stroke, authorId: joinedUserId };
      board.strokes.set(stored.id, stored);
      socket.to(joinedBoardId).emit("stroke:add", stored);
    });

    socket.on("stroke:remove", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const ids = Array.isArray(payload.strokeIds)
        ? payload.strokeIds.filter((id): id is string => typeof id === "string")
        : [];
      const board = boards.get(joinedBoardId);
      if (!board) {
        return;
      }
      touch(board);
      const removed: string[] = [];
      for (const id of ids) {
        const stroke = board.strokes.get(id);
        if (stroke && mayDelete(board, stroke.authorId)) {
          board.strokes.delete(id);
          removed.push(id);
        }
      }
      if (removed.length > 0) {
        socket.to(joinedBoardId).emit("stroke:remove", removed);
      }
    });

    socket.on("stroke:transform", (data: unknown) => {
      if (!joinedBoardId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const strokeId = payload.strokeId;
      if (typeof strokeId !== "string") {
        return;
      }
      const board = boards.get(joinedBoardId);
      const stroke = board?.strokes.get(strokeId);
      if (!board || !stroke) {
        return;
      }
      touch(board);
      stroke.transform = payload.transform;
      socket.to(joinedBoardId).emit("stroke:transform", {
        strokeId,
        transform: payload.transform,
      });
    });

    socket.on("item:add", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const item = payload.item as ItemRecord | undefined;
      if (!item || typeof item.id !== "string") {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board) {
        return;
      }
      touch(board);
      const stored: ItemRecord = { ...item, authorId: joinedUserId };
      board.items.set(stored.id, stored);
      socket.to(joinedBoardId).emit("item:add", stored);
    });

    socket.on("item:update", (data: unknown) => {
      if (!joinedBoardId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const itemId = payload.itemId;
      const patch = payload.patch;
      if (typeof itemId !== "string" || typeof patch !== "object" || patch === null) {
        return;
      }
      const board = boards.get(joinedBoardId);
      const existing = board?.items.get(itemId);
      if (!board || !existing) {
        return;
      }
      touch(board);
      // A patch carries only what changed, so the media data URL is not sent
      // again on every pointer move.
      const stored: ItemRecord = {
        ...existing,
        ...(patch as ItemRecord),
        id: itemId,
        authorId: existing.authorId ?? joinedUserId ?? undefined,
      };
      board.items.set(itemId, stored);
      socket.to(joinedBoardId).emit("item:update", stored);
    });

    socket.on("item:remove", (data: unknown) => {
      if (!joinedBoardId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const itemId = payload.itemId;
      if (typeof itemId !== "string") {
        return;
      }
      const board = boards.get(joinedBoardId);
      const item = board?.items.get(itemId);
      if (!board || !item || !mayDelete(board, item.authorId)) {
        return;
      }
      touch(board);
      board.items.delete(itemId);
      socket.to(joinedBoardId).emit("item:remove", itemId);
    });

    /**
     * The host uploads the board it already has.
     *
     * A board opened before this server existed lives in the host's browser.
     * On the first join the server has nothing, so the host seeds it and
     * everybody else receives exactly the board the host sees.
     */
    socket.on("board:seed", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board || board.hostId !== joinedUserId) {
        return;
      }
      touch(board);
      const payload = (data ?? {}) as Record<string, unknown>;
      const strokes = Array.isArray(payload.strokes)
        ? (payload.strokes as StrokeRecord[])
        : [];
      const items = Array.isArray(payload.items) ? (payload.items as ItemRecord[]) : [];
      let added = false;
      for (const stroke of strokes) {
        if (stroke && typeof stroke.id === "string" && !board.strokes.has(stroke.id)) {
          board.strokes.set(stroke.id, {
            ...stroke,
            authorId: stroke.authorId ?? joinedUserId,
          });
          added = true;
        }
      }
      for (const item of items) {
        if (item && typeof item.id === "string" && !board.items.has(item.id)) {
          board.items.set(item.id, {
            ...item,
            authorId: item.authorId ?? joinedUserId,
          });
          added = true;
        }
      }
      if (added) {
        socket.to(joinedBoardId).emit("board:seeded", {
          strokes: Array.from(board.strokes.values()),
          items: Array.from(board.items.values()),
        });
      }
    });

    socket.on("item:reorder", (data: unknown) => {
      if (!joinedBoardId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const order = Array.isArray(payload.order)
        ? payload.order.filter((id): id is string => typeof id === "string")
        : [];
      if (order.length === 0) {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board) {
        return;
      }
      touch(board);
      socket.to(joinedBoardId).emit("item:reorder", { order });
    });

    /**
     * Audio is shared, not personal.
     *
     * Anybody may start a clip, and everybody receives the same command, so
     * the room hears one song together. The position is passed along so a
     * late joiner starts at the same point rather than at zero.
     */
    socket.on("audio:play", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const itemId = payload.itemId;
      if (typeof itemId !== "string") {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board) {
        return;
      }
      touch(board);
      const position =
        typeof payload.position === "number" && Number.isFinite(payload.position)
          ? payload.position
          : 0;
      const playing = Boolean(payload.playing);
      socket.to(joinedBoardId).emit("audio:play", {
        itemId,
        position,
        playing,
      });
    });

    socket.on("board:clear", () => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board || board.hostId !== joinedUserId) {
        socket.emit("error", { message: "Only the board host can clear the board." });
        return;
      }
      touch(board);
      board.strokes.clear();
      board.items.clear();
      io.to(joinedBoardId).emit("board:cleared");
    });

    socket.on("user:kick", (data: unknown) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const board = boards.get(joinedBoardId);
      const targetId = payload.targetUserId;
      if (!board || board.hostId !== joinedUserId || typeof targetId !== "string") {
        return;
      }
      if (targetId === joinedUserId) {
        return;
      }
      touch(board);
      const target = board.users.get(targetId);
      if (target) {
        io.to(target.socketId).emit("board:kicked");
        const targetSocket = io.sockets.sockets.get(target.socketId);
        targetSocket?.leave(joinedBoardId);
        board.users.delete(targetId);
        broadcastUsers(board);
        io.to(joinedBoardId).emit("user:left", { userId: targetId });
      }
    });

    socket.on("user:ban", (data: unknown) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const board = boards.get(joinedBoardId);
      const targetId = payload.targetUserId;
      if (!board || board.hostId !== joinedUserId || typeof targetId !== "string") {
        return;
      }
      if (targetId === joinedUserId) {
        return;
      }
      touch(board);
      board.bannedIds.add(targetId);
      const target = board.users.get(targetId);
      if (target) {
        io.to(target.socketId).emit("board:banned");
        const targetSocket = io.sockets.sockets.get(target.socketId);
        targetSocket?.leave(joinedBoardId);
        board.users.delete(targetId);
      }
      broadcastUsers(board);
      io.to(joinedBoardId).emit("user:left", { userId: targetId });
    });

    socket.on("settings:update", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const board = boards.get(joinedBoardId);
      if (!board || board.hostId !== joinedUserId) {
        return;
      }
      touch(board);
      const payload = (data ?? {}) as Record<string, unknown>;
      const settings = payload.settings;
      if (typeof settings === "object" && settings !== null) {
        board.settings = { ...board.settings, ...(settings as Partial<BoardSettings>) };
        socket.to(joinedBoardId).emit("settings:update", board.settings);
      }
    });

    socket.on("cursor:move", (data: unknown) => {
      if (!joinedBoardId || !joinedUserId) {
        return;
      }
      const payload = (data ?? {}) as Record<string, unknown>;
      const x = payload.x;
      const y = payload.y;
      if (typeof x !== "number" || typeof y !== "number") {
        return;
      }
      const board = boards.get(joinedBoardId);
      const user = board?.users.get(joinedUserId);
      if (!board || !user) {
        return;
      }
      touch(board);
      socket.to(joinedBoardId).emit("cursor:update", {
        userId: joinedUserId,
        x,
        y,
        color: typeof payload.color === "string" ? payload.color : "#e0533f",
        name: user.name,
      });
    });

    socket.on("disconnect", () => {
      if (joinedBoardId && joinedUserId) {
        removeMember(socket.id, joinedBoardId, joinedUserId);
      }
    });
  });

  return io;
}
