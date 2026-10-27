"""Varsayılan ayarlar için uzun süren sonuçları (exact + sweep) çalışan API üzerinden önceden
hesaplar; böylece UI açılır açılmaz önbellekten gelir.

Kullanım (API çalışırken):  python scripts/precompute.py [--time-limit 60]
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000"


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def get(path: str) -> dict:
    return json.loads(urllib.request.urlopen(BASE + path, timeout=60).read())


def spec(scenario: str) -> dict:
    return {
        "instance": "ankara",
        "scenario": scenario,
        "params": None,
        "constraints": {"max_hospitals": None, "budget_mtl": None, "max_distance_km": None, "min_utilization": None},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--time-limit", type=float, default=60)
    a = ap.parse_args()
    jobs = []
    for sc in ("single", "multi"):
        jobs.append((f"exact {sc}", post("/api/exact", {"spec": spec(sc), "time_limit": a.time_limit})))
    for sc in ("single", "multi"):
        for kind in ("count", "budget"):
            body = {"spec": spec(sc), "kind": kind, "time_limit": 15, "base_time_limit": a.time_limit}
            jobs.append((f"sweep {kind} {sc}", post("/api/sweep", body)))
    pending = dict(jobs)
    while pending:
        for name, j in list(pending.items()):
            s = get(f"/api/jobs/{j['id']}")
            if s["status"] in ("done", "error"):
                print(f"{name}: {s['status']} {'(önbellek)' if s['cached'] else ''} {s.get('error') or ''} {s['elapsed']} sn", flush=True)
                del pending[name]
        time.sleep(5)


if __name__ == "__main__":
    main()
