"""Çözüm temsili ve tek amaç fonksiyonu.

Bir çözüm iki diziden oluşur:
  genes  (J,)  0 = kapalı, k ≥ 1 = problem.types[k-1] tipinde hastane
  assign (I,)  mahallenin atandığı aday indeksi, -1 = karşılanmadı
Exact model de metasezgiseller de maliyeti buradaki `evaluate` ile hesaplar.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .instance import Problem


@dataclass
class Solution:
    genes: np.ndarray
    assign: np.ndarray
    fixed_cost: float
    assign_cost: float
    penalty_cost: float
    investment: float

    @property
    def total(self) -> float:
        return self.fixed_cost + self.assign_cost + self.penalty_cost


def open_cost(problem: Problem, genes: np.ndarray) -> tuple[float, float]:
    """(yıllık açılış maliyeti, toplam yatırım)."""
    j = np.nonzero(genes)[0]
    k = genes[j] - 1
    return float(problem.fixed[j, k].sum()), float(problem.invest[j, k].sum())


def evaluate(problem: Problem, genes: np.ndarray, assign: np.ndarray) -> Solution:
    genes = np.asarray(genes, dtype=int)
    assign = np.asarray(assign, dtype=int)
    fixed, invest = open_cost(problem, genes)
    served = assign >= 0
    idx = np.nonzero(served)[0]
    a_cost = float(problem.assign_cost[idx, assign[idx]].sum())
    p_cost = float(problem.penalty[~served].sum())
    return Solution(genes, assign, fixed, a_cost, p_cost, invest)


def loads(problem: Problem, sol: Solution) -> np.ndarray:
    """(J,) her adaya atanan yatak talebi."""
    served = sol.assign >= 0
    return np.bincount(sol.assign[served], weights=problem.d[served], minlength=problem.n_cand)


def capacities(problem: Problem, genes: np.ndarray) -> np.ndarray:
    out = np.zeros(problem.n_cand)
    j = np.nonzero(genes)[0]
    out[j] = problem.cap[genes[j] - 1]
    return out


def check_feasible(problem: Problem, sol: Solution, tol: float = 1e-6) -> list[str]:
    """Kısıt ihlallerinin listesi (boş = uygun). Testlerde kullanılır."""
    errs = []
    genes, assign = sol.genes, sol.assign
    if np.any(genes < 0) or np.any(genes > problem.kmax):
        errs.append("geçersiz tip (arazi yetmiyor)")
    served = assign >= 0
    if np.any(genes[assign[served]] == 0):
        errs.append("kapalı hastaneye atama")
    if not np.all(problem.allowed[np.nonzero(served)[0], assign[served]]):
        errs.append("izin verilmeyen atama (mesafe)")
    over = loads(problem, sol) - capacities(problem, genes)
    if np.any(over > tol):
        errs.append("kapasite aşıldı")
    c = problem.constraints
    n_open = int(np.count_nonzero(genes))
    if c.max_hospitals is not None and n_open > c.max_hospitals:
        errs.append("hastane sayısı üst sınırı aşıldı")
    if c.budget_mtl is not None and sol.investment > c.budget_mtl + tol:
        errs.append("bütçe aşıldı")
    if c.min_utilization is not None:
        cap = capacities(problem, genes)
        ld = loads(problem, sol)
        if np.any((genes > 0) & (ld < c.min_utilization * cap - tol)):
            errs.append("minimum doluluk sağlanmadı")
    return errs


def solution_to_dict(problem: Problem, sol: Solution) -> dict:
    """UI için JSON'a çevrilebilir özet."""
    ld = loads(problem, sol)
    cap = capacities(problem, sol.genes)
    served = sol.assign >= 0
    idx = np.nonzero(served)[0]
    dist = problem.dist[idx, sol.assign[idx]]
    w = problem.w[idx]
    hospitals = []
    for j in np.nonzero(sol.genes)[0]:
        t = problem.types[sol.genes[j] - 1]
        hospitals.append(
            {
                "cand": int(j),
                "type": t.key,
                "beds": t.beds,
                "load": round(float(ld[j]), 2),
                "util": round(float(ld[j] / cap[j]), 4),
                "fixed": round(float(problem.fixed[j, sol.genes[j] - 1]), 3),
                "invest": round(float(problem.invest[j, sol.genes[j] - 1]), 3),
                "n_assigned": int(np.count_nonzero(sol.assign == j)),
            }
        )
    by_type = {t.key: 0 for t in problem.types}
    for h in hospitals:
        by_type[h["type"]] += 1
    unmet_beds = float(problem.d[~served].sum())
    return {
        "genes": sol.genes.tolist(),
        "assign": sol.assign.tolist(),
        "hospitals": hospitals,
        "cost": {
            "total": round(sol.total, 3),
            "fixed": round(sol.fixed_cost, 3),
            "assign": round(sol.assign_cost, 3),
            "penalty": round(sol.penalty_cost, 3),
        },
        "investment": round(sol.investment, 3),
        "kpi": {
            "n_open": len(hospitals),
            "by_type": by_type,
            "avg_dist_km": round(float((dist * w).sum() / w.sum()), 3) if len(idx) else None,
            "max_dist_km": round(float(dist.max()), 3) if len(idx) else None,
            "unmet_beds": round(unmet_beds, 2),
            "unmet_pct": round(100 * unmet_beds / float(problem.d.sum()), 3),
            "unmet_count": int((~served).sum()),
            "avg_util": round(float(ld.sum() / cap.sum()), 4) if cap.sum() else None,
        },
    }
