"""Real-time collaboration primitives: presence + per-tile edit locks.

Ephemeral, in-memory runtime state -- NOT persisted to the DB or disk. The app
runs as a single uvicorn process (no ``--workers``), so shared in-memory
registries are valid; a module-level ``threading.Lock`` guards them for safety.

Two registries, both pruned of expired entries on every access:

Presence
    ``client_id -> {name, tile, last_seen}``. Clients heartbeat via
    ``POST /api/presence``; an entry older than ``TTL_PRESENCE`` seconds is
    considered offline and dropped.

Locks
    ``tile_name -> {client_id, name, ts}``. A tile may be actively edited by
    only one client. A lock is refreshed by heartbeat/claim and auto-expires
    after ``TTL_LOCK`` seconds of no refresh.

The wall clock is read through the module-level ``now()`` helper so tests can
monkeypatch it (or ``app.collab.time.time``) to exercise TTL expiry.
"""
from __future__ import annotations

import threading
import time
from typing import Any

TTL_PRESENCE = 20.0  # seconds a presence entry survives without a heartbeat
TTL_LOCK = 20.0  # seconds a lock survives without a refresh

_lock = threading.Lock()

# client_id -> {"name": str, "tile": str | None, "last_seen": float}
_presence: dict[str, dict[str, Any]] = {}
# tile_name -> {"client_id": str, "name": str, "ts": float}
_locks: dict[str, dict[str, Any]] = {}


def now() -> float:
    """Current wall-clock time in seconds. Patchable in tests."""
    return time.time()


def reset() -> None:
    """Clear all runtime state (test helper)."""
    with _lock:
        _presence.clear()
        _locks.clear()


def _prune_locked(ts: float) -> None:
    """Drop expired presence + lock entries. Caller must hold ``_lock``."""
    for cid in [c for c, e in _presence.items() if ts - e["last_seen"] > TTL_PRESENCE]:
        del _presence[cid]
    for tile in [t for t, e in _locks.items() if ts - e["ts"] > TTL_LOCK]:
        del _locks[tile]


def _snapshot_locked() -> dict[str, Any]:
    """Build the public live-state snapshot. Caller must hold ``_lock``."""
    ts = now()
    users = [
        {
            "client_id": cid,
            "name": e["name"],
            "tile": e["tile"],
            "idle_secs": round(ts - e["last_seen"], 3),
        }
        for cid, e in _presence.items()
    ]
    locks = [
        {"tile": tile, "client_id": e["client_id"], "name": e["name"]}
        for tile, e in _locks.items()
    ]
    return {"users": users, "locks": locks}


def heartbeat(client_id: str, name: str, tile: str | None = None) -> dict[str, Any]:
    """Upsert presence (this IS the heartbeat) and return the live state.

    Updates ``last_seen`` and the client's current tile. If ``tile`` is set,
    refreshes that client's lock on it -- but never steals a lock held by
    another client.
    """
    ts = now()
    with _lock:
        _prune_locked(ts)
        _presence[client_id] = {"name": name, "tile": tile, "last_seen": ts}
        if tile:
            holder = _locks.get(tile)
            if holder is None or holder["client_id"] == client_id:
                _locks[tile] = {"client_id": client_id, "name": name, "ts": ts}
        return _snapshot_locked()


def snapshot() -> dict[str, Any]:
    """Read-only live-state snapshot (prunes expired entries, no upsert)."""
    with _lock:
        _prune_locked(now())
        return _snapshot_locked()


def claim(tile: str, client_id: str, name: str) -> dict[str, Any]:
    """Acquire the tile's edit lock if free or already held by this client.

    Returns ``{"ok": bool, "locked_by": {"client_id", "name"} | None}``.
    ``ok`` is true when the caller now holds the lock; if held by someone else,
    ``ok`` is false and ``locked_by`` is the other holder.
    """
    ts = now()
    with _lock:
        _prune_locked(ts)
        holder = _locks.get(tile)
        if holder is not None and holder["client_id"] != client_id:
            return {
                "ok": False,
                "locked_by": {
                    "client_id": holder["client_id"],
                    "name": holder["name"],
                },
            }
        _locks[tile] = {"client_id": client_id, "name": name, "ts": ts}
        return {"ok": True, "locked_by": {"client_id": client_id, "name": name}}


def release(tile: str, client_id: str) -> dict[str, Any]:
    """Release the tile's lock IF this client holds it (no-op otherwise)."""
    ts = now()
    with _lock:
        _prune_locked(ts)
        holder = _locks.get(tile)
        if holder is not None and holder["client_id"] == client_id:
            del _locks[tile]
        return {"ok": True}


def release_any(tile: str) -> None:
    """Force-release a tile's lock regardless of holder (verify hook)."""
    with _lock:
        _prune_locked(now())
        _locks.pop(tile, None)


def locks_by_tile() -> dict[str, dict[str, str]]:
    """Map ``tile_name -> {"client_id", "name"}`` for all non-expired locks."""
    with _lock:
        _prune_locked(now())
        return {
            tile: {"client_id": e["client_id"], "name": e["name"]}
            for tile, e in _locks.items()
        }
