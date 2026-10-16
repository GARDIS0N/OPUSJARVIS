"""Jarvis Personal Manager — structured SQLite schedule, priorities, daily briefing, and accountability engine."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from datetime import date as dt_date
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from openjarvis.core.paths import get_config_dir
from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_DAYS_OF_WEEK = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)

_CATEGORY_KEYWORDS = {
    "shift": ("shift", "hospital", "duty", "ward", "night shift", "day shift", "on-call"),
    "class": ("class", "lecture", "seminar", "practical", "tutorial", "campus", "exam"),
    "study": ("study", "revision", "read", "hematology", "chemistry", "microbiology", "histopathology", "anki", "notes"),
    "nestlist": ("nestlist", "landlord", "tenant", "listing", "marketplace", "product", "deploy", "frontend", "backend", "pitch", "founder"),
}


def _infer_category(text: str, explicit: str = "") -> str:
    if explicit and explicit.lower() in ("shift", "class", "study", "nestlist", "personal"):
        return explicit.lower()
    lower = text.lower()
    for cat, keywords in _CATEGORY_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return cat
    return "personal"


def _resolve_day_to_date(day_name: str, base_date: dt_date) -> str:
    target_idx = _DAYS_OF_WEEK.index(day_name.lower())
    delta = (target_idx - base_date.weekday()) % 7
    return (base_date + timedelta(days=delta)).isoformat()


def parse_schedule_text(
    text: str,
    default_date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Parse multi-line natural language or structured schedule entries into structured blocks.

    Supported formats per line:
    - ``2026-10-16 08:00-16:00 [shift] Hospital Lab Shift``
    - ``Monday 09:00-11:00 Class: Hematology Lecture``
    - ``14:00 - 16:30 NestList: Landlord onboarding verification``
    - JSON array of schedule objects
    """
    raw = (text or "").strip()
    if not raw:
        return []

    base_dt = (
        dt_date.fromisoformat(default_date)
        if default_date
        else datetime.now().date()
    )

    if raw.startswith("[") or raw.startswith("{"):
        try:
            parsed_json = json.loads(raw)
            items = parsed_json if isinstance(parsed_json, list) else [parsed_json]
            out: List[Dict[str, Any]] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or item.get("task") or "").strip()
                if not title:
                    continue
                item_date = str(item.get("date") or base_dt.isoformat())
                day_name = str(
                    item.get("day_of_week")
                    or dt_date.fromisoformat(item_date).strftime("%A")
                )
                cat = _infer_category(title, str(item.get("category") or ""))
                out.append(
                    {
                        "date": item_date,
                        "day_of_week": day_name,
                        "start_time": str(item.get("start_time") or "09:00"),
                        "end_time": str(item.get("end_time") or "10:00"),
                        "category": cat,
                        "title": title,
                        "notes": str(item.get("notes") or ""),
                    }
                )
            return out
        except Exception:
            pass

    entries: List[Dict[str, Any]] = []
    line_pattern = re.compile(
        r"^(?:[-*•]\s*)?"
        r"(?:(?P<date>\d{4}-\d{2}-\d{2})\s+|(?P<day>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?"
        r"(?:(?P<start>\d{1,2}:\d{2})\s*(?:-|to|–)\s*(?P<end>\d{1,2}:\d{2})\s*)?"
        r"(?:\[(?P<bracket_cat>[a-zA-Z_]+)\]\s*)?"
        r"(?:(?P<prefix_cat>shift|class|study|nestlist|personal)\s*:\s*)?"
        r"(?P<title>.+)$",
        re.IGNORECASE,
    )

    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        m = line_pattern.match(line)
        if not m:
            continue
        title = m.group("title").strip()
        if not title:
            continue

        if m.group("date"):
            entry_date = m.group("date")
            try:
                day_of_week = dt_date.fromisoformat(entry_date).strftime("%A")
            except ValueError:
                day_of_week = base_dt.strftime("%A")
        elif m.group("day"):
            day_raw = m.group("day").lower()
            entry_date = _resolve_day_to_date(day_raw, base_dt)
            day_of_week = day_raw.capitalize()
        else:
            entry_date = base_dt.isoformat()
            day_of_week = base_dt.strftime("%A")

        start_t = m.group("start") or "09:00"
        end_t = m.group("end") or "10:00"
        if len(start_t) == 4:
            start_t = "0" + start_t
        if len(end_t) == 4:
            end_t = "0" + end_t

        explicit_cat = m.group("bracket_cat") or m.group("prefix_cat") or ""
        category = _infer_category(title, explicit_cat)

        notes = ""
        if " — " in title:
            title, notes = [p.strip() for p in title.split(" — ", 1)]
        elif " - " in title:
            title, notes = [p.strip() for p in title.split(" - ", 1)]

        entries.append(
            {
                "date": entry_date,
                "day_of_week": day_of_week,
                "start_time": start_t,
                "end_time": end_t,
                "category": category,
                "title": title,
                "notes": notes,
            }
        )

    return entries


