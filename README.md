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
.venv/Scripts/python -m pip install -r requirements-dev.txt
```

```bash
cd frontend
npm install
```

## Çalıştırma

İki terminalde:

```bash
cd backend && .venv/Scripts/python -m uvicorn server.main:app --port 8000
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

## Yayınlama (Vercel)

Uygulama Vercel'in ücretsiz (Hobby) planında çalışır. Arayüz statik olarak sunulur, `/api/*`
istekleri [api/index.py](api/index.py) Python fonksiyonuna gider. Ayarlar [vercel.json](vercel.json)
dosyasındadır. GitHub deposu bağlandıktan sonra her `git push` otomatik olarak yeniden yayınlanır.

Bir kerelik kurulum: vercel.com'da GitHub hesabıyla giriş yapın, *Add New → Project → Import Git
Repository* ile depoyu seçin, ayarlara dokunmadan **Deploy**'a basın.

Sunucusuz ortamın sınırları (istek başına en fazla 300 sn, arka plan işi yok) nedeniyle yayında
uygulanan farklar:

| Konu | Yerelde | Vercel'de |
|---|---|---|
| Uzun işler | Arka plan kuyruğu + ilerleme çubuğu | İstek içinde çalışır, bekleme göstergesi görünür |
| Exact zaman limiti | 300 sn'ye kadar | En fazla 120 sn |
| Sweep eğrisi | Nokta başına 15 sn | Toplam ~4 dk'ya sığacak şekilde kısaltılır |
| Karşılaştırma | Sunucuda paralel süreçler | Her çalışma ayrı istek, tarayıcı 6'şar paralel gönderir |
| Önbellek | `cache/` diskte kalıcı | Yalnızca `precomputed/` kalıcı, yeni sonuçlar geçicidir |

`precomputed/` klasörü varsayılan ayarlar için önceden hesaplanmış exact, sweep, optimize ve
benchmark sonuçlarını içerir. Site açılır açılmaz bu sonuçlar gösterilir. Güncellemek için
`backend/scripts/precompute.py` çalıştırılıp `cache/` içeriği `precomputed/`'a kopyalanır.

Docker kullanan bir sunucuya (ör. Render) taşımak için kökteki [Dockerfile](Dockerfile) hazırdır:

```bash
docker build -t ankara-cflp .
```

```bash
docker run --rm -p 7860:7860 ankara-cflp
```

## Veri

`data/processed/` hazır gelir. Yeniden üretmek için:

```bash
cd backend && .venv/Scripts/python -m cflp.data_pipeline.fetch_osm
```

```bash
cd backend && .venv/Scripts/python -m cflp.data_pipeline.osm_parcels
```

```bash
cd backend && .venv/Scripts/python -m cflp.data_pipeline.build_real
```

| Veri | Kaynak |
|---|---|
| İlçe sınırları | OpenStreetMap, Nominatim (`fetch_osm`) |
| Mahalle sınırları | OSM admin_level=8 anlık görüntüsü, `data/raw/turkey-admin-level-8.geojson` ([izzetkalic/geojsons-of-turkey](https://github.com/izzetkalic/geojsons-of-turkey), 63 MB) |
| İlçe nüfusları | TÜİK ADNKS 2024 |
| Mahalle nüfusları | İlçe nüfusu, alan–yoğunluk modeliyle mahallelere dağıtılır (simülasyon) |
| Aday yerler | Gerçek OSM parselleri: [Geofabrik Türkiye](https://download.geofabrik.de/europe/turkey.html) dosyası (`data/raw/osm/turkey-latest.osm.pbf`, ~650 MB) `osm_parcels` ile işlenir |

Aday parsel kuralları:
- Etiket: inşaat alanı, atıl sanayi alanı, yapılaşmamış arazi, çayır, tarım arazisi, bozkır ya da çalılık.
- En az 35.000 m², ince uzun olmayan (yol kenarı şeritleri ve kavşak adaları elenir).
- Ana yollara en az 100 m uzak.
- Park, koru, mezarlık, askeri alan, kampüs, havaalanı, su ya da korunan alan içinde değil.

60 aday, 3 km içindeki nüfus ve parsel büyüklüğüyle ağırlıklı, birbirine en az 1,2 km uzak olacak şekilde seçilir. Arazi
büyüklüğü parselin gerçek alanıdır. Arsa fiyatı ilçeye göre simüle edilir. İnternet yoksa
`python -m cflp.data_pipeline.synthetic` tamamen sentetik bir örnek üretir.

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
backend/server/        FastAPI uç noktaları, iş kuyruğu, disk önbelleği
api/index.py           Vercel giriş noktası
frontend/src/tabs/     5 sekme: Veri, Exact, Algoritma nasıl çalışır, Süreç, Karşılaştırma
config/defaults.json   varsayılan parametreler ve hastane tipleri
```
