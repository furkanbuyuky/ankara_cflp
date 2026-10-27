# Ankara Hastane CFLP — Tasarım Dokümanı

> Ödev: *"Simulate a CFLP for hospitals in Ankara. Current existing hospitals in the city will be ignored. Create an UI for the problem and your solution."*

Bu doküman uygulamaya başlamadan önce tüm kararları sabitler. Kodda bir karar değişirse önce burası güncellenir.

---

## 0. Kapsam özeti

| Konu | Karar |
|---|---|
| Coğrafya | Ankara'nın 9 merkez ilçesi: Altındağ, Çankaya, Etimesgut, Gölbaşı, Keçiören, Mamak, Pursaklar, Sincan, Yenimahalle |
| Mevcut hastaneler | Yok sayılır, şehir "boş sayfa" |
| Talep noktaları | Mahalle merkezleri (~300–400 nokta), nüfus ağırlıklı |
| Aday yerler | ~50 nokta, her birinin müsait arazisi ve arsa fiyatı var |
| Senaryolar | **S1: Tek tip** (sadece orta boy) ve **S2: Üç tip** (küçük / orta / büyük) |
| Atama | Single-sourcing: her mahalle tek hastaneye gider ya da karşılanmaz |
| Çözüm yöntemleri | Exact MIP (PuLP + HiGHS), Genetik Algoritma (3 seçim × 3 çaprazlama varyantı), Diferansiyel Evrim (2–3 varyant) |
| Teknoloji | Algoritmalar ve backend **Python** (FastAPI), UI **React + TypeScript** (Vite, Leaflet, Chart.js) |
| UI dili | **Türkçe** |

---

## 0.1 Uygulama sırasında değişen kararlar

Aşağıdaki maddeler, uygulama sırasında ölçülen sonuçlara göre ilk tasarımdan farklılaştı. Aşağıdaki bölümlerin ilgili yerleri bu tabloya göre okunmalı.

