import itertools

import numpy as np
import pytest

from cflp.exact import solve_exact
from cflp.instance import Constraints, Instance, Params, build_problem
from cflp.solution import check_feasible


@pytest.fixture(scope="module")
def toy():
    return Instance.load("toy")


@pytest.fixture(scope="module")
def params():
    return Params.defaults()


def brute_force(problem):
    """Tüm yer/tip kombinasyonlarını dene; her biri için atamayı MIP ile tam çöz."""
    best = None
    ranges = [range(k + 1) for k in problem.kmax]
    for genes in itertools.product(*ranges):
        genes = np.array(genes)
        if not genes.any():
            continue
        c = problem.constraints
        if c.max_hospitals is not None and np.count_nonzero(genes) > c.max_hospitals:
            continue
        j = np.nonzero(genes)[0]
        if c.budget_mtl is not None and problem.invest[j, genes[j] - 1].sum() > c.budget_mtl:
            continue
        sol, info = solve_exact(problem, fixed_genes=genes, time_limit=10)
        if info.status not in ("optimal",):
            continue
        if best is None or sol.total < best.total - 1e-6:
            best = sol
    return best


@pytest.mark.parametrize("scenario", ["single", "multi"])
def test_exact_matches_brute_force(toy, params, scenario):
    pb = build_problem(toy, params, scenario)
    sol, info = solve_exact(pb, time_limit=60)
    assert info.status == "optimal"
    assert check_feasible(pb, sol) == []
    bf = brute_force(pb)
    assert sol.total == pytest.approx(bf.total, rel=1e-6)


def test_exact_with_max_hospitals_matches_brute_force(toy, params):
    pb = build_problem(toy, params, "multi", Constraints(max_hospitals=1))
    sol, info = solve_exact(pb, time_limit=60)
    assert info.status == "optimal"
    assert np.count_nonzero(sol.genes) <= 1
    assert sol.total == pytest.approx(brute_force(pb).total, rel=1e-6)


def test_multi_never_worse_than_single(toy, params):
    single, _ = solve_exact(build_problem(toy, params, "single"))
    multi, _ = solve_exact(build_problem(toy, params, "multi"))
    assert multi.total <= single.total + 1e-6


def test_tighter_hospital_limit_never_cheaper(toy, params):
    costs = []
    for p in range(1, 5):
        sol, _ = solve_exact(build_problem(toy, params, "multi", Constraints(max_hospitals=p)))
        costs.append(sol.total)
    assert all(a >= b - 1e-6 for a, b in zip(costs, costs[1:]))


def test_low_limit_leaves_demand_unmet(toy, params):
    pb = build_problem(toy, params, "single", Constraints(max_hospitals=1))
    sol, _ = solve_exact(pb)
    assert sol.penalty_cost > 0  # tek orta boy hastane tüm talebi karşılayamaz


def test_constraints_respected(toy, params):
    c = Constraints(budget_mtl=15000, max_distance_km=4.0, min_utilization=0.5)
    pb = build_problem(toy, params, "multi", c)
    sol, info = solve_exact(pb)
    assert info.status == "optimal"
    assert check_feasible(pb, sol) == []
