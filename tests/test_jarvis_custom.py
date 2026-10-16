"""Verification tests for Jarvis Personal AI Manager customizations (Phases 2 & 5)."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from openjarvis.agents._stubs import AgentContext, AgentResult, BaseAgent
from openjarvis.agents.loop_guard import LoopGuard, compute_similarity
from openjarvis.agents.native_openhands import NativeOpenHandsAgent
from openjarvis.core.types import Message, Role
from openjarvis.engine._stubs import InferenceEngine
from openjarvis.engine.ollama import _ollama_request_options
from openjarvis.jarvis_manager import (
    JarvisManagerStore,
    jarvis_manager_router,
    parse_schedule_text,
)
from openjarvis.tools.storage.sqlite import SQLiteMemory


# ---------------------------------------------------------------------------
# 1. Schedule Parsing & Storage Tests
# ---------------------------------------------------------------------------


def test_parse_schedule_text_natural_language() -> None:
    sample_schedule = """
    - 2026-10-16 07:30 - 13:30 [shift] Hospital Lab Shift — Hematology bench
    - 2026-10-16 15:00 - 17:00 [class] MLS Clinical Chemistry Lecture
    - 2026-10-16 18:00 - 19:30 [study] Study Parasitology Notes
    - 2026-10-16 20:00 - 21:30 [nestlist] NestList Landlord Onboarding Flow
    """
    items = parse_schedule_text(sample_schedule)
    assert len(items) == 4
    assert items[0]["date"] == "2026-10-16"
    assert items[0]["start_time"] == "07:30"
    assert items[0]["end_time"] == "13:30"
    assert items[0]["category"] == "shift"
    assert "Hospital Lab Shift" in items[0]["title"]

    assert items[1]["category"] == "class"
    assert items[2]["category"] == "study"
    assert items[3]["category"] == "nestlist"


def test_parse_schedule_text_json() -> None:
    raw_json = """
    [
      {"date": "2026-10-17", "start_time": "08:00", "end_time": "12:00", "title": "NestList Sprint", "category": "nestlist"}
    ]
    """
    items = parse_schedule_text(raw_json)
    assert len(items) == 1
    assert items[0]["title"] == "NestList Sprint"
    assert items[0]["category"] == "nestlist"


def test_schedule_store_and_top_priorities(tmp_path: Path) -> None:
    store = JarvisManagerStore(db_path=tmp_path / "schedule.db")
    today = date.today().isoformat()
    added = store.import_schedule_text(
        f"""
        {today} 08:00-14:00 [shift] Lab Shift at Hospital
        {today} 16:00-18:00 [study] Study Hematology
        {today} 19:30-21:00 [nestlist] NestList Property Verification
        """,
        default_date=today,
    )
    assert len(added) == 3
    blocks = store.list_schedule(date=today)
    assert len(blocks) == 3

    priorities = store.get_top_priorities(date=today)
    assert len(priorities) == 3
    titles = [p["title"] for p in priorities]
    assert any("Lab Shift" in t for t in titles)
    assert any("Study Hematology" in t for t in titles)
    assert any("NestList" in t for t in titles)


# ---------------------------------------------------------------------------
# 2. Daily Briefing & Accountability Tests
# ---------------------------------------------------------------------------


def test_daily_briefing_generation(tmp_path: Path) -> None:
    store = JarvisManagerStore(db_path=tmp_path / "schedule.db")
    today = date.today().isoformat()
    store.import_schedule_text(
        f"{today} 09:00-11:00 [nestlist] NestList Onboarding Polish",
        default_date=today,
    )
    store.set_top_priorities(
        [
            {"title": "Finish NestList landlord verification", "category": "nestlist"},
            {"title": "Review MLS Microbiology flashcards", "category": "study"},
            {"title": "Prep for evening lab shift", "category": "shift"},
        ],
        date=today,
    )
    briefing = store.generate_daily_briefing(date=today)
    assert "Good morning, Gardison" in briefing["text"]
    assert "TOP 3 PRIORITIES" in briefing["text"]
    assert "Finish NestList landlord verification" in briefing["text"]
    assert "NestList Onboarding Polish" in briefing["text"]
    assert len(briefing["priorities"]) == 3


def test_accountability_pushback_and_streak(tmp_path: Path) -> None:
    store = JarvisManagerStore(db_path=tmp_path / "schedule.db")
    today = date.today().isoformat()
    priorities = store.set_top_priorities(
        [
            {"title": "Complete NestList listing form", "category": "nestlist"},
            {"title": "Read 15 pages of Clinical Chemistry", "category": "study"},
        ],
        date=today,
    )

    # 1. Slipping / procrastinating check-in -> firm but kind pushback
    slip_res = store.record_checkin(
        status="slipping",
        summary="Scrolled on my phone instead of starting NestList listing form",
        date=today,
    )
    assert "Hold on, Gardison" in slip_res["jarvis_pushback"]
    assert "20 minutes" in slip_res["jarvis_pushback"]

    # 2. Completing a task -> celebration + streak increment
    store.toggle_priority(priorities[0]["id"], completed=True)
    win_res = store.record_checkin(
        status="completed",
        summary="Complete NestList listing form",
        date=today,
    )
    assert "Well done, Gardison" in win_res["jarvis_pushback"]
    assert win_res["stats"]["streak_days"] >= 1
    assert win_res["stats"]["today_completion_rate"] == 50.0


# ---------------------------------------------------------------------------
# 3. Anti-Repetition Tests (>80% similarity rejection, windowing, repeat_penalty)
# ---------------------------------------------------------------------------


def test_anti_repetition_similarity_rejection() -> None:
    prev = (
        "Good morning Gardison! Today your top three priorities are finishing the "
        "NestList landlord onboarding flow, studying hematology for two hours, and "
        "resting before your night shift."
    )
    nearly_identical = (
        "Good morning Gardison! Today your top three priorities are finishing the "
        "NestList landlord onboarding flow, studying hematology for 2 hours, and "
        "resting before your night shift."
    )
    distinct = (
        "Let's break the NestList onboarding task into a 10-minute starter step: "
        "open the form component and add phone number validation first."
    )

    sim_high = compute_similarity(prev, nearly_identical)
    sim_low = compute_similarity(prev, distinct)
    assert sim_high > 0.80
    assert sim_low < 0.50

    guard = LoopGuard(similarity_threshold=0.80)
    verdict_repeat = guard.check_response(nearly_identical, previous_response=prev)
    assert verdict_repeat.blocked is True
    assert "similar to previous response" in verdict_repeat.reason
    assert verdict_repeat.similarity > 0.80

    verdict_ok = guard.check_response(distinct, previous_response=prev)
    assert verdict_ok.blocked is False


class _RepeatingMockEngine(InferenceEngine):
    """Mock engine that returns a repeated reply first, then a fresh reply on retry."""

    engine_id = "mock"

    def __init__(self, first_reply: str, retry_reply: str) -> None:
        self.first_reply = first_reply
        self.retry_reply = retry_reply
        self.calls: list[dict[str, Any]] = []

    def generate(
        self,
        messages: Any,
        *,
        model: str = "mock",
        temperature: float = 0.7,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append({"messages": list(messages), "kwargs": dict(kwargs)})
        if len(self.calls) == 1:
            return {"content": self.first_reply, "usage": {}}
        return {"content": self.retry_reply, "usage": {}}

    async def stream(
        self,
        messages: Any,
        *,
        model: str = "mock",
        temperature: float = 0.7,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> Any:
        yield self.retry_reply

    def list_models(self) -> list[str]:
        return ["mock"]

    def health(self) -> bool:
        return True


class _DummyAgent(BaseAgent):
    def run(self, input: str, context: AgentContext | None = None, **kwargs: Any) -> AgentResult:
        messages = self._build_messages(
            input,
            context,
            system_prompt="You are Jarvis.",
        )
        res = self._generate(messages)
        return AgentResult(content=res["content"], turns=1)


def test_base_agent_rejects_and_retries_80_percent_similar_reply() -> None:
    prev_reply = (
        "Gardison, focus on your NestList landlord dashboard for the next 25 minutes "
        "and then review your hematology lab notes."
    )
    repeated_reply = (
        "Gardison, focus on your NestList landlord dashboard for the next 25 minutes "
        "and then review your hematology lab notes!"
    )
    fresh_reply = (
        "Great — since the dashboard layout is ready, wire the unit-availability toggle "
        "next and test it on a 360px mobile screen."
    )
    engine = _RepeatingMockEngine(repeated_reply, fresh_reply)
    agent = _DummyAgent(engine, "mock")
    from openjarvis.core.types import Conversation

    conv = Conversation(
        messages=[
            Message(role=Role.USER, content="What should I do now?"),
            Message(role=Role.ASSISTANT, content=prev_reply),
        ]
    )
    ctx = AgentContext(conversation=conv)
    result = agent.run("Okay, what's the next step?", context=ctx)
    assert len(engine.calls) == 2
    assert result.content == fresh_reply


def test_conversation_history_windowing_and_summarization() -> None:
    guard = LoopGuard()
    history = [Message(role=Role.SYSTEM, content="You are Jarvis.")]
    for i in range(16):
        history.append(Message(role=Role.USER, content=f"User question number {i} about NestList and MLS studies"))
        history.append(Message(role=Role.ASSISTANT, content=f"Assistant answer number {i} with action items"))

    compressed = guard.compress_context(history)
    assert len(compressed) < len(history)
    assert any("Earlier conversation summary" in (m.content or "") for m in compressed)


def test_ollama_request_options_includes_repeat_penalty() -> None:
    opts = _ollama_request_options(
        temperature=0.6,
        max_tokens=512,
        kwargs={"repeat_penalty": 1.22},
    )
    assert opts["repeat_penalty"] == pytest.approx(1.22)
    assert opts["temperature"] == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# 4. Long-Term Memory Read/Write Tests
# ---------------------------------------------------------------------------


def test_sqlite_memory_read_write_delete(tmp_path: Path) -> None:
    mem = SQLiteMemory(db_path=tmp_path / "memory.db")
    doc_id = mem.store(
        "Gardison is building NestList, a Kenyan property rental marketplace, while studying Medical Laboratory Science.",
        source="onboarding",
        metadata={"topic": "profile"},
    )
    assert isinstance(doc_id, str) and len(doc_id) > 0

    results = mem.retrieve("NestList Kenyan property rental", top_k=3)
    assert len(results) >= 1
    assert "NestList" in results[0].content
    assert results[0].source == "onboarding"

    deleted = mem.delete(doc_id)
    assert deleted is True
    after = mem.retrieve("NestList Kenyan property rental", top_k=3)
    assert len(after) == 0
    mem.close()


# ---------------------------------------------------------------------------
# 5. CodeAct Permission Toggle & API Router Tests
# ---------------------------------------------------------------------------


def test_codeact_permission_toggle_blocks_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = JarvisManagerStore(db_path=tmp_path / "schedule.db")
    monkeypatch.setattr("openjarvis.jarvis_manager.get_manager_store", lambda: store)

    engine = _RepeatingMockEngine("Hello!", "Hello!")
    agent = NativeOpenHandsAgent(engine, "mock")

    # Blocked when codeact_enabled is False (default)
    res_blocked = agent.run("Calculate 2+2 in Python")
    assert res_blocked.metadata.get("blocked_by_permission_toggle") is True
    assert "CodeAct (`native_openhands`) is currently disabled" in res_blocked.content

    # Allowed after enabling toggle
    store.update_settings(codeact_enabled=True)
    res_allowed = agent.run("Say hello")
    assert res_allowed.metadata.get("blocked_by_permission_toggle") is not True


def test_jarvis_manager_fastapi_endpoints(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import FastAPI

    store = JarvisManagerStore(db_path=tmp_path / "schedule.db")
    monkeypatch.setattr("openjarvis.jarvis_manager.get_manager_store", lambda: store)

    app = FastAPI()
    app.include_router(jarvis_manager_router)
    client = TestClient(app)

    # Set top 3 priorities
    resp = client.post(
        "/api/jarvis/priorities",
        json={
            "priorities": [
                {"title": "Ship NestList search filter", "category": "nestlist"},
                {"title": "Revise Hematology practicals", "category": "study"},
                {"title": "Afternoon Hospital Shift", "category": "shift"},
            ]
        },
    )
    assert resp.status_code == 200
    assert len(resp.json()["priorities"]) == 3

    # Overview endpoint
    ov = client.get("/api/jarvis/overview")
    assert ov.status_code == 200
    data = ov.json()
    assert len(data["priorities"]) == 3
    assert data["settings"]["codeact_enabled"] is False
