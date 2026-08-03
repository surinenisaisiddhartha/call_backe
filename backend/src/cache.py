"""
Small in-process TTL cache.

Why this exists: the database is remote (see db.py), so a query costs tens of
milliseconds of network round trip rather than real work. On the live-call path
— the tool webhooks the voice agent calls mid-conversation — that time is dead
air while a parent waits for an answer. The values cached here (the tools
secret, a school row, a school's knowledge chunks, Cal.com event types) change
rarely, but were being re-read on every single call.

Two properties worth being explicit about:

1. It is PER PROCESS. If the app is ever run with multiple uvicorn workers,
   each worker holds its own copy, and invalidating in one does not touch the
   others. That is why every entry also has a TTL: explicit invalidation makes
   a change appear instantly in the process that made it, and the TTL bounds
   how long any other process can lag.

2. It is deliberately NOT used for anything a caller's decision depends on
   being current — call state, contact status, appointments. Only slow-moving
   configuration and content.
"""
import threading
import time
from typing import Any, Callable, Optional, Tuple

_MISS = object()


class TTLCache:
    """Thread-safe key/value cache with a per-instance time-to-live."""

    def __init__(self, ttl_seconds: float, name: str = ""):
        self.ttl = ttl_seconds
        self.name = name
        self._lock = threading.Lock()
        self._data: dict = {}   # key -> (value, stored_at)
        self.hits = 0
        self.misses = 0

    def get(self, key: Any) -> Any:
        """Returns the cached value, or the module-level _MISS sentinel."""
        now = time.time()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                self.misses += 1
                return _MISS
            value, stored_at = entry
            if now - stored_at >= self.ttl:
                # Expired — drop it so the dict doesn't accumulate dead keys.
                self._data.pop(key, None)
                self.misses += 1
                return _MISS
            self.hits += 1
            return value

    def set(self, key: Any, value: Any) -> None:
        with self._lock:
            self._data[key] = (value, time.time())

    def get_or_load(self, key: Any, loader: Callable[[], Any]) -> Any:
        """
        Returns the cached value, else calls loader() and caches the result.

        The loader runs OUTSIDE the lock: it does database or network I/O, and
        holding a lock across that would serialise every concurrent call —
        exactly the wrong behaviour during simultaneous calls. Two callers
        racing on a cold key may both load; that is harmless duplicate work,
        and far cheaper than blocking.
        """
        value = self.get(key)
        if value is not _MISS:
            return value
        value = loader()
        self.set(key, value)
        return value

    def invalidate(self, key: Any = None) -> None:
        """Drop one key, or everything when key is None."""
        with self._lock:
            if key is None:
                self._data.clear()
            else:
                self._data.pop(key, None)

    def stats(self) -> dict:
        with self._lock:
            total = self.hits + self.misses
            return {
                "name": self.name,
                "entries": len(self._data),
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(self.hits / total, 3) if total else 0.0,
                "ttl_seconds": self.ttl,
            }


# ── The caches themselves ────────────────────────────────────────────────
# TTLs are short enough that a stale value can't outlive a single call, and
# every one of these is also invalidated explicitly when it's written through
# the app.

# Platform settings (tools secret, API keys, dialer config). Read on EVERY
# tool webhook call for the shared-secret check.
settings_cache = TTLCache(ttl_seconds=30, name="settings")

# School rows, keyed by Retell agent id — resolved on every tool call to work
# out which tenant is calling.
school_cache = TTLCache(ttl_seconds=60, name="school")

# A school's knowledge chunks. The whole set is scanned in Python for each
# lookup, so this avoids re-reading every row from a remote database while a
# caller waits. Invalidated whenever the knowledge base is rebuilt.
knowledge_cache = TTLCache(ttl_seconds=300, name="knowledge")

# Cal.com event types, keyed by API key. An external HTTP call that sat in the
# booking path; event types change when someone edits them in Cal.com, not
# during a call.
cal_event_types_cache = TTLCache(ttl_seconds=300, name="cal_event_types")


def invalidate_all() -> None:
    for c in (settings_cache, school_cache, knowledge_cache, cal_event_types_cache):
        c.invalidate()


def all_stats() -> list:
    return [c.stats() for c in (settings_cache, school_cache, knowledge_cache, cal_event_types_cache)]
