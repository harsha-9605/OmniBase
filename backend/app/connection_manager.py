"""
WebSocket Connection Manager — the in-memory switchboard for real-time chat.

Tracks every active browser connection, grouped by project_id (channel room).
Handles connect, disconnect, and fan-out broadcast atomically.
"""

import json
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # { project_id: [WebSocket, WebSocket, ...] }
        self.rooms: dict[int, list[WebSocket]] = {}
        # { account_id: [WebSocket, ...] }
        self.personal_rooms: dict[int, list[WebSocket]] = {}
        # Redis client reference for Pub/Sub publishing
        self.redis_client = None

    async def connect(self, websocket: WebSocket, project_id: int, account_id: int = None) -> None:
        """Accept the handshake and register the socket in the correct room."""
        await websocket.accept()
        if project_id not in self.rooms:
            self.rooms[project_id] = []
        self.rooms[project_id].append(websocket)
        
        if account_id:
            if account_id not in self.personal_rooms:
                self.personal_rooms[account_id] = []
            self.personal_rooms[account_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int, account_id: int = None) -> None:
        """Remove the socket from the room. Safe to call even if already absent."""
        if project_id in self.rooms:
            try:
                self.rooms[project_id].remove(websocket)
            except ValueError:
                pass
            # Clean up empty rooms to avoid memory accumulation
            if not self.rooms[project_id]:
                del self.rooms[project_id]
                
        if account_id and account_id in self.personal_rooms:
            try:
                self.personal_rooms[account_id].remove(websocket)
            except ValueError:
                pass
            if not self.personal_rooms[account_id]:
                del self.personal_rooms[account_id]

    async def broadcast(self, message: dict, project_id: int) -> None:
        """Broadcast a message. Publishes to Redis Pub/Sub if available, otherwise sends locally."""
        if self.redis_client is not None:
            payload = {
                "type": "project",
                "target_id": project_id,
                "payload": message
            }
            try:
                await self.redis_client.publish("ws_channel_broadcast", json.dumps(payload))
                return
            except Exception as e:
                print(f"Failed to publish to Redis Pub/Sub: {e}. Falling back to local broadcast.")
        
        await self.broadcast_local(message, project_id)

    async def broadcast_local(self, message: dict, project_id: int) -> None:
        """Deliver a message locally to active sockets in the local room."""
        if project_id not in self.rooms:
            return

        dead_sockets: list[WebSocket] = []

        for websocket in self.rooms[project_id]:
            try:
                await websocket.send_json(message)
            except Exception:
                dead_sockets.append(websocket)

        for ws in dead_sockets:
            self.disconnect(ws, project_id)

    async def broadcast_to_project(self, project_id: int, message: dict) -> None:
        """Push a JSON message to every active socket in a channel room (alias for broadcast)."""
        await self.broadcast(message, project_id)

    async def personal_broadcast(self, message: dict, account_id: int) -> None:
        """Broadcast personally to a user. Publishes to Redis Pub/Sub if available, otherwise sends locally."""
        if self.redis_client is not None:
            payload = {
                "type": "personal",
                "target_id": account_id,
                "payload": message
            }
            try:
                await self.redis_client.publish("ws_channel_broadcast", json.dumps(payload))
                return
            except Exception as e:
                print(f"Failed to publish to Redis Pub/Sub: {e}. Falling back to local personal broadcast.")
                
        await self.personal_broadcast_local(message, account_id)

    async def personal_broadcast_local(self, message: dict, account_id: int) -> None:
        """Deliver a personal message locally to active sockets for a specific user."""
        if account_id not in self.personal_rooms:
            return

        dead_sockets: list[WebSocket] = []

        for websocket in self.personal_rooms[account_id]:
            try:
                await websocket.send_json(message)
            except Exception:
                dead_sockets.append(websocket)

        for ws in dead_sockets:
            self.disconnect(ws, 0, account_id)


# Singleton — shared across the entire FastAPI process lifetime
manager = ConnectionManager()