class JarvisManagerStore:
    """SQLite persistence for schedule blocks, daily top-3 priorities, and accountability."""

    def __init__(self, db_path: str | Path = "") -> None:
        if not db_path:
            db_path = get_config_dir() / "schedule.db"
        self._db_path = str(db_path)
        if self._db_path != ":memory:":
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS schedule_blocks (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    date        TEXT NOT NULL,
                    day_of_week TEXT NOT NULL,
                    start_time  TEXT NOT NULL,
                    end_time    TEXT NOT NULL,
                    category    TEXT NOT NULL DEFAULT 'personal',
                    title       TEXT NOT NULL,
                    notes       TEXT NOT NULL DEFAULT '',
                    completed   INTEGER NOT NULL DEFAULT 0,
                    created_at  REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS daily_priorities (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    date         TEXT NOT NULL,
                    rank         INTEGER NOT NULL,
                    title        TEXT NOT NULL,
                    category     TEXT NOT NULL DEFAULT 'personal',
                    starter_step TEXT NOT NULL DEFAULT '',
                    completed    INTEGER NOT NULL DEFAULT 0,
                    completed_at REAL,
                    created_at   REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS accountability_checkins (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    date            TEXT NOT NULL,
                    timestamp       REAL NOT NULL,
                    status          TEXT NOT NULL,
                    summary         TEXT NOT NULL,
                    jarvis_pushback TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS manager_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            defaults = {
                "codeact_enabled": "false",
                "cloud_fallback_enabled": "false",
                "voice_enabled": "false",
            }
            for k, v in defaults.items():
                self._conn.execute(
                    "INSERT OR IGNORE INTO manager_settings (key, value) VALUES (?, ?)",
                    (k, v),
                )
            self._conn.commit()

    def seed_if_empty(self, today: Optional[str] = None) -> None:
        """Seed initial structured schedule & priorities in SQLite if database is empty."""
        today_str = today or datetime.now().date().isoformat()
        with self._lock:
            count = self._conn.execute("SELECT COUNT(*) FROM schedule_blocks").fetchone()[0]
            if count > 0:
                return
        sample_schedule = "\n".join(
            [
                f"{today_str} 07:30-13:30 [shift] Hospital Laboratory Shift - Hematology & Crossmatch bench",
                f"{today_str} 15:00-16:30 [study] Medical Lab Science - Clinical Chemistry electrolytes & Acid-Base review",
                f"{today_str} 17:00-19:00 [nestlist] NestList - Verify landlord listing onboarding flow & mobile photo upload",
            ]
        )
        self.import_schedule_text(sample_schedule, default_date=today_str)
        self.set_top_priorities(
            [
                {
                    "rank": 1,
                    "title": "Complete Hospital Lab Hematology bench shift & log QC notes",
                    "category": "shift",
                    "starter_step": "Review morning analyzer QC calibration sheet (10 mins)",
                },
                {
                    "rank": 2,
                    "title": "Study Clinical Chemistry: Electrolytes & Arterial Blood Gases",
                    "category": "study",
                    "starter_step": "Do 15 practice flashcards before opening full textbook",
                },
                {
                    "rank": 3,
                    "title": "NestList: Ship landlord verification badge on listing cards",
                    "category": "nestlist",
                    "starter_step": "Open listing card component and wire verified badge prop (20 mins)",
                },
            ],
            date=today_str,
        )

    def import_schedule_text(
        self,
        text: str,
        default_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        parsed = parse_schedule_text(text, default_date=default_date)
        return self.add_schedule_blocks(parsed)

    def add_schedule_blocks(self, blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        now = time.time()
        inserted: List[Dict[str, Any]] = []
        with self._lock:
            for b in blocks:
                b_date = str(b.get("date") or datetime.now().date().isoformat())
                day_of_week = str(
                    b.get("day_of_week")
                    or dt_date.fromisoformat(b_date).strftime("%A")
                )
                start_time = str(b.get("start_time") or "09:00")
                end_time = str(b.get("end_time") or "10:00")
                title = str(b.get("title") or "").strip()
                if not title:
                    continue
                category = _infer_category(title, str(b.get("category") or ""))
                notes = str(b.get("notes") or "")
                cur = self._conn.execute(
                    """
                    INSERT INTO schedule_blocks
                    (date, day_of_week, start_time, end_time, category, title, notes, completed, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                    """,
                    (b_date, day_of_week, start_time, end_time, category, title, notes, now),
                )
                inserted.append(
                    {
                        "id": cur.lastrowid,
                        "date": b_date,
                        "day_of_week": day_of_week,
                        "start_time": start_time,
                        "end_time": end_time,
                        "category": category,
                        "title": title,
                        "notes": notes,
                        "completed": False,
                    }
                )
            self._conn.commit()
        return inserted

    def list_schedule(
        self,
        date: Optional[str] = None,
        month: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            if date:
                rows = self._conn.execute(
                    "SELECT * FROM schedule_blocks WHERE date = ? ORDER BY start_time ASC, id ASC",
                    (date,),
                ).fetchall()
            elif month:
                rows = self._conn.execute(
                    "SELECT * FROM schedule_blocks WHERE date LIKE ? ORDER BY date ASC, start_time ASC",
                    (f"{month}%",),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM schedule_blocks ORDER BY date ASC, start_time ASC LIMIT 100"
                ).fetchall()
        return [
            {
                "id": r["id"],
                "date": r["date"],
                "day_of_week": r["day_of_week"],
                "start_time": r["start_time"],
                "end_time": r["end_time"],
                "category": r["category"],
                "title": r["title"],
                "notes": r["notes"],
                "completed": bool(r["completed"]),
            }
            for r in rows
        ]

    def toggle_schedule_block(
        self,
        block_id: int,
        completed: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM schedule_blocks WHERE id = ?", (block_id,)
            ).fetchone()
            if not row:
                return None
            new_val = int(not bool(row["completed"])) if completed is None else int(completed)
            self._conn.execute(
                "UPDATE schedule_blocks SET completed = ? WHERE id = ?",
                (new_val, block_id),
            )
            self._conn.commit()
            updated = self._conn.execute(
                "SELECT * FROM schedule_blocks WHERE id = ?", (block_id,)
            ).fetchone()
        return {
            "id": updated["id"],
            "date": updated["date"],
            "day_of_week": updated["day_of_week"],
            "start_time": updated["start_time"],
            "end_time": updated["end_time"],
            "category": updated["category"],
            "title": updated["title"],
            "notes": updated["notes"],
            "completed": bool(updated["completed"]),
        }

    def delete_schedule_block(self, block_id: int) -> bool:
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM schedule_blocks WHERE id = ?", (block_id,)
            )
            self._conn.commit()
            return cur.rowcount > 0

    def set_top_priorities(
        self,
        priorities: List[Dict[str, Any]],
        date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        target_date = date or datetime.now().date().isoformat()
        now = time.time()
        with self._lock:
            self._conn.execute(
                "DELETE FROM daily_priorities WHERE date = ?", (target_date,)
            )
            for idx, item in enumerate(priorities[:3], start=1):
                title = str(item.get("title") or "").strip()
                if not title:
                    continue
                rank = int(item.get("rank") or idx)
                cat = _infer_category(title, str(item.get("category") or ""))
                starter = str(
                    item.get("starter_step")
                    or f"Spend 15 focused minutes starting: {title[:50]}"
                )
                completed = int(bool(item.get("completed", False)))
                self._conn.execute(
                    """
                    INSERT INTO daily_priorities
                    (date, rank, title, category, starter_step, completed, completed_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        target_date,
                        rank,
                        title,
                        cat,
                        starter,
                        completed,
                        now if completed else None,
                        now,
                    ),
                )
            self._conn.commit()
        return self.get_top_priorities(target_date)

    def get_top_priorities(self, date: Optional[str] = None) -> List[Dict[str, Any]]:
        target_date = date or datetime.now().date().isoformat()
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM daily_priorities WHERE date = ? ORDER BY rank ASC, id ASC LIMIT 3",
                (target_date,),
            ).fetchall()
        if not rows:
            blocks = self.list_schedule(date=target_date)
            if blocks:
                derived = [
                    {
                        "rank": i + 1,
                        "title": f"{b['title']} ({b['start_time']}–{b['end_time']})",
                        "category": b["category"],
                        "starter_step": b["notes"] or f"Start 15-min sprint on {b['title']}",
                        "completed": b["completed"],
                    }
                    for i, b in enumerate(blocks[:3])
                ]
                return self.set_top_priorities(derived, date=target_date)
        return [
            {
                "id": r["id"],
                "date": r["date"],
                "rank": r["rank"],
                "title": r["title"],
                "category": r["category"],
                "starter_step": r["starter_step"],
                "completed": bool(r["completed"]),
            }
            for r in rows
        ]

    def toggle_priority(
        self,
        priority_id: int,
        completed: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM daily_priorities WHERE id = ?", (priority_id,)
            ).fetchone()
            if not row:
                return None
            new_val = int(not bool(row["completed"])) if completed is None else int(completed)
            self._conn.execute(
                "UPDATE daily_priorities SET completed = ?, completed_at = ? WHERE id = ?",
                (new_val, now if new_val else None, priority_id),
            )
            self._conn.commit()
            updated = self._conn.execute(
                "SELECT * FROM daily_priorities WHERE id = ?", (priority_id,)
            ).fetchone()
        return {
            "id": updated["id"],
            "date": updated["date"],
            "rank": updated["rank"],
            "title": updated["title"],
            "category": updated["category"],
            "starter_step": updated["starter_step"],
            "completed": bool(updated["completed"]),
        }

    def record_checkin(
        self,
        status: str,
        summary: str,
        date: Optional[str] = None,
    ) -> Dict[str, Any]:
        target_date = date or datetime.now().date().isoformat()
        norm_status = status.lower().strip()
        if norm_status not in ("completed", "progress", "slipping", "blocked"):
            norm_status = "progress"

        priorities = self.get_top_priorities(target_date)
        pending = [p for p in priorities if not p["completed"]]
        next_priority = pending[0]["title"] if pending else "your next scheduled block"
        starter_step = (
            pending[0]["starter_step"]
            if pending
            else "Take 15 minutes to review tomorrow's plan."
        )

        if norm_status == "completed":
            feedback = (
                f"Well done, Gardison! Logging '{summary}' as a win. "
                f"Keep that momentum going—{len(pending)} priority item(s) remaining today."
            )
        elif norm_status in ("slipping", "blocked"):
            feedback = (
                f"Hold on, Gardison—I hear you on '{summary}', but let's not let the whole day slide. "
                f"Put distractions away for 20 minutes and do ONLY the starter step for '{next_priority}': "
                f"{starter_step}."
            )
        else:
            feedback = (
                f"Good check-in on '{summary}'. Stay locked in on '{next_priority}' "
                f"for the next 25-minute block before switching context."
            )

        now = time.time()
        with self._lock:
            cur = self._conn.execute(
                """
                INSERT INTO accountability_checkins
                (date, timestamp, status, summary, jarvis_pushback)
                VALUES (?, ?, ?, ?, ?)
                """,
                (target_date, now, norm_status, summary, feedback),
            )
            self._conn.commit()
            checkin_id = cur.lastrowid

        stats = self.get_accountability_stats(target_date)
        return {
            "id": checkin_id,
            "date": target_date,
            "status": norm_status,
            "summary": summary,
            "jarvis_pushback": feedback,
            "stats": stats,
        }

    def get_accountability_stats(self, today: Optional[str] = None) -> Dict[str, Any]:
        target_date = today or datetime.now().date().isoformat()
        with self._lock:
            today_p = self._conn.execute(
                "SELECT COUNT(*) as total, SUM(completed) as done FROM daily_priorities WHERE date = ?",
                (target_date,),
            ).fetchone()
            all_p = self._conn.execute(
                "SELECT COUNT(*) as total, SUM(completed) as done FROM daily_priorities"
            ).fetchone()
            all_b = self._conn.execute(
                "SELECT COUNT(*) as total, SUM(completed) as done FROM schedule_blocks"
            ).fetchone()

            active_dates_rows = self._conn.execute(
                """
                SELECT DISTINCT date FROM (
                    SELECT date FROM daily_priorities WHERE completed = 1
                    UNION
                    SELECT date FROM schedule_blocks WHERE completed = 1
                    UNION
                    SELECT date FROM accountability_checkins WHERE status IN ('completed', 'progress')
                ) ORDER BY date DESC
                """
            ).fetchall()

            recent_rows = self._conn.execute(
                "SELECT * FROM accountability_checkins ORDER BY timestamp DESC LIMIT 10"
            ).fetchall()

        total_today = int(today_p["total"] or 0)
        done_today = int(today_p["done"] or 0)
        total_all = int((all_p["total"] or 0) + (all_b["total"] or 0))
        done_all = int((all_p["done"] or 0) + (all_b["done"] or 0))
        completion_rate = round((done_all / total_all) * 100.0, 1) if total_all > 0 else 0.0
        today_rate = round((done_today / total_today) * 100.0, 1) if total_today > 0 else 0.0

        active_dates = {r["date"] for r in active_dates_rows}
        streak = 0
        cursor = dt_date.fromisoformat(target_date)
        if cursor.isoformat() not in active_dates and (cursor - timedelta(days=1)).isoformat() in active_dates:
            cursor = cursor - timedelta(days=1)
        while cursor.isoformat() in active_dates:
            streak += 1
            cursor -= timedelta(days=1)

        if done_today == total_today and total_today > 0:
            nudge = "All top priorities completed today! Celebrate the win and protect your rest."
        elif done_today == 0 and total_today > 0:
            nudge = "You haven't checked off a top priority yet today. Pick #1 and do a 15-minute starter sprint now."
        else:
            nudge = f"You've finished {done_today}/{total_today} priorities today ({today_rate}%). Keep pushing!"

        return {
            "date": target_date,
            "streak_days": streak,
            "completion_rate": completion_rate,
            "today_completion_rate": today_rate,
            "completed_today": done_today,
            "total_today": total_today,
            "completed_all_time": done_all,
            "total_all_time": total_all,
            "nudge": nudge,
            "recent_checkins": [
                {
                    "id": r["id"],
                    "date": r["date"],
                    "timestamp": r["timestamp"],
                    "status": r["status"],
                    "summary": r["summary"],
                    "jarvis_pushback": r["jarvis_pushback"],
                }
                for r in recent_rows
            ],
        }

    def generate_daily_briefing(self, date: Optional[str] = None) -> Dict[str, Any]:
        target_date = date or datetime.now().date().isoformat()
        self.seed_if_empty(target_date)
        priorities = self.get_top_priorities(target_date)
        schedule = self.list_schedule(date=target_date)
        stats = self.get_accountability_stats(target_date)

        day_label = dt_date.fromisoformat(target_date).strftime("%A, %b %d, %Y")
        lines = [
            f"Good morning, Gardison. Here is your plan for {day_label} (EAT):",
            "",
            "TOP 3 PRIORITIES:",
        ]
        for p in priorities:
            mark = "[DONE]" if p["completed"] else "[TODO]"
            lines.append(
                f"  {p['rank']}. {mark} [{p['category'].upper()}] {p['title']} — Starter: {p['starter_step']}"
            )
        lines.append("")
        lines.append("TODAY'S SCHEDULE:")
        if schedule:
            for b in schedule:
                mark = "✓" if b["completed"] else "•"
                lines.append(
                    f"  {mark} {b['start_time']}–{b['end_time']} ({b['category']}): {b['title']}"
                )
        else:
            lines.append("  • No fixed blocks logged yet. Add your shift, class, or NestList block.")
        lines.append("")
        lines.append(
            f"ACCOUNTABILITY: {stats['streak_days']}-day streak | "
            f"{stats['completion_rate']}% overall completion | {stats['nudge']}"
        )

        return {
            "date": target_date,
            "day_label": day_label,
            "text": "\n".join(lines),
            "priorities": priorities,
            "schedule": schedule,
            "accountability": stats,
        }

    def get_settings(self) -> Dict[str, Any]:
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM manager_settings").fetchall()
        raw = {r["key"]: r["value"] for r in rows}
        soul_path = get_config_dir() / "SOUL.md"
        soul_text = soul_path.read_text(encoding="utf-8") if soul_path.exists() else ""
        return {
            "codeact_enabled": raw.get("codeact_enabled") == "true",
            "cloud_fallback_enabled": raw.get("cloud_fallback_enabled") == "true",
            "voice_enabled": raw.get("voice_enabled") == "true",
            "soul_prompt": soul_text,
            "soul_path": str(soul_path),
        }

    def update_settings(self, **kwargs: Any) -> Dict[str, Any]:
        with self._lock:
            for key in ("codeact_enabled", "cloud_fallback_enabled", "voice_enabled"):
                if key in kwargs and kwargs[key] is not None:
                    val = "true" if bool(kwargs[key]) else "false"
                    self._conn.execute(
                        "INSERT OR REPLACE INTO manager_settings (key, value) VALUES (?, ?)",
                        (key, val),
                    )
            self._conn.commit()
        if "soul_prompt" in kwargs and isinstance(kwargs["soul_prompt"], str):
            soul_path = get_config_dir() / "SOUL.md"
            soul_path.write_text(kwargs["soul_prompt"], encoding="utf-8")
        return self.get_settings()


_STORE_LOCK = threading.Lock()
_DEFAULT_STORE: Optional[JarvisManagerStore] = None


def get_manager_store() -> JarvisManagerStore:
    global _DEFAULT_STORE
    with _STORE_LOCK:
        if _DEFAULT_STORE is None:
            _DEFAULT_STORE = JarvisManagerStore()
            _DEFAULT_STORE.seed_if_empty()
        return _DEFAULT_STORE


# ---------------------------------------------------------------------------
# OpenJarvis Agent Tools
# ---------------------------------------------------------------------------


@ToolRegistry.register("schedule_manage")
class ScheduleManageTool(BaseTool):
    """Manage Gardison's monthly schedule (shifts, classes, study blocks, NestList work)."""

    tool_id = "schedule_manage"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="schedule_manage",
            description=(
                "Read or update Gardison's structured schedule (shifts, classes, study blocks, NestList work). "
                "Actions: 'list' (view today or month), 'add' (parse & save schedule lines), 'complete' (mark block done)."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "One of: 'list', 'add', 'complete'.",
                    },
                    "schedule_text": {
                        "type": "string",
                        "description": "Schedule lines to parse and store (when action='add').",
                    },
                    "date": {
                        "type": "string",
                        "description": "Optional ISO date YYYY-MM-DD.",
                    },
                    "block_id": {
                        "type": "integer",
                        "description": "Schedule block ID to toggle complete (when action='complete').",
                    },
                },
                "required": ["action"],
            },
            category="productivity",
            required_capabilities=["memory:read", "memory:write"],
        )

    def execute(self, **params: Any) -> ToolResult:
        store = get_manager_store()
        action = str(params.get("action") or "list").lower().strip()
        target_date = params.get("date")
        if action == "add":
            text = str(params.get("schedule_text") or "")
            added = store.import_schedule_text(text, default_date=target_date)
            return ToolResult(
                tool_name="schedule_manage",
                content=json.dumps({"added": len(added), "blocks": added}, indent=2),
                success=True,
            )
        if action == "complete":
            block_id = int(params.get("block_id") or 0)
            updated = store.toggle_schedule_block(block_id, completed=True)
            if not updated:
                return ToolResult(
                    tool_name="schedule_manage",
                    content=f"Schedule block {block_id} not found.",
                    success=False,
                )
            return ToolResult(
                tool_name="schedule_manage",
                content=json.dumps(updated, indent=2),
                success=True,
            )
        blocks = store.list_schedule(date=target_date)
        return ToolResult(
            tool_name="schedule_manage",
            content=json.dumps({"blocks": blocks}, indent=2),
            success=True,
        )


@ToolRegistry.register("daily_briefing")
class DailyBriefingTool(BaseTool):
    """Generate Gardison's daily morning briefing from structured SQLite schedule & priorities."""

    tool_id = "daily_briefing"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="daily_briefing",
            description=(
                "Generate today's structured daily briefing including Today's Top 3 Priorities, "
                "shifts/classes/study/NestList schedule blocks, and accountability streak."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Optional ISO date YYYY-MM-DD (defaults to today).",
                    }
                },
                "required": [],
            },
            category="productivity",
            required_capabilities=["memory:read"],
        )

    def execute(self, **params: Any) -> ToolResult:
        store = get_manager_store()
        briefing = store.generate_daily_briefing(date=params.get("date"))
        return ToolResult(
            tool_name="daily_briefing",
            content=briefing["text"],
            success=True,
            metadata=briefing,
        )


@ToolRegistry.register("accountability_checkin")
class AccountabilityCheckinTool(BaseTool):
    """Log an accountability check-in, update streak & completion rate, and get firm/warm feedback."""

    tool_id = "accountability_checkin"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="accountability_checkin",
            description=(
                "Log a daily accountability check-in ('completed', 'progress', 'slipping', or 'blocked') "
                "or view current streak and completion rate."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "One of: 'completed', 'progress', 'slipping', 'blocked', or 'stats'.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "What Gardison finished or what he is procrastinating on.",
                    },
                },
                "required": ["status"],
            },
            category="productivity",
            required_capabilities=["memory:read", "memory:write"],
        )

    def execute(self, **params: Any) -> ToolResult:
        store = get_manager_store()
        status = str(params.get("status") or "stats").lower().strip()
        if status == "stats":
            stats = store.get_accountability_stats()
            return ToolResult(
                tool_name="accountability_checkin",
                content=json.dumps(stats, indent=2),
                success=True,
            )
        summary = str(params.get("summary") or "Check-in update")
        res = store.record_checkin(status=status, summary=summary)
        return ToolResult(
            tool_name="accountability_checkin",
            content=json.dumps(res, indent=2),
            success=True,
        )


