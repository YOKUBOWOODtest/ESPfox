/**
 * WhiteboardMod WebSocket Server
 * 
 * Lightweight real-time collaboration server for whiteboardmod.
 * Handles: stroke sync, item sync, user presence, cursor positions.
 * 
 * Run: node index.js
 * Deploy: Render Web Service (Docker or Node.js)
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { parse } from 'url';

const PORT = process.env.PORT || 3001;

// Board rooms: boardId -> Set of clients
const rooms = new Map();

// Client info: ws -> { boardId, userId, userName, color, cursor, isHost }
const clients = new Map();

// Generate random color for user cursor
function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 50%)`;
}

// Broadcast to all clients in a room except sender
function broadcast(roomId, message, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const data = JSON.stringify(message);
  for (const clientWs of room) {
    if (clientWs !== excludeWs && clientWs.readyState === 1) { // WebSocket.OPEN
      clientWs.send(data);
    }
  }
}

// Send to specific client
function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

// Handle new connection
function handleConnection(ws, req) {
  const url = parse(req.url, true);
  const boardId = url.query.boardId;
  const userId = url.query.userId;
  const userName = url.query.userName || 'Anonymous';
  
  if (!boardId || !userId) {
    ws.close(4000, 'Missing boardId or userId');
    return;
  }
  
  console.log(`Client connected: ${userName} (${userId}) to board ${boardId}`);
  
  // Initialize room if needed
  if (!rooms.has(boardId)) {
    rooms.set(boardId, new Set());
  }
  
  const room = rooms.get(boardId);
  room.add(ws);
  
  // Determine if this user is host (first to join)
  const existingClients = Array.from(room).filter(c => c !== ws);
  const isHost = existingClients.length === 0;
  
  const color = randomColor();
  
  // Store client info
  clients.set(ws, {
    boardId,
    userId,
    userName,
    color,
    cursor: { x: 0, y: 0 },
    isHost,
    joinedAt: Date.now()
  });
  
  // Notify others about new user
  broadcast(boardId, {
    type: 'user_joined',
    user: {
      userId,
      userName,
      color,
      isHost,
      cursor: { x: 0, y: 0 }
    }
  }, ws);
  
  // Send current room state to new user
  const users = [];
  for (const clientWs of room) {
    const info = clients.get(clientWs);
    if (info) {
      users.push({
        userId: info.userId,
        userName: info.userName,
        color: info.color,
        isHost: info.isHost,
        cursor: info.cursor
      });
    }
  }
  
  send(ws, {
    type: 'room_state',
    boardId,
    yourUserId: userId,
    isHost,
    users,
    // Request full document sync
    needSync: true
  });
  
  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });
  
  // Handle disconnect
  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      console.log(`Client disconnected: ${info.userName} (${info.userId}) from board ${info.boardId}`);
      
      // Remove from room
      const room = rooms.get(info.boardId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          rooms.delete(info.boardId);
        } else {
          // Notify others
          broadcast(info.boardId, {
            type: 'user_left',
            userId: info.userId
          });
          
          // Transfer host if needed
          if (info.isHost && room.size > 0) {
            const newHostWs = room.values().next().value;
            const newHostInfo = clients.get(newHostWs);
            if (newHostInfo) {
              newHostInfo.isHost = true;
              broadcast(info.boardId, {
                type: 'host_changed',
                newHostId: newHostInfo.userId
              }, newHostWs);
              send(newHostWs, {
                type: 'became_host'
              });
            }
          }
        }
      }
      
      clients.delete(ws);
    }
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}

// Handle incoming messages
function handleMessage(ws, message) {
  const info = clients.get(ws);
  if (!info) return;
  
  const { boardId, userId, isHost } = info;
  
  switch (message.type) {
    case 'stroke': {
      // Broadcast stroke to others
      broadcast(boardId, {
        type: 'stroke',
        stroke: message.stroke,
        authorId: userId,
        authorName: info.userName,
        authorColor: info.color
      }, ws);
      break;
    }
    
    case 'stroke_batch': {
      // Multiple strokes at once (for sync)
      broadcast(boardId, {
        type: 'stroke_batch',
        strokes: message.strokes,
        authorId: userId
      }, ws);
      break;
    }
    
    case 'item': {
      // Item add/update/remove
      broadcast(boardId, {
        type: 'item',
        item: message.item,
        action: message.action, // 'add' | 'update' | 'remove'
        authorId: userId
      }, ws);
      break;
    }
    
    case 'item_batch': {
      broadcast(boardId, {
        type: 'item_batch',
        items: message.items,
        authorId: userId
      }, ws);
      break;
    }
    
    case 'cursor': {
      // Update cursor position
      info.cursor = message.cursor;
      broadcast(boardId, {
        type: 'cursor',
        userId,
        cursor: message.cursor
      }, ws);
      break;
    }
    
    case 'selection': {
      // Selection changes
      broadcast(boardId, {
        type: 'selection',
        userId,
        selection: message.selection
      }, ws);
      break;
    }
    
    case 'clear': {
      // Only host can clear
      if (!isHost) {
        send(ws, { type: 'error', message: 'Only host can clear board' });
        return;
      }
      broadcast(boardId, { type: 'clear' }, ws);
      break;
    }
    
    case 'undo': {
      // Undo is local - just notify others to remove last stroke by this user
      broadcast(boardId, {
        type: 'undo',
        authorId: userId
      }, ws);
      break;
    }
    
    case 'delete_stroke': {
      // Delete specific stroke (host can delete any, users only their own)
      const { strokeId, authorId } = message;
      if (!isHost && authorId !== userId) {
        send(ws, { type: 'error', message: 'Cannot delete other users\' strokes' });
        return;
      }
      broadcast(boardId, {
        type: 'delete_stroke',
        strokeId,
        authorId
      }, ws);
      break;
    }
    
    case 'delete_item': {
      const { itemId, authorId } = message;
      if (!isHost && authorId !== userId) {
        send(ws, { type: 'error', message: 'Cannot delete other users\' items' });
        return;
      }
      broadcast(boardId, {
        type: 'delete_item',
        itemId,
        authorId
      }, ws);
      break;
    }
    
    case 'sync_request': {
      // Another client requested full sync
      // In a real app, we'd send the full document from storage
      // For now, we'll just acknowledge
      send(ws, { type: 'sync_ack', requestedBy: message.from });
      break;
    }
    
    case 'sync_document': {
      // Full document sync (strokes + items)
      broadcast(boardId, {
        type: 'sync_document',
        document: message.document,
        authorId: userId
      }, ws);
      break;
    }
    
    case 'ping': {
      send(ws, { type: 'pong' });
      break;
    }
  }
}

// Create HTTP server (for health checks)
const server = createServer((req, res) => {
  const url = parse(req.url, true);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      rooms: rooms.size,
      clients: clients.size
    }));
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', handleConnection);

server.listen(PORT, () => {
  console.log(`WhiteboardMod WebSocket server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  wss.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
});