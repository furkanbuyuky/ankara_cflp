# Ankara Hastane CFLP

Ankara'nın 9 merkez ilçesi için kapasiteli tesis yerleşim problemi (CFLP) simülasyonu ve arayüzü.
Mevcut hastaneler yok sayılır. Yeni hastanelerin yeri, büyüklüğü (tek tip ya da küçük/orta/büyük)
ve mahallelerin hangi hastaneye bağlanacağı belirlenir. Çözüm yöntemleri:

- **Exact:** MIP (PuLP + HiGHS)
- **Genetik Algoritma:** rulet / turnuva / rank seçimi × tek nokta / iki nokta / uniform çaprazlama
- **Diferansiyel Evrim:** rand/1, best/1, current-to-best/1

Tasarım kararları: [docs/DESIGN.md](docs/DESIGN.md)

## Kurulum

Python 3.11+ ve Node 20+ gerekir.

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install numpy pulp highspy shapely numba fastapi "uvicorn[standard]" pydantic pytest truststore
```

```bash
cd frontend
npm install
```

## Çalıştırma

İki terminalde:

```bash
cd backend && .venv/Scripts/python -m uvicorn api.main:app --port 8000
```

```bash
cd frontend && npm run dev
```

Tarayıcıda http://localhost:5173 adresini açın.

Uzun süren hesapları (varsayılan ayarlarda exact çözüm ve sweep eğrileri, ~10 dk) önceden
önbelleğe almak için API çalışırken:

```bash
cd backend && .venv/Scripts/python scripts/precompute.py
```

Tek sunucudan servis etmek için `npm run build` yeterli. API, `frontend/dist` klasörü varsa onu
kök adreste sunar (http://localhost:8000).

## Veri

`data/processed/` hazır gelir. Yeniden üretmek için:

```bash
cd backend && .venv/Scripts/python -m cflp.data_pipeline.fetch_osm
```

```bash
cd backend && .venv/Scripts/python -m cflp.data_pipeline.build_real
```

`fetch_osm` ilçe sınırlarını Nominatim'den indirir. Mahalle sınırları için
`data/raw/turkey-admin-level-8.geojson` dosyası
[izzetkalic/geojsons-of-turkey](https://github.com/izzetkalic/geojsons-of-turkey) deposundan
alınmıştır (OSM türevi, 63 MB). İlçe nüfusları TÜİK ADNKS 2024'ten gelir. Mahalle nüfusları
alan–yoğunluk modeliyle simüle edilir. İnternet yoksa `python -m cflp.data_pipeline.synthetic`
tamamen sentetik bir örnek üretir.

## Testler

```bash
cd backend && .venv/Scripts/python -m pytest -q tests
```

Testler şunları kontrol eder:

- Exact sonuç küçük örnekte brute force ile aynı mı
- Numba ve Python decoder'ları birebir aynı sonucu veriyor mu
- Kısıtlar sağlanıyor mu
- Algoritmalar tekrarlanabilir mi
- İz kaydındaki maliyetler amaç fonksiyonuyla tutarlı mı

## Klasörler

```
backend/cflp/          model, maliyetler, exact MIP, sweep, benchmark
backend/cflp/heuristics/  decoder, GA, DE, operatörler, iz kaydı (trace), pseudocode
backend/api/           FastAPI uç noktaları, iş kuyruğu, disk önbelleği
frontend/src/tabs/     5 sekme: Veri, Exact, Algoritma nasıl çalışır, Süreç, Karşılaştırma
config/defaults.json   varsayılan parametreler ve hastane tipleri
```
