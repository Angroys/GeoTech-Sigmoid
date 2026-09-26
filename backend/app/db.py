"""SQLite persistence layer (stdlib sqlite3).

Schema
------
tiles(name PK, verification_status, updated_at, updated_by)
    verification_status in {unchecked, in_progress, verified} default unchecked
annotations(id PK, tile_name FK, label, shape_type, points, attributes,
            source, occluded, z_order)
    points     : JSON array of [x, y] float pairs
    attributes : JSON object {attr_name: value}
    shape_type : one of {polygon, polyline, box}
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from . import config

VALID_STATUS = {"unchecked", "in_progress", "verified"}
VALID_SHAPE = {"polygon", "polyline", "box"}

_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create tables if they do not exist (idempotent migrate)."""
    with _lock, get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tiles (
                name                TEXT PRIMARY KEY,
                verification_status TEXT NOT NULL DEFAULT 'unchecked',
                updated_at          TEXT,
                updated_by          TEXT
            );
            CREATE TABLE IF NOT EXISTS annotations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tile_name  TEXT NOT NULL,
                label      TEXT NOT NULL,
                shape_type TEXT NOT NULL,
                points     TEXT NOT NULL DEFAULT '[]',
                attributes TEXT NOT NULL DEFAULT '{}',
                source     TEXT NOT NULL DEFAULT 'manual',
                occluded   INTEGER NOT NULL DEFAULT 0,
                z_order    INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (tile_name) REFERENCES tiles(name) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ann_tile ON annotations(tile_name);
            """
        )


# ---------------------------------------------------------------- tiles ----
def ensure_tile(name: str, conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or get_conn()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO tiles(name, verification_status, updated_at) "
            "VALUES (?, 'unchecked', ?)",
            (name, _now()),
        )
        if own:
            conn.commit()
    finally:
        if own:
            conn.close()


def sync_tiles(names: Iterable[str]) -> None:
    """Register any tile filenames not yet in the DB."""
    with _lock, get_conn() as conn:
        for name in names:
            ensure_tile(name, conn)


def get_tile_status(name: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM tiles WHERE name = ?", (name,)).fetchone()
        return dict(row) if row else None


def set_tile_status(name: str, status: str, updated_by: str | None = None) -> dict[str, Any]:
    if status not in VALID_STATUS:
        raise ValueError(f"invalid status {status!r}; expected one of {sorted(VALID_STATUS)}")
    with _lock, get_conn() as conn:
        ensure_tile(name, conn)
        conn.execute(
            "UPDATE tiles SET verification_status = ?, updated_at = ?, updated_by = ? "
            "WHERE name = ?",
            (status, _now(), updated_by, name),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tiles WHERE name = ?", (name,)).fetchone()
        return dict(row)


def annotation_counts() -> dict[str, int]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT tile_name, COUNT(*) c FROM annotations GROUP BY tile_name"
        ).fetchall()
        return {r["tile_name"]: r["c"] for r in rows}


def status_counts() -> dict[str, int]:
    out = {"unchecked": 0, "in_progress": 0, "verified": 0}
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT verification_status s, COUNT(*) c FROM tiles GROUP BY verification_status"
        ).fetchall()
        for r in rows:
            out[r["s"]] = r["c"]
    return out


# ---------------------------------------------------------- annotations ----
def _row_to_ann(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "tile_name": row["tile_name"],
        "label": row["label"],
        "shape_type": row["shape_type"],
        "points": json.loads(row["points"]),
        "attributes": json.loads(row["attributes"]),
        "source": row["source"],
        "occluded": row["occluded"],
        "z_order": row["z_order"],
    }


def list_annotations(tile_name: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM annotations WHERE tile_name = ? ORDER BY id", (tile_name,)
        ).fetchall()
        return [_row_to_ann(r) for r in rows]


def get_annotation(ann_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM annotations WHERE id = ?", (ann_id,)).fetchone()
        return _row_to_ann(row) if row else None


def _validate_shape(shape_type: str) -> None:
    if shape_type not in VALID_SHAPE:
        raise ValueError(
            f"invalid shape_type {shape_type!r}; expected one of {sorted(VALID_SHAPE)}"
        )


def create_annotation(
    tile_name: str,
    label: str,
    shape_type: str,
    points: list[list[float]],
    attributes: dict[str, Any] | None = None,
    source: str = "manual",
    occluded: int = 0,
    z_order: int = 0,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    _validate_shape(shape_type)
    own = conn is None
    conn = conn or get_conn()
    try:
        ensure_tile(tile_name, conn)
        cur = conn.execute(
            "INSERT INTO annotations(tile_name, label, shape_type, points, attributes, "
            "source, occluded, z_order) VALUES (?,?,?,?,?,?,?,?)",
            (
                tile_name,
                label,
                shape_type,
                json.dumps(points),
                json.dumps(attributes or {}),
                source,
                int(occluded),
                int(z_order),
            ),
        )
        if own:
            conn.commit()
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM annotations WHERE id = ?", (new_id,)).fetchone()
        return _row_to_ann(row)
    finally:
        if own:
            conn.close()


def update_annotation(ann_id: int, **fields: Any) -> dict[str, Any] | None:
    allowed = {"label", "shape_type", "points", "attributes", "source", "occluded", "z_order"}
    sets: list[str] = []
    vals: list[Any] = []
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        if key == "shape_type":
            _validate_shape(value)
        if key in ("points", "attributes"):
            value = json.dumps(value)
        elif key in ("occluded", "z_order"):
            value = int(value)
        sets.append(f"{key} = ?")
        vals.append(value)
    if not sets:
        return get_annotation(ann_id)
    with _lock, get_conn() as conn:
        vals.append(ann_id)
        conn.execute(f"UPDATE annotations SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
        row = conn.execute("SELECT * FROM annotations WHERE id = ?", (ann_id,)).fetchone()
        return _row_to_ann(row) if row else None


def delete_annotation(ann_id: int) -> bool:
    with _lock, get_conn() as conn:
        cur = conn.execute("DELETE FROM annotations WHERE id = ?", (ann_id,))
        conn.commit()
        return cur.rowcount > 0


def replace_annotations(tile_name: str, annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Atomically replace the full annotation set for a tile."""
    with _lock, get_conn() as conn:
        ensure_tile(tile_name, conn)
        conn.execute("DELETE FROM annotations WHERE tile_name = ?", (tile_name,))
        for ann in annotations:
            create_annotation(
                tile_name=tile_name,
                label=ann["label"],
                shape_type=ann["shape_type"],
                points=ann.get("points", []),
                attributes=ann.get("attributes", {}),
                source=ann.get("source", "manual"),
                occluded=ann.get("occluded", 0),
                z_order=ann.get("z_order", 0),
                conn=conn,
            )
        conn.commit()
    return list_annotations(tile_name)


def all_tiles_with_annotations() -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT tile_name FROM annotations ORDER BY tile_name"
        ).fetchall()
        return [r["tile_name"] for r in rows]
