"""Presence + per-tile edit-lock collaboration primitives.

The route handlers are exercised directly (like the rest of this suite) so no
HTTP client dependency is required. Collab state is ephemeral module-level
runtime state, so we reset it before each test; TTL expiry is driven by
monkeypatching the module's ``now()`` clock helper.
"""
from __future__ import annotations

import pytest

from app import api, collab, db
from app.api import ClaimIn, PresenceIn, ReleaseIn, StatusIn


@pytest.fixture(autouse=True)
def _fresh_collab():
    collab.reset()
    yield
    collab.reset()


class FakeClock:
    """Monkeypatchable stand-in for ``collab.now``."""

    def __init__(self, start: float = 1_000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, secs: float) -> None:
        self.t += secs


# ------------------------------------------------------------- locking ----
def test_claim_then_second_client_blocked():
    a = api.claim_tile("tileX", ClaimIn(client_id="A", name="Alice"))
    assert a == {"ok": True, "locked_by": {"client_id": "A", "name": "Alice"}}

    b = api.claim_tile("tileX", ClaimIn(client_id="B", name="Bob"))
    assert b["ok"] is False
    assert b["locked_by"] == {"client_id": "A", "name": "Alice"}


def test_release_frees_lock_for_others():
    api.claim_tile("tileX", ClaimIn(client_id="A", name="Alice"))
    assert api.release_tile("tileX", ReleaseIn(client_id="A")) == {"ok": True}

    b = api.claim_tile("tileX", ClaimIn(client_id="B", name="Bob"))
    assert b["ok"] is True
    assert b["locked_by"] == {"client_id": "B", "name": "Bob"}


def test_release_by_non_holder_is_noop():
    api.claim_tile("tileX", ClaimIn(client_id="A", name="Alice"))
    # B does not hold it -> no-op, still ok:true, and A keeps the lock.
    assert api.release_tile("tileX", ReleaseIn(client_id="B")) == {"ok": True}
    b = api.claim_tile("tileX", ClaimIn(client_id="B", name="Bob"))
    assert b["ok"] is False
    assert b["locked_by"]["client_id"] == "A"


def test_claim_by_same_client_refreshes():
    api.claim_tile("tileX", ClaimIn(client_id="A", name="Alice"))
    again = api.claim_tile("tileX", ClaimIn(client_id="A", name="Alice"))
    assert again["ok"] is True


# ------------------------------------------------------------ presence ----
def test_presence_returns_all_users_and_their_tiles():
    api.post_presence(PresenceIn(client_id="A", name="Alice", tile="tileX"))
    state = api.post_presence(PresenceIn(client_id="B", name="Bob", tile="tileY"))

    users = {u["client_id"]: u for u in state["users"]}
    assert set(users) == {"A", "B"}
    assert users["A"]["tile"] == "tileX"
    assert users["B"]["tile"] == "tileY"
    assert all("idle_secs" in u for u in state["users"])

    locks = {lock["tile"]: lock for lock in state["locks"]}
    assert locks["tileX"]["client_id"] == "A"
    assert locks["tileY"]["client_id"] == "B"


def test_presence_heartbeat_does_not_steal_lock():
    # B holds tileX; A heartbeats claiming tileX -> must NOT steal it.
    api.claim_tile("tileX", ClaimIn(client_id="B", name="Bob"))
    api.post_presence(PresenceIn(client_id="A", name="Alice", tile="tileX"))
    state = api.get_presence()
    locks = {lock["tile"]: lock for lock in state["locks"]}
    assert locks["tileX"]["client_id"] == "B"


def test_get_presence_is_read_only():
    api.post_presence(PresenceIn(client_id="A", name="Alice", tile="tileX"))
    snap = api.get_presence()
    assert {u["client_id"] for u in snap["users"]} == {"A"}


# ----------------------------------------------------------- TTL expiry ----
def test_expired_lock_becomes_claimable(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(collab, "now", clock)

    api.claim_tile("tileX", ClaimIn(client_id="A", name="Alice"))
    # Before expiry: B is blocked.
    assert api.claim_tile("tileX", ClaimIn(client_id="B", name="Bob"))["ok"] is False

    clock.advance(collab.TTL_LOCK + 1)
    # A never heartbeat/refreshed -> lock pruned -> B can now claim.
    b = api.claim_tile("tileX", ClaimIn(client_id="B", name="Bob"))
    assert b["ok"] is True
    assert b["locked_by"]["client_id"] == "B"


def test_expired_presence_drops_off(monkeypatch):
    clock = FakeClock()
    monkeypatch.setattr(collab, "now", clock)

    api.post_presence(PresenceIn(client_id="A", name="Alice", tile="tileX"))
    clock.advance(collab.TTL_PRESENCE + 1)
    snap = api.get_presence()
    assert snap["users"] == []
    assert snap["locks"] == []


# -------------------------------------------------- verify releases lock ----
def test_verify_status_auto_releases_lock():
    db.init_db()
    tile = "verify_release.tif"
    api.claim_tile(tile, ClaimIn(client_id="A", name="Alice"))
    api.put_status(tile, StatusIn(status="verified", updated_by="Alice"))
    # Lock freed: B can now claim.
    b = api.claim_tile(tile, ClaimIn(client_id="B", name="Bob"))
    assert b["ok"] is True


def test_non_verify_status_keeps_lock():
    db.init_db()
    tile = "keep_lock.tif"
    api.claim_tile(tile, ClaimIn(client_id="A", name="Alice"))
    api.put_status(tile, StatusIn(status="in_progress", updated_by="Alice"))
    b = api.claim_tile(tile, ClaimIn(client_id="B", name="Bob"))
    assert b["ok"] is False
    assert b["locked_by"]["client_id"] == "A"