# ---------------------------------------------------------------------------
# FastAPI Router for Jarvis Frontend
# ---------------------------------------------------------------------------

jarvis_manager_router = APIRouter(prefix="/api/jarvis", tags=["jarvis-manager"])


class ScheduleImportBody(BaseModel):
    text: str
    date: Optional[str] = None


class PrioritiesSetBody(BaseModel):
    priorities: List[Dict[str, Any]]
    date: Optional[str] = None


class ToggleBody(BaseModel):
    completed: Optional[bool] = None


class CheckinBody(BaseModel):
    status: str = "progress"
    summary: str
    date: Optional[str] = None


class MemoryStoreBody(BaseModel):
    content: str
    source: str = "user_note"


class SettingsUpdateBody(BaseModel):
    codeact_enabled: Optional[bool] = None
    cloud_fallback_enabled: Optional[bool] = None
    voice_enabled: Optional[bool] = None
    soul_prompt: Optional[str] = None


@jarvis_manager_router.get("/overview")
async def get_overview(request: Request, date: Optional[str] = None):
    store = get_manager_store()
    target_date = date or datetime.now().date().isoformat()
    store.seed_if_empty(target_date)
    briefing = store.generate_daily_briefing(target_date)
    settings = store.get_settings()
    model_name = getattr(request.app.state, "model", "qwen3.5:2b")
    engine_name = getattr(request.app.state, "engine_name", "ollama") or "ollama"
    from openjarvis.server.cloud_router import is_cloud_model

    leaves_device = bool(is_cloud_model(model_name) or engine_name == "cloud")
    return {
        "date": target_date,
        "priorities": briefing["priorities"],
        "schedule_today": briefing["schedule"],
        "accountability": briefing["accountability"],
        "briefing_text": briefing["text"],
        "settings": settings,
        "runtime": {
            "model": model_name,
            "engine": engine_name,
            "is_local": not leaves_device,
            "leaves_device_warning": (
                f"Active model '{model_name}' sends requests to a cloud provider."
                if leaves_device
                else ""
            ),
        },
    }


