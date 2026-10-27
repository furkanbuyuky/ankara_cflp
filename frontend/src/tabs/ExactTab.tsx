import type { ChartConfiguration } from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { useCachedJob } from "../api";
import { typeColor } from "../colors";
import ChartBox, { baseOptions, merge } from "../components/ChartBox";
import { CostBar, JobStatus, Kpi, Seg, SolutionKpis, SolverBadge } from "../components/common";
import MapView, { MapLegend } from "../components/MapView";
import { mtl, n0, n1, pct } from "../format";
import { scenarioTypes, useApp } from "../state";
import type { Constraints, ExactResult, HospitalType, Scenario, SolutionDict, SolverInfo, SweepPoint, SweepResult } from "../types";

type View = Scenario | "compare";
const SC_LABEL: Record<Scenario, string> = { single: "S1 · Tek tip", multi: "S2 · Üç tip" };
const SC_COLOR: Record<Scenario, string> = { single: "--run-1", multi: "--run-2" };

interface Shown {
  sol: SolutionDict;
  solver: SolverInfo;
  limitLabel?: string;
}

/** Sweep noktası: slider değeri için uygun en büyük grid değeri (sınır gevşedikçe çözüm geçerli kalır). */
function pointAt(sw: SweepResult | null, v: number): SweepPoint | null {
  if (!sw) return null;
  let best: SweepPoint | null = null;
  for (const p of sw.points) if (p.value <= v + 1e-9) best = p;
  return best ?? sw.points[0];
}

export default function ExactTab() {
  const { instance, districts, params, scenario, setScenario, makeSpec } = useApp();
  const [view, setView] = useState<View>(scenario);
  const [timeLimit, setTimeLimit] = useState(60);
  const [maxDist, setMaxDist] = useState<number | null>(null);
  const [minUtil, setMinUtil] = useState<number | null>(null);
  const [sweepKind, setSweepKind] = useState<"count" | "budget">("count");
  const [sweepOn, setSweepOn] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    if (view !== "compare") setScenario(view);
  }, [view, setScenario]);

  const cons: Constraints = { max_distance_km: maxDist, min_utilization: minUtil };
  const specS1 = makeSpec(cons, "single");
  const specS2 = makeSpec(cons, "multi");
  const showS1 = view !== "multi";
  const showS2 = view !== "single";

  const ex1 = useCachedJob<ExactResult>("exact", showS1 ? { spec: specS1, time_limit: timeLimit } : null);
  const ex2 = useCachedJob<ExactResult>("exact", showS2 ? { spec: specS2, time_limit: timeLimit } : null);
  const swBody = (spec: unknown) => ({ spec, kind: sweepKind, time_limit: 15, base_time_limit: timeLimit });
  const sw1 = useCachedJob<SweepResult>("sweep", showS1 ? swBody(specS1) : null);
  const sw2 = useCachedJob<SweepResult>("sweep", showS2 ? swBody(specS2) : null);

  const sweeps = [showS1 ? sw1.result : null, showS2 ? sw2.result : null].filter(Boolean) as SweepResult[];
  const range = useMemo(() => {
    if (!sweeps.length) return null;
    const vals = sweeps.flatMap((s) => s.points.map((p) => p.value));
    return { min: Math.min(...vals), max: Math.max(...vals) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sw1.result, sw2.result, view]);

  useEffect(() => {
    if (range) setLimit((l) => (l == null || l < range.min || l > range.max ? range.max : l));
    else setLimit(null);
  }, [range]);

  if (!instance || !params) return null;
  const types1 = scenarioTypes(params, "single");
  const types2 = scenarioTypes(params, "multi");
  const useSweep = sweepOn && limit != null && sweeps.length > 0;

  const shown = (sc: Scenario): Shown | null => {
    const sw = sc === "single" ? sw1.result : sw2.result;
    if (useSweep && sw) {
      const p = pointAt(sw, limit!);
      if (p) return { sol: p, solver: p.solver, limitLabel: sweepKind === "count" ? `p ≤ ${p.value}` : `B ≤ ${mtl(p.value)}` };
    }
    const ex = sc === "single" ? ex1.result : ex2.result;
    return ex ? { sol: ex.solution, solver: ex.solver } : null;
  };

  const solveAll = () => {
    if (showS1) ex1.run();
    if (showS2) ex2.run();
  };
  const sweepAll = () => {
    if (showS1) sw1.run();
    if (showS2) sw2.run();
  };
  const anyRunning = ex1.running || ex2.running;
  const swRunning = sw1.running || sw2.running;
  const scenarios: Scenario[] = view === "compare" ? ["single", "multi"] : [view];

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <div className="row" style={{ gap: 14 }}>
            <Seg<View>
              value={view}
              onChange={setView}
              options={[
                { value: "single", label: "S1 · Tek tip" },
                { value: "multi", label: "S2 · Üç tip" },
                { value: "compare", label: "Karşılaştır" },
              ]}
            />
            <label className="field inline">
              <input type="checkbox" checked={maxDist != null} onChange={(e) => setMaxDist(e.target.checked ? 8 : null)} />
              Maks. mesafe
              {maxDist != null && (
                <input type="number" min={2} max={40} step={1} value={maxDist} style={{ width: 64 }} onChange={(e) => setMaxDist(Number(e.target.value) || 8)} />
              )}
              {maxDist != null && "km"}
            </label>
            <label className="field inline">
              <input type="checkbox" checked={minUtil != null} onChange={(e) => setMinUtil(e.target.checked ? 0.6 : null)} />
              Min. doluluk
              {minUtil != null && (
                <input type="number" min={10} max={95} step={5} value={Math.round(minUtil * 100)} style={{ width: 60 }} onChange={(e) => setMinUtil((Number(e.target.value) || 60) / 100)} />
              )}
              {minUtil != null && "%"}
            </label>
            <label className="field inline">
              Zaman limiti
              <select value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))}>
                {[30, 60, 120, 300].map((t) => <option key={t} value={t}>{t} sn</option>)}
              </select>
            </label>
          </div>
          <button className="btn primary" onClick={solveAll} disabled={anyRunning}>
            {anyRunning ? "Çözülüyor…" : "MIP ile çöz"}
          </button>
        </div>
        {(ex1.job || ex2.job || ex1.error || ex2.error) && (
          <div className="row" style={{ marginTop: 10, gap: 16 }}>
            {showS1 && <JobStatus job={ex1.job} error={ex1.error} expectSeconds={timeLimit + 5} />}
            {showS2 && <JobStatus job={ex2.job} error={ex2.error} expectSeconds={timeLimit + 5} />}
          </div>
        )}
      </div>

      <div className={view === "compare" ? "two" : ""}>
        {scenarios.map((sc) => {
          const s = shown(sc);
          const types = sc === "single" ? types1 : types2;
          return (
            <ScenarioPanel
              key={sc}
              title={SC_LABEL[sc]}
              shown={s}
              types={types}
              compact={view === "compare"}
              mapGroup={view === "compare" ? "exact-compare" : undefined}
              instance={instance}
              districts={districts}
              beds={params.beds_per_1000}
              running={sc === "single" ? ex1.running : ex2.running}
              checking={sc === "single" ? ex1.checking : ex2.checking}
            />
          );
        })}
      </div>

      {view === "compare" && <CompareTable a={shown("single")} b={shown("multi")} />}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Üst sınır analizi</h2>
            <p className="muted small">
              Sınır her değer için ayrıca çözülür (nokta başına 15 sn). Sınır bağlayıcı olmaktan çıkınca çözüm kısıtsız optimumla aynı kalır.
            </p>
          </div>
          <div className="row">
            <Seg value={sweepKind} onChange={setSweepKind} options={[{ value: "count", label: "Hastane sayısı" }, { value: "budget", label: "Yatırım bütçesi" }]} />
            <button className="btn" onClick={sweepAll} disabled={swRunning}>{swRunning ? "Hesaplanıyor…" : "Eğriyi hesapla"}</button>
          </div>
        </div>
        {(sw1.job || sw2.job || sw1.error || sw2.error) && (
          <div className="row" style={{ marginBottom: 10, gap: 16 }}>
            {showS1 && <JobStatus job={sw1.job} error={sw1.error} />}
            {showS2 && <JobStatus job={sw2.job} error={sw2.error} />}
          </div>
        )}
        {sweeps.length === 0 && !swRunning && <div className="notice">Bu ayarlar için eğri henüz hesaplanmadı. "Eğriyi hesapla" ile başlatın (birkaç dakika sürebilir).</div>}
        {sweeps.length > 0 && range && limit != null && (
          <SweepView
            kind={sweepKind}
            limit={limit}
            setLimit={setLimit}
            range={range}
            sweepOn={sweepOn}
            setSweepOn={setSweepOn}
            series={[
              ...(showS1 && sw1.result ? [{ sc: "single" as Scenario, sw: sw1.result }] : []),
              ...(showS2 && sw2.result ? [{ sc: "multi" as Scenario, sw: sw2.result }] : []),
            ]}
          />
        )}
      </div>
    </div>
  );
}

