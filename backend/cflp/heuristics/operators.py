"""GA operatörleri: seçim, çaprazlama, mutasyon.

Her operatör (sonuç, iz bilgisi) döndürür; iz bilgisi Sekme 3'teki görsellere gider.
Maliyet minimize edildiği için düşük maliyet = iyi birey.
"""
from __future__ import annotations

import numpy as np

# ------------------------------------------------------------------ seçim


def select_roulette(costs: np.ndarray, rng: np.random.Generator) -> tuple[int, dict]:
    """Rulet: maliyet fitness'a çevrilir, f_i = c_max − c_i + ε; olasılık f_i / Σf."""
    cmax, cmin = float(costs.max()), float(costs.min())
    eps = 0.01 * (cmax - cmin) if cmax > cmin else 1.0
    f = cmax - costs + eps
    prob = f / f.sum()
    r = float(rng.random())
    idx = int(min(np.searchsorted(np.cumsum(prob), r, side="right"), len(costs) - 1))
    return idx, {"fitness": f.round(3), "prob": prob.round(4), "r": round(r, 4), "chosen": idx}


def select_tournament(costs: np.ndarray, rng: np.random.Generator, k: int = 3) -> tuple[int, dict]:
    """Turnuva: k rastgele birey, en düşük maliyetli kazanır."""
    k = min(k, len(costs))
    comp = rng.choice(len(costs), size=k, replace=False)
    idx = int(comp[np.argmin(costs[comp])])
    return idx, {"competitors": comp, "costs": costs[comp].round(3), "chosen": idx}


def select_rank(costs: np.ndarray, rng: np.random.Generator, s: float = 1.7) -> tuple[int, dict]:
    """Doğrusal sıralama: olasılık maliyetin büyüklüğüne değil sırasına bağlı.
    r = 1 en iyi, p_r = (2−s)/N + 2(s−1)(N−r)/(N(N−1))."""
    n = len(costs)
    order = np.argsort(costs, kind="stable")
    rank = np.empty(n, dtype=int)
    rank[order] = np.arange(1, n + 1)
    prob = (2 - s) / n + 2 * (s - 1) * (n - rank) / (n * (n - 1)) if n > 1 else np.ones(1)
    r = float(rng.random())
    idx = int(min(np.searchsorted(np.cumsum(prob), r, side="right"), n - 1))
    return idx, {"rank": rank, "prob": np.round(prob, 4), "r": round(r, 4), "chosen": idx}


def select(kind: str, costs: np.ndarray, rng: np.random.Generator, cfg) -> tuple[int, dict]:
    if kind == "roulette":
        return select_roulette(costs, rng)
    if kind == "tournament":
        return select_tournament(costs, rng, cfg.tournament_k)
    if kind == "rank":
        return select_rank(costs, rng, cfg.rank_pressure)
    raise ValueError(f"Bilinmeyen seçim: {kind}")


# ------------------------------------------------------------------ çaprazlama


def crossover(
    kind: str, a: np.ndarray, b: np.ndarray, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray, dict]:
    n = len(a)
    if kind == "one_point":
        c = int(rng.integers(1, n))
        mask = np.arange(n) < c
        info = {"cuts": [c]}
    elif kind == "two_point":
        c1, c2 = sorted(rng.choice(np.arange(1, n), size=2, replace=False))
        mask = (np.arange(n) < c1) | (np.arange(n) >= c2)
        info = {"cuts": [int(c1), int(c2)]}
    elif kind == "uniform":
        mask = rng.random(n) < 0.5
        info = {}
    else:
        raise ValueError(f"Bilinmeyen çaprazlama: {kind}")
    # mask True → ç1 genini e1'den, ç2 genini e2'den alır
    c1 = np.where(mask, a, b)
    c2 = np.where(mask, b, a)
    info["mask"] = mask.astype(int)
    return c1, c2, info


# ------------------------------------------------------------------ mutasyon


def mutate(
    genes: np.ndarray, kmax: np.ndarray, p_mut: float, rng: np.random.Generator
) -> tuple[np.ndarray, list[dict]]:
    """Rastgele sıfırlama: her gen p_mut olasılıkla başka bir geçerli değere döner."""
    genes = genes.copy()
    changes = []
    hits = np.nonzero((rng.random(len(genes)) < p_mut) & (kmax > 0))[0]
    for j in hits:
        old = int(genes[j])
        choices = [v for v in range(kmax[j] + 1) if v != old]
        new = int(rng.choice(choices))
        genes[j] = new
        changes.append({"pos": int(j), "old": old, "new": new})
    return genes, changes
