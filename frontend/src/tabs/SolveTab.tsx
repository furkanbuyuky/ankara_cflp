import type { ChartConfiguration } from "chart.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJSON } from "../api";
import { cssVar, withAlpha } from "../colors";
import ChartBox, { baseOptions, merge } from "../components/ChartBox";
import { CostBar, Kpi, Seg } from "../components/common";
import Formulation from "../components/Formulation";
import MapView, { MapLegend } from "../components/MapView";
import { compact, mtl, n0, n1, pct } from "../format";
import { METHODS, mipFor, solutionAt, streamSolve, type Method, type MipTable, type Run } from "../solve";
import { scenarioTypes, useApp } from "../state";
import type { GenSummary, Scenario, SolutionDict } from "../types";

const MAX_LIMIT = 30;
const SC_LABEL: Record<Scenario, string> = { single: "Tek tip", multi: "Üç tip" };
const SC_DESC: Record<Scenario, string> = {
  single: "Tüm hastaneler orta boy (600 yatak).",
  multi: "Her yere küçük (250), orta (600) ya da büyük (1.200 yatak) hastane açılabilir.",
};
const methodInfo = (m: Method) => METHODS.find((x) => x.value === m)!;
/** Gerçek maliyet: açılış + ulaşım. Karşılanmama cezası modelin talebi karşılamaya zorlanması
 * için konmuş yapay bir terimdir, harcama değildir; ekranda ayrı gösterilir. */
const realCost = (c: { fixed: number; assign: number }) => c.fixed + c.assign;
const limitLabel = (l: number | null) => (l == null ? "Sınırsız" : `En fazla ${l}`);

