"""Sekme 3'te gösterilen pseudocode. Satır kimlikleri trace olaylarındaki `line` ile eşleşir.

`variant` alanı olan satırlar yalnızca o varyant seçiliyken öne çıkarılır.
"""

MAIN_EVAL = [
    {"id": "main.repair", "text": "onar: sayı/bütçe sınırı aşılıyorsa hastane kapat", "indent": 2},
    {"id": "main.decode", "text": "çöz: DECODER(genler) → mahalle atamaları", "indent": 2},
    {"id": "main.cost", "text": "maliyet ← açılış + ulaşım + ceza", "indent": 2},
]

GA = {
    "title": "Genetik Algoritma",
    "main": [
        {"id": "ga.init", "text": "P ← N rastgele birey (her gen p_open olasılıkla açık, tipi rastgele)", "indent": 0},
        {"id": "ga.eval0", "text": "her birey için: onar, çöz, maliyet hesapla", "indent": 0},
        {"id": "ga.loop", "text": "while değerlendirme < bütçe:", "indent": 0},
        {"id": "ga.elite", "text": "Q ← P'nin en iyi e bireyi            ▹ elitizm", "indent": 1},
        {"id": "ga.while", "text": "while |Q| < N:", "indent": 1},
        {"id": "ga.sel1", "text": "e1 ← SEÇ(P)", "indent": 2},
        {"id": "ga.sel2", "text": "e2 ← SEÇ(P)", "indent": 2},
        {"id": "ga.cross", "text": "if rand < p_c: (ç1, ç2) ← ÇAPRAZLA(e1, e2)", "indent": 2},
        {"id": "ga.nocross", "text": "else: (ç1, ç2) ← (e1, e2)", "indent": 2},
        {"id": "ga.mutate", "text": "her gen: rand < p_m ise rastgele geçerli tipe çevir   ▹ mutasyon", "indent": 2},
        *MAIN_EVAL,
        {"id": "ga.add", "text": "Q ← Q ∪ {ç1, ç2}", "indent": 2},
        {"id": "ga.replace", "text": "P ← Q", "indent": 1},
        {"id": "ga.best", "text": "en iyi çözümü güncelle", "indent": 1},
        {"id": "ga.return", "text": "return en iyi", "indent": 0},
    ],
    "blocks": [
        {
            "title": "SEÇ(P)",
            "group": "selection",
            "lines": [
                {"id": "sel.roulette.fit", "variant": "roulette", "text": "f_i ← c_max − c_i + ε     ▹ maliyet → fitness", "indent": 0},
                {"id": "sel.roulette.prob", "variant": "roulette", "text": "p_i ← f_i / Σ f", "indent": 0},
                {"id": "sel.roulette.spin", "variant": "roulette", "text": "r ← rand; kümülatif olasılığı r'yi geçen ilk bireyi seç", "indent": 0},
                {"id": "sel.tournament.pick", "variant": "tournament", "text": "P'den rastgele k birey seç", "indent": 0},
                {"id": "sel.tournament.win", "variant": "tournament", "text": "en düşük maliyetliyi döndür", "indent": 0},
                {"id": "sel.rank.sort", "variant": "rank", "text": "bireyleri maliyete göre sırala (r = 1 en iyi)", "indent": 0},
                {"id": "sel.rank.prob", "variant": "rank", "text": "p_r ← (2−s)/N + 2(s−1)(N−r) / (N(N−1))", "indent": 0},
                {"id": "sel.rank.spin", "variant": "rank", "text": "r ← rand; kümülatif olasılığı r'yi geçen ilk bireyi seç", "indent": 0},
            ],
        },
        {
            "title": "ÇAPRAZLA(e1, e2)",
            "group": "crossover",
            "lines": [
                {"id": "cx.one_point", "variant": "one_point", "text": "c ← rastgele kesim; ç1 ← e1[:c] + e2[c:],  ç2 ← e2[:c] + e1[c:]", "indent": 0},
                {"id": "cx.two_point", "variant": "two_point", "text": "a < b seç; [a, b) aralığındaki genleri değiştir", "indent": 0},
                {"id": "cx.uniform", "variant": "uniform", "text": "her gen için yazı-tura: ç1 genini e1'den mi e2'den mi alacak", "indent": 0},
            ],
        },
        {
            "title": "DECODER(genler)",
            "group": "decoder",
            "lines": [
                {"id": "dec.open", "text": "açık hastaneleri ve kapasitelerini al", "indent": 0},
                {"id": "dec.regret", "text": "her mahalle: pişmanlık ← (2. en yakın − en yakın mesafe) × nüfus", "indent": 0},
                {"id": "dec.order", "text": "mahalleleri pişmanlığa göre azalan sırala", "indent": 0},
                {"id": "dec.assign", "text": "sırayla: kapasitesi yeten en yakın hastaneye ata, yoksa karşılanmadı", "indent": 0},
                {"id": "dec.fix", "text": "karşılanamayan her mahalle: dolu hastanedeki bir mahalleyi boş bir hastaneye kaydırıp yer aç", "indent": 0},
            ],
        },
    ],
}

DE = {
    "title": "Diferansiyel Evrim",
    "main": [
        {"id": "de.init", "text": "X ← N rastgele vektör, x_j ∈ [0, kmax_j + 1)", "indent": 0},
        {"id": "de.eval0", "text": "her vektör: genler ← ⌊x⌋, onar, çöz, maliyet", "indent": 0},
        {"id": "de.loop", "text": "while değerlendirme < bütçe:", "indent": 0},
        {"id": "de.for", "text": "for her hedef vektör x_t:", "indent": 1},
        {"id": "de.pick", "text": "r1, r2, r3 ← t'den ve birbirinden farklı rastgele indeksler", "indent": 2},
        {"id": "de.mut.rand1", "variant": "rand1", "text": "v ← x_r1 + F · (x_r2 − x_r3)", "indent": 2},
        {"id": "de.mut.best1", "variant": "best1", "text": "v ← x_best + F · (x_r1 − x_r2)", "indent": 2},
        {"id": "de.mut.current_to_best1", "variant": "current_to_best1", "text": "v ← x_t + F · (x_best − x_t) + F · (x_r1 − x_r2)", "indent": 2},
        {"id": "de.bound", "text": "v'yi [0, kmax + 1) sınırlarına yansıt", "indent": 2},
        {"id": "de.cross", "text": "j_rand ← rastgele;  u_j ← v_j (rand < CR veya j = j_rand), değilse x_t,j", "indent": 2},
        {"id": "de.map", "text": "genler ← ⌊u⌋", "indent": 2},
        *MAIN_EVAL,
        {"id": "de.select", "text": "if maliyet(u) ≤ maliyet(x_t): x_t ← u", "indent": 2},
        {"id": "de.best", "text": "en iyi çözümü güncelle", "indent": 1},
        {"id": "de.return", "text": "return en iyi", "indent": 0},
    ],
    "blocks": [GA["blocks"][2]],
}

PSEUDOCODE = {"ga": GA, "de": DE}
