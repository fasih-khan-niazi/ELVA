import json
import os
import sqlite3
import threading
import time
from typing import Dict, List


class ConversationStore:
    # Sessions idle for longer than this are purged automatically.
    SESSION_TTL_DAYS: int = int(os.environ.get("SESSION_TTL_DAYS", "7"))
    # How often the cleanup thread wakes up (seconds).
    _CLEANUP_INTERVAL_SEC: int = 6 * 60 * 60  # 6 hours

    def __init__(self, db_path: str = None) -> None:
        self.db_path = db_path or os.environ.get("AI_SESSION_DB", "./ai_sessions.db")
        self._lock = threading.Lock()
        self._initialize()
        self._start_cleanup_thread()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS conversation_turns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_state (
                    session_id TEXT PRIMARY KEY,
                    in_scope INTEGER NOT NULL DEFAULT 0,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS order_state (
                    session_id TEXT PRIMARY KEY,
                    order_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'idle',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lead_state (
                    session_id TEXT PRIMARY KEY,
                    lead_json TEXT NOT NULL DEFAULT '{}',
                    captured INTEGER NOT NULL DEFAULT 0,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id, id)"
            )
            conn.commit()

    def load_history(self, session_id: str, limit: int = 60) -> List[Dict[str, str]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT role, content
                FROM conversation_turns
                WHERE session_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()

        turns = [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]
        return turns

    def append_turn(self, session_id: str, role: str, content: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO conversation_turns(session_id, role, content) VALUES (?, ?, ?)",
                (session_id, role, content),
            )
            conn.commit()

    def prune_history(self, session_id: str, keep_last: int = 120) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                DELETE FROM conversation_turns
                WHERE session_id = ?
                  AND id NOT IN (
                      SELECT id FROM conversation_turns
                      WHERE session_id = ?
                      ORDER BY id DESC
                      LIMIT ?
                  )
                """,
                (session_id, session_id, keep_last),
            )
            conn.commit()

    def get_session_state(self, session_id: str) -> Dict[str, bool]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT in_scope FROM session_state WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            return {"in_scope": False}
        return {"in_scope": bool(row["in_scope"]) }

    def set_session_state(self, session_id: str, in_scope: bool) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO session_state(session_id, in_scope, updated_at)
                VALUES(?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id)
                DO UPDATE SET in_scope = excluded.in_scope, updated_at = CURRENT_TIMESTAMP
                """,
                (session_id, 1 if in_scope else 0),
            )
            conn.commit()

    def get_health(self) -> Dict[str, int]:
        with self._lock, self._connect() as conn:
            turns_count = conn.execute("SELECT COUNT(*) as c FROM conversation_turns").fetchone()["c"]
            sessions_count = conn.execute("SELECT COUNT(*) as c FROM session_state").fetchone()["c"]
        return {"turns": int(turns_count), "sessions": int(sessions_count)}

    # --- Order State ---
    def get_order_state(self, session_id: str) -> Dict:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT order_json, status FROM order_state WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            return {"items": [], "status": "idle", "customer": {}}
        try:
            data = json.loads(row["order_json"])
        except (json.JSONDecodeError, TypeError):
            data = {}
        data["status"] = row["status"]
        return data

    def set_order_state(self, session_id: str, order_data: Dict, status: str = "collecting") -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO order_state(session_id, order_json, status, updated_at)
                VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id)
                DO UPDATE SET order_json = excluded.order_json, status = excluded.status, updated_at = CURRENT_TIMESTAMP
                """,
                (session_id, json.dumps(order_data), status),
            )
            conn.commit()

    def clear_order_state(self, session_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "DELETE FROM order_state WHERE session_id = ?",
                (session_id,),
            )
            conn.commit()

    # --- Lead State ---
    def get_lead_state(self, session_id: str) -> Dict:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT lead_json, captured FROM lead_state WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            return {"captured": False, "data": {}}
        try:
            data = json.loads(row["lead_json"])
        except (json.JSONDecodeError, TypeError):
            data = {}
        return {"captured": bool(row["captured"]), "data": data}

    def set_lead_state(self, session_id: str, lead_data: Dict, captured: bool = True) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO lead_state(session_id, lead_json, captured, updated_at)
                VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id)
                DO UPDATE SET lead_json = excluded.lead_json, captured = excluded.captured, updated_at = CURRENT_TIMESTAMP
                """,
                (session_id, json.dumps(lead_data), 1 if captured else 0),
            )
            conn.commit()

    # --- TTL cleanup ---

    def cleanup_old_sessions(self, ttl_days: int = None) -> int:
        """Delete all rows belonging to sessions idle for longer than `ttl_days`.
        Returns the number of session IDs purged."""
        days = ttl_days if ttl_days is not None else self.SESSION_TTL_DAYS
        with self._lock, self._connect() as conn:
            # Collect stale session IDs (based on the most recently touched state table).
            stale = conn.execute(
                """
                SELECT session_id FROM session_state
                WHERE updated_at < DATETIME('now', ? || ' days')
                """,
                (f"-{days}",),
            ).fetchall()
            stale_ids = [row["session_id"] for row in stale]

            if not stale_ids:
                return 0

            placeholders = ",".join("?" * len(stale_ids))
            for table in ("conversation_turns", "session_state", "order_state", "lead_state"):
                conn.execute(
                    f"DELETE FROM {table} WHERE session_id IN ({placeholders})",
                    stale_ids,
                )
            conn.commit()

        print(f"[ConversationStore] Purged {len(stale_ids)} stale session(s) older than {days} day(s).")
        return len(stale_ids)

    def _start_cleanup_thread(self) -> None:
        def _loop() -> None:
            # Sleep first so startup isn't slowed by immediate DB work.
            time.sleep(60)
            while True:
                try:
                    self.cleanup_old_sessions()
                except Exception as exc:
                    print(f"[ConversationStore] Cleanup error: {exc}")
                time.sleep(self._CLEANUP_INTERVAL_SEC)

        t = threading.Thread(target=_loop, daemon=True, name="session-ttl-cleanup")
        t.start()
