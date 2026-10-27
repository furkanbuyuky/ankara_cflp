"""Metasezgisellerin ortak katmanı: kodlama, onarım (repair), decoder ve değerlendirme.

Kromozom: genes (J,) tamsayı; 0 = kapalı, k = problem.types[k-1] tipi hastane.
Arazisine sığmayan tipler hiç üretilmez: 0 ≤ genes[j] ≤ kmax[j].
"""
from __future__ import annotations

import numpy as np

from ..instance import Problem
from ..solution import Solution, capacities, evaluate
from . import fast_decode
from .trace import Tracer


def auto_p_open(problem: Problem) -> float:
    """Başlangıçta bir genin açık olma olasılığı: beklenen kapasite ≈ talebin 1.3 katı."""
    eligible = max(int(np.count_nonzero(problem.kmax)), 1)
    n_needed = 1.3 * problem.d.sum() / problem.cap.mean()
    return float(np.clip(n_needed / eligible, 0.05, 0.9))


def random_genes(problem: Problem, rng: np.random.Generator, p_open: float) -> np.ndarray:
    genes = np.zeros(problem.n_cand, dtype=int)
    opened = (rng.random(problem.n_cand) < p_open) & (problem.kmax > 0)
    for j in np.nonzero(opened)[0]:
        genes[j] = rng.integers(1, problem.kmax[j] + 1)
    return genes


