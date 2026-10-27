import { useEffect, useMemo, useState } from "react";
import { postJSON } from "../api";
import { Kpi, PageHeader } from "../components/common";
import Formulation from "../components/Formulation";
import MapView from "../components/MapView";
import { compact, mtl, n0, n1, pct } from "../format";
import { scenarioTypes, useApp } from "../state";
import type { HospitalType, Params, ProblemSummary } from "../types";

type NumKey = "beds_per_1000" | "alpha_tl_per_person_km" | "discount_rate" | "lifetime_years" | "circuity" | "assign_k_nearest";

const FIELDS: { key: NumKey; label: string; step: number; min: number; max?: number; scale?: number; hint: string }[] = [
  { key: "beds_per_1000", label: "Yatak ihtiyacı (1000 kişi başına)", step: 0.1, min: 0.5, max: 6, hint: "Talep: dᵢ = nüfus × β / 1000" },
  { key: "alpha_tl_per_person_km", label: "Ulaşım maliyeti (₺ / kişi·km·yıl)", step: 10, min: 0, hint: "Hastane sayısını belirleyen ana parametre" },
  { key: "discount_rate", label: "Faiz oranı (%)", step: 0.5, min: 0, max: 30, scale: 100, hint: "Yatırımı yıllıklandırmak için" },
  { key: "lifetime_years", label: "Ekonomik ömür (yıl)", step: 1, min: 5, max: 80, hint: "CRF = r(1+r)ⁿ / ((1+r)ⁿ − 1)" },
  { key: "circuity", label: "Yol dolambaç katsayısı", step: 0.05, min: 1, max: 2, hint: "Yol mesafesi ≈ kuş uçuşu × katsayı" },
  { key: "assign_k_nearest", label: "Atanabilir en yakın aday", step: 1, min: 3, max: 60, hint: "Model boyutunu küçültür" },
];