export default function SolveTab() {
  const { instance, districts, params } = useApp();
  const [scenario, setScenario] = useState<Scenario>("multi");
  const [method, setMethod] = useState<Method>("ga_tournament");
  const [limit, setLimit] = useState<number | null>(null);
  const [seed, setSeed] = useState(1);
  const [mip, setMip] = useState<Partial<Record<Scenario, MipTable>>>({});
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [idx, setIdx] = useState(0); // gösterilen nesil
  const [playing, setPlaying] = useState(false);
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);

  // MIP tabloları (her senaryo için bir kez)
  useEffect(() => {
    if (mip[scenario]) return;
    getJSON<MipTable>(`/api/mip/${scenario}`)
      .then((t) => setMip((m) => ({ ...m, [scenario]: t })))
      .catch(() => undefined);
  }, [scenario, mip]);

  const types = scenarioTypes(params, scenario);
  const table = mip[scenario];
  // karşılaştırma, gösterilen çalışmanın kendi senaryosu ve sınırıyla yapılır
  const runTable = run ? mip[run.scenario] : undefined;
  const mipRef = run && runTable ? mipFor(runTable, run.limit) : null;

  // MIP seçiliyken ayar değişince sonuç anında gösterilir (önceden hesaplandı)
  useEffect(() => {
    if (method !== "mip" || !table) return;
    const p = mipFor(table, limit);
    setPlaying(false);
    setRun({ id: 0, scenario, method: "mip", limit, seed: null, status: "done", gens: [], best: p, solver: p.solver, seconds: p.solver.seconds });
  }, [method, table, limit, scenario]);

  const solve = useCallback(async () => {
    if (method === "mip") return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const id = nextId.current++;
    const gens: GenSummary[] = [];
    const t0 = performance.now();
    let last = 0;
    let current: Run = { id, scenario, method, limit, seed, status: "running", gens, best: null, seconds: 0 };
    setPlaying(false);
    setRun(current);
    setIdx(0);
    // Gelen nesiller saniyede ~60 adet; harita ve grafik en fazla ~12 kez/sn güncellenir
    const flush = (force = false) => {
      const now = performance.now();
      if (!force && now - last < 80) return;
      last = now;
      current = { ...current, gens: [...gens], seconds: (now - t0) / 1000 };
      setRun(current);
      setIdx(gens.length - 1);
    };
    try {
      await streamSolve(
        { scenario, method, max_hospitals: limit, seed },
        (e) => {
          if (e.type === "gen") {
            const { type: _t, ...g } = e;
            void _t;
            gens.push(g as GenSummary);
            flush();
          } else if (e.type === "done") {
            current = { ...current, gens: [...gens], best: e.best, status: "done", seconds: (performance.now() - t0) / 1000 };
          } else if (e.type === "error") {
            current = { ...current, status: "error", error: e.message };
          }
        },
        ctrl.signal,
      );
      if (current.status === "running") current = { ...current, status: "error", error: "Akış beklenmedik şekilde bitti" };
    } catch (err) {
      if (ctrl.signal.aborted) return;
      current = { ...current, status: "error", error: String(err) };
    }
    setRun(current);
    setIdx(Math.max(0, current.gens.length - 1));
    if (current.status === "done") setHistory((h) => [current, ...h].slice(0, 8));
  }, [method, scenario, limit, seed]);

  // timelapse oynatma: tüm çalışma ~8 sn
  useEffect(() => {
    if (!playing || !run || run.gens.length < 2) return;
    const n = run.gens.length;
    const step = Math.max(1, Math.round(n / 100));
    const t = setInterval(() => {
      setIdx((i) => {
        if (i + step >= n - 1) {
          setPlaying(false);
          return n - 1;
        }
        return i + step;
      });
    }, 80);
    return () => clearInterval(t);
  }, [playing, run]);

  if (!instance || !params) return null;
  const totalPop = instance.demand.reduce((s, d) => s + d.population, 0);
  const totalBeds = (totalPop * params.beds_per_1000) / 1000;
  const minHosp = Math.ceil(totalBeds / Math.max(...types.map((t) => t.beds)));
  const running = run?.status === "running";
  const isMip = method === "mip";

  return (
    <div className="stack">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Ankara'da yeni hastaneler nereye açılmalı?</h1>
          <p className="page-desc">
            Mevcut hastaneler yok sayılarak 9 merkez ilçedeki mahallelerin yatak ihtiyacını karşılayacak hastanelerin
            yeri ve büyüklüğü seçilir. Amaç, yıllık açılış maliyeti ile hastaların yol maliyetinin toplamını en aza indirmek.
            Her mahalle tek bir hastaneye bağlanır, hastaneler kapasitelerini aşamaz.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <span className="badge">{instance.demand.length} mahalle · {compact(totalPop)} kişi</span>
            <span className="badge">{instance.candidates.length} aday parsel</span>
            <span className="badge">{n0(totalBeds)} yatak ihtiyacı</span>
          </div>
        </div>
      </header>

      <div className="card">
        <div className="controls">
          <div className="controls-row">
          <div className="control">
            <div className="control-label">1 · Senaryo</div>
            <Seg value={scenario} onChange={setScenario} options={[{ value: "single", label: "Tek tip" }, { value: "multi", label: "Üç tip" }]} />
            <div className="hint">{SC_DESC[scenario]}</div>
          </div>
          <div className="control grow">
            <div className="control-label">2 · Yöntem</div>
            <Seg value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
            <div className="hint">{methodInfo(method).desc}</div>
          </div>
          </div>
          <div className="controls-row">
          <div className="control" style={{ minWidth: 260, flex: 1 }}>
            <div className="control-label row between">
              <span>3 · Hastane sayısı</span>
              <b className="num" style={{ color: "var(--ink)" }}>{limitLabel(limit)}</b>
            </div>
            <input
              type="range"
              min={0}
              max={MAX_LIMIT}
              value={limit ?? 0}
              onChange={(e) => setLimit(Number(e.target.value) === 0 ? null : Number(e.target.value))}
              aria-label="Hastane sayısı üst sınırı"
            />
            <div className="row between hint">
              <span>Sınırsız</span>
              <span>Tüm talep için en az {minHosp} hastane gerekir</span>
              <span>{MAX_LIMIT}</span>
            </div>
          </div>
          <div className="control">
            <div className="control-label">4 · Seed</div>
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input type="number" min={0} value={seed} disabled={isMip} style={{ width: 90 }}
                onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Seed" />
              <button className="btn icon" disabled={isMip} title="Rastgele seed" aria-label="Rastgele seed"
                onClick={() => setSeed(Math.floor(Math.random() * 10000))}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" /></svg>
              </button>
            </div>
            <div className="hint">{isMip ? "MIP rastgele değildir" : "Aynı seed aynı sonucu verir"}</div>
          </div>
          <div className="control" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary solve-btn" onClick={solve} disabled={isMip || running}>
              {running ? `Çözülüyor… ${run?.gens.length ?? 0}. nesil` : isMip ? "Sonuç hazır" : "Çöz"}
            </button>
          </div>
          </div>
        </div>
      </div>

      <div className="split-wide">
        <MapPanel run={run} idx={idx} instance={instance} districts={districts} beds={params.beds_per_1000} />
        <div className="stack">
          <ResultCard run={run} idx={idx} mipRef={mipRef} />
          <History history={history} current={run} onSelect={(r) => { setPlaying(false); setRun(r); setIdx(Math.max(0, r.gens.length - 1)); }} mip={mip} />
        </div>
      </div>

      <ProgressCard run={run} idx={idx} setIdx={setIdx} playing={playing} setPlaying={setPlaying} mipRef={mipRef} />

      <div className="card">
        <details>
          <summary>Model ve veri hakkında</summary>
          <Formulation />
          <ul className="hint" style={{ margin: "12px 0 0", paddingLeft: 18 }}>
            {Object.values(instance.meta.sources ?? {}).map((v) => <li key={String(v)}>{String(v)}</li>)}
            <li>Parametreler sabittir: 1000 kişi başına {n1(params.beds_per_1000)} yatak, ulaşım {n0(params.alpha_tl_per_person_km)} ₺/kişi·km·yıl, yatırım %{n1(params.discount_rate * 100)} faizle {params.lifetime_years} yıla yayılır. GA ve DE 10.000 çözüm değerlendirir.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ harita

function MapPanel(props: {
  run: Run | null;
  idx: number;
  instance: NonNullable<ReturnType<typeof useApp>["instance"]>;
  districts: GeoJSON.FeatureCollection | null;
  beds: number;
}) {
  const { run, idx, instance, districts, beds } = props;
  const runTypes = scenarioTypes(useApp().params, run?.scenario ?? "multi");
  const demandBeds = useMemo(() => instance.demand.map((d) => (d.population * beds) / 1000), [instance, beds]);
  let solution: { genes: number[]; assign: number[] } | null = null;
  let newOpen: number[] = [];
  let closed: number[] = [];
  if (run?.gens.length) {
    const i = Math.min(idx, run.gens.length - 1);
    const cur = solutionAt(run.gens, i);
    // son nesilde, varsa nihai (tam) çözüm gösterilir
    solution = i === run.gens.length - 1 && run.best ? run.best : cur;
    if (cur.prevGenes) {
      newOpen = cur.genes.flatMap((v, j) => (v > 0 && v !== cur.prevGenes![j] ? [j] : []));
      closed = cur.genes.flatMap((v, j) => (v === 0 && cur.prevGenes![j] > 0 ? [j] : []));
    }
  } else if (run?.best) {
    solution = run.best;
  }
  const g = run?.gens.length ? run.gens[Math.min(idx, run.gens.length - 1)] : null;
  return (
    <div className="card flush" style={{ position: "relative" }}>
      <MapView
        instance={instance}
        districts={districts}
        types={runTypes}
        solution={solution}
        demandBeds={demandBeds}
        newOpen={newOpen}
        recentlyClosed={closed}
        height={600}
        overlay={<MapLegend types={runTypes} />}
      />
      {run && (
        <div className="map-status">
          <b>{methodInfo(run.method).label}</b> · {SC_LABEL[run.scenario]} · {limitLabel(run.limit)}
          {g ? <> · <span className="num">{g.gen}. nesil · {mtl(realCost(g.best_cost))}</span></> : null}
          {g && (g.unmet_beds ?? 0) > 0 ? <span className="badge bad">{n0(g.unmet_beds)} yatak açıkta</span> : null}
          {run.status === "running" && <span className="live-dot" aria-label="hesaplanıyor" />}
        </div>
      )}
      {!run && (
        <div className="map-empty">
          <div className="notice">Yöntemi seçip <b>Çöz</b>'e basın. Algoritma çalışırken harita her nesilde güncellenir.</div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ sonuç kartı

function ResultCard({ run, idx, mipRef }: { run: Run | null; idx: number; mipRef: SolutionDict | null }) {
  const types = scenarioTypes(useApp().params, run?.scenario ?? "multi");
  if (!run) {
    return (
      <div className="card">
        <h2>Sonuç</h2>
        <p className="hint" style={{ marginTop: 6 }}>Henüz çözüm yok.</p>
      </div>
    );
  }
  if (run.status === "error") return <div className="notice error">Hata: {run.error}</div>;
  const g = run.gens.length ? run.gens[Math.min(idx, run.gens.length - 1)] : null;
  const atEnd = !run.gens.length || idx >= run.gens.length - 1;
  const sol = atEnd && run.best ? run.best : null;
  const cost = sol ? sol.cost : g?.best_cost;
  const real = cost ? realCost(cost) : 0;
  const unmet = sol ? sol.kpi.unmet_beds : g?.unmet_beds ?? 0;
  const refReal = mipRef ? realCost(mipRef.cost) : null;
  const refUnmet = mipRef?.kpi.unmet_beds ?? 0;
  let costSub: string | undefined;
  if (run.method === "mip") costSub = "en iyi bilinen çözüm";
  else if (refReal != null && unmet === 0 && refUnmet === 0) costSub = `MIP'e göre ${real >= refReal ? "+" : ""}${pct((real - refReal) / refReal, 1)}`;
  else if (refReal != null) costSub = `MIP: ${mtl(refReal)}, ${refUnmet > 0 ? `${n0(refUnmet)} yatak açıkta` : "tüm talep karşılanıyor"}`;
  const nOpen = sol ? sol.kpi.n_open : g?.n_open ?? 0;
  const genes = sol ? sol.genes : g?.best_genes ?? [];
  const mix = types.length > 1 ? types.map((t, k) => `${genes.filter((v) => v === k + 1).length} ${t.name.toLowerCase()}`).join(" · ") : `hepsi ${types[0]?.name.toLowerCase()}`;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{run.status === "running" ? "Hesaplanıyor…" : atEnd ? "Sonuç" : `${g?.gen}. nesildeki en iyi çözüm`}</h2>
          <p className="hint">
            {methodInfo(run.method).label} · {SC_LABEL[run.scenario]} · {limitLabel(run.limit)}
            {run.seed != null ? ` · seed ${run.seed}` : ""}
          </p>
        </div>
        {run.method === "mip" && run.solver ? (
          <span className={`badge ${run.solver.status === "optimal" ? "ok" : "warn"}`}>
            {run.solver.status === "optimal" ? "Optimal" : `Optimuma en fazla ${pct(run.solver.gap, 2)} uzak`}
          </span>
        ) : run.status === "done" ? (
          <span className="badge">{n1(run.seconds)} sn · {run.gens.length} nesil</span>
        ) : null}
      </div>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Kpi label="Yıllık maliyet (açılış + ulaşım)" value={mtl(real)} sub={costSub} />
        <Kpi label="Açılan hastane" value={n0(nOpen)} sub={mix} />
        <Kpi label="Ortalama mesafe" value={sol ? `${n1(sol.kpi.avg_dist_km)} km` : "–"} sub={sol ? `en uzak ${n1(sol.kpi.max_dist_km)} km` : "çözüm bitince"} />
        <Kpi
          label="Karşılanmayan talep"
          value={unmet > 0 ? `${n0(unmet)} yatak` : "Yok"}
          sub={unmet > 0 ? (sol ? `${pct(sol.kpi.unmet_pct / 100)} · ${sol.kpi.unmet_count} mahalle hastanesiz` : "bazı mahalleler hastanesiz") : "tüm mahalleler bir hastaneye bağlı"}
          alert={unmet > 0}
        />
      </div>
      {cost && (
        <div style={{ marginTop: 14 }}>
          <div className="control-label" style={{ marginBottom: 6 }}>Maliyetin dağılımı</div>
          <CostBar cost={{ ...cost, penalty: 0, total: real }} />
          {unmet > 0 && (
            <p className="hint" style={{ marginTop: 8 }}>
              Hastane sayısı sınırı tüm talebi karşılamaya yetmiyor. Model, karşılanamayan her yatak için bir ceza puanı kullanır
              (talebi karşılamaya zorlamak için). Bu ceza gerçek bir harcama olmadığı için maliyete eklenmez.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ geçmiş

function History({ history, current, onSelect, mip }: { history: Run[]; current: Run | null; onSelect: (r: Run) => void; mip: Partial<Record<Scenario, MipTable>> }) {
  if (!history.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Bu oturumdaki çözümler</h2>
          <p className="hint">Bir satıra tıklayınca o çözüm yeniden gösterilir.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Yöntem</th><th>Ayar</th><th className="r">Maliyet</th><th className="r">MIP'e fark</th></tr></thead>
          <tbody>
            {history.map((r) => {
              const m = mip[r.scenario] ? mipFor(mip[r.scenario]!, r.limit) : null;
              const ref = m && m.kpi.unmet_beds === 0 ? realCost(m.cost) : null;
              const c = r.best ? realCost(r.best.cost) : 0;
              const open = r.best?.kpi.unmet_beds ?? 0;
              return (
                <tr key={r.id} onClick={() => onSelect(r)} style={{ cursor: "pointer", background: current?.id === r.id ? "var(--accent-wash)" : undefined }}>
                  <td>{methodInfo(r.method).short}</td>
                  <td className="hint">{SC_LABEL[r.scenario]} · {r.limit ?? "∞"} · seed {r.seed}</td>
                  <td className="r">{mtl(c)}</td>
                  <td className="r">{open > 0 ? <span className="badge bad">{n0(open)} yatak açıkta</span> : ref ? `${c >= ref ? "+" : ""}${pct((c - ref) / ref, 1)}` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ilerleme grafiği ve timelapse

function ProgressCard(props: {
  run: Run | null;
  idx: number;
  setIdx: (v: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  mipRef: SolutionDict | null;
}) {
  const { run, idx, setIdx, playing, setPlaying, mipRef } = props;
  const gens = run?.gens ?? [];
  const n = gens.length;
  const i = Math.min(idx, Math.max(0, n - 1));
  const refReal = mipRef ? realCost(mipRef.cost) : null;
  const refUnmet = mipRef?.kpi.unmet_beds ?? 0;
  const improvements = gens.map((g, k) => (g.improved ? k : -1)).filter((k) => k > 0);
  // sınır tüm talebi karşılamaya yetmiyorsa karşılanamayan yatak ayrı bir grafikte izlenir
  const hasUnmet = gens.some((g) => (g.unmet_beds ?? 0) > 0) || refUnmet > 0;
  const cursor = n ? gens[i].gen : null;
  const xMax = Math.max(10, n ? gens[n - 1].gen : 10);

  const costCfg = useMemo<ChartConfiguration>(() => {
    const color = cssVar("--accent");
    const reals = gens.map((g) => realCost(g.best_cost));
    const lo = Math.min(...reals, refReal ?? Infinity);
    // sınırsızda maliyet hep düşer: alt kısım yakınlaştırılır; sınır bağlayıcıyken maliyet artabilir: tüm aralık
    const top = Math.max(...reals, refReal ?? 0);
    const hi = hasUnmet ? top * 1.03 : Math.max(lo * 1.05, Math.min(top, lo * 1.35));
    return {
      type: "line",
      data: {
        datasets: [
          {
            label: "En iyi çözümün maliyeti",
            data: gens.map((g, k) => ({ x: g.gen, y: reals[k] })),
            borderColor: color,
            backgroundColor: withAlpha(color, 0.08),
            fill: "start",
            borderWidth: 2.2,
            pointRadius: 0,
            stepped: "before" as const,
          },
        ],
      },
      options: merge(baseOptions(), {
        plugins: {
          overlay: { x: cursor, refLines: refReal != null ? [{ y: refReal, label: `MIP: ${mtl(refReal)}`, color: cssVar("--critical"), dash: [6, 4] }] : [] },
          tooltip: { callbacks: { title: (it: { parsed: { x: number } }[]) => `${it[0]?.parsed.x}. nesil`, label: (it: { parsed: { y: number } }) => `Açılış + ulaşım: ${mtl(it.parsed.y)}` } },
        },
        scales: {
          x: { type: "linear", min: 0, max: xMax, title: { display: true, text: "Nesil (iterasyon)" }, ticks: { maxTicksLimit: 10, includeBounds: false } },
          y: { min: Number.isFinite(lo) ? lo * 0.97 : undefined, max: Number.isFinite(lo) ? hi : undefined, title: { display: true, text: "Yıllık maliyet (açılış + ulaşım)" }, ticks: { callback: (v: number) => mtl(v) } },
        },
      }),
    };
  }, [gens, cursor, refReal, xMax, hasUnmet]);

  const unmetCfg = useMemo<ChartConfiguration>(() => {
    const color = cssVar("--critical");
    return {
      type: "line",
      data: {
        datasets: [
          {
            label: "Karşılanamayan yatak",
            data: gens.map((g) => ({ x: g.gen, y: g.unmet_beds ?? 0 })),
            borderColor: color,
            backgroundColor: withAlpha(color, 0.08),
            fill: "start",
            borderWidth: 2.2,
            pointRadius: 0,
            stepped: "before" as const,
          },
        ],
      },
      options: merge(baseOptions(), {
        plugins: {
          overlay: { x: cursor, refLines: [{ y: refUnmet, label: `MIP: ${n0(refUnmet)} yatak`, color: cssVar("--ink-2"), dash: [6, 4] }] },
          tooltip: { callbacks: { title: (it: { parsed: { x: number } }[]) => `${it[0]?.parsed.x}. nesil`, label: (it: { parsed: { y: number } }) => `Karşılanamayan: ${n0(it.parsed.y)} yatak` } },
        },
        scales: {
          x: { type: "linear", min: 0, max: xMax, title: { display: true, text: "Nesil (iterasyon)" }, ticks: { maxTicksLimit: 10, includeBounds: false } },
          y: { beginAtZero: true, title: { display: true, text: "Karşılanamayan yatak" }, ticks: { callback: (v: number) => n0(v) } },
        },
      }),
    };
  }, [gens, cursor, refUnmet, xMax]);

  if (!run || run.method === "mip") {
    return (
      <div className="card">
        <div className="card-head"><h2>Maliyetin nesiller boyunca düşüşü</h2></div>
        <p className="hint">
          {run?.method === "mip"
            ? "MIP iterasyon göstermez, tek seferde en iyi çözümü verir. GA ya da DE seçip Çöz'e bastığınızda, algoritmanın maliyeti nesil nesil nasıl düşürdüğü burada görünür. Kırmızı çizgi MIP sonucudur."
            : "Çöz'e bastığınızda algoritmanın en iyi çözümü nesil nesil nasıl iyileştirdiği burada çizilir. Kırmızı çizgi MIP sonucudur."}
        </p>
      </div>
    );
  }

  const first = n ? realCost(gens[0].best_cost) : 0;
  const last = n ? realCost(gens[n - 1].best_cost) : 0;
  const unmetFirst = gens[0]?.unmet_beds ?? 0;
  const unmetLast = gens[n - 1]?.unmet_beds ?? 0;
  const jump = (dir: 1 | -1) => {
    setPlaying(false);
    if (dir > 0) setIdx(improvements.find((k) => k > i) ?? n - 1);
    else setIdx([...improvements].reverse().find((k) => k < i) ?? 0);
  };
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Maliyetin nesiller boyunca düşüşü</h2>
          <p className="hint">
            Her nesilde o ana kadar bulunan en iyi çözümün yıllık maliyeti (açılış + ulaşım). Kırmızı kesikli çizgi MIP sonucu.
            {n > 1 && !hasUnmet && first > 0 && ` İlk nesilden sona maliyet ${pct((first - last) / first, 0)} düştü.`}
            {n > 1 && hasUnmet && ` Hastane sınırı bağlayıcı: algoritma önce karşılanamayan talebi azaltır (${n0(unmetFirst)} → ${n0(unmetLast)} yatak), bu sırada maliyet artabilir.`}
          </p>
        </div>
      </div>
      <div className="player" style={{ marginBottom: 12 }}>
        <button className="btn icon" onClick={() => { setPlaying(false); setIdx(0); }} disabled={run.status !== "done"} title="Başa sar" aria-label="Başa sar">⏮</button>
        <button className="btn icon" onClick={() => jump(-1)} disabled={run.status !== "done"} title="Önceki iyileşme" aria-label="Önceki iyileşme">◀</button>
        <button className="btn primary icon" disabled={run.status !== "done"} onClick={() => { if (i >= n - 1) setIdx(0); setPlaying(!playing); }} aria-label={playing ? "Duraklat" : "Oynat"}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="btn icon" onClick={() => jump(1)} disabled={run.status !== "done"} title="Sonraki iyileşme" aria-label="Sonraki iyileşme">▶|</button>
        <div className="timeline">
          <div className="ticks">{improvements.map((k) => <i key={k} style={{ left: `${(k / Math.max(1, n - 1)) * 100}%` }} />)}</div>
          <input type="range" min={0} max={Math.max(0, n - 1)} value={i} disabled={run.status !== "done"}
            onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Zaman çizelgesi" />
        </div>
        <span className="num small" style={{ minWidth: 110, textAlign: "right" }}>{n ? `${gens[i].gen}. nesil / ${gens[n - 1].gen}` : "–"}</span>
      </div>
      <ChartBox config={costCfg} height={hasUnmet ? 240 : 300} />
      {hasUnmet && (
        <div style={{ marginTop: 16 }}>
          <div className="control-label" style={{ marginBottom: 6 }}>Karşılanamayan talep</div>
          <ChartBox config={unmetCfg} height={180} />
        </div>
      )}
      {run.status === "done" && <p className="hint" style={{ marginTop: 8 }}>Yeşil çentikler en iyi çözümün iyileştiği nesiller. Kaydırıcıyı sürükleyerek ya da ▶ ile çözümün gelişimini haritada izleyebilirsiniz.</p>}
    </div>
  );
}