class Evaluator:
    """Kromozom → çözüm. Sayaç, önbellek ve (detay modunda) decoder izini tutar."""

    def __init__(self, problem: Problem, tracer: Tracer | None = None, use_fast: bool = True):
        self.p = problem
        self.use_fast = use_fast
        self.tracer = tracer or Tracer()
        self.evals = 0
        self.line_override: str | None = None  # başlangıçta tüm değerlendirme tek satır
        self._cache: dict[bytes, Solution] = {}
        masked = np.where(problem.allowed, problem.dist, np.inf)
        self.order = np.argsort(masked, axis=1, kind="stable")  # (I, J) yakından uzağa
        rows = np.arange(problem.n_demand)[:, None]
        self.order_allowed = problem.allowed[rows, self.order]
        self.order_dist = problem.dist[rows, self.order]
        self.d_list = problem.d.tolist()
        # repair puanı için: tipe göre yıllık açılış maliyeti
        self._fixed = np.nan_to_num(problem.fixed, nan=np.inf)

    # ---------------------------------------------------------------- onarım
    def _nearest_load(self, genes: np.ndarray) -> np.ndarray:
        """Kapasite gözetmeden en yakın açık hastaneye atanırsa oluşacak yük (J,)."""
        open_sorted = (genes > 0)[self.order] & self.order_allowed
        has = open_sorted.any(axis=1)
        pos = open_sorted.argmax(axis=1)
        j = self.order[np.arange(self.p.n_demand), pos]
        return np.bincount(j[has], weights=self.p.d[has], minlength=self.p.n_cand)

    def violates(self, genes: np.ndarray) -> str | None:
        c = self.p.constraints
        if c.max_hospitals is not None and np.count_nonzero(genes) > c.max_hospitals:
            return "sayı"
        if c.budget_mtl is not None:
            j = np.nonzero(genes)[0]
            if self.p.invest[j, genes[j] - 1].sum() > c.budget_mtl + 1e-9:
                return "bütçe"
        return None

    def repair(self, genes: np.ndarray) -> tuple[np.ndarray, list[dict]]:
        """Sayı/bütçe sınırı aşılıyorsa, açılış maliyeti başına en az talep taşıyacak
        hastaneyi kapatır; sınır sağlanana kadar tekrarlar."""
        genes = np.minimum(genes, self.p.kmax)
        closed = []
        while (reason := self.violates(genes)) is not None:
            j_open = np.nonzero(genes)[0]
            load = self._nearest_load(genes)[j_open]
            score = load / self._fixed[j_open, genes[j_open] - 1]
            jw = int(j_open[np.argmin(score)])
            closed.append({"cand": jw, "reason": reason, "load": float(load[np.argmin(score)])})
            genes = genes.copy()
            genes[jw] = 0
        return genes, closed

    # ---------------------------------------------------------------- decoder
    def decode(self, genes: np.ndarray, trace: bool = False) -> np.ndarray:
        """Regret tabanlı açgözlü atama. Her mahalle, kapasitesi yeten en yakın açık
        hastaneye; seçeneği azalan (pişmanlığı büyük) mahalleler önce atanır."""
        p, tr = self.p, self.tracer
        I = p.n_demand
        cap_left = capacities(p, genes)
        open_sorted = (genes > 0)[self.order] & self.order_allowed
        has1 = open_sorted.any(axis=1)
        pos1 = open_sorted.argmax(axis=1)
        rest = open_sorted.copy()
        rest[np.arange(I), pos1] = False
        has2 = rest.any(axis=1)
        pos2 = rest.argmax(axis=1)
        d1 = self.order_dist[np.arange(I), pos1]
        d2 = self.order_dist[np.arange(I), pos2]
        regret = np.where(has2, (d2 - d1) * p.w, np.inf)
        regret[~has1] = -np.inf  # hiç seçeneği yok → en sona, karşılanmayacak
        seq = np.argsort(-regret, kind="stable")
        if trace:
            tr.emit("main.decode", "decode_open", sub="dec.open", open=np.nonzero(genes)[0], cap_left=cap_left)
            tr.emit("main.decode", "decode_regret", sub="dec.regret",
                    regret=[None if not np.isfinite(r) else round(float(r), 1) for r in regret])
            tr.emit("main.decode", "decode_order", sub="dec.order", order=seq)

        if not trace and fast_decode.AVAILABLE and self.use_fast:
            first = self.order[np.arange(I), pos1]
            return fast_decode.decode_fast(seq, has1, first, open_sorted, self.order, p.d,
                                           cap_left.copy(), p.assign_cost)

        # Okunabilir sürüm (iz kaydı bu sürümden alınır).
        # Sıcak döngü: numpy skaler erişimi yavaş olduğu için Python listeleri kullanılır.
        assign_l = [-1] * I
        cap = cap_left.tolist()
        d = self.d_list
        first = self.order[np.arange(I), pos1].tolist()
        has1_l = has1.tolist()
        seq_l = seq.tolist()
        for i in seq_l:
            if not has1_l[i]:
                if trace:
                    tr.emit("main.decode", "decode_assign", sub="dec.assign", i=i, j=-1,
                            why="erişilebilir açık hastane yok", cap_left=cap)
                continue
            di = d[i]
            j = first[i]
            if cap[j] < di - 1e-9:
                j = -1
                for jj in self.order[i, open_sorted[i]].tolist():
                    if cap[jj] >= di - 1e-9:
                        j = jj
                        break
            if j >= 0:
                assign_l[i] = j
                cap[j] -= di
            if trace:
                tr.emit("main.decode", "decode_assign", sub="dec.assign", i=i, j=j,
                        why=None if j >= 0 else "kapasite yetmiyor", nearest=first[i], cap_left=cap)
        assign = np.array(assign_l, dtype=int)
        cap_left = np.array(cap)

        # İkinci geçiş: karşılanamayan her mahalle için, dolu bir hastanedeki başka bir
        # mahalleyi boş kapasiteli bir hastaneye kaydırarak yer açmayı dene.
        for i in seq_l:
            if assign[i] >= 0 or not has1_l[i]:
                continue
            if cap_left.sum() < d[i] - 1e-9:  # toplam boş kapasite yetmiyorsa kaydırma da işe yaramaz
                move = None
            else:
                move = self._ejection(i, genes, assign, cap_left, open_sorted)
            if move is None:
                if trace:
                    tr.emit("main.decode", "decode_fix", sub="dec.fix", i=i, j=-1, moved=None,
                            why="kaydırılabilecek mahalle yok", cap_left=cap_left)
                continue
            j, i2, j2 = move
            assign[i2] = j2
            cap_left[j2] -= d[i2]
            cap_left[j] += d[i2] - d[i]
            assign[i] = j
            if trace:
                tr.emit("main.decode", "decode_fix", sub="dec.fix", i=i, j=int(j),
                        moved={"i": int(i2), "from": int(j), "to": int(j2)}, cap_left=cap_left)
        return assign

    def _ejection(self, i, genes, assign, cap_left, open_sorted):
        """(j, i2, j2): i'yi j'ye almak için j'deki i2'yi j2'ye taşı; en ucuz seçenek."""
        p = self.p
        js = self.order[i, open_sorted[i]]
        need = np.full(p.n_cand, np.inf)
        need[js] = p.d[i] - cap_left[js]
        # i'nin erişebildiği bir hastanede olup, çıkarılınca i'ye yer açacak mahalleler
        cand = np.nonzero((assign >= 0) & (p.d >= np.where(assign >= 0, need[assign], np.inf) - 1e-9))[0]
        if len(cand) == 0:
            return None
        rows = self.order[cand]
        ok = (
            open_sorted[cand]
            & (cap_left[rows] >= p.d[cand, None] - 1e-9)
            & (rows != assign[cand, None])
        )
        has = ok.any(axis=1)
        if not has.any():
            return None
        cand, rows, ok = cand[has], rows[has], ok[has]
        j2 = rows[np.arange(len(cand)), ok.argmax(axis=1)]  # i2 için en yakın uygun j2
        j = assign[cand]
        cost = p.assign_cost[i, j] + p.assign_cost[cand, j2] - p.assign_cost[cand, j]
        b = int(np.argmin(cost))
        return int(j[b]), int(cand[b]), int(j2[b])

    def _close_underused(self, genes: np.ndarray, assign: np.ndarray) -> int | None:
        theta = self.p.constraints.min_utilization
        if theta is None:
            return None
        cap = capacities(self.p, genes)
        served = assign >= 0
        load = np.bincount(assign[served], weights=self.p.d[served], minlength=self.p.n_cand)
        short = np.where(genes > 0, theta * cap - load, -np.inf)
        j = int(np.argmax(short))
        return j if short[j] > 1e-9 else None

    # ---------------------------------------------------------------- değerlendirme
    def evaluate(self, genes: np.ndarray) -> Solution:
        """Onar → çöz → (gerekirse az dolu hastaneyi kapatıp yeniden çöz) → maliyet.
        Dönen çözümün genleri onarılmış genlerdir (Lamarckçı)."""
        self.evals += 1
        tr = self.tracer
        key = np.asarray(genes, dtype=np.int8).tobytes()
        if key in self._cache and not tr.detail:
            return self._cache[key]

        genes, closed = self.repair(np.asarray(genes, dtype=int))
        if tr.detail:
            tr.emit(self.line_override or "main.repair", "repair", closed=closed, genes=genes)
        assign = self.decode(genes, trace=tr.trace_decoder)
        if tr.detail and not tr.trace_decoder:
            tr.emit(self.line_override or "main.decode", "decode", assign=assign)
        while (j := self._close_underused(genes, assign)) is not None:
            genes = genes.copy()
            genes[j] = 0
            if tr.detail:
                tr.emit(self.line_override or "main.repair", "repair", closed=[{"cand": j, "reason": "doluluk"}], genes=genes)
            assign = self.decode(genes, trace=False)
        sol = evaluate(self.p, genes, assign)
        if tr.detail:
            tr.emit(self.line_override or "main.cost", "evaluate", genes=genes, assign=assign, cost=cost_dict(sol))
        self._cache[key] = sol
        return sol


