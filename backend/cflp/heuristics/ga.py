"""Genetik Algoritma (nesilsel, elitist)."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import numpy as np

from ..instance import Problem
from ..solution import Solution
from .common import Evaluator, auto_p_open, cost_dict, generation_summary, random_genes
from .operators import crossover, mutate, select
from .trace import Tracer


@dataclass
class GAConfig:
    pop_size: int = 50
    p_cross: float = 0.9
    p_mut: float | None = None  # None → 1/J
    elite: int = 2
    p_open: float | None = None  # None → otomatik
    selection: str = "tournament"  # roulette | tournament | rank
    tournament_k: int = 3
    rank_pressure: float = 1.7
    crossover: str = "one_point"  # one_point | two_point | uniform
    max_evals: int = 10000
    max_generations: int | None = None
    seed: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


SELECTION_STEPS = {
    "roulette": ["sel.roulette.fit", "sel.roulette.prob", "sel.roulette.spin"],
    "tournament": ["sel.tournament.pick", "sel.tournament.win"],
    "rank": ["sel.rank.sort", "sel.rank.prob", "sel.rank.spin"],
}


def _ind(sol: Solution) -> dict:
    return {"genes": sol.genes.tolist(), "cost": round(sol.total, 3)}


def run_ga(problem: Problem, cfg: GAConfig, tracer: Tracer | None = None) -> tuple[Solution, dict]:
    tr = tracer or Tracer()
    rng = np.random.default_rng(cfg.seed)
    ev = Evaluator(problem, tr)
    N = cfg.pop_size
    p_mut = cfg.p_mut if cfg.p_mut is not None else 1.0 / problem.n_cand
    p_open = cfg.p_open if cfg.p_open is not None else auto_p_open(problem)
    t0 = time.perf_counter()

    # 1-2: başlangıç popülasyonu
    tr.state = {"gen": 0, "P": [], "Q": [], "best": None, "evals": 0}
    pop: list[Solution] = []
    for n in range(N):
        g = random_genes(problem, rng, p_open)
        tr.emit("ga.init", "init_individual", index=n, genes=g)
        ev.line_override = "ga.eval0"
        sol = ev.evaluate(g)
        ev.line_override = None
        pop.append(sol)
        tr.state["P"].append(_ind(sol))
        tr.state["evals"] = ev.evals
    best = min(pop, key=lambda s: s.total)
    tr.state["best"] = _ind(best)
    costs = np.array([s.total for s in pop])
    tr.generation(generation_summary(0, ev.evals, costs, np.array([s.genes for s in pop]), best, True))

    gen = 0
    while ev.evals < cfg.max_evals and not tr.stop_requested:
        if cfg.max_generations is not None and gen >= cfg.max_generations:
            break
        gen += 1
        tr.state.update(gen=gen, Q=[])
        tr.emit("ga.loop", "generation_start", gen=gen)
        costs = np.array([s.total for s in pop])

        elite_idx = np.argsort(costs, kind="stable")[: cfg.elite]
        new_pop = [pop[i] for i in elite_idx]
        tr.state["Q"] = [_ind(s) for s in new_pop]
        tr.emit("ga.elite", "elitism", indices=elite_idx)

        while len(new_pop) < N:
            i1, info1 = select(cfg.selection, costs, rng, cfg)
            for sub in SELECTION_STEPS[cfg.selection]:
                tr.emit("ga.sel1", f"select_{cfg.selection}", sub=sub, which=1, **info1)
            i2, info2 = select(cfg.selection, costs, rng, cfg)
            for sub in SELECTION_STEPS[cfg.selection]:
                tr.emit("ga.sel2", f"select_{cfg.selection}", sub=sub, which=2, **info2)
            a, b = pop[i1].genes, pop[i2].genes
            if rng.random() < cfg.p_cross:
                c1, c2, cinfo = crossover(cfg.crossover, a, b, rng)
                tr.emit("ga.cross", "crossover", sub=f"cx.{cfg.crossover}", parents=[i1, i2], parent_genes=[a, b],
                        children=[c1, c2], **cinfo)
            else:
                c1, c2 = a.copy(), b.copy()
                tr.emit("ga.nocross", "no_crossover", parents=[i1, i2], children=[c1, c2])
            for child in (c1, c2):
                if len(new_pop) >= N:
                    break
                before = child
                child, changes = mutate(child, problem.kmax, p_mut, rng)
                tr.emit("ga.mutate", "mutate", before=before, after=child, changes=changes)
                sol = ev.evaluate(child)
                new_pop.append(sol)
                tr.state["Q"].append(_ind(sol))
                tr.state["evals"] = ev.evals
                tr.emit("ga.add", "add_child", index=len(new_pop) - 1, genes=sol.genes, cost=cost_dict(sol))

        pop = new_pop
        costs = np.array([s.total for s in pop])
        cand = pop[int(np.argmin(costs))]
        improved = cand.total < best.total - 1e-9
        if improved:
            best = cand
        tr.state.update(P=[_ind(s) for s in pop], Q=[], best=_ind(best))
        tr.emit("ga.replace", "replace", costs=costs.round(3))
        tr.emit("ga.best", "best_update", improved=improved, best_cost=round(best.total, 3))
        tr.generation(generation_summary(gen, ev.evals, costs, np.array([s.genes for s in pop]),
                                         best, improved))

    tr.emit("ga.return", "done", best_cost=round(best.total, 3))
    stats = {"evals": ev.evals, "generations": gen, "seconds": round(time.perf_counter() - t0, 3),
             "p_open": round(p_open, 4), "p_mut": round(p_mut, 4)}
    return best, stats
