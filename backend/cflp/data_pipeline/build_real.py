"""Gerçek sınırlarla Ankara örneğini üretir.

Kaynaklar:
  - İlçe sınırları: OSM (Nominatim)                       data/raw/districts.json
  - Mahalle sınırları: OSM admin_level=8 anlık görüntüsü   data/raw/turkey-admin-level-8.geojson
    (github.com/izzetkalic/geojsons-of-turkey)
  - İlçe nüfusları: TÜİK ADNKS 2024
  - Aday parseller: OSM (Geofabrik Türkiye), osm_parcels.py   data/raw/parcels.json
Mahalle nüfusları kamuya açık hazır bir veri setinde bulunamadığı için simüle edilir:
ilçe nüfusu, alan–yoğunluk modeliyle mahallelere dağıtılır (küçük alanlı mahalleler yoğun
kentsel doku, büyük alanlı eski köy mahalleleri seyrek). İlçe toplamları korunur.

Çalıştırma:  python -m cflp.data_pipeline.build_real
"""
from __future__ import annotations

import json
import math
import re

import numpy as np
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .common import (
    DISTRICTS,
    PROCESSED,
    ROOT,
    candidates_from_parcels,
    district_table,
    make_candidates,
    make_toy,
    pick_candidates,
    write_instance,
)

RAW = ROOT / "data" / "raw"
URBAN_AREA_KM2 = 3.0  # bu alanın üstünde yoğunluk hızla düşer
MIN_POPULATION = 500  # bunun altındaki kırsal mahalleler talep noktası olmaz
N_CANDIDATES = 60
SEED = 42


def _km2(geom) -> float:
    lat = geom.representative_point().y
    return geom.area * 111.32**2 * math.cos(math.radians(lat))


def _clean_name(name: str) -> str:
    name = re.sub(r"\s+(Mahallesi|Mahallsi|Mah\.?|Mh\.?)$", "", name.strip(), flags=re.IGNORECASE)
    return name


def load_districts() -> dict:
    gj = json.loads((RAW / "districts.json").read_text(encoding="utf-8"))
    return {f["properties"]["name"]: shape(f["geometry"]) for f in gj["features"]}


def load_mahalle(dpoly: dict) -> list[dict]:
    gj = json.loads((RAW / "turkey-admin-level-8.geojson").read_text(encoding="utf-8"))
    union = unary_union(list(dpoly.values()))
    out = []
    for f in gj["features"]:
        g = f.get("geometry")
        if not g or g["type"] not in ("Polygon", "MultiPolygon"):
            continue
        s = shape(g)
        if not s.is_valid:
            s = s.buffer(0)
        if not s.intersects(union):
            continue
        pt = s.representative_point()
        district = next((k for k, p in dpoly.items() if p.contains(pt)), None)
        if district is None:
            continue
        out.append(
            {
                "name": _clean_name(f["properties"].get("name", "?")),
                "district": district,
                "lat": round(pt.y, 6),
                "lon": round(pt.x, 6),
                "area_km2": round(_km2(s), 4),
                "osm_id": f["properties"].get("@id"),
            }
        )
    return out


def simulate_population(mahalle: list[dict], rng: np.random.Generator) -> list[dict]:
    """pop ∝ alan × yoğunluk(alan),  yoğunluk(a) = 1 / (1 + (a / A0)^3), lognormal gürültü."""
    out = []
    for name, prof in DISTRICTS.items():
        rows = [m for m in mahalle if m["district"] == name]
        a = np.array([m["area_km2"] for m in rows])
        w = a / (1 + (a / URBAN_AREA_KM2) ** 3) * rng.lognormal(0, 0.35, len(rows))
        pop = prof["population"] * w / w.sum()
        keep = pop >= MIN_POPULATION
        pop = np.where(keep, pop, 0)
        pop = prof["population"] * pop / pop.sum()  # ilçe toplamını koru
        for m, p, k in zip(rows, pop, keep):
            if k:
                out.append({**m, "population": int(round(p, -1))})
    for n, m in enumerate(out):
        m["id"] = n
    return out


def write_district_geojson(dpoly: dict) -> None:
    feats = [
        {
            "type": "Feature",
            "properties": {"name": k, "population": DISTRICTS[k]["population"]},
            "geometry": mapping(p.simplify(0.0008, preserve_topology=True)),
        }
        for k, p in dpoly.items()
    ]
    path = PROCESSED / "districts.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    print("ilçe sınırları:", path)


def main() -> None:
    rng = np.random.default_rng(SEED)
    dpoly = load_districts()
    PROCESSED.mkdir(parents=True, exist_ok=True)
    write_district_geojson(dpoly)
    mahalle = load_mahalle(dpoly)
    demand = simulate_population(mahalle, rng)
    parcels_path = RAW / "parcels.json"
    parcels = json.loads(parcels_path.read_text(encoding="utf-8")) if parcels_path.exists() else None
    if parcels:
        cand = candidates_from_parcels(demand, parcels, N_CANDIDATES, rng)
    else:
        print("UYARI: data/raw/parcels.json yok; adaylar mahalle merkezlerinden simüle ediliyor")
        cand = make_candidates(demand, pick_candidates(demand, N_CANDIDATES, rng), rng)
    sources = {
        "district_boundaries": "OpenStreetMap (Nominatim)",
        "mahalle_boundaries": "OpenStreetMap admin_level=8 (github.com/izzetkalic/geojsons-of-turkey)",
        "district_population": "TÜİK ADNKS 2024",
        "mahalle_population": "Simülasyon: alan–yoğunluk modeli, ilçe toplamları korunur",
        "candidates": (
            "OSM boş/yapılaşmaya uygun parseller (inşaat, atıl sanayi, çayır vb.; ≥35.000 m², ana yollardan ≥100 m); "
            "arazi = parselin gerçek alanı, arsa fiyatı ilçe profiline göre simüle"
            if parcels else "Simülasyon: mahallelerden seçilen adaylar; arazi ve arsa fiyatı ilçe profiline göre"
        ),
    }
    data = {
        "id": "ankara",
        "name": "Ankara — 9 merkez ilçe",
        "source": "osm",
        "districts": district_table(),
        "demand": demand,
        "candidates": cand,
        "meta": {"seed": SEED, "sources": sources, "osm_mahalle_count": len(mahalle)},
    }
    print("ankara:", write_instance(data), f"{len(mahalle)} mahalle → {len(demand)} talep noktası,",
          len(cand), "aday")
    trng = np.random.default_rng(7)
    toy = make_toy(demand, trng, parcels)
    print("toy:", write_instance({
        "id": "toy",
        "name": "Öğretim örneği (10 mahalle, 6 aday)",
        "source": "osm",
        "districts": data["districts"],
        **toy,
        "meta": {"seed": 7, "note": "Kızılay çevresindeki 10 mahalle; nüfuslar öğretim için ölçeklendi",
                 "sources": sources},
    }))


if __name__ == "__main__":
    main()
