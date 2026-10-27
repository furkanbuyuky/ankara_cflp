"""Aday hastane yerleri için gerçek arazi parsellerini Türkiye OSM dosyasından çıkarır.

Girdi : data/raw/osm/turkey-latest.osm.pbf  (Geofabrik)
Çıktı : data/raw/parcels.json  — 9 merkez ilçedeki uygun parseller

Uygun parsel:
  - Yapılaşmaya açık arazi etiketi: landuse = brownfield / greenfield / construction / grass /
    meadow / farmland, natural = grassland / scrub
  - En az 35.000 m² (küçük hastanenin arazi ihtiyacı)
  - İnce uzun değil (yol kenarı şeritleri, kavşak adaları elenir): 4πA/P² ≥ 0,25
  - Hastane noktası (parselin kenarlarına en uzak iç nokta) ana yollara en az 100 m uzak
  - Hastane noktası park, koru, mezarlık, askeri alan, kampüs, havaalanı, su ya da korunan alan
    içinde değil (bu alanlar OSM'de çoğu zaman "çim/çayır" olarak da etiketlidir)

Çalıştırma:  python -m cflp.data_pipeline.osm_parcels
"""
from __future__ import annotations

import json
import math
import time

import osmium
from osmium.filter import KeyFilter
import numpy as np
import shapely
from shapely import STRtree, wkb
from shapely.geometry import Point, shape
from shapely.ops import polylabel

from .common import ROOT

RAW = ROOT / "data" / "raw"
PBF = RAW / "osm" / "turkey-latest.osm.pbf"
OUT = RAW / "parcels.json"

BBOX = (32.40, 39.62, 33.10, 40.12)  # batı, güney, doğu, kuzey
LANDUSE = {"brownfield", "greenfield", "construction", "grass", "meadow", "farmland"}
NATURAL = {"grassland", "scrub"}
MAJOR_ROADS = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"}
EXCLUDE = {
    "leisure": {"park", "nature_reserve", "garden", "golf_course", "recreation_ground", "pitch", "stadium",
                "playground", "sports_centre"},
    "landuse": {"forest", "cemetery", "military", "recreation_ground", "railway", "religious"},
    "amenity": {"university", "college", "school", "hospital", "clinic", "grave_yard", "place_of_worship"},
    "boundary": {"protected_area", "national_park"},
    "natural": {"water", "wetland", "wood"},
    "aeroway": {"aerodrome"},
}
MIN_AREA_M2 = 35_000
MIN_COMPACTNESS = 0.25
ROAD_CLEARANCE_M = 100

LAT0 = 39.93
KX = 111_320 * math.cos(math.radians(LAT0))  # derece → metre (yerel düzlem)
KY = 110_574


def to_m(geom):
    return shapely.transform(geom, lambda c: c * np.array([KX, KY]))


def in_bbox(b) -> bool:
    w, s, e, n = BBOX
    return not (b[2] < w or b[0] > e or b[3] < s or b[1] > n)


def main() -> None:
    t0 = time.time()
    factory = osmium.geom.WKBFactory()
    parcels, roads, excluded = [], [], []
    keys = ("landuse", "natural", "leisure", "amenity", "boundary", "aeroway")
    fp = (
        osmium.FileProcessor(str(PBF))
        .with_locations()
        .with_areas(KeyFilter(*keys))
        .with_filter(KeyFilter("highway", *keys))
    )
    for obj in fp:
        tags = obj.tags
        if obj.is_way() and tags.get("highway") in MAJOR_ROADS:
            try:
                g = wkb.loads(factory.create_linestring(obj), hex=True)
            except Exception:  # noqa: BLE001 - eksik düğümlü yollar
                continue
            if in_bbox(g.bounds):
                roads.append(g)
        elif obj.is_area():
            kind = tags.get("landuse") if tags.get("landuse") in LANDUSE else (
                tags.get("natural") if tags.get("natural") in NATURAL else None)
            excl = any(tags.get(k) in v for k, v in EXCLUDE.items())
            if kind is None and not excl:
                continue
            try:
                g = wkb.loads(factory.create_multipolygon(obj), hex=True)
            except Exception:  # noqa: BLE001 - kapanmayan poligonlar
                continue
            if not in_bbox(g.bounds):
                continue
            if excl:
                excluded.append(g)
            if kind is not None:
                parcels.append((kind, obj.orig_id(), obj.from_way(), g))
    print(f"OSM okundu: {len(parcels)} arazi poligonu, {len(roads)} ana yol, {len(excluded)} yasak alan, "
          f"{time.time() - t0:.0f} sn", flush=True)

    dist = json.loads((RAW / "districts.json").read_text(encoding="utf-8"))
    dpoly = {f["properties"]["name"]: shape(f["geometry"]) for f in dist["features"]}
    roads_m = [to_m(r) for r in roads]
    tree = STRtree(roads_m)
    excl_m = [to_m(g) for g in excluded]
    excl_tree = STRtree(excl_m)

    out, stats = [], {"küçük": 0, "ince": 0, "yol": 0, "yasak alan": 0, "ilçe dışı": 0}
    for kind, oid, from_way, g in parcels:
        gm = to_m(g)
        area = gm.area
        if area < MIN_AREA_M2:
            stats["küçük"] += 1
            continue
        # çok parçalı poligonlarda en büyük parça
        part = max(gm.geoms, key=lambda p: p.area) if gm.geom_type == "MultiPolygon" else gm
        comp = 4 * math.pi * part.area / part.length**2
        if comp < MIN_COMPACTNESS:
            stats["ince"] += 1
            continue
        site = polylabel(part, tolerance=5)
        near = tree.query(site.buffer(ROAD_CLEARANCE_M))
        if len(near) and min(roads_m[i].distance(site) for i in near) < ROAD_CLEARANCE_M:
            stats["yol"] += 1
            continue
        if any(excl_m[i].contains(site) for i in excl_tree.query(site)):
            stats["yasak alan"] += 1
            continue
        lon, lat = site.x / KX, site.y / KY
        district = next((k for k, p in dpoly.items() if p.contains(Point(lon, lat))), None)
        if district is None:
            stats["ilçe dışı"] += 1
            continue
        out.append(
            {
                "osm": f"{'way' if from_way else 'relation'}/{oid}",
                "kind": kind,
                "district": district,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "area_m2": round(part.area, -2),
                "compactness": round(comp, 3),
            }
        )
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    by_d = {}
    for p in out:
        by_d[p["district"]] = by_d.get(p["district"], 0) + 1
    print(f"Elenen: {stats}")
    print(f"Uygun parsel: {len(out)} → {OUT}")
    print("İlçelere göre:", dict(sorted(by_d.items())))
    print(f"Toplam süre {time.time() - t0:.0f} sn")


if __name__ == "__main__":
    main()