@jarvis_manager_router.get("/priorities")
async def get_priorities(date: Optional[str] = None):
    store = get_manager_store()
    return {"priorities": store.get_top_priorities(date)}


@jarvis_manager_router.post("/priorities")
async def set_priorities(body: PrioritiesSetBody):
    store = get_manager_store()
    return {"priorities": store.set_top_priorities(body.priorities, date=body.date)}


@jarvis_manager_router.patch("/priorities/{priority_id}")
async def patch_priority(priority_id: int, body: ToggleBody):
    store = get_manager_store()
    updated = store.toggle_priority(priority_id, completed=body.completed)
    if not updated:
        raise HTTPException(status_code=404, detail="Priority not found")
    return {
        "priority": updated,
        "accountability": store.get_accountability_stats(updated["date"]),
    }


@jarvis_manager_router.get("/schedule")
async def get_schedule(date: Optional[str] = None, month: Optional[str] = None):
    store = get_manager_store()
    return {"blocks": store.list_schedule(date=date, month=month)}


@jarvis_manager_router.post("/schedule/import")
async def import_schedule(body: ScheduleImportBody):
    store = get_manager_store()
    added = store.import_schedule_text(body.text, default_date=body.date)
    return {"added": len(added), "blocks": added}


@jarvis_manager_router.patch("/schedule/{block_id}")
async def patch_schedule_block(block_id: int, body: ToggleBody):
    store = get_manager_store()
    updated = store.toggle_schedule_block(block_id, completed=body.completed)
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule block not found")
    return {
        "block": updated,
        "accountability": store.get_accountability_stats(updated["date"]),
    }