def cost_dict(sol: Solution) -> dict:
    return {
        "total": round(sol.total, 3),
        "fixed": round(sol.fixed_cost, 3),
        "assign": round(sol.assign_cost, 3),
        "penalty": round(sol.penalty_cost, 3),
    }


def diversity(pop: np.ndarray) -> float:
    """Popülasyondaki ortalama ikili Hamming mesafesi (gen sayısına oranla)."""
    n = len(pop)
    if n < 2:
        return 0.0
    diff = (pop[:, None, :] != pop[None, :, :]).sum(axis=2)
    return float(diff.sum() / (n * (n - 1)) / pop.shape[1])


def generation_summary(
    gen: int, evals: int, costs: np.ndarray, pop: np.ndarray, best: Solution, improved: bool,
    d: np.ndarray | None = None,
) -> dict:
    s = {
        "gen": gen,
        "evals": evals,
        "best": round(best.total, 3),
        "mean": round(float(np.mean(costs)), 3),
        "median": round(float(np.median(costs)), 3),
        "worst": round(float(np.max(costs)), 3),
        "diversity": round(diversity(pop), 4),
        "n_open": int(np.count_nonzero(best.genes)),
        "best_genes": best.genes.tolist(),
        "best_cost": cost_dict(best),
        "improved": improved,
    }
    if d is not None:  # karşılanamayan yatak (arayüzde cezadan ayrı gösterilir)
        s["unmet_beds"] = round(float(d[best.assign < 0].sum()), 1)
    if improved:
        s["assign"] = best.assign.tolist()
    return s
