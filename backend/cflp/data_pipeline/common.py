"""Gerçek (OSM) ve sentetik veri hattının ortak parçaları: ilçe tablosu, aday yer
seçimi, arazi büyüklüğü/fiyatı üretimi ve JSON yazımı."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from ..costs import haversine_km

ROOT = Path(__file__).resolve().parents[3]
PROCESSED = ROOT / "data" / "processed"

# Nüfus: TÜİK ADNKS 2024 ilçe nüfusları.
# Arsa fiyatı (TL/m²) ve arazi profili illüstratiftir; sıralama gerçekçi tutuldu.
DISTRICTS = {
    "Altındağ":    {"population": 414_893, "land_price": 18_000, "land_median": 80_000, "center": (39.955, 32.885)},
    "Çankaya":     {"population": 947_330, "land_price": 45_000, "land_median": 75_000, "center": (39.890, 32.840)},
    "Etimesgut":   {"population": 629_112, "land_price": 22_000, "land_median": 130_000, "center": (39.950, 32.670)},
    "Gölbaşı":     {"population": 165_201, "land_price": 16_000, "land_median": 190_000, "center": (39.790, 32.810)},
    "Keçiören":    {"population": 932_128, "land_price": 20_000, "land_median": 85_000, "center": (39.990, 32.860)},
    "Mamak":       {"population": 686_777, "land_price": 15_000, "land_median": 95_000, "center": (39.930, 32.920)},
    "Pursaklar":   {"population": 165_665, "land_price": 11_000, "land_median": 180_000, "center": (40.040, 32.900)},
    "Sincan":      {"population": 590_309, "land_price": 12_000, "land_median": 170_000, "center": (39.970, 32.580)},
    "Yenimahalle": {"population": 714_866, "land_price": 28_000, "land_median": 120_000, "center": (39.970, 32.790)},
}


def pick_candidates(
    demand: list[dict], n: int, rng: np.random.Generator, min_spacing_km: float = 1.2
) -> list[int]:
    """Nüfusun kareköküyle ağırlıklı, birbirine en az `min_spacing_km` uzak mahalle indeksleri."""
    pts = np.array([[p["lat"], p["lon"]] for p in demand])
    w = np.sqrt(np.array([p["population"] for p in demand], dtype=float))
    order = rng.choice(len(demand), size=len(demand), replace=False, p=w / w.sum())
    chosen: list[int] = []
    for idx in order:
        if chosen and haversine_km(pts[[idx]], pts[chosen]).min() < min_spacing_km:
            continue
        chosen.append(int(idx))
        if len(chosen) == n:
            break
    return chosen


def make_candidates(demand: list[dict], idx: list[int], rng: np.random.Generator) -> list[dict]:
    out = []
    for c, i in enumerate(idx):
        p = demand[i]
        prof = DISTRICTS[p["district"]]
        land = float(np.clip(rng.lognormal(np.log(prof["land_median"]), 0.55), 20_000, 320_000))
        if "area_km2" in p:  # yoğun, küçük mahallelerde büyük boş arazi bulunmaz
            land = max(20_000.0, min(land, 0.3 * p["area_km2"] * 1e6))
        price = float(prof["land_price"] * rng.lognormal(0, 0.25))
        out.append(
            {
                "id": c,
                "name": f"Aday {c + 1} ({p['name']})",
                "district": p["district"],
                # mahalle merkezine çok yakın ama üst üste değil
                "lat": round(p["lat"] + rng.normal(0, 0.002), 6),
                "lon": round(p["lon"] + rng.normal(0, 0.002), 6),
                "land_m2": round(land, -3),
                "land_price_tl_m2": round(price, -2),
            }
        )
    return out


def district_table(populations: dict[str, int] | None = None) -> list[dict]:
    rows = []
    for name, prof in DISTRICTS.items():
        rows.append(
            {
                "name": name,
                "population": int((populations or {}).get(name, prof["population"])),
                "land_price_tl_m2": prof["land_price"],
                "land_median_m2": prof["land_median"],
                "center": list(prof["center"]),
            }
        )
    return rows


def write_instance(data: dict) -> Path:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    path = PROCESSED / f"{data['id']}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


PARCEL_KIND = {
    "brownfield": "atıl sanayi alanı",
    "greenfield": "yapılaşmamış arazi",
    "construction": "inşaat alanı",
    "grass": "boş alan (çim)",
    "meadow": "çayır",
    "farmland": "tarım arazisi",
    "grassland": "bozkır",
    "scrub": "çalılık",
}
MAX_LAND_M2 = 300_000  # bundan büyük parseller her tipi alır; değer gösterim için sınırlanır


def _nearest_name(demand: list[dict], lat: float, lon: float) -> str:
    pts = np.array([[p["lat"], p["lon"]] for p in demand])
    return demand[int(np.argmin(haversine_km(np.array([[lat, lon]]), pts)[0]))]["name"]


def parcel_candidate(c: int, parcel: dict, demand: list[dict], rng: np.random.Generator) -> dict:
    prof = DISTRICTS[parcel["district"]]
    return {
        "id": c,
        "name": f"Aday {c + 1} ({_nearest_name(demand, parcel['lat'], parcel['lon'])})",
        "district": parcel["district"],
        "lat": parcel["lat"],
        "lon": parcel["lon"],
        "land_m2": float(round(min(parcel["area_m2"], MAX_LAND_M2), -3)),
        "land_price_tl_m2": round(float(prof["land_price"] * rng.lognormal(0, 0.25)), -2),
        "parcel": PARCEL_KIND.get(parcel["kind"], parcel["kind"]),
        "osm": parcel["osm"],
    }


def candidates_from_parcels(
    demand: list[dict], parcels: list[dict], n: int, rng: np.random.Generator, min_spacing_km: float = 1.2
) -> list[dict]:
    """Gerçek parsellerden aday seçimi: 3 km içindeki nüfus ve parsel büyüklüğüyle ağırlıklı,
    birbirine en az `min_spacing_km` uzak `n` parsel. Bir planlamacının kısa listesi gibi, büyük
    hastane alabilecek parseller öne çıkar; neredeyse hiç nüfusa hizmet etmeyecek kırsal parseller elenir."""
    dpts = np.array([[p["lat"], p["lon"]] for p in demand])
    w = np.array([p["population"] for p in demand], dtype=float)
    ppts = np.array([[p["lat"], p["lon"]] for p in parcels])
    dist = haversine_km(ppts, dpts)
    near3 = (dist <= 3.0) @ w
    near6 = (dist <= 6.0) @ w
    ok = near6 >= 20_000
    area = np.array([min(p["area_m2"], 150_000) for p in parcels]) / 35_000
    weight = np.where(ok, (near3 + 1_000) ** 0.7 * area**0.8, 0.0)
    order = rng.choice(len(parcels), size=int(ok.sum()), replace=False, p=weight / weight.sum())
    chosen: list[int] = []
    for idx in order:
        if chosen and haversine_km(ppts[[idx]], ppts[chosen]).min() < min_spacing_km:
            continue
        chosen.append(int(idx))
        if len(chosen) == n:
            break
    return [parcel_candidate(c, parcels[i], demand, rng) for c, i in enumerate(chosen)]


def make_toy(
    demand: list[dict], rng: np.random.Generator, parcels: list[dict] | None = None, center=(39.915, 32.855)
) -> dict:
    """Sekme 3 için küçük öğretim örneği: merkeze en yakın mahallelerden 10'u ve 6 aday.
    Nüfuslar, 2–3 hastane gerektirecek şekilde ölçeklenir (toplam ≈ 450 bin)."""
    pts = np.array([[p["lat"], p["lon"]] for p in demand])
    dist = haversine_km(np.array([center]), pts)[0]
    near = np.argsort(dist)[:40]
    sel = list(rng.choice(near, size=10, replace=False))
    sub = [dict(demand[i]) for i in sel]
    scale = 450_000 / sum(p["population"] for p in sub)
    toy_demand = []
    for n, p in enumerate(sub):
        toy_demand.append({**p, "id": n, "population": int(round(p["population"] * scale, -2))})
    if parcels:
        # merkeze en yakın parsellerden, birbirine en az 0,8 km uzak 6 tane; en az biri büyük hastane alabilsin
        tpts = np.array([[p["lat"], p["lon"]] for p in toy_demand])
        c0 = tpts.mean(axis=0)
        ppts = np.array([[p["lat"], p["lon"]] for p in parcels])
        order = np.argsort(haversine_km(np.array([c0]), ppts)[0])[:40]
        chosen: list[int] = []
        big = next((int(i) for i in order if parcels[i]["area_m2"] >= 120_000), None)
        if big is not None:
            chosen.append(big)
        for i in order:
            if len(chosen) == 6:
                break
            if chosen and haversine_km(ppts[[i]], ppts[chosen]).min() < 0.8:
                continue
            chosen.append(int(i))
        chosen.sort(key=lambda i: (parcels[i]["lon"], parcels[i]["lat"]))
        cands = [parcel_candidate(c, parcels[i], toy_demand, rng) for c, i in enumerate(chosen)]
    else:
        cidx = pick_candidates(toy_demand, 6, rng, min_spacing_km=0.6)
        cands = make_candidates(toy_demand, cidx, rng)
        # öğretimde tip çeşitliliği görünsün: arazileri elle çeşitlendir
        for c, land in zip(cands, [40_000, 80_000, 160_000, 35_000, 120_000, 200_000]):
            c["land_m2"] = land
    return {"demand": toy_demand, "candidates": cands}