@jarvis_manager_router.delete("/schedule/{block_id}")
async def remove_schedule_block(block_id: int):
    store = get_manager_store()
    ok = store.delete_schedule_block(block_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Schedule block not found")
    return {"deleted": True}


@jarvis_manager_router.get("/briefing")
async def get_briefing(date: Optional[str] = None):
    store = get_manager_store()
    return store.generate_daily_briefing(date=date)


@jarvis_manager_router.get("/accountability")
async def get_accountability(date: Optional[str] = None):
    store = get_manager_store()
    return store.get_accountability_stats(today=date)


@jarvis_manager_router.post("/checkin")
async def post_checkin(body: CheckinBody):
    store = get_manager_store()
    return store.record_checkin(
        status=body.status,
        summary=body.summary,
        date=body.date,
    )


@jarvis_manager_router.get("/memory")
async def list_memories(query: str = ""):
    from openjarvis.tools.storage.sqlite import SQLiteMemory

    mem = SQLiteMemory(get_config_dir() / "memory.db")
    if query.strip():
        results = mem.retrieve(query, top_k=20)
        items = [
            {
                "id": r.metadata.get("id", ""),
                "content": r.content,
                "source": r.source,
                "score": r.score,
            }
            for r in results
        ]
    else:
        conn = sqlite3.connect(str(get_config_dir() / "memory.db"))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, content, source, created_at FROM documents ORDER BY created_at DESC LIMIT 30"
            ).fetchall()
            items = [
                {
                    "id": r["id"],
                    "content": r["content"],
                    "source": r["source"],
                    "created_at": r["created_at"],
                }
                for r in rows
            ]
        except sqlite3.Error:
            items = []
        finally:
            conn.close()
    return {"items": items, "count": len(items)}


@jarvis_manager_router.post("/memory")
async def store_memory_item(body: MemoryStoreBody):
    from openjarvis.tools.storage.sqlite import SQLiteMemory

    mem = SQLiteMemory(get_config_dir() / "memory.db")
    doc_id = mem.store(body.content, source=body.source)
    return {"id": doc_id, "content": body.content, "source": body.source}


@jarvis_manager_router.delete("/memory/{doc_id}")
async def delete_memory_item(doc_id: str):
    from openjarvis.tools.storage.sqlite import SQLiteMemory

    mem = SQLiteMemory(get_config_dir() / "memory.db")
    deleted = mem.delete(doc_id)
    return {"deleted": deleted}


@jarvis_manager_router.get("/settings")
async def read_manager_settings():
    store = get_manager_store()
    return store.get_settings()


@jarvis_manager_router.post("/settings")
async def write_manager_settings(body: SettingsUpdateBody):
    store = get_manager_store()
    return store.update_settings(
        codeact_enabled=body.codeact_enabled,
        cloud_fallback_enabled=body.cloud_fallback_enabled,
        voice_enabled=body.voice_enabled,
        soul_prompt=body.soul_prompt,
    )
