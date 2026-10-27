"""Arka plan işleri ve disk önbelleği.

Uzun süren hesaplar (exact, sweep, optimize, benchmark) iş olarak başlatılır; frontend
GET /api/jobs/{id} ile ilerlemeyi sorar. Sonuçlar istek içeriğinin hash'iyle diske yazılır;
aynı istek tekrar gelirse anında döner.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "cache"
CACHE_VERSION = "v1"


def cache_key(kind: str, payload: dict) -> str:
    raw = json.dumps({"kind": kind, "v": CACHE_VERSION, **payload}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def cache_get(kind: str, key: str) -> Any | None:
    path = CACHE / kind / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def cache_put(kind: str, key: str, value: Any) -> None:
    path = CACHE / kind / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    message: str = ""
    result: Any = None
    error: str | None = None
    cached: bool = False
    started: float = field(default_factory=time.time)
    partial: Any = None  # ör. optimize sırasında biten çalışmalar

    def public(self, with_result: bool = True) -> dict:
        d = {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 4),
            "message": self.message,
            "cached": self.cached,
            "elapsed": round(time.time() - self.started, 1),
            "error": self.error,
        }
        if with_result and self.status == "done":
            d["result"] = self.result
        return d


class JobManager:
    def __init__(self, workers: int = 2):
        self.pool = ThreadPoolExecutor(max_workers=workers)
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.inflight: dict[str, str] = {}  # cache key → job id (aynı iş iki kez başlamasın)

    def submit(self, kind: str, payload: dict, fn: Callable[[Job], Any]) -> Job:
        key = cache_key(kind, payload)
        with self.lock:
            if key in self.inflight and self.jobs[self.inflight[key]].status in ("queued", "running"):
                return self.jobs[self.inflight[key]]
            job = Job(id=uuid.uuid4().hex[:12], kind=kind)
            self.jobs[job.id] = job
            cached = cache_get(kind, key)
            if cached is not None:
                job.status, job.progress, job.result, job.cached = "done", 1.0, cached, True
                return job
            self.inflight[key] = job.id

        def run():
            job.status = "running"
            try:
                job.result = fn(job)
                cache_put(kind, key, job.result)
                job.progress, job.status = 1.0, "done"
            except Exception as e:  # noqa: BLE001
                job.status, job.error = "error", f"{type(e).__name__}: {e}"
                traceback.print_exc()

        self.pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)
