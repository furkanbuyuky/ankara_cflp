"""Hastane sayısı / bütçe üst sınırı için exact çözüm eğrileri (Sekme 2 slider'ları)."""
from __future__ import annotations

import time
from dataclasses import replace
from typing import Callable

import numpy as np

from .exact import solve_exact
from .heuristics.ga import GAConfig, run_ga
from .instance import Constraints, Problem, with_constraints
from .solution import solution_to_dict


def _point(problem: Problem, sol, info, value) -> dict:
    return {"value": value, **solution_to_dict(problem, sol), "solver": info.to_dict()}


def run_sweep(
    problem: Problem,
    kind: str,
    time_limit: float = 15.0,
    base_time_limit: float = 60.0,
    n_budget_points: int = 16,
    extra_count: int = 3,
    progress: Callable[[float, str], None] | None = None,
    total_budget: float | None = None,
) -> dict:
    """kind = "count" | "budget". Önce kısıtsız problem çözülür (p*, B*); sonra sınırın
    her değeri için çözülür. Sınır bağlayıcı değilse kısıtsız çözüm aynen kullanılır.
    `total_budget` (sn) verilirse nokta başına süre kalan bütçeye göre kısaltılır."""
    progress = progress or (lambda f, m: None)
    t0 = time.perf_counter()
    progress(0.0, "Kısıtsız problem çözülüyor")
    base_sol, base_info = solve_exact(problem, time_limit=base_time_limit)
    p_star = int(np.count_nonzero(base_sol.genes))
    b_star = base_sol.investment

    if kind == "count":
        values: list = list(range(1, p_star + extra_count + 1))
    elif kind == "budget":
        cheapest = float(np.nanmin(problem.invest))
        values = [round(float(v), 1) for v in np.linspace(cheapest, b_star * 1.2, n_budget_points)]
    else:
        raise ValueError(f"Bilinmeyen sweep türü: {kind}")

    points = []
    prev = None
    n_binding = sum(1 for v in values if (v < p_star if kind == "count" else v < b_star))
    done_binding = 0
    for n, v in enumerate(values):
        progress((n + 1) / (len(values) + 1), f"{'p' if kind == 'count' else 'B'} = {v}")
        binding = v < p_star if kind == "count" else v < b_star
        if not binding:
            points.append({**_point(problem, base_sol, base_info, v), "binding": False})
            continue
        c = replace(problem.constraints, **({"max_hospitals": v} if kind == "count" else {"budget_mtl": v}))
        pb = with_constraints(problem, c)
        # başlangıç çözümü: kısıtlı problemde hızlı bir GA (önceki noktayla da yarıştırılır)
        ga, _ = run_ga(pb, GAConfig(pop_size=30, max_evals=2500, seed=n))
        start = ga if prev is None or ga.total <= prev.total else prev
        tl = time_limit
        if total_budget is not None:
            left = total_budget - (time.perf_counter() - t0)
            tl = max(1.0, min(time_limit, left / max(1, n_binding - done_binding) - 1.5))
        sol, info = solve_exact(pb, time_limit=tl, start=start)
        done_binding += 1
        prev = sol
        points.append({**_point(pb, sol, info, v), "binding": True})
    progress(1.0, "Tamamlandı")
    return {
        "kind": kind,
        "p_star": p_star,
        "b_star": round(b_star, 1),
        "base": _point(problem, base_sol, base_info, None),
        "points": points,
    }
