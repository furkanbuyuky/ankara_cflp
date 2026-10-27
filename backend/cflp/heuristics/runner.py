"""Algoritmaları isimle çalıştırma ve "polish" adımı."""
from __future__ import annotations

import numpy as np

from ..exact import solve_exact
from ..instance import Problem
from ..solution import Solution, solution_to_dict
from .de import DEConfig, run_de
from .ga import GAConfig, run_ga
from .trace import Tracer


def make_config(algo: str, params: dict) -> GAConfig | DEConfig:
    if algo == "ga":
        return GAConfig(**params)
    if algo == "de":
        return DEConfig(**params)
    raise ValueError(f"Bilinmeyen algoritma: {algo}")


def run_algorithm(problem: Problem, algo: str, cfg, tracer: Tracer | None = None):
    if algo == "ga":
        return run_ga(problem, cfg, tracer)
    if algo == "de":
        return run_de(problem, cfg, tracer)
    raise ValueError(f"Bilinmeyen algoritma: {algo}")


def polish(problem: Problem, sol: Solution, time_limit: float = 10.0) -> Solution | None:
    """Metasezgiselin seçtiği hastaneler sabitken atamayı MIP ile tam çözer."""
    if not np.any(sol.genes):
        return None
    polished, info = solve_exact(problem, time_limit=time_limit, gap=1e-3, fixed_genes=sol.genes)
    if info.status not in ("optimal", "time_limit") or polished.total > sol.total + 1e-6:
        return None
    return polished


def run_full(
    problem: Problem, algo: str, params: dict, tracer: Tracer | None = None, do_polish: bool = True
) -> dict:
    cfg = make_config(algo, params)
    tr = tracer or Tracer()
    best, stats = run_algorithm(problem, algo, cfg, tr)
    pol = polish(problem, best) if do_polish else None
    return {
        "algo": algo,
        "config": cfg.to_dict(),
        "stats": stats,
        "generations": tr.generations,
        "best": solution_to_dict(problem, best),
        "polished": solution_to_dict(problem, pol) if pol is not None else None,
    }
