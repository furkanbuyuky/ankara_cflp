"""Ankara'nın 9 merkez ilçesi için ham OSM verisini indirir.

  districts.json   ilçe sınırları (Nominatim, GeoJSON poligon)
  mahalle.json     mahalle (admin_level=8) merkezleri ve etiketleri (Overpass, out center)
  residential.json landuse=residential alanlarının sınır kutuları (Overpass, out bb)
                   → mahalle nüfusunu dağıtmak için konut alanı vekil değişkeni

Çıktılar data/raw/ altına yazılır; dosya zaten varsa tekrar indirilmez.
Çalıştırma:  python -m cflp.data_pipeline.fetch_osm
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

try:  # Windows'ta sistem sertifika deposunu kullan
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "data" / "raw"
UA = {"User-Agent": "cflp-hospital-assignment/0.1 (university course project)"}

DISTRICTS = [
    "Altındağ", "Çankaya", "Etimesgut", "Gölbaşı", "Keçiören",
    "Mamak", "Pursaklar", "Sincan", "Yenimahalle",
]
# güney, batı, kuzey, doğu — 9 ilçenin kentsel kısmını kapsayan kutu
BBOX = (39.62, 32.40, 40.12, 33.10)

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

_B = ",".join(str(v) for v in BBOX)
QUERIES = {
    "mahalle.json": (
        f'[out:json][timeout:180];rel["admin_level"="8"]["boundary"="administrative"]({_B});out center tags;'
    ),
    "residential.json": (
        f'[out:json][timeout:180];way["landuse"="residential"]({_B});out bb;'
    ),
}


def _get(url: str, data: bytes | None = None, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def overpass(query: str, retries: int = 9) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            return _get(url, urllib.parse.urlencode({"data": query}).encode())
        except Exception as e:  # noqa: BLE001 - ağ hataları çeşitli
            last = e
            print(f"  {url} başarısız ({e}); tekrar deneniyor...", flush=True)
            time.sleep(15)
    raise RuntimeError(f"Overpass sorgusu başarısız: {last}")


def fetch_districts() -> dict:
    features = []
    for name in DISTRICTS:
        q = urllib.parse.urlencode(
            {
                "q": f"{name}, Ankara, Türkiye",
                "format": "jsonv2",
                "polygon_geojson": 1,
                "polygon_threshold": 0.0005,
                "limit": 5,
            }
        )
        res = json.loads(_get(f"https://nominatim.openstreetmap.org/search?{q}", timeout=60))
        hit = next(
            (r for r in res if r.get("type") == "administrative" and r["geojson"]["type"] != "Point"),
            None,
        )
        if hit is None:
            raise RuntimeError(f"{name} için sınır bulunamadı")
        features.append(
            {"type": "Feature", "properties": {"name": name, "osm_id": hit["osm_id"]}, "geometry": hit["geojson"]}
        )
        print(f"  {name}: {hit['display_name']}", flush=True)
        time.sleep(1.2)  # Nominatim kullanım politikası: en fazla 1 istek/sn
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / "districts.json"
    if not path.exists():
        print("districts.json: Nominatim'den indiriliyor...", flush=True)
        path.write_text(json.dumps(fetch_districts(), ensure_ascii=False), encoding="utf-8")
    for name, query in QUERIES.items():
        path = RAW / name
        if path.exists():
            print(f"{name}: zaten var, atlanıyor")
            continue
        print(f"{name}: indiriliyor...", flush=True)
        t = time.time()
        body = overpass(query)
        json.loads(body)  # geçerli JSON mu?
        path.write_bytes(body)
        print(f"{name}: {len(body) / 1e6:.1f} MB, {time.time() - t:.0f} sn", flush=True)


if __name__ == "__main__":
    main()
