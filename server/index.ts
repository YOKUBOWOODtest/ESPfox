/**
 * Socket.io server for real-time whiteboard collaboration.
 * 
 * Handles:
 * - Stroke syncing (broadcast finished strokes)
 * - Cursor positions (throttled)
 * - User presence (join/leave, user list)
 * - Host permissions (clear board, kick/ban)
 * - Board settings sync
 */

import { Server } from "socket.io";
import { createServer } from "http";
import { parse } from "url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error handling request:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    // Increase max payload for stroke data
    maxHttpBufferSize: 1e6,
  });

  // Board state in memory (per boardId)
  interface BoardState {
    strokes: Map<string, any>; // strokeId -> stroke
    items: Map<string, any>;
    users: Map<string, UserInfo>;
    hostId: string | null;
    bannedIds: Set<string>;
    settings: any;
  }

  interface UserInfo {
    id: string;
    name: string;
    hue: number;
    socketId: string;
    isHost: boolean;
    cursor?: { x: number; y: number; color: string };
    lastSeen: number;
  }

  const boards = new Map<string, BoardState>();

  function getOrCreateBoard(boardId: string): BoardState {
    let board = boards.get(boardId);
    if (!board) {
      board = {
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
      };
      boards.set(boardId, board);
    }
    return board;
  }

  function getBoardUsers(board: BoardState) {
    return Array.from(board.users.values()).map((u) => ({
      id: u.id,
      name: u.name,
      hue: u.hue,
      isHost: u.isHost,
    }));
  }

  function broadcastUsers(boardId: string) {
    const board = boards.get(boardId);
    if (!board) return;
    io.to(boardId).emit("users:update", getBoardUsers(board));
  }

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    let currentBoardId: string | null = null;
    let currentUserId: string | null = null;

    // Join a board
    socket.on("board:join", (data: { boardId: string; userId: string; name: string; hue: number }) => {
      const { boardId, userId, name, hue } = data;
      
      // Check ban
      const board = getOrCreateBoard(boardId);
      if (board.bannedIds.has(userId)) {
        socket.emit("board:banned");
        socket.disconnect();
        return;
      }

      // Leave previous board if any
      if (currentBoardId) {
        socket.leave(currentBoardId);
        const prevBoard = boards.get(currentBoardId);
        if (prevBoard && prevBoard.users.has(currentUserId!)) {
          prevBoard.users.delete(currentUserId!);
          broadcastUsers(currentBoardId);
        }
      }

      // Join new board
      socket.join(boardId);
      currentBoardId = boardId;
      currentUserId = userId;

      // Assign host if first user
      const isHost = board.hostId === null;
      if (isHost) {
        board.hostId = userId;
      }

      // Register user
      board.users.set(userId, {
        id: userId,
        name,
        hue,
        socketId: socket.id,
        isHost,
        lastSeen: Date.now(),
      });

      // Send current board state to the new user
      socket.emit("board:state", {
        strokes: Array.from(board.strokes.values()),
        items: Array.from(board.items.values()),
        users: getBoardUsers(board),
        hostId: board.hostId,
        isHost,
        settings: board.settings,
        myId: userId,
      });

      // Notify others
      socket.to(boardId).emit("user:joined", {
        id: userId,
        name,
        hue,
        isHost,
      });

      broadcastUsers(boardId);
      console.log(`User ${name} (${userId}) joined board ${boardId} ${isHost ? "as host" : ""}`);
    });

    // Cursor position update (throttled client-side)
    socket.on("cursor:move", (data: { boardId: string; x: number; y: number; color: string }) => {
      const board = boards.get(data.boardId);
      if (!board) return;
      const user = board.users.get(currentUserId!);
      if (!user) return;

      user.cursor = { x: data.x, y: data.y, color: data.color };
      user.lastSeen = Date.now();

      // Broadcast to others in the board
      socket.to(data.boardId).emit("cursor:update", {
        userId: currentUserId,
        x: data.x,
        y: data.y,
        color: data.color,
        name: user.name,
      });
    });

    // New finished stroke
    socket.on("stroke:add", (data: { boardId: string; stroke: any }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      // Only accept strokes from the user who owns the socket
      const stroke = { ...data.stroke, authorId: currentUserId };
      board.strokes.set(stroke.id, stroke);

      // Broadcast to all OTHER users
      socket.to(data.boardId).emit("stroke:add", stroke);
    });

    // Stroke removed (erase)
    socket.on("stroke:remove", (data: { boardId: string; strokeIds: string[] }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      for (const id of data.strokeIds) {
        board.strokes.delete(id);
      }

      socket.to(data.boardId).emit("stroke:remove", data.strokeIds);
    });

    // Stroke transform (move/scale/rotate selection)
    socket.on("stroke:transform", (data: { boardId: string; strokeId: string; transform: any }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      const stroke = board.strokes.get(data.strokeId);
      if (stroke) {
        stroke.transform = data.transform;
        socket.to(data.boardId).emit("stroke:transform", {
          strokeId: data.strokeId,
          transform: data.transform,
        });
      }
    });

    // Imported item added
    socket.on("item:add", (data: { boardId: string; item: any }) => {
      const board = boards.get(data.boardId);
      if (!board) return;
      board.items.set(data.item.id, data.item);
      socket.to(data.boardId).emit("item:add", data.item);
    });

    // Imported item updated (move/scale/rotate)
    socket.on("item:update", (data: { boardId: string; item: any }) => {
      const board = boards.get(data.boardId);
      if (!board) return;
      board.items.set(data.item.id, data.item);
      socket.to(data.boardId).emit("item:update", data.item);
    });

    // Imported item removed
    socket.on("item:remove", (data: { boardId: string; itemId: string }) => {
      const board = boards.get(data.boardId);
      if (!board) return;
      board.items.delete(data.itemId);
      socket.to(data.boardId).emit("item:remove", data.itemId);
    });

    // Clear board (host only)
    socket.on("board:clear", (data: { boardId: string }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      // Only host can clear
      if (board.hostId !== currentUserId) {
        socket.emit("error", { message: "Only the host can clear the board" });
        return;
      }

      board.strokes.clear();
      board.items.clear();
      io.to(data.boardId).emit("board:cleared");
    });

    // Kick user (host only)
    socket.on("user:kick", (data: { boardId: string; targetUserId: string }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      if (board.hostId !== currentUserId) {
        socket.emit("error", { message: "Only the host can kick users" });
        return;
      }

      const targetSocket = board.users.get(data.targetUserId)?.socketId;
      if (targetSocket) {
        io.to(targetSocket).emit("board:kicked");
        // They'll reconnect and rejoin if they want
      }
      board.users.delete(data.targetUserId);
      broadcastUsers(data.boardId);
      io.to(data.boardId).emit("user:left", { userId: data.targetUserId });
    });

    // Ban user (host only)
    socket.on("user:ban", (data: { boardId: string; targetUserId: string }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      if (board.hostId !== currentUserId) {
        socket.emit("error", { message: "Only the host can ban users" });
        return;
      }

      board.bannedIds.add(data.targetUserId);
      board.users.delete(data.targetUserId);
      
      const targetSocket = board.users.get(data.targetUserId)?.socketId;
      if (targetSocket) {
        io.to(targetSocket).emit("board:banned");
      }
      
      broadcastUsers(data.boardId);
      io.to(data.boardId).emit("user:left", { userId: data.targetUserId });
    });

    // Settings update (host only)
    socket.on("settings:update", (data: { boardId: string; settings: any }) => {
      const board = boards.get(data.boardId);
      if (!board) return;

      if (board.hostId !== currentUserId) {
        socket.emit("error", { message: "Only the host can change settings" });
        return;
      }

      board.settings = { ...board.settings, ...data.settings };
      io.to(data.boardId).emit("settings:update", board.settings);
    });

    // Disconnect
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (currentBoardId && currentUserId) {
        const board = boards.get(currentBoardId);
        if (board) {
          const wasHost = board.hostId === currentUserId;
          board.users.delete(currentUserId);

          // Transfer host if needed
          if (wasHost) {
            const firstUser = board.users.values().next().value;
            if (firstUser) {
              board.hostId = firstUser.id;
              firstUser.isHost = true;
              io.to(currentBoardId).emit("host:changed", { newHostId: firstUser.id });
            } else {
              board.hostId = null;
            }
          }

          broadcastUsers(currentBoardId);
          socket.to(currentBoardId).emit("user:left", { userId: currentUserId });
        }
      }
    });
  });

  // Cleanup stale boards periodically
  setInterval(() => {
    const now = Date.now();
    for (const [boardId, board] of boards.entries()) {
      // Remove boards with no users for > 1 hour
      if (board.users.size === 0) {
        // Could add lastActivity timestamp to track this
        // For now, keep boards alive
      }
      // Remove stale users (> 5 min no cursor/activity)
      for (const [userId, user] of board.users.entries()) {
        if (now - user.lastSeen > 5 * 60 * 1000) {
          board.users.delete(userId);
          broadcastUsers(boardId);
          io.to(boardId).emit("user:left", { userId });
        }
      }
    }
  }, 60000);

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});