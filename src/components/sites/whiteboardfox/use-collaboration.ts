"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Stroke, Point, StrokeStyle, Transform } from "@/lib/board/stroke";
import type { ImportedItem } from "@/lib/board/imported";

export interface RemoteUser {
  userId: string;
  userName: string;
  color: string;
  isHost: boolean;
  cursor: { x: number; y: number };
}

export interface CursorPosition {
  x: number;
  y: number;
}

export interface SelectionBox {
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  rotation: number;
}

/**
 * Hook for real-time WebSocket collaboration.
 * Connects to the WebSocket server and handles:
 * - User presence (join/leave)
 * - Stroke synchronization
 * - Item synchronization
 * - Cursor positions
 * - Selection boxes
 * - Host permissions
 */
export function useCollaboration(
  boardId: string,
  userId: string,
  userName: string,
  // Callbacks for the board to handle remote changes
  onRemoteStroke: (stroke: Stroke, authorId: string, authorName: string, authorColor: string) => void,
  onRemoteStrokeBatch: (strokes: Stroke[], authorId: string) => void,
  onRemoteStrokeDelete: (strokeId: string, authorId: string) => void,
  onRemoteUndo: (authorId: string) => void,
  onRemoteItem: (item: ImportedItem, action: 'add' | 'update' | 'remove', authorId: string) => void,
  onRemoteItemBatch: (items: ImportedItem[], authorId: string) => void,
  onRemoteItemDelete: (itemId: string, authorId: string) => void,
  onRemoteClear: () => void,
  onRemoteCursor: (userId: string, cursor: { x: number; y: number }) => void,
  onRemoteSelection: (userId: string, selection: SelectionBox | null) => void,
  onUserJoined: (user: { userId: string; userName: string; color: string; isHost: boolean }) => void,
  onUserLeft: (userId: string) => void,
  onHostChanged: (newHostId: string) => void,
  onBecameHost: () => void,
  onSyncRequest: () => void,
  onSyncDocument: (document: { strokes: any[]; items: any[] }) => void,
  onError: (message: string) => void,
  isHostRef: React.MutableRefObject<boolean>
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<RemoteUser[]>([]);
  const pendingStrokesRef = useRef<Stroke[]>([]);
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 
    (typeof window !== 'undefined' 
      ? `ws://${window.location.hostname}:3001` 
      : 'ws://localhost:3001');

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const url = `${WS_URL}?boardId=${encodeURIComponent(boardId)}&userId=${encodeURIComponent(userId)}&userName=${encodeURIComponent(userName)}`;
    
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('[Collab] Connected to WebSocket server');
        setConnected(true);
        reconnectAttempts.current = 0;
      };
      
      ws.onclose = () => {
        console.log('[Collab] Disconnected from WebSocket server');
        setConnected(false);
        
        // Exponential backoff reconnect
        if (reconnectAttempts.current < 10) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };
      
      ws.onerror = (err) => {
        console.error('[Collab] WebSocket error:', err);
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error('[Collab] Failed to parse message:', e);
        }
      };
    } catch (e) {
      console.error('[Collab] Failed to create WebSocket:', e);
    }
  }, [boardId, userId, userName]);

  const handleMessage = (message: any) => {
    switch (message.type) {
      case 'room_state': {
        isHostRef.current = message.isHost;
        setUsers(message.users.map((u: any) => ({
          userId: u.userId,
          userName: u.userName,
          color: u.color,
          isHost: u.isHost,
          cursor: u.cursor
        })));
        
        if (message.needSync) {
          onSyncRequest();
        }
        break;
      }
      
      case 'user_joined': {
        onUserJoined(message.user);
        setUsers(prev => [...prev, message.user]);
        break;
      }
      
      case 'user_left': {
        onUserLeft(message.userId);
        setUsers(prev => prev.filter(u => u.userId !== message.userId));
        break;
      }
      
      case 'host_changed': {
        onHostChanged(message.newHostId);
        setUsers(prev => prev.map(u => 
          u.userId === message.newHostId ? { ...u, isHost: true } : u
        ));
        break;
      }
      
      case 'became_host': {
        isHostRef.current = true;
        onBecameHost();
        break;
      }
      
      case 'stroke': {
        onRemoteStroke(message.stroke, message.authorId, message.authorName, message.authorColor);
        break;
      }
      
      case 'stroke_batch': {
        onRemoteStrokeBatch(message.strokes, message.authorId);
        break;
      }
      
      case 'stroke_delete': {
        onRemoteStrokeDelete(message.strokeId, message.authorId);
        break;
      }
      
      case 'undo': {
        onRemoteUndo(message.authorId);
        break;
      }
      
      case 'item': {
        onRemoteItem(message.item, message.action, message.authorId);
        break;
      }
      
      case 'item_batch': {
        onRemoteItemBatch(message.items, message.authorId);
        break;
      }
      
      case 'item_delete': {
        onRemoteItemDelete(message.itemId, message.authorId);
        break;
      }
      
      case 'clear': {
        onRemoteClear();
        break;
      }
      
      case 'cursor': {
        onRemoteCursor(message.userId, message.cursor);
        setUsers(prev => prev.map(u => 
          u.userId === message.userId ? { ...u, cursor: message.cursor } : u
        ));
        break;
      }
      
      case 'selection': {
        onRemoteSelection(message.userId, message.selection);
        break;
      }
      
      case 'sync_document': {
        onSyncDocument(message.document);
        break;
      }
      
      case 'sync_ack': {
        onSyncRequest();
        break;
      }
      
      case 'error': {
        onError(message.message);
        break;
      }
      
      case 'pong': {
        // Heartbeat response
        break;
      }
    }
  };

  // Send stroke to other clients (batched for performance)
  const sendStroke = useCallback((stroke: Stroke) => {
    pendingStrokesRef.current.push(stroke);
    
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
    }
    
    flushTimeoutRef.current = setTimeout(() => {
      const strokes = [...pendingStrokesRef.current];
      pendingStrokesRef.current = [];
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        if (strokes.length === 1) {
          wsRef.current.send(JSON.stringify({
            type: 'stroke',
            stroke: strokes[0]
          }));
        } else {
          wsRef.current.send(JSON.stringify({
            type: 'stroke_batch',
            strokes
          }));
        }
      }
    }, 16); // ~60fps batch
  }, []);

  // Send item changes
  const sendItem = useCallback((item: any, action: 'add' | 'update' | 'remove') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'item',
        item,
        action
      }));
    }
  }, []);

  const sendItemBatch = useCallback((items: any[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'item_batch',
        items
      }));
    }
  }, []);

  const sendItemDelete = useCallback((itemId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'delete_item',
        itemId
      }));
    }
  }, []);

  // Send cursor position (throttled)
  const cursorThrottleRef = useRef(0);
  const sendCursor = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - cursorThrottleRef.current < 50) return; // 20fps max
    cursorThrottleRef.current = now;
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'cursor',
        cursor: { x, y }
      }));
    }
  }, []);

  // Send selection
  const sendSelection = useCallback((selection: SelectionBox | null) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'selection',
        selection
      }));
    }
  }, []);

  // Delete stroke
  const sendStrokeDelete = useCallback((strokeId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'delete_stroke',
        strokeId
      }));
    }
  }, []);

  // Send undo notification
  const sendUndo = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'undo' }));
    }
  }, []);

  // Clear board (host only)
  const sendClear = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear' }));
    }
  }, []);

  // Request full sync
  const requestSync = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'sync_request' }));
    }
  }, []);

  // Send full document for sync
  const sendSyncDocument = useCallback((document: { strokes: any[]; items: any[] }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'sync_document',
        document
      }));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Heartbeat
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  return {
    connected,
    users,
    sendStroke,
    sendItem,
    sendItemBatch,
    sendItemDelete,
    sendCursor,
    sendSelection,
    sendStrokeDelete,
    sendUndo,
    sendClear,
    requestSync,
    sendSyncDocument,
    isHost: isHostRef.current
  };
}