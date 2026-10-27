"""Kapasiteli tesis yerleşim probleminin (CFLP) exact MIP modeli — PuLP + HiGHS.

    min  Σ_jk F_jk y_jk + Σ_ij c_ij x_ij + Σ_i π_i z_i
    s.t. Σ_j x_ij + z_i = 1                      ∀i   (tek kaynak ya da karşılanmaz)
         Σ_i d_i x_ij ≤ Σ_k u_k y_jk             ∀j   (kapasite)
         Σ_k y_jk ≤ 1                            ∀j   (yer başına bir hastane)
         x_ij ≤ Σ_k y_jk                         ∀i,j (güçlü bağlantı)
    opsiyonel: hastane sayısı, bütçe, minimum doluluk; maks. mesafe izinli x'leri daraltır.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import pulp

from .instance import Problem
from .solution import Solution, evaluate


@dataclass
class SolveInfo:
    status: str  # "optimal" | "time_limit" | "infeasible" | ...
    gap: float | None
    seconds: float
    objective: float | None
    bound: float | None

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "gap": self.gap,
            "seconds": round(self.seconds, 3),
            "objective": self.objective,
            "bound": self.bound,
        }


class _WarmHiGHS(pulp.HiGHS):
    """PuLP'un HiGHS arayüzü + başlangıç çözümü (MIP start)."""

    def __init__(self, start: dict | None = None, **kw):
        super().__init__(**kw)
        self.start = start

    def callSolver(self, lp):
        if self.start:
            import highspy

            vals = [0.0] * lp.solverModel.getNumCol()
            for var, v in self.start.items():
                vals[var.index] = float(v)
            sol = highspy.HighsSolution()
            sol.col_value = vals
            sol.value_valid = True
            lp.solverModel.setSolution(sol)
        super().callSolver(lp)


def _solver(time_limit: float, gap: float, msg: bool, start: dict | None) -> pulp.LpSolver:
    if "HiGHS" in pulp.listSolvers(onlyAvailable=True):
        return _WarmHiGHS(start=start, msg=msg, timeLimit=time_limit, gapRel=gap)
    return pulp.PULP_CBC_CMD(msg=msg, timeLimit=time_limit, gapRel=gap, warmStart=bool(start))


def _read_info(prob: pulp.LpProblem, seconds: float) -> SolveInfo:
    status = pulp.LpStatus[prob.status].lower()
    gap = bound = None
    model = getattr(prob, "solverModel", None)
    if model is not None and hasattr(model, "getInfo"):
        info = model.getInfo()
        gap = float(info.mip_gap) if info.mip_gap < 1e30 else None
        bound = float(info.mip_dual_bound)
        ms = model.getModelStatus()
        if "TIME" in str(ms).upper():
            status = "time_limit"
    if status == "optimal" and gap is not None and gap > 1e-3:
        status = "time_limit"
    return SolveInfo(status, gap, seconds, pulp.value(prob.objective), bound)


def solve_exact(
    problem: Problem,
    time_limit: float = 60.0,
    gap: float = 1e-4,
    msg: bool = False,
    fixed_genes: np.ndarray | None = None,
    start: Solution | None = None,
) -> tuple[Solution, SolveInfo]:
    """Modeli çözer. `fixed_genes` verilirse hastaneler sabitlenir, yalnızca atama
    optimize edilir (metasezgisel sonrası "polish" adımı). `start` uygun bir çözümse
    solver'a başlangıç çözümü olarak verilir."""
    t0 = time.perf_counter()
    I, J = problem.n_demand, problem.n_cand
    c = problem.constraints
    prob = pulp.LpProblem("CFLP", pulp.LpMinimize)

    # y_jk: yalnızca arazisine sığan tipler için
    y: dict[tuple[int, int], pulp.LpVariable | int] = {}
    for j in range(J):
        for k in range(problem.n_types):
            if np.isnan(problem.fixed[j, k]):
                continue
            if fixed_genes is None:
                y[j, k] = prob.add_variable(f"y_{j}_{k}", cat="Binary")
            elif fixed_genes[j] == k + 1:
                y[j, k] = 1
    open_expr = {j: pulp.lpSum(v for (jj, _), v in y.items() if jj == j) for j in range(J)}
    is_open = {j: any((j, k) in y for k in range(problem.n_types)) for j in range(J)}

    pairs = [
        (i, j)
        for i in range(I)
        for j in np.nonzero(problem.allowed[i])[0]
        if is_open[j]
    ]
    x = {(i, j): prob.add_variable(f"x_{i}_{j}", cat="Binary") for i, j in pairs}
    z = {i: prob.add_variable(f"z_{i}", cat="Binary") for i in range(I)}

    by_i: dict[int, list] = {i: [] for i in range(I)}
    by_j: dict[int, list] = {j: [] for j in range(J)}
    for (i, j), v in x.items():
        by_i[i].append(v)
        by_j[j].append((i, v))

    prob += (
        pulp.lpSum(problem.fixed[j, k] * v for (j, k), v in y.items())
        + pulp.lpSum(problem.assign_cost[i, j] * v for (i, j), v in x.items())
        + pulp.lpSum(problem.penalty[i] * z[i] for i in range(I))
    )
    for i in range(I):
        prob += pulp.lpSum(by_i[i]) + z[i] == 1, f"assign_{i}"
    for j in range(J):
        if not is_open[j]:
            continue
        capacity = pulp.lpSum(problem.cap[k] * v for (jj, k), v in y.items() if jj == j)
        load = pulp.lpSum(problem.d[i] * v for i, v in by_j[j])
        prob += load <= capacity, f"cap_{j}"
        if fixed_genes is None:
            prob += open_expr[j] <= 1, f"one_{j}"
            for i, v in by_j[j]:
                prob += v <= open_expr[j], f"link_{i}_{j}"
        if c.min_utilization is not None:
            prob += load >= c.min_utilization * capacity, f"minutil_{j}"
    if fixed_genes is None:
        # Geçerli eşitsizlik: toplam açık kapasite ≥ karşılanan toplam talep.
        # Modelin çözüm kümesini değiştirmez, LP gevşetmesini belirgin şekilde sıkılaştırır.
        prob += (
            pulp.lpSum(problem.cap[k] * v for (_, k), v in y.items())
            >= pulp.lpSum(problem.d[i] * (1 - z[i]) for i in range(I)),
            "total_capacity",
        )
        if c.max_hospitals is not None:
            prob += pulp.lpSum(y.values()) <= c.max_hospitals, "max_hospitals"
        if c.budget_mtl is not None:
            prob += (
                pulp.lpSum(problem.invest[j, k] * v for (j, k), v in y.items()) <= c.budget_mtl,
                "budget",
            )

    start_values = None
    if start is not None and fixed_genes is None:
        start_values = {v: 0 for v in [*y.values(), *x.values(), *z.values()] if not isinstance(v, int)}
        for j in np.nonzero(start.genes)[0]:
            if (j, start.genes[j] - 1) in y:
                start_values[y[j, start.genes[j] - 1]] = 1
        for i, j in enumerate(start.assign):
            if j < 0:
                start_values[z[i]] = 1
            elif (i, j) in x:
                start_values[x[i, j]] = 1
        for v, val in start_values.items():
            v.setInitialValue(val)

    prob.solve(_solver(time_limit, gap, msg, start_values))
    info = _read_info(prob, time.perf_counter() - t0)

    if fixed_genes is not None:
        genes = np.asarray(fixed_genes, dtype=int).copy()
    else:
        genes = np.zeros(J, dtype=int)
        for (j, k), v in y.items():
            if (v.varValue or 0) > 0.5:
                genes[j] = k + 1
    assign = np.full(I, -1, dtype=int)
    for (i, j), v in x.items():
        if (v.varValue or 0) > 0.5:
            assign[i] = j
    return evaluate(problem, genes, assign), info