function ScenarioPanel(props: {
  title: string;
  shown: Shown | null;
  types: HospitalType[];
  compact: boolean;
  mapGroup?: string;
  instance: NonNullable<ReturnType<typeof useApp>["instance"]>;
  districts: GeoJSON.FeatureCollection | null;
  beds: number;
  running: boolean;
  checking: boolean;
}) {
  const { title, shown, types, compact, mapGroup, instance, districts, beds, running, checking } = props;
  const demandBeds = useMemo(() => instance.demand.map((d) => (d.population * beds) / 1000), [instance, beds]);
  const sol = shown?.sol ?? null;
  return (
    <div className={compact ? "stack" : "split-wide"}>
      <div className="card flush" style={{ position: "relative" }}>
        <MapView
          instance={instance}
          districts={districts}
          types={types}
          solution={sol}
          demandBeds={demandBeds}
          height={compact ? 460 : 600}
          group={mapGroup}
          showDistrictLabels={!compact}
        />
        {!sol && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 600 }}>
            <div className="notice" style={{ pointerEvents: "auto" }}>
              {running ? "MIP çözülüyor…" : checking ? "Önbellek kontrol ediliyor…" : "Henüz çözüm yok — \"MIP ile çöz\" düğmesine basın."}
            </div>
          </div>
        )}
      </div>
      <div className="stack">
        <div className="card">
          <div className="card-head">
            <h2>{title}</h2>
            <div className="row">
              {shown?.limitLabel && <span className="badge">{shown.limitLabel}</span>}
              {shown && <SolverBadge info={shown.solver} />}
            </div>
          </div>
          <MapLegend types={types} />
          {sol && shown && (
            <div className="stack" style={{ marginTop: 12 }}>
              <SolutionKpis cost={sol.cost} kpi={sol.kpi} types={types} investment={sol.investment}
                extra={shown.solver.bound != null && shown.solver.status !== "optimal" ? (
                  <Kpi label="Alt sınır (bound)" value={mtl(shown.solver.bound)} sub={`optimum ${mtl(shown.solver.bound)} – ${mtl(sol.cost.total)} arasında`} />
                ) : undefined}
              />
              <CostBar cost={sol.cost} />
            </div>
          )}
        </div>
        {sol && !compact && <UtilChart sol={sol} types={types} />}
      </div>
    </div>
  );
}