export default function DataTab() {
  const { instance, districts, params, defaults, overrides, setOverrides, scenario, makeSpec } = useApp();
  const [rawSummary, setSummary] = useState<ProblemSummary | null>(null);
  const types = scenarioTypes(params, scenario);
  const spec = useMemo(() => makeSpec(), [makeSpec]);

  useEffect(() => {
    postJSON<ProblemSummary>("/api/problem", spec).then(setSummary).catch(() => setSummary(null));
  }, [spec]);

  // senaryo değiştiğinde yeni özet gelene kadar eskisi kullanılmaz
  const summary = rawSummary && rawSummary.scenario === scenario ? rawSummary : null;
  if (!instance || !params || !defaults) return null;
  const local = { ...defaults, ...overrides } as Params;

  const setNum = (key: NumKey, raw: string, scale = 1) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    setOverrides({ ...overrides, [key]: v / scale });
  };
  const setType = (k: string, field: keyof HospitalType, raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const ht = local.hospital_types.map((t) => (t.key === k ? { ...t, [field]: v } : t));
    setOverrides({ ...overrides, hospital_types: ht });
  };
  const changed = Object.keys(overrides).length > 0;
  const eligible = summary ? types.map((_, k) => summary.kmax.filter((m) => m >= k + 1).length) : [];
  const src = instance.meta.sources ?? {};

  const legend = (
    <div className="legend">
      <span><i className="dot" style={{ background: "var(--ink-2)", opacity: 0.45 }} /> Mahalle (alan ∝ nüfus)</span>
      {types.map((t) => (
        <span key={t.key}><i className="sq" style={{ border: `2px solid var(--type-${t.key})` }} /> En fazla {t.name.toLowerCase()} sığar</span>
      ))}
      <span><i className="sq" style={{ border: "2px solid var(--critical)" }} /> Hiçbir tip sığmaz</span>
    </div>
  );

  return (
    <>
      <PageHeader step={1} title="Problem ve veri">
        Ankara'nın 9 merkez ilçesinde, mevcut hastaneler yok sayılarak yeni hastanelerin nereye ve hangi büyüklükte açılacağı
        ve her mahallenin hangi hastaneye bağlanacağı belirlenir. Haritadaki kareler aday yerlerdir. Rengi, o parsele sığan en büyük hastane tipini gösterir.
      </PageHeader>

      <div className="split">
        <div className="stack">
          <div className="card flush">
            <MapView
              instance={instance}
              districts={districts}
              types={types}
              candidateMode="eligibility"
              kmax={summary?.kmax}
              demandBeds={summary?.demand_beds}
              height={620}
              overlay={legend}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Model</h2>
                <p className="hint">Kapasiteli, tek kaynaklı tesis yerleşim problemi (CFLP)</p>
              </div>
            </div>
            <p className="ink2" style={{ marginBottom: 12 }}>
              Amaç: yıllıklandırılmış açılış maliyeti + hastaların yıllık ulaşım maliyeti + karşılanmayan talep cezasının toplamını en aza indirmek.
              Her mahalle tek bir hastaneye bağlanır, hastaneler yatak kapasitelerini aşamaz, her aday yere en fazla bir hastane açılır.
            </p>
            <details>
              <summary>Matematiksel formülasyon</summary>
              <Formulation />
            </details>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Örnek özeti</h2>
              <span className="badge accent">{scenario === "single" ? "S1 · Tek tip" : "S2 · Üç tip"}</span>
            </div>
            <div className="kpis" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <Kpi label="Nüfus" value={summary ? compact(summary.total_population) : "–"} sub={`${instance.demand.length} mahalle`} />
              <Kpi label="Yatak ihtiyacı" value={n0(summary?.total_beds)} sub={`1000 kişi başına ${n1(params.beds_per_1000)}`} />
              <Kpi label="Aday yer" value={instance.candidates.length} sub={types.map((t, k) => `${t.name}: ${eligible[k] ?? "–"}`).join(" · ")} />
              <Kpi label="En az hastane" value={summary?.min_hospitals_by_capacity ?? "–"} sub="kapasiteye göre alt sınır" />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Parametreler</h2>
                <p className="hint">Değişiklikler tüm sayfalara uygulanır.</p>
              </div>
              <button className="btn small" disabled={!changed} onClick={() => setOverrides({})}>Varsayılana dön</button>
            </div>
            <div className="fields">
              {FIELDS.map((f) => {
                const raw = local[f.key] as number | null;
                return (
                  <label className="field" key={f.key} title={f.hint}>
                    {f.label}
                    <input
                      type="number"
                      step={f.step}
                      min={f.min}
                      max={f.max}
                      value={raw == null ? "" : +(raw * (f.scale ?? 1)).toFixed(4)}
                      onChange={(e) => setNum(f.key, e.target.value, f.scale)}
                    />
                  </label>
                );
              })}
            </div>
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="hint">Yatırımın yıllık payı (CRF): {pct(summary?.crf ?? 0, 2)}</span>
              <span className="hint">Ceza: yatak başı {mtl(summary?.penalty_per_bed)} / yıl</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Hastane tipleri</h2>
                <p className="hint">Büyüdükçe yatak başı inşaat maliyeti düşer (ölçek ekonomisi).</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Tip</th><th className="r">Yatak</th><th className="r">Arazi m²</th><th className="r">İnşaat mn ₺</th></tr>
                </thead>
                <tbody>
                  {local.hospital_types.map((t) => (
                    <tr key={t.key}>
                      <td>
                        <span className="row" style={{ gap: 7, flexWrap: "nowrap" }}>
                          <i className="dot" style={{ background: `var(--type-${t.key})` }} />
                          {t.name}
                          {t.key === local.single_type_key && <span className="badge">S1</span>}
                        </span>
                      </td>
                      <td className="r"><input type="number" step={50} value={t.beds} onChange={(e) => setType(t.key, "beds", e.target.value)} style={{ width: 76 }} /></td>
                      <td className="r"><input type="number" step={5000} value={t.land_m2} onChange={(e) => setType(t.key, "land_m2", e.target.value)} style={{ width: 96 }} /></td>
                      <td className="r"><input type="number" step={100} value={t.construction_mtl} onChange={(e) => setType(t.key, "construction_mtl", e.target.value)} style={{ width: 86 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Yatırım = inşaat + arazi × parselin bulunduğu yerin arsa fiyatı. Para birimi milyon TL (mn ₺); değerler illüstratiftir.
            </p>
          </div>

          <div className="card">
            <details>
              <summary>İlçeler ve veri kaynakları</summary>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>İlçe</th><th className="r">Nüfus</th><th className="r">Mahalle</th><th className="r">Arsa ₺/m²</th></tr></thead>
                  <tbody>
                    {instance.districts.map((d) => (
                      <tr key={d.name}>
                        <td>{d.name}</td>
                        <td className="r">{n0(d.population)}</td>
                        <td className="r">{instance.demand.filter((x) => x.district === d.name).length}</td>
                        <td className="r">{n0(d.land_price_tl_m2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="hint" style={{ margin: "12px 0 0", paddingLeft: 18 }}>
                {Object.entries(src).map(([k, v]) => <li key={k}>{v}</li>)}
                <li>Mevcut hastaneler ödev gereği yok sayıldı.</li>
              </ul>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}
