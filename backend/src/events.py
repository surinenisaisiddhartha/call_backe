import asyncio
import json
from typing import Set, Optional
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/events", tags=["Events"])

class EventManager:
    def __init__(self):
        self.subscribers: Set[asyncio.Queue] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self.subscribers.discard(q)

    async def broadcast(self, event_type: str, data: dict, school_id: Optional[str] = None):
        payload = json.dumps({
            "type": event_type,
            "school_id": school_id,
            "data": data
        })
        dead = []
        for q in list(self.subscribers):
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            self.subscribers.discard(q)

    def broadcast_sync(self, event_type: str, data: dict, school_id: Optional[str] = None):
        """Thread-safe event broadcast from synchronous code or webhooks."""
        try:
            target_loop = self.loop
            if not target_loop:
                try:
                    target_loop = asyncio.get_running_loop()
                except RuntimeError:
                    target_loop = None
            if target_loop and target_loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    self.broadcast(event_type, data, school_id),
                    target_loop
                )
            else:
                asyncio.run(self.broadcast(event_type, data, school_id))
        except Exception as e:
            print(f"[EVENT_MANAGER] Broadcast error: {e}")

event_manager = EventManager()

@router.get("/stream")
async def event_stream(request: Request):
    """
    Server-Sent Events (SSE) stream endpoint for real-time frontend updates.
    """
    async def event_generator():
        q = await event_manager.subscribe()
        try:
            # Connection handshake event
            init_payload = json.dumps({"type": "CONNECTED", "message": "Real-time SSE stream connected"})
            yield f"data: {init_payload}\n\n"
            
            while True:
                if await request.is_disconnected():
                    break
                try:
                    # Wait for next event or 15-second heartbeat
                    message = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {message}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat comment to keep connection alive through proxies/ngrok
                    yield ": heartbeat\n\n"
        finally:
            event_manager.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