function UtilChart({ sol, types }: { sol: SolutionDict; types: HospitalType[] }) {
  const hs = [...sol.hospitals].sort((a, b) => b.util - a.util);
  const order = new Map(types.map((t, k) => [t.key, k]));
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: "bar",
      data: {
        labels: hs.map((h) => `A${h.cand + 1}`),
        datasets: [
          {
            data: hs.map((h) => h.util * 100),
            backgroundColor: hs.map((h) => typeColor(h.type)),
            borderRadius: 4,
            borderSkipped: "start",
            barPercentage: 0.85,
            categoryPercentage: 0.9,
          },
        ],
      },
      options: merge(baseOptions(), {
        plugins: {
          tooltip: {
            callbacks: {
              title: (items: { dataIndex: number }[]) => {
                const h = hs[items[0].dataIndex];
                return `Aday ${h.cand + 1} · ${types[order.get(h.type) ?? 0]?.name}`;
              },
              label: (it: { dataIndex: number }) => {
                const h = hs[it.dataIndex];
                return `Doluluk ${pct(h.util)} · ${n0(h.load)}/${n0(h.beds)} yatak · ${h.n_assigned} mahalle`;
              },
            },
          },
        },
        scales: { y: { min: 0, max: 100, ticks: { callback: (v: number) => `%${v}` } }, x: { ticks: { autoSkip: true, maxRotation: 0 } } },
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sol, types],
  );
  return (
    <div className="card">
      <div className="card-head"><h2>Hastane doluluk oranları</h2><span className="muted small">{hs.length} hastane, dolulukça sıralı</span></div>
      <ChartBox config={config} height={200} />
    </div>
  );
}

function CompareTable({ a, b }: { a: Shown | null; b: Shown | null }) {
  if (!a || !b) return null;
  const rows: [string, (s: SolutionDict) => number, (v: number) => string][] = [
    ["Toplam yıllık maliyet", (s) => s.cost.total, mtl],
    ["Açılış maliyeti (yıllık)", (s) => s.cost.fixed, mtl],
    ["Ulaşım maliyeti (yıllık)", (s) => s.cost.assign, mtl],
    ["Toplam yatırım", (s) => s.investment, mtl],
    ["Açılan hastane", (s) => s.kpi.n_open, n0],
    ["Toplam yatak", (s) => s.hospitals.reduce((x, h) => x + h.beds, 0), n0],
    ["Ort. mesafe (km)", (s) => s.kpi.avg_dist_km ?? 0, n1],
    ["Maks. mesafe (km)", (s) => s.kpi.max_dist_km ?? 0, n1],
    ["Ort. doluluk", (s) => s.kpi.avg_util ?? 0, (v) => pct(v)],
  ];
  return (
    <div className="card">
      <div className="card-head"><h2>S1 ve S2 karşılaştırması</h2><span className="muted small">Fark = S2 − S1</span></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Ölçüt</th><th className="r">S1 · Tek tip</th><th className="r">S2 · Üç tip</th><th className="r">Fark</th><th className="r">Değişim</th></tr></thead>
          <tbody>
            {rows.map(([label, f, fmt]) => {
              const va = f(a.sol);
              const vb = f(b.sol);
              return (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="r">{fmt(va)}</td>
                  <td className="r">{fmt(vb)}</td>
                  <td className="r">{label === "Ort. doluluk" ? pct(vb - va) : fmt(vb - va)}</td>
                  <td className="r muted">{va ? pct((vb - va) / Math.abs(va)) : "–"}</td>
                </tr>
              );
            })}
            <tr>
              <td>Tip dağılımı</td>
              <td className="r">{a.sol.kpi.n_open} orta</td>
              <td className="r">{Object.entries(b.sol.kpi.by_type).map(([k, v]) => `${v}${k === "S" ? "K" : k === "M" ? "O" : "B"}`).join(" · ")}</td>
              <td /><td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        S2 tek tip seçeneğini de kapsadığı için optimal maliyeti S1'den kötü olamaz. Zaman limitli çözümlerde aradaki fark gap kadar oynayabilir.
      </p>
    </div>
  );
}

