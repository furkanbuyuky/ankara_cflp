"""Hastane sayısı / bütçe üst sınırı için exact çözüm eğrileri (Sekme 2 slider'ları)."""
from __future__ import annotations

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
) -> dict:
    """kind = "count" | "budget". Önce kısıtsız problem çözülür (p*, B*); sonra sınırın
    her değeri için çözülür. Sınır bağlayıcı değilse kısıtsız çözüm aynen kullanılır."""
    progress = progress or (lambda f, m: None)
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
        sol, info = solve_exact(pb, time_limit=time_limit, start=start)
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
