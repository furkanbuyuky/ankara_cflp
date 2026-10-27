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


# Arayüzün varsayılan istekleriyle birebir aynı gövdeler (önbellek anahtarı bunlara göre oluşur)
PRESETS = {
    "GA · Turnuva": ("ga", {"selection": "tournament", "crossover": "one_point"}),
    "GA · Rulet": ("ga", {"selection": "roulette", "crossover": "one_point"}),
    "GA · Rank": ("ga", {"selection": "rank", "crossover": "one_point"}),
    "DE · rand/1": ("de", {"strategy": "rand1"}),
}


def wait(jobs: list[tuple[str, dict]]) -> dict:
    pending, results = dict(jobs), {}
    while pending:
        for name, j in list(pending.items()):
            s = get(f"/api/jobs/{j['id']}")
            if s["status"] in ("done", "error"):
                print(f"{name}: {s['status']} {'(önbellek)' if s['cached'] else ''} {s.get('error') or ''} {s['elapsed']} sn", flush=True)
                results[name] = s.get("result")
                del pending[name]
        time.sleep(3)
    return results


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--time-limit", type=float, default=60)
    a = ap.parse_args()
    scenarios = ("single", "multi")

    exact = wait([(sc, post("/api/exact", {"spec": spec(sc), "time_limit": a.time_limit})) for sc in scenarios])

    def run(label: str, extra: dict) -> dict:
        algo, cfg = PRESETS[label]
        return {"label": label, "algo": algo, "config": {**cfg, **extra}}

    # Sekme 4 varsayılanı: GA · Turnuva, GA · Rulet, DE · rand/1; 10.000 değerlendirme, seed 0
    jobs = []
    for sc in scenarios:
        runs = [run(lbl, {"max_evals": 10000, "seed": 0}) for lbl in ("GA · Turnuva", "GA · Rulet", "DE · rand/1")]
        jobs.append((f"optimize {sc}", post("/api/optimize", {"spec": spec(sc), "runs": runs, "polish": True})))
    for sc in scenarios:
        for kind in ("count", "budget"):
            body = {"spec": spec(sc), "kind": kind, "time_limit": 15, "base_time_limit": a.time_limit}
            jobs.append((f"sweep {kind} {sc}", post("/api/sweep", body)))
    wait(jobs)

    # Sekme 5 varsayılanı: 4 konfigürasyon × 10 seed, referans = exact en iyi
    for sc in scenarios:
        ref = exact[sc]["solution"]["cost"]["total"] if exact.get(sc) else None
        body = {"spec": spec(sc), "runs": [run(lbl, {}) for lbl in PRESETS], "seeds": 10, "max_evals": 10000,
                "polish": True, "reference": ref}
        wait([(f"benchmark {sc}", post("/api/benchmark", body))])


if __name__ == "__main__":
    main()
