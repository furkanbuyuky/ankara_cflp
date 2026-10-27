"""Sentetik (yedek) örnek: ilçe merkezleri etrafında, ilçe nüfusuyla orantılı Gauss kümeleri.

Gerçek mahalle verisi kullanılamadığında aynı JSON yapısını üretir.
Çalıştırma:  python -m cflp.data_pipeline.synthetic
"""
from __future__ import annotations

import numpy as np

from .common import DISTRICTS, district_table, make_candidates, make_toy, pick_candidates, write_instance

POINTS_PER_100K = 6.5
SPREAD_DEG = {"Gölbaşı": 0.035, "Sincan": 0.03, "Etimesgut": 0.03, "Pursaklar": 0.02}


def build(seed: int = 42, n_candidates: int = 60) -> dict:
    rng = np.random.default_rng(seed)
    demand = []
    for name, prof in DISTRICTS.items():
        n = max(8, int(prof["population"] / 100_000 * POINTS_PER_100K))
        share = rng.dirichlet(np.full(n, 3.0))
        lat0, lon0 = prof["center"]
        s = SPREAD_DEG.get(name, 0.025)
        for k in range(n):
            demand.append(
                {
                    "id": len(demand),
                    "name": f"{name} S{k + 1}",
                    "district": name,
                    "lat": round(lat0 + rng.normal(0, s), 6),
                    "lon": round(lon0 + rng.normal(0, s * 1.3), 6),
                    "population": int(round(prof["population"] * share[k], -1)),
                }
            )
    cand = make_candidates(demand, pick_candidates(demand, n_candidates, rng), rng)
    return {
        "id": "ankara",
        "name": "Ankara — 9 merkez ilçe (sentetik)",
        "source": "synthetic",
        "districts": district_table(),
        "demand": demand,
        "candidates": cand,
        "meta": {"seed": seed},
    }


def main() -> None:
    data = build()
    print("ankara:", write_instance(data), len(data["demand"]), "talep,", len(data["candidates"]), "aday")
    rng = np.random.default_rng(7)
    toy = make_toy(data["demand"], rng)
    toy_data = {
        "id": "toy",
        "name": "Öğretim örneği (10 mahalle, 6 aday)",
        "source": "synthetic",
        "districts": data["districts"],
        **toy,
        "meta": {"seed": 7, "note": "Nüfuslar öğretim için ölçeklendi"},
    }
    print("toy:", write_instance(toy_data))


if __name__ == "__main__":
    main()
