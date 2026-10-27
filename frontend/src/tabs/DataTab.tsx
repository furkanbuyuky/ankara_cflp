import { useEffect, useMemo, useState } from "react";
import { postJSON } from "../api";
import { Kpi } from "../components/common";
import Formulation from "../components/Formulation";
import MapView from "../components/MapView";
import { compact, mtl, n0, n1, pct } from "../format";
import { scenarioTypes, useApp } from "../state";
import type { HospitalType, Params, ProblemSummary } from "../types";

type NumKey = "beds_per_1000" | "alpha_tl_per_person_km" | "discount_rate" | "lifetime_years" | "circuity" | "assign_k_nearest";

const FIELDS: { key: NumKey; label: string; step: number; min: number; max?: number; scale?: number; hint: string }[] = [
  { key: "beds_per_1000", label: "Yatak ihtiyacı β (1000 kişi başına)", step: 0.1, min: 0.5, max: 6, hint: "Talep: dᵢ = nüfus × β / 1000" },
  { key: "alpha_tl_per_person_km", label: "Ulaşım maliyeti α (₺ / kişi·km·yıl)", step: 10, min: 0, hint: "Hastane sayısını belirleyen ana parametre" },
  { key: "discount_rate", label: "Faiz oranı r (%)", step: 0.5, min: 0, max: 30, scale: 100, hint: "Yatırımı yıllıklandırmak için" },
  { key: "lifetime_years", label: "Ekonomik ömür n (yıl)", step: 1, min: 5, max: 80, hint: "CRF = r(1+r)ⁿ / ((1+r)ⁿ − 1)" },
  { key: "circuity", label: "Yol dolambaç katsayısı", step: 0.05, min: 1, max: 2, hint: "Yol mesafesi ≈ kuş uçuşu × katsayı" },
  { key: "assign_k_nearest", label: "Atanabilir en yakın aday sayısı", step: 1, min: 3, max: 60, hint: "Model boyutunu küçültür" },
];

export default function DataTab() {
  const { instance, districts, params, defaults, overrides, setOverrides, scenario, makeSpec } = useApp();
  const [summary, setSummary] = useState<ProblemSummary | null>(null);
  const types = scenarioTypes(params, scenario);
  const spec = useMemo(() => makeSpec(), [makeSpec]);

  useEffect(() => {
    postJSON<ProblemSummary>("/api/problem", spec).then(setSummary).catch(() => setSummary(null));
  }, [spec]);

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

  return (
    <div className="split">
      <div className="stack">
        <div className="card flush" style={{ position: "relative" }}>
          <MapView
            instance={instance}
            districts={districts}
            types={types}
            candidateMode="eligibility"
            kmax={summary?.kmax}
            demandBeds={summary?.demand_beds}
            height={600}
          />
        </div>
        <div className="card">
          <div className="legend">
            <span><i className="dot" style={{ background: "var(--ink-2)", opacity: 0.5 }} /> Mahalle (alan ∝ nüfus)</span>
            {types.map((t) => (
              <span key={t.key}><i className="sq" style={{ border: `2px solid var(--type-${t.key})` }} /> Aday: en fazla {t.name.toLowerCase()} hastane sığar</span>
            ))}
            <span><i className="sq" style={{ border: "2px solid var(--critical)" }} /> Aday: hiçbir tip sığmaz</span>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Problem</h2><span className="muted small">Kapasiteli Tesis Yerleşim Problemi (CFLP), tek kaynaklı</span></div>
          <p className="ink2" style={{ marginBottom: 10 }}>
            Ankara'nın 9 merkez ilçesinde mevcut hastaneler yok sayılarak yeni hastanelerin <b>nereye</b> ve <b>hangi büyüklükte</b> açılacağı
            ve her mahallenin <b>hangi hastaneye</b> bağlanacağı belirlenir. Amaç, yıllıklandırılmış açılış maliyeti + hastaların yıllık
            ulaşım maliyeti + karşılanmayan talep cezasının toplamını en aza indirmek. Her mahalle tek bir hastaneye bağlanır, hastaneler kapasitelerini aşamaz.
          </p>
          <details>
            <summary>Matematiksel model</summary>
            <Formulation />
          </details>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-head"><h2>Örnek özeti</h2><span className="badge">{scenario === "single" ? "S1 · Tek tip" : "S2 · Üç tip"}</span></div>
          <div className="kpis">
            <Kpi label="Nüfus" value={compact(summary?.total_population ?? 0)} sub={`${instance.demand.length} mahalle`} />
            <Kpi label="Yatak ihtiyacı" value={n0(summary?.total_beds)} sub={`β = ${n1(params.beds_per_1000)} / 1000 kişi`} />
            <Kpi label="Aday yer" value={instance.candidates.length} sub={types.map((t, k) => `${t.name[0]}: ${eligible[k] ?? "–"}`).join(" · ")} />
            <Kpi label="En az hastane" value={summary?.min_hospitals_by_capacity ?? "–"} sub="kapasite alt sınırı" />
            <Kpi label="CRF" value={pct(summary?.crf ?? 0, 2)} sub="yatırımın yıllık payı" />
            <Kpi label="Ceza (yatak başı)" value={mtl(summary?.penalty_per_bed)} sub="yıllık" />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Parametreler</h2>
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
          <h3 style={{ margin: "14px 0 6px" }}>Hastane tipleri</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Tip</th><th className="r">Yatak</th><th className="r">Arazi (m²)</th><th className="r">İnşaat (mn ₺)</th><th className="r">mn ₺ / yatak</th></tr>
              </thead>
              <tbody>
                {local.hospital_types.map((t) => (
                  <tr key={t.key}>
                    <td><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: `var(--type-${t.key})` }} />{t.name}{t.key === local.single_type_key && <span className="badge">S1</span>}</span></td>
                    <td className="r"><input type="number" step={50} value={t.beds} onChange={(e) => setType(t.key, "beds", e.target.value)} style={{ width: 72 }} /></td>
                    <td className="r"><input type="number" step={5000} value={t.land_m2} onChange={(e) => setType(t.key, "land_m2", e.target.value)} style={{ width: 92 }} /></td>
                    <td className="r"><input type="number" step={100} value={t.construction_mtl} onChange={(e) => setType(t.key, "construction_mtl", e.target.value)} style={{ width: 84 }} /></td>
                    <td className="r muted">{n1(t.construction_mtl / t.beds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Yatak başı inşaat maliyeti büyüdükçe düşer (ölçek ekonomisi). Arsa maliyeti (arazi × ilçe arsa fiyatı) yatırıma eklenir.
            Parametre değişiklikleri tüm sekmelere uygulanır. Önbellekte olmayan sonuçlar yeniden hesaplanır.
          </p>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 8 }}>İlçeler</h2>
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
          <details style={{ marginTop: 10 }}>
            <summary>Veri kaynakları</summary>
            <ul className="small ink2" style={{ margin: 0, paddingLeft: 18 }}>
              {Object.entries(src).map(([k, v]) => <li key={k}>{v}</li>)}
              <li>Mevcut hastaneler ödev gereği yok sayıldı.</li>
            </ul>
          </details>
        </div>
        <p className="muted small">Para birimi milyon TL (mn ₺); değerler illüstratiftir. Karşılanmayan her yatak için ceza, bir yatağı karşılamanın en pahalı yolunun {n0(params.penalty_multiplier)} katıdır. Model mecbur kalmadıkça talebi karşılanmamış bırakmaz.</p>
      </div>
    </div>
  );
}