function SweepView(props: {
  kind: "count" | "budget";
  limit: number;
  setLimit: (v: number) => void;
  range: { min: number; max: number };
  sweepOn: boolean;
  setSweepOn: (v: boolean) => void;
  series: { sc: Scenario; sw: SweepResult }[];
}) {
  const { kind, limit, setLimit, range, sweepOn, setSweepOn, series } = props;
  const [withPenalty, setWithPenalty] = useState(false);
  const fmtX = (v: number) => (kind === "count" ? n0(v) : mtl(v));
  const mk = (title: string, f: (p: SweepPoint) => number, yfmt: (v: number) => string): ChartConfiguration => ({
    type: "line",
    data: {
      datasets: series.map(({ sc, sw }) => {
        const c = getComputedStyle(document.documentElement).getPropertyValue(SC_COLOR[sc]).trim();
        return {
          label: SC_LABEL[sc],
          data: sw.points.map((p) => ({ x: p.value, y: f(p) })),
          borderColor: c,
          backgroundColor: c,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          stepped: kind === "budget" ? ("before" as const) : false,
        };
      }),
    },
    options: merge(baseOptions(), {
      plugins: {
        legend: { display: series.length > 1, position: "top", align: "end" },
        title: { display: true, text: title, align: "start", color: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(), font: { weight: 600, size: 12.5 } },
        tooltip: { callbacks: { title: (it: { parsed: { x: number } }[]) => `${kind === "count" ? "p ≤ " : "B ≤ "}${fmtX(it[0].parsed.x)}`, label: (it: { dataset: { label: string }; parsed: { y: number } }) => `${it.dataset.label}: ${yfmt(it.parsed.y)}` } },
        overlay: { x: limit },
      },
      scales: {
        x: { type: "linear", min: range.min, max: range.max, ticks: { callback: (v: number) => fmtX(v), maxTicksLimit: 8 }, title: { display: true, text: kind === "count" ? "Hastane sayısı üst sınırı p" : "Yatırım bütçesi B" } },
        y: { beginAtZero: true, ticks: { callback: (v: number) => yfmt(v) } },
      },
    }),
  });
  const configs = useMemo(
    () => [
      withPenalty
        ? mk("Toplam yıllık maliyet (ceza dahil)", (p) => p.cost.total, mtl)
        : mk("Açılış + ulaşım maliyeti (ceza hariç)", (p) => p.cost.fixed + p.cost.assign, mtl),
      mk("Karşılanmayan talep (yatak)", (p) => p.kpi.unmet_beds, n0),
      mk("Açılan hastane sayısı", (p) => p.kpi.n_open, n0),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, limit, kind, range, withPenalty],
  );
  const step = kind === "count" ? 1 : (range.max - range.min) / 200;
  return (
    <div className="stack">
      <div className="row" style={{ gap: 14 }}>
        <label className="field inline"><input type="checkbox" checked={sweepOn} onChange={(e) => setSweepOn(e.target.checked)} /> Haritada uygula</label>
        <span className="ink2 small" style={{ whiteSpace: "nowrap" }}>{kind === "count" ? "p ≤" : "B ≤"}</span>
        <input type="range" min={range.min} max={range.max} step={step} value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setSweepOn(true); }} style={{ flex: 1, minWidth: 180 }} />
        <b className="num" style={{ minWidth: 90, textAlign: "right" }}>{fmtX(limit)}</b>
        <label className="field inline"><input type="checkbox" checked={withPenalty} onChange={(e) => setWithPenalty(e.target.checked)} /> Maliyete cezayı dahil et</label>
      </div>
      <div className="row small ink2" style={{ gap: 16 }}>
        {series.map(({ sc, sw }) => {
          const p = pointAt(sw, limit);
          return (
            <span key={sc}>
              <b>{SC_LABEL[sc]}</b>: kısıtsız optimumda {kind === "count" ? `p* = ${sw.p_star} hastane` : `B* = ${mtl(sw.b_star)}`}
              {p && (p.binding ? ` · sınır bağlayıcı, ${p.kpi.n_open} hastane, ${n0(p.kpi.unmet_beds)} yatak karşılanmıyor` : " · sınır bağlayıcı değil, çözüm değişmez")}
            </span>
          );
        })}
      </div>
      <div className="three">
        {configs.map((c, i) => <ChartBox key={i} config={c} height={220} />)}
      </div>
    </div>
  );
}
