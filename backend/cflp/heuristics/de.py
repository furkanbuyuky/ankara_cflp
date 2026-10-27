"""Diferansiyel Evrim, ayrık probleme floor dönüşümüyle uyarlanmış.

Her gen sürekli bir değer x_j ∈ [0, kmax_j + 1); genler = ⌊x⌋.
"""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import numpy as np

from ..instance import Problem
from ..solution import Solution
from .common import Evaluator, auto_p_open, cost_dict, generation_summary
from .trace import Tracer


@dataclass
class DEConfig:
    pop_size: int = 50
    F: float = 0.5
    CR: float = 0.9
    strategy: str = "rand1"  # rand1 | best1 | current_to_best1
    p_open: float | None = None  # None → otomatik
    max_evals: int = 10000
    max_generations: int | None = None
    seed: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def _to_genes(x: np.ndarray) -> np.ndarray:
    return np.floor(x).astype(int)


def _sync(x: np.ndarray, genes: np.ndarray) -> np.ndarray:
    """Onarımın kapattığı genleri sürekli vektöre geri yansıt (Lamarckçı)."""
    x = x.copy()
    closed = (genes == 0) & (x >= 1)
    x[closed] = x[closed] - np.floor(x[closed])
    return x


def _reflect(v: np.ndarray, ub: np.ndarray) -> np.ndarray:
    v = np.where(v < 0, -v, v)
    v = np.where(v >= ub, 2 * ub - v - 1e-9, v)
    return np.clip(v, 0, ub - 1e-9)


def _vec(x: np.ndarray) -> list:
    return np.round(x, 3).tolist()


def run_de(problem: Problem, cfg: DEConfig, tracer: Tracer | None = None) -> tuple[Solution, dict]:
    tr = tracer or Tracer()
    rng = np.random.default_rng(cfg.seed)
    ev = Evaluator(problem, tr)
    N, J = cfg.pop_size, problem.n_cand
    ub = problem.kmax + 1.0
    p_open = cfg.p_open if cfg.p_open is not None else auto_p_open(problem)
    t0 = time.perf_counter()

    def ind(i: int) -> dict:
        return {"x": _vec(X[i]), "genes": sols[i].genes.tolist(), "cost": round(sols[i].total, 3)}

    # Başlangıç: düz rastgele örnekleme genlerin çoğunu "açık" yapar; bu yüzden
    # her gen p_open olasılıkla [1, ub) aralığından, aksi halde [0, 1)'den örneklenir.
    X = np.zeros((N, J))
    sols: list[Solution] = []
    tr.state = {"gen": 0, "P": [], "best": None, "evals": 0}
    for n in range(N):
        opened = (rng.random(J) < p_open) & (problem.kmax > 0)
        X[n] = np.where(opened, 1 + rng.random(J) * (ub - 1), rng.random(J))
        X[n] = np.clip(X[n], 0, ub - 1e-9)
        tr.emit("de.init", "init_individual", index=n, x=_vec(X[n]), genes=_to_genes(X[n]))
        ev.line_override = "de.eval0"
        sol = ev.evaluate(_to_genes(X[n]))
        ev.line_override = None
        X[n] = _sync(X[n], sol.genes)
        sols.append(sol)
        tr.state["P"].append(ind(n))
        tr.state["evals"] = ev.evals
    best_i = int(np.argmin([s.total for s in sols]))
    best = sols[best_i]
    tr.state["best"] = ind(best_i)
    costs = np.array([s.total for s in sols])
    tr.generation(generation_summary(0, ev.evals, costs, np.array([s.genes for s in sols]), best, True))

    gen = 0
    while ev.evals < cfg.max_evals and not tr.stop_requested:
        if cfg.max_generations is not None and gen >= cfg.max_generations:
            break
        gen += 1
        tr.state["gen"] = gen
        tr.emit("de.loop", "generation_start", gen=gen)
        costs = np.array([s.total for s in sols])
        b = int(np.argmin(costs))
        X_new, sols_new = X.copy(), list(sols)
        for t in range(N):
            if ev.evals >= cfg.max_evals or tr.stop_requested:
                break
            tr.state["target"] = t
            tr.emit("de.for", "de_target", target=t)
            others = [i for i in range(N) if i != t]
            r1, r2, r3 = (int(v) for v in rng.choice(others, size=3, replace=False))
            tr.emit("de.pick", "de_pick", target=t, r=[r1, r2, r3], best=b)
            if cfg.strategy == "rand1":
                v = X[r1] + cfg.F * (X[r2] - X[r3])
                base = {"r1": _vec(X[r1]), "r2": _vec(X[r2]), "r3": _vec(X[r3])}
            elif cfg.strategy == "best1":
                v = X[b] + cfg.F * (X[r1] - X[r2])
                base = {"best": _vec(X[b]), "r1": _vec(X[r1]), "r2": _vec(X[r2])}
            elif cfg.strategy == "current_to_best1":
                v = X[t] + cfg.F * (X[b] - X[t]) + cfg.F * (X[r1] - X[r2])
                base = {"target": _vec(X[t]), "best": _vec(X[b]), "r1": _vec(X[r1]), "r2": _vec(X[r2])}
            else:
                raise ValueError(f"Bilinmeyen DE stratejisi: {cfg.strategy}")
            tr.emit(f"de.mut.{cfg.strategy}", "de_mutation", strategy=cfg.strategy, F=cfg.F, r=[r1, r2, r3],
                    best=b, vectors=base, v=_vec(v))
            v_raw = v
            v = _reflect(v, ub)
            tr.emit("de.bound", "de_bound", before=_vec(v_raw), after=_vec(v), ub=ub)
            jrand = int(rng.integers(J))
            mask = (rng.random(J) < cfg.CR)
            mask[jrand] = True
            u = np.where(mask, v, X[t])
            tr.emit("de.cross", "de_crossover", jrand=jrand, CR=cfg.CR, mask=mask.astype(int),
                    target=_vec(X[t]), v=_vec(v), u=_vec(u))
            g = _to_genes(u)
            tr.emit("de.map", "de_map", u=_vec(u), genes=g)
            sol = ev.evaluate(g)
            u = _sync(u, sol.genes)
            win = sol.total <= sols[t].total
            tr.emit("de.select", "de_selection", target=t, trial_cost=cost_dict(sol),
                    target_cost=round(sols[t].total, 3), trial_wins=win, trial_genes=sol.genes)
            if win:
                X_new[t], sols_new[t] = u, sol
            tr.state["evals"] = ev.evals
        X, sols = X_new, sols_new
        costs = np.array([s.total for s in sols])
        cand = sols[int(np.argmin(costs))]
        improved = cand.total < best.total - 1e-9
        if improved:
            best = cand
        tr.state.update(P=[ind(i) for i in range(N)], best=ind(int(np.argmin(costs))))
        tr.state.pop("target", None)
        tr.emit("de.best", "best_update", improved=improved, best_cost=round(best.total, 3))
        tr.generation(generation_summary(gen, ev.evals, costs, np.array([s.genes for s in sols]),
                                         best, improved))

    tr.emit("de.return", "done", best_cost=round(best.total, 3))
    stats = {"evals": ev.evals, "generations": gen, "seconds": round(time.perf_counter() - t0, 3),
             "p_open": round(p_open, 4)}
    return best, stats
