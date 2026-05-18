"""
WebSocket Connection Manager — the in-memory switchboard for real-time chat.

Tracks every active browser connection, grouped by project_id (channel room).
Handles connect, disconnect, and fan-out broadcast atomically.
"""

from fastapi import WebSocket
import asyncio


class ConnectionManager:
    def __init__(self):
        # { project_id: [WebSocket, WebSocket, ...] }
        self.rooms: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: int) -> None:
        """Accept the handshake and register the socket in the correct room."""
        await websocket.accept()
        if project_id not in self.rooms:
            self.rooms[project_id] = []
        self.rooms[project_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int) -> None:
        """Remove the socket from the room. Safe to call even if already absent."""
        if project_id in self.rooms:
            try:
                self.rooms[project_id].remove(websocket)
            except ValueError:
                pass
            # Clean up empty rooms to avoid memory accumulation
            if not self.rooms[project_id]:
                del self.rooms[project_id]

    async def broadcast(self, message: dict, project_id: int) -> None:
        """Push a JSON message to every active socket in a channel room.

        Dead connections are silently removed so one broken client cannot
        block the rest of the room from receiving messages.
        """
        if project_id not in self.rooms:
            return

        dead_sockets: list[WebSocket] = []

        for websocket in self.rooms[project_id]:
            try:
                await websocket.send_json(message)
            except Exception:
                # Connection is dead — mark for cleanup after iteration
                dead_sockets.append(websocket)

        # Clean up broken connections discovered during broadcast
        for ws in dead_sockets:
            self.disconnect(ws, project_id)


# Singleton — shared across the entire FastAPI process lifetime
manager = ConnectionManager()