| Konu | İlk tasarım | Uygulanan | Neden |
|---|---|---|---|
| Talep noktaları | OSM Overpass, mahalle merkezleri | OSM admin_level=8 anlık görüntüsü ([izzetkalic/geojsons-of-turkey](https://github.com/izzetkalic/geojsons-of-turkey)), 375 mahalle | Overpass sunucuları uzun süre 502/504 döndü |
| Mahalle nüfusu | TÜİK mahalle verisi | İlçe nüfusu (TÜİK ADNKS 2024), alan–yoğunluk modeliyle mahallelere dağıtılır | Kamuya açık, hazır mahalle nüfus verisi bulunamadı |
| Aday sayısı | ~50 | 60 | Tek tipte yeterli seçenek kalsın diye |
| Varsayılan parametreler | β = 3,0 | β = 2,5, α = 250, tip maliyetleri yeniden kalibre edildi (`config/defaults.json`) | Daha dengeli S/M/L karışımı, makul hastane sayısı (S1: 23, S2: 16) |
| Atama kümesi | Tüm adaylar | Her mahalle en yakın 15 adaya atanabilir (`assign_k_nearest`, UI'dan değişir) | MIP boyutu yaklaşık 4 kat küçülür. Exact ve sezgiseller aynı kümeyi kullanır |
| MIP | Temel formülasyon | + geçerli eşitsizlik (toplam kapasite ≥ karşılanan talep) + GA ile başlangıç çözümü (sweep'te) | Kapasite çok sıkı (%95–98 doluluk), LP sınırı zayıf |
| Optimalite | "optimal" referans çizgisi | **En iyi çözüm + alt sınır** (gap) | 600 sn'de bile gap %0,5 kaldı. UI optimumun bulunduğu aralığı gösterir |
| Decoder | Regret tabanlı açgözlü atama | + ikinci geçiş: karşılanamayan mahalle için başka bir mahalleyi boş hastaneye kaydırıp yer açma (`dec.fix`) | Sıkı kapasitede tek geçişli decoder %25'e varan kötü sonuç veriyordu |
| Hız | Saf Python | Decoder'ın numba ile derlenmiş eşi (iz kaydı Python sürümünden). Eşdeğerlik testle sınanır | 10.000 değerlendirme ~20 sn → ~3 sn |
| Altlık harita | — | OpenStreetMap karoları (koyu temada CSS filtresi) | CARTO artık API anahtarı istiyor |
| Polish süresi | — | 10 sn, gap %0,1 | Sabit hastanelerle atama MIP'i de sıkı kapasitede yavaş |

---

## 1. Mimari

```
┌──────────────────────────── Frontend (React + TS) ────────────────────────────┐
│  Sekme 1 Veri │ Sekme 2 Exact │ Sekme 3 Nasıl çalışır │ Sekme 4 Süreç │ Sekme 5 Karşılaştırma │
│  Leaflet harita · Chart.js grafikler · Pseudocode paneli · Trace oynatıcı      │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │ JSON (REST)  +  iş ilerlemesi (polling)
┌───────────────────────────────┴──────────── Backend (Python) ─────────────────┐
│  api/      FastAPI uç noktaları, iş kuyruğu (uzun işler), disk cache           │
│  cflp/     instance · costs · exact · sweep · heuristics (ga, de, decoder)     │
│            trace (olay kaydı) · benchmark                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Temel prensip:** Algoritma bir kez Python'da çalışır ve bir **trace** (olay listesi) üretir. Frontend bu trace'i oynatır. İleri/geri sarma, hız ayarı ve duraklatma tamamen tarayıcıda olur, sunucuya tekrar gidilmez.

**Neden Streamlit değil:** Her etkileşimde script'i baştan çalıştırdığı için adım adım animasyon, zaman çizelgesi ve yan yana yarış görünümü gibi istediğimiz etkileşimleri kurmak çok zahmetli.

**Python bağımlılıkları:** `numpy`, `pulp` (+ `highspy`, PuLP'un HiGHS arayüzü; yedek olarak PuLP'la gelen CBC), `fastapi`, `uvicorn`, `pydantic`, `shapely` (sadece veri hazırlığında).
**Frontend bağımlılıkları:** `react`, `react-leaflet` / `leaflet`, `chart.js` / `react-chartjs-2`. Başka büyük kütüphane yok.

---

## 2. Veri

### 2.1 Kaynaklar ve hazırlık hattı (tek seferlik)

`backend/cflp/data_pipeline/` altında çalışan, sonucu `data/processed/` altına JSON olarak yazan script'ler. Uygulama sadece işlenmiş JSON'u okur, çalışırken internete çıkmaz.

1. **İlçe sınırları:** OSM kaynaklı Ankara ilçe GeoJSON'u (haritada çizim + noktaların hangi ilçeye düştüğü)
2. **Mahalle merkezleri:** OSM Overpass, `place=neighbourhood|quarter|suburb` düğümleri, 9 ilçe içinde
3. **Nüfus:** TÜİK ADNKS (mahalle bazında varsa onu, yoksa ilçe nüfusunu mahallelere eşit ya da alan oranında dağıtırız)
4. **Yedek (sentetik) mod:** Gerçek mahalle verisi toplanamazsa ilçe merkezleri etrafında, ilçe nüfusuyla orantılı Gauss kümeleri üretilir. Seed ile tekrarlanabilir. Ödevdeki "simulate" ifadesine de uygun.

> ⚠️ Açık nokta: Mahalle nüfus verisinin erişilebilirliği veri hazırlığında netleşecek. Model ve UI iki modda da aynı çalışır.

### 2.2 Talep

- $w_i$ = mahalle nüfusu (ulaşım maliyetinde ağırlık)
- $d_i = w_i \cdot \beta / 1000$ = **yatak ihtiyacı** (kapasite kısıtında). Varsayılan $\beta = 3.0$ yatak/1000 kişi (UI'da slider)

### 2.3 Aday yerler

- ~50 nokta, kentsel alandan örneklenir (mahalle merkezlerinin bir alt kümesi + küçük rastgele kayma)
- $A_j$: müsait arazi (m²). İlçe tipine göre dağılım: merkez ilçelerde (Çankaya, Altındağ) küçük, dış ilçelerde (Sincan, Etimesgut, Gölbaşı) büyük
- $\rho_j$: arsa birim fiyatı (TL/m²). İlçe bazlı tablo + gürültü, sıralama gerçekçi olacak (Çankaya en pahalı)

### 2.4 Hastane tipleri (`config/hospital_types.json`, UI'da düzenlenebilir)

Değerler **illüstratif** ve parametriktir. Önemli olan ölçek ekonomisi (büyüdükçe yatak başı maliyetin düşmesi).

| Tip | $u_k$ (yatak) | $a_k$ (arazi, m²) | $C_k$ (inşaat) | Yatak başı |
|---|---|---|---|---|
| Küçük (S) | 250 | 30.000 | düşük | en yüksek |
| Orta (M) | 600 | 70.000 | orta | orta |
| Büyük (L) | 1200 | 150.000 | yüksek | en düşük |

- **S1 (tek tip):** Sadece M
- **S2 (üç tip):** S, M, L

### 2.5 Maliyetler

- **Mesafe:** $\text{dist}_{ij} = \text{haversine}(i, j) \times 1.3$ (yol dolambaç katsayısı, parametre)
- **Yatırım:** $I_{jk} = C_k + \rho_j \cdot a_k$ (tek seferlik, bütçe kısıtında kullanılır)
- **Yıllıklandırılmış açılış maliyeti:** $F_{jk} = I_{jk} \cdot \text{CRF}$, $\text{CRF} = \dfrac{r(1+r)^n}{(1+r)^n - 1}$. Varsayılan $r = 0.05$, $n = 30$ (CRF ≈ 0.065)
- **Yıllık ulaşım maliyeti:** $c_{ij} = \alpha \cdot w_i \cdot \text{dist}_{ij}$. $\alpha$ (TL / kişi·km·yıl) UI'da slider. Hastane sayısını asıl belirleyen parametre bu
- **Karşılanmayan talep cezası:** $\pi_i = \pi \cdot d_i$. $\pi$ otomatik hesaplanır: bir yatağı karşılamanın mümkün en pahalı yolunun 10 katı. Böylece model gerçekten mecbur kalmadıkça talebi karşılamamayı seçmez

### 2.6 Örnekler (instance'lar)

| Ad | Boyut | Kullanım |
|---|---|---|
| `ankara` | ~300–400 talep × ~50 aday | Sekme 1, 2, 4, 5 |
| `toy` | 10 talep × 6 aday (Çankaya'da küçük bir bölge) | Sekme 3 (öğretim) |

Her ikisi de aynı veri yapısında. `toy` sabit seed ile üretilir, sunumda hep aynı görünür.

---

## 3. Matematiksel model (exact)

**Kümeler:** $I$ talep noktaları, $J$ aday yerler, $K$ hastane tipleri. $K_j = \{k \in K : a_k \le A_j\}$ ($j$'nin arazisine sığan tipler).

**Değişkenler:**
- $y_{jk} \in \{0,1\}$: $j$'de $k$ tipi hastane açılır ($k \in K_j$)
- $x_{ij} \in \{0,1\}$: $i$, $j$'ye atanır
- $z_i \in \{0,1\}$: $i$ karşılanmaz

**Amaç (yıllık toplam maliyet):**
$$\min \; \sum_{j}\sum_{k \in K_j} F_{jk}\, y_{jk} \;+\; \sum_{i}\sum_{j} c_{ij}\, x_{ij} \;+\; \sum_i \pi_i\, z_i$$

**Kısıtlar:**
1. $\sum_j x_{ij} + z_i = 1 \quad \forall i$ (her mahalle tek hastaneye ya da karşılanmaz)
2. $\sum_i d_i\, x_{ij} \le \sum_{k \in K_j} u_k\, y_{jk} \quad \forall j$ (kapasite)
3. $\sum_{k \in K_j} y_{jk} \le 1 \quad \forall j$ (yer başına en fazla bir hastane)
4. $x_{ij} \le \sum_{k \in K_j} y_{jk} \quad \forall i, j$ (güçlü formülasyon, LP gevşetmesini sıkılaştırır)

**Opsiyonel kısıtlar (UI'dan aç/kapa):**
- (P) Hastane sayısı üst sınırı: $\sum_{j,k} y_{jk} \le p_{\max}$
- (B) Bütçe: $\sum_{j,k} I_{jk}\, y_{jk} \le B$
- (D) Maksimum erişim mesafesi: $\text{dist}_{ij} > D_{\max}$ ise $x_{ij}$ değişkeni oluşturulmaz
- (U) Minimum doluluk: $\sum_i d_i x_{ij} \ge \theta \sum_k u_k y_{jk}$

**Solver:** PuLP + HiGHS, zaman limiti (varsayılan 60 sn) UI'dan ayarlanır. Sonuçta durum (optimal / zaman limiti), MIP gap ve süre raporlanır.

**Boyut:** 350 × 50 = 17.500 $x$ binary'si + ~150 $y$. HiGHS'ın makul sürede çözmesi beklenir. Sorun çıkarsa (D) kısıtı ya da uzak çiftlerin elenmesi (her mahalle için en yakın 15 aday) problemi önemli ölçüde küçültür.

### 3.1 Sweep (Sekme 2 slider'ları)

Slider her oynatıldığında yeniden çözmek yerine eğri önceden hesaplanır:
- **Sayı sweep'i:** $p_{\max} = 1, 2, \dots, P$ (kısıtsız optimumdaki $p^*$'ın birkaç fazlasına kadar)
- **Bütçe sweep'i:** $B$ için ~20 noktalı ızgara (0'dan kısıtsız optimumun yatırımının biraz üstüne)

Her nokta için toplam maliyet, kırılımı, açılan hastaneler, karşılanmayan talep ve atama kaydedilir. Bir önceki çözüm warm start olarak verilir. Sonuçlar parametre hash'iyle disk cache'e yazılır.

Beklenen görünüm: düşük sınırlarda karşılanmayan talep > 0. $p^*$ (ya da $B^*$) noktasından sonra eğri düzleşir ve hastane sayısı artmaz.

---

## 4. Metasezgiseller

### 4.1 Ortak katman (`heuristics/common.py`)

**Kodlama:** $g \in \{0, 1, \dots, |K|\}^{|J|}$. $g_j = 0$ kapalı, $g_j = k$ ise $k$ tipi hastane. S1'de $g_j \in \{0, 1\}$. Arazisine sığmayan tipler **maske** ile hiç üretilmez (başlangıç, mutasyon ve DE dönüşümünde $\min(g_j, k^{\max}_j)$).

**Decoder (kromozom → çözüm), regret-based greedy:**
1. Açık hastaneleri ve kalan kapasitelerini çıkar
2. Her mahalle için açık hastaneleri mesafeye göre sırala ((D) aktifse $D_{\max}$ ötesini at)
3. Mahalleleri **regret** sırasına koy: (2. en yakın − en yakın) × $w_i$, büyük olan önce
4. Sırayla her mahalleyi, kapasitesi yeten en yakın hastaneye ata. Hiçbiri yetmezse "karşılanmadı" ($z_i = 1$)
5. Maliyet = yıllık açılış + ulaşım + ceza (exact modelle **birebir aynı amaç fonksiyonu**)

**Repair (kısıt P ve B):** Sınır aşılıyorsa, açılış maliyetine göre en az talep taşıyan hastane kapatılır ve sınır sağlanana kadar tekrarlanır. Repair edilmiş kromozom popülasyona geri yazılır (Lamarckian).

**Not:** Decoder sezgisel olduğu için aynı $y$ ile exact çözümden kötü bir atama verebilir. Bu yüzden çalışma sonunda en iyi bireyin $y$'si sabitlenip atama MIP ile tam çözülür ("**polish**" adımı). UI'da "decoder sonucu" ve "polish sonrası" ayrı gösterilir. Gap'in ne kadarının yer seçiminden, ne kadarının atamadan geldiği böylece görünür.

**Fitness bütçesi:** Tüm algoritmalar aynı sayıda fitness değerlendirmesi ile durdurulur (varsayılan 20.000). Adil karşılaştırma için şart.

### 4.2 Genetik Algoritma (`heuristics/ga.py`)

```
GA(pop_size N, p_c, p_m, elite e, selection, crossover, max_evals)
 1  P ← rastgele N birey (her gen p_open olasılıkla açık, tipi rastgele)
 2  her birey için: repair, decode, maliyet hesapla
 3  while değerlendirme < max_evals:
 4      E ← P'nin en iyi e bireyi                         # elitizm
 5      Q ← E
 6      while |Q| < N:
 7          ebeveyn1 ← SEÇ(P)                            # rulet / turnuva / rank
 8          ebeveyn2 ← SEÇ(P)
 9          if rand < p_c: (c1, c2) ← ÇAPRAZLA(e1, e2)  # tek nokta / iki nokta / uniform
10          else: (c1, c2) ← (e1, e2)
11          her gen için rand < p_m ise rastgele geçerli tipe çevir   # mutasyon
12          c1, c2 için repair, decode, maliyet
13          Q ← Q ∪ {c1, c2}
14      P ← Q
15      en iyiyi güncelle, nesil özetini kaydet
16  return en iyi (+ polish)
```

**Seçim varyantları:**
- **Rulet:** Minimizasyon için dönüşüm $f_i = c_{\max} - c_i + \varepsilon$ (popülasyon içi). Bu dönüşüm pseudocode'da ayrı bir satır olarak gösterilir, öğretilecek önemli bir nokta
- **Turnuva:** $k$ rastgele birey, en düşük maliyetli kazanır ($k$ slider'ı, varsayılan 3)
- **Rank (doğrusal sıralama):** Seçilim baskısı $s \in [1, 2]$. Ölçek sorununu çözdüğü için ruletle karşılaştırmak öğretici

**Çaprazlama:** Tek nokta, iki nokta, uniform (gen başına 0.5).
**Mutasyon:** Rastgele gen sıfırlama (maske içinde).
**Parametreler (UI):** $N$ (varsayılan 50), $p_c$ (0.9), $p_m$ ($1/|J|$), $e$ (2), $p_{open}$ (0.2), seçim türü, çaprazlama türü, seed.

### 4.3 Diferansiyel Evrim (`heuristics/de.py`)

Sürekli vektör $x \in [0, |K|+1)^{|J|}$, dönüşüm $g_j = \min(\lfloor x_j \rfloor, k^{\max}_j)$.

```
DE(N, F, CR, strateji, max_evals)
 1  X ← [0, K+1)^J içinde rastgele N vektör; her biri için dönüştür, repair, decode, maliyet
 2  while değerlendirme < max_evals:
 3      for her hedef vektör x_t:
 4          r1, r2, r3 ← t'den ve birbirinden farklı rastgele indeksler
 5          v ← x_r1 + F · (x_r2 − x_r3)                  # rand/1
 6            (best/1:  v ← x_best + F · (x_r1 − x_r2))
 7          v'yi sınırlara yansıt
 8          j_rand ← rastgele indeks
 9          u_j ← v_j  eğer rand < CR veya j = j_rand, değilse x_t,j   # binom çaprazlama
10          u'yu dönüştür (floor), repair, decode, maliyet
11          if maliyet(u) ≤ maliyet(x_t): x_t ← u          # açgözlü seçim
12      en iyiyi güncelle, nesil özetini kaydet
13  return en iyi (+ polish)
```

**Varyantlar:** DE/rand/1/bin, DE/best/1/bin, (opsiyonel) DE/current-to-best/1/bin.
**Parametreler (UI):** $N$ (50), $F$ (0.5), $CR$ (0.9), strateji, seed.
**Başlangıç yanlılığı:** Rastgele başlangıçta genlerin ~%75'i "açık" olur (0 aralığı tüm aralığın 1/4'ü). Bunu dengelemek için başlangıç $p_{open}$'a göre örneklenir. Raporda tartışılacak bir nokta.

### 4.4 Trace (`heuristics/trace.py`)

Algoritmalar **tek bir kod** olarak yazılır ve `tracer` nesnesine olay gönderir. İki seviye var:

| Seviye | Ne kaydedilir | Kim kullanır |
|---|---|---|
| `detail` | Her pseudocode satırı ve operatör olayı | Sekme 3 (toy örnek, 1–3 nesil) |
| `generation` | Nesil başına özet | Sekme 4, 5 (gerçek örnek, tüm çalışma) |

Öğretilen kodla çalışan kodun aynı olmasını garanti eder: Sekme 3'te gösterilen GA, Sekme 4'te Ankara'yı çözen GA'nın ta kendisi.

**Detay olay tipleri** (her olayda `line_id` var, pseudocode'daki satıra karşılık gelir):

| Olay | İçerik |
|---|---|
| `init_individual` | birey indeksi, genler |
| `decode_step` | mahalle → hastane, kalan kapasite, (ya da karşılanmadı) |
| `evaluate` | maliyet kırılımı |
| `repair` | kapatılan hastane, sebep |
| `elitism` | taşınan bireyler |
| `select_roulette` | dönüştürülmüş fitness'lar, dilim oranları, rastgele sayı, seçilen |
| `select_tournament` | yarışanlar ve maliyetleri, kazanan |
| `select_rank` | sıralar, olasılıklar, seçilen |
| `crossover` | ebeveynler, kesim noktaları / maske, çocuklar |
| `mutate` | değişen gen pozisyonları, eski → yeni |
| `de_mutation` | r1, r2, r3 (veya best), F, sonuç vektörü |
| `de_crossover` | j_rand, CR maskesi, deneme vektörü |
| `de_selection` | deneme vs hedef maliyeti, kazanan |
| `generation_end` | yeni popülasyon, en iyi |

Her olaya Türkçe/İngilizce açıklama metni üretmek için bir şablon eklenir (frontend'de, olay verisinden).

**Nesil özeti:** nesil no, değerlendirme sayısı, en iyi / ortalama / en kötü maliyet, en iyinin genleri, maliyet kırılımı, çeşitlilik (ortalama Hamming mesafesi), `improved` bayrağı. Atama listesi **sadece iyileşme olan nesillerde** eklenir (boyutu küçük tutmak için, frontend son atamayı hatırlar).

**Pseudocode metinleri:** `heuristics/pseudocode/{ga,de}.json` dosyasında satır id'leri ile tutulur. Varyanta özel satırlar (rulet / turnuva / rank blokları) etiketlenir, frontend sadece seçili varyantın bloğunu açık gösterir.

---

## 5. Backend API (`api/`)

| Uç nokta | Açıklama | Süre |
|---|---|---|
| `GET /api/instances` | Mevcut örnekler (`ankara`, `toy`) | anlık |
| `GET /api/instances/{id}` | Talep noktaları, adaylar, ilçe sınırları, parametreler | anlık |
| `POST /api/instances/{id}/params` | β, α, r, n, tip tablosu değişiklikleri → türetilmiş örnek id'si | anlık |
| `POST /api/exact` | Senaryo + opsiyonel kısıtlar → çözüm | iş (job) |
| `POST /api/sweep` | `kind: count \| budget` → eğri | iş |
| `POST /api/teach` | Algoritma + varyant, toy örnek → detay trace | anlık (küçük) |
| `POST /api/optimize` | Bir veya birden çok konfigürasyon (yarış) → nesil trace'leri | iş |
| `POST /api/benchmark` | Konfigürasyonlar × seed'ler → istatistikler | iş |
| `GET /api/jobs/{id}` | Durum, ilerleme %, sonuç | anlık |

- Uzun işler arka planda çalışır (process pool). Frontend 500 ms aralıkla ilerlemeyi sorar ve ilerleme çubuğu gösterir
- Sonuçlar (örnek + parametreler + algoritma + seed) hash'iyle `cache/` altına JSON olarak yazılır. Aynı istek ikinci kez anında döner
- Şemalar `pydantic` ile tanımlanır. Frontend TypeScript tipleri aynı şemalardan elle (ya da OpenAPI'den) türetilir

---

## 6. UI tasarımı

**Genel düzen:** Üstte başlık + sekmeler + global seçimler (senaryo S1/S2, örnek). Harita bileşeni tüm sekmelerde aynı (`MapView`), sadece katmanları değişir.

**Harita gösterim dili (tüm sekmelerde tutarlı):**
- Talep noktası: gri daire, alanı nüfusla orantılı. Karşılanmayan mahalle kırmızı çerçeveli
- Aday yer: içi boş küçük kare, arazisine sığan en büyük tipe göre kenar rengi
- Açık hastane: dolu ikon, boyutu tipe göre (S/M/L), dolgu rengi kapasite doluluğuna göre (yeşil → kırmızı)
- Atama: hastane rengiyle ince çizgi, opaklık nüfusa göre
- İlçe sınırları: ince kesikli çizgi + isimler

### Sekme 1 — Problem & Veri
- Harita: ilçeler, talep noktaları, aday yerler
- Sağ panel: parametreler (β, α, r, n, dolambaç katsayısı, seed) ve **düzenlenebilir hastane tipi tablosu**
- Özet kartları: toplam nüfus, toplam yatak ihtiyacı, aday sayısı, adaylarda tip uygunluk dağılımı
- Kısa problem açıklaması ve formülasyon (KaTeX ile)

### Sekme 2 — Exact Çözüm
- Görünüm seçici: **S1** | **S2** | **Karşılaştır** (iki harita yan yana, senkron zoom)
- Kısıt paneli: [ ] Hastane sayısı üst sınırı ━━●━━ · [ ] Bütçe ━━●━━ · [ ] Maks. mesafe · [ ] Min. doluluk · zaman limiti
- KPI kartları: toplam yıllık maliyet, açılış / ulaşım / ceza kırılımı, açılan hastane (tip bazında), ortalama ve maksimum mesafe, karşılanmayan talep (yatak, %), solver durumu, gap, süre
- Sweep grafiği: x = $p_{\max}$ (veya $B$), y1 = toplam maliyet, y2 = karşılanmayan talep, ek olarak açılan hastane sayısı. Slider'ın konumu grafikte dikey çizgi, $p^*$ işaretli. Slider oynadıkça harita o noktanın çözümünü gösterir
- Hastane başına kapasite kullanımı (bar)
- Karşılaştır modunda: S1 vs S2 fark tablosu (maliyet, hastane sayısı, ortalama mesafe, tip dağılımı)

### Sekme 3 — Algoritma Nasıl Çalışır (öğretim)
- Seçiciler: Algoritma (GA / DE) · GA seçimi (rulet / turnuva / rank) · çaprazlama · DE stratejisi · seed
- Üç sütun:
  - **Sol: Pseudocode**, çalışan satır vurgulu, seçili olmayan varyant blokları soluk
  - **Orta: Durum paneli.** Popülasyon tablosu (kromozom = renkli kutucuk dizisi, maliyet, seçilenler işaretli) ve **operatör görseli**:
    - Rulet: pasta grafiği, dönen ibre animasyonu
    - Turnuva: yarışan bireyler ve kazanan
    - Rank: sıra → olasılık çubukları
    - Çaprazlama: iki ebeveyn, kesim çizgisi / uniform maske, oluşan çocuklar
    - Mutasyon: değişen gen yanıp söner
    - DE: $x_{r1}$, $x_{r2}$, $x_{r3}$ ve $v$ gen gen sütunlar halinde, ardından CR maskesi ve floor ile tip dönüşümü
  - **Sağ: Küçük harita** (toy örnek). Değerlendirilen bireyin hastaneleri ve decoder adımlarında atama çizgileri tek tek belirir, kapasite barları dolar
- Alt şerit: adımın açıklama metni
- Kontroller: ⏮ başa · ◀ geri · ▶/⏸ · ileri ▶ · hız · "decoder adımlarını göster/atla" · "sonraki nesle atla"

### Sekme 4 — Optimizasyon Süreci
- Konfigürasyon listesi: bir veya daha fazla çalışma eklenir (örneğin GA-rulet, GA-turnuva, DE-rand/1). Hepsi aynı örnek ve aynı değerlendirme bütçesiyle çalışır (**yarış modu**)
- Zaman çizelgesi: nesil slider'ı, ▶/⏸, hız, iyileşme noktaları işaretli, "◀ önceki / sonraki ▶ iyileşme"
- Harita: seçili çalışmanın o nesildeki en iyi çözümü. Önceki en iyiye göre yeni açılan hastane yeşil vurgulu, kapanan soluk iz bırakır. Yarış modunda harita sekmeli ya da 2×2 küçük haritalar
- Yakınsama grafiği: her çalışmanın en iyi maliyeti (çizgi) ve ortalaması (ince çizgi), x ekseni değerlendirme sayısı, exact optimum yatay kesikli çizgi
- Yan grafikler: çeşitlilik (Hamming), açılan hastane sayısının seyri
- KPI: o anki en iyi maliyet, optimuma gap, decoder vs polish farkı

### Sekme 5 — Karşılaştırma
- Konfigürasyonlar (çoklu seçim) × seed sayısı (varsayılan 10) × değerlendirme bütçesi
- Tablo: en iyi / ortalama ± std maliyet, ortalama gap, %1 gap'e ulaşma süresi (değerlendirme sayısı), çalışma süresi
- Box plot: konfigürasyon başına nihai maliyet dağılımı
- Ortalama yakınsama eğrileri (ortalama ± std bandı)
- S1 ve S2 için ayrı ayrı çalıştırılabilir

---

## 7. Klasör yapısı

```
uflp_assignment/
├── docs/DESIGN.md
├── backend/
│   ├── pyproject.toml
│   ├── cflp/
│   │   ├── instance.py          # dataclass'lar, yükleme, türetilmiş parametreler
│   │   ├── costs.py             # haversine, CRF, maliyet matrisleri
│   │   ├── exact.py             # PuLP modeli
│   │   ├── sweep.py
│   │   ├── heuristics/
│   │   │   ├── common.py        # kodlama, maske, decoder, repair, fitness
│   │   │   ├── selection.py     # rulet, turnuva, rank
│   │   │   ├── crossover.py     # tek nokta, iki nokta, uniform
│   │   │   ├── mutation.py
│   │   │   ├── ga.py
│   │   │   ├── de.py
│   │   │   ├── polish.py        # sabit y ile atama MIP'i
│   │   │   ├── trace.py
│   │   │   └── pseudocode/{ga,de}.json
│   │   ├── benchmark.py
│   │   └── data_pipeline/       # OSM/TÜİK → data/processed
│   ├── api/
│   │   ├── main.py
│   │   ├── schemas.py
│   │   └── jobs.py
│   └── tests/
├── frontend/
│   ├── package.json             # Vite + React + TS
│   └── src/
│       ├── api/                 # istemci + tipler
│       ├── components/          # MapView, KpiCards, PseudocodePanel, PopulationTable,
│       │                        # RouletteWheel, TournamentView, CrossoverView, DeVectorView,
│       │                        # ConvergenceChart, SweepChart, Timeline, PlayerControls
│       ├── tabs/                # DataTab, ExactTab, TeachTab, ProcessTab, CompareTab
│       └── player/              # trace oynatıcı (state machine, ileri/geri)
├── data/
│   ├── raw/
│   └── processed/{ankara,toy}.json, districts.geojson
├── config/hospital_types.json
├── cache/                       # git'e girmez
└── report/
```

---

## 8. Doğrulama ve testler

- **Exact doğruluğu:** Toy örnekte tüm $(|K|+1)^{|J|}$ yer kombinasyonu brute force ile denenir (atama MIP ile), exact sonuçla aynı olmalı
- **Senaryo tutarlılığı:** S2'nin optimumu ≤ S1'in optimumu (S2 S1'i kapsar)
- **Sweep monotonluğu:** $p_{\max}$ arttıkça optimal maliyet artmaz
- **Decoder invariantları:** Kapasite asla aşılmaz, her mahalle tam bir kez atanır ya da karşılanmaz, $D_{\max}$ ihlal edilmez
- **Amaç tutarlılığı:** Aynı $(y, x)$ için decoder maliyeti ile MIP amaç fonksiyonu eşit
- **Tekrarlanabilirlik:** Aynı seed → aynı trace (byte düzeyinde)
- **Repair:** Çıktı her zaman P ve B kısıtlarını sağlar

---

## 9. Uygulama aşamaları

| # | Aşama | Bitti sayılması için |
|---|---|---|
| 1 | Veri hattı + `ankara` / `toy` örnekleri | JSON'lar üretildi, haritada doğru görünüyor |
| 2 | Maliyetler + exact model (S1, S2, opsiyonel kısıtlar) + testler | Brute force testi geçiyor, Ankara makul sürede çözülüyor |
| 3 | Backend iskeleti (API, job, cache) + frontend iskeleti + Sekme 1 | Harita ve parametre paneli çalışıyor |
| 4 | Sekme 2: exact çözüm görünümü, S1/S2 karşılaştırma, sweep + slider | Eğriler ve karşılanmayan talep doğru |
| 5 | Ortak heuristic katmanı (decoder, repair, polish) + GA (tüm varyantlar) + trace | Testler geçiyor, GA optimuma yakın |
| 6 | DE (varyantlar) | Aynı |
| 7 | Sekme 4: oynatıcı, zaman çizelgesi, yarış modu | Akıcı oynatma, ileri/geri |
| 8 | Sekme 3: detaylı öğretim görünümü + operatör görselleri | Tüm varyantlar için satır satır anlaşılır |
| 9 | Sekme 5: benchmark | İstatistikler ve grafikler |
| 10 | Parametre kalibrasyonu, cila, rapor | Sonuçlar anlamlı, rapor yazıldı |

---

## 10. Açık noktalar ve riskler

| Konu | Risk | Plan |
|---|---|---|
| Mahalle nüfus verisi | Erişilemeyebilir | Sentetik mod hazır, aynı veri yapısı |
| Parametre kalibrasyonu ($\alpha$, $C_k$) | Değerler kötü seçilirse sonuç "tek dev hastane" ya da "her mahalleye hastane" çıkar | Aşama 2'de $\alpha$ taraması yapılıp makul aralık (~15–35 hastane) belirlenir |
| Exact çözüm süresi (S2, kısıtsız) | Zaman limitine takılabilir | Aday eleme (en yakın 15), warm start, gap'i gösterme |
| DE'nin ayrıklaştırılması | Floor dönüşümü aramayı zorlaştırabilir | Varyantlar + raporda tartışma; gerekirse alternatif dönüşüm (eşik tabanlı açık/kapalı + tip) |
| Decoder'ın sezgisel olması | Gap'i yapay olarak büyütebilir | Polish adımı ve ayrı raporlama |
| UI dili | — | **Türkçe** (karar verildi) |
