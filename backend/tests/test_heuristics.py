import json

import numpy as np
import pytest

from cflp.exact import solve_exact
from cflp.heuristics.common import Evaluator, random_genes
from cflp.heuristics.de import DEConfig, run_de
from cflp.heuristics.ga import GAConfig, run_ga
from cflp.heuristics.runner import run_full
from cflp.heuristics.trace import Tracer
from cflp.instance import Constraints, Instance, Params, build_problem
from cflp.solution import check_feasible


@pytest.fixture(scope="module")
def ankara():
    return build_problem(Instance.load("ankara"), Params.defaults(), "multi")


@pytest.fixture(scope="module")
def toy():
    return build_problem(Instance.load("toy"), Params.defaults(), "multi")


def test_fast_and_python_decoder_agree(ankara):
    fast = Evaluator(ankara, use_fast=True)
    slow = Evaluator(ankara, use_fast=False)
    rng = np.random.default_rng(0)
    for _ in range(200):
        g = random_genes(ankara, rng, p_open=float(rng.uniform(0.1, 0.6)))
        assert np.array_equal(fast.decode(g), slow.decode(g))


@pytest.mark.parametrize("constraints", [
    Constraints(),
    Constraints(max_hospitals=10),
    Constraints(budget_mtl=60000),
    Constraints(max_distance_km=6.0),
    Constraints(min_utilization=0.6),
])
def test_decoded_solutions_are_feasible(constraints):
    pb = build_problem(Instance.load("ankara"), Params.defaults(), "multi", constraints)
    ev = Evaluator(pb)
    rng = np.random.default_rng(1)
    for _ in range(100):
        sol = ev.evaluate(random_genes(pb, rng, p_open=0.5))
        assert check_feasible(pb, sol) == []


@pytest.mark.parametrize("selection", ["roulette", "tournament", "rank"])
@pytest.mark.parametrize("crossover", ["one_point", "two_point", "uniform"])
def test_ga_variants_run_and_respect_limit(toy, selection, crossover):
    pb = build_problem(toy.instance, toy.params, "multi", Constraints(max_hospitals=2))
    best, stats = run_ga(pb, GAConfig(pop_size=10, max_evals=300, selection=selection, crossover=crossover))
    assert check_feasible(pb, best) == []
    assert stats["evals"] >= 300


@pytest.mark.parametrize("strategy", ["rand1", "best1", "current_to_best1"])
def test_de_variants_run(toy, strategy):
    best, _ = run_de(toy, DEConfig(pop_size=10, max_evals=300, strategy=strategy))
    assert check_feasible(toy, best) == []


@pytest.mark.parametrize("algo", ["ga", "de"])
def test_reproducible(ankara, algo):
    a = run_full(ankara, algo, {"max_evals": 1500, "seed": 3}, do_polish=False)
    b = run_full(ankara, algo, {"max_evals": 1500, "seed": 3}, do_polish=False)
    assert json.dumps(a["generations"]) == json.dumps(b["generations"])


@pytest.mark.parametrize("algo", ["ga", "de"])
def test_heuristics_find_toy_optimum(toy, algo):
    opt, _ = solve_exact(toy)
    r = run_full(toy, algo, {"pop_size": 20, "max_evals": 2000, "seed": 0})
    best = r["polished"] or r["best"]
    assert best["cost"]["total"] == pytest.approx(opt.total, rel=1e-6)


@pytest.mark.parametrize("algo,variant", [("ga", {"selection": "roulette"}), ("ga", {"selection": "rank",
                         "crossover": "uniform"}), ("de", {"strategy": "best1"})])
def test_detail_trace_is_consistent(toy, algo, variant):
    tr = Tracer(detail=True)
    run_full(toy, algo, {"pop_size": 6, "max_generations": 2, "seed": 0, **variant}, tracer=tr, do_polish=False)
    assert tr.events and not tr.truncated
    assert all("line" in e and "state" in e for e in tr.events)
    kinds = {e["kind"] for e in tr.events}
    assert {"decode_assign", "evaluate", "best_update"} <= kinds
    # olaylardaki maliyetler gerçek amaç fonksiyonuyla aynı olmalı
    ev = Evaluator(toy, use_fast=False)
    for e in tr.events:
        if e["kind"] == "evaluate":
            sol = ev.evaluate(np.array(e["genes"]))
            assert e["cost"]["total"] == pytest.approx(sol.total, abs=1e-3)
