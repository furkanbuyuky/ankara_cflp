"""Çoklu seed karşılaştırması (Sekme 5). Çalışmalar süreç havuzunda paralel koşar."""
from __future__ import annotations

import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Callable

import numpy as np

from .heuristics.runner import run_full
from .instance import Constraints, Instance, Params, build_problem


def _one(spec: dict, run: dict, seed: int, do_polish: bool) -> dict:
    """Süreç havuzunda çalışır: problemi kendi içinde kurar."""
    pb = build_problem(
        Instance.load(spec["instance"]),
        Params.defaults().with_overrides(spec.get("params")),
        spec["scenario"],
        Constraints(**(spec.get("constraints") or {})),
    )
    t0 = time.perf_counter()
    r = run_full(pb, run["algo"], {**run["config"], "seed": seed}, do_polish=do_polish)
    return {
        "label": run["label"],
        "seed": seed,
        "best": r["best"]["cost"]["total"],
        "polished": r["polished"]["cost"]["total"] if r["polished"] else r["best"]["cost"]["total"],
        "n_open": r["best"]["kpi"]["n_open"],
        "seconds": round(time.perf_counter() - t0, 3),
        "algo_seconds": r["stats"]["seconds"],
        "curve": [[g["evals"], g["best"]] for g in r["generations"]],
    }


def _evals_to_reach(curve: list, target: float) -> int | None:
    for evals, best in curve:
        if best <= target:
            return evals
    return None


def run_benchmark(
    spec: dict,
    runs: list[dict],
    seeds: int,
    reference: float | None,
    do_polish: bool = True,
    progress: Callable[[float, str], None] | None = None,
) -> dict:
    progress = progress or (lambda f, m: None)
    tasks = [(run, s) for run in runs for s in range(seeds)]
    results: list[dict] = []
    # konteynerde os.cpu_count() sunucunun tüm çekirdeklerini gösterebilir; BENCH_WORKERS ile sınırlanır
    limit = int(os.environ.get("BENCH_WORKERS", (os.cpu_count() or 2) - 1))
    workers = max(1, min(len(tasks), limit))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_one, spec, run, s, do_polish) for run, s in tasks]
        for n, f in enumerate(as_completed(futs)):
            results.append(f.result())
            progress((n + 1) / len(tasks), f"{n + 1}/{len(tasks)} çalışma bitti")

    summary = []
    for run in runs:
        rs = sorted([r for r in results if r["label"] == run["label"]], key=lambda r: r["seed"])
        final = np.array([r["polished"] for r in rs])
        dec = np.array([r["best"] for r in rs])
        row = {
            "label": run["label"],
            "algo": run["algo"],
            "config": run["config"],
            "n": len(rs),
            "best": round(float(final.min()), 3),
            "mean": round(float(final.mean()), 3),
            "std": round(float(final.std(ddof=1)) if len(rs) > 1 else 0.0, 3),
            "worst": round(float(final.max()), 3),
            "decoder_mean": round(float(dec.mean()), 3),
            "seconds_mean": round(float(np.mean([r["seconds"] for r in rs])), 3),
            "finals": final.round(3).tolist(),
            "runs": rs,
        }
        if reference:
            row["gap_mean_pct"] = round(float((final.mean() - reference) / reference * 100), 3)
            row["gap_best_pct"] = round(float((final.min() - reference) / reference * 100), 3)
            reach = [_evals_to_reach(r["curve"], reference * 1.01) for r in rs]
            ok = [x for x in reach if x is not None]
            row["reach1_rate"] = round(len(ok) / len(rs), 3)
            row["reach1_evals_mean"] = round(float(np.mean(ok)), 1) if ok else None
        summary.append(row)
    return {"reference": reference, "seeds": seeds, "summary": summary}
