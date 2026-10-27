import type { ChartConfiguration } from "chart.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { postJSON, useCachedJob } from "../api";
import { cssVar, runColor, withAlpha } from "../colors";
import ChartBox, { baseOptions, merge } from "../components/ChartBox";
import { JobStatus, Kpi, PageHeader, Seg } from "../components/common";
import MapView, { MapLegend } from "../components/MapView";
import { mtl, n0, n1, pct } from "../format";
import { autoLabel, PRESETS, RunConfigEditor } from "../runs";
import { scenarioTypes, useApp } from "../state";
import type { ExactResult, GenSummary, RunResult, RunSpec } from "../types";

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function genAt(gens: GenSummary[], t: number): number {
  let lo = 0;
  let hi = gens.length - 1;
  if (t < gens[0].evals) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (gens[mid].evals <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** idx'deki en iyi çözümün ataması (yalnızca iyileşme nesillerinde saklanır) ve bir önceki en iyinin genleri. */
function solutionAt(gens: GenSummary[], idx: number) {
  let a = idx;
  while (a > 0 && !gens[a].assign) a--;
  let p = a - 1;
  while (p > 0 && !gens[p].improved) p--;
  return { genes: gens[idx].best_genes, assign: gens[a].assign ?? [], prevGenes: p >= 0 ? gens[p].best_genes : null, improvedAt: a };
}

export default function ProcessTab() {
  const { instance, districts, params, scenario, makeSpec } = useApp();
  const [runs, setRuns] = useState<RunSpec[]>([PRESETS[0], PRESETS[1], PRESETS[4]]);
  const [budget, setBudget] = useState(10000);
  const [seed, setSeed] = useState(0);
  const [maxH, setMaxH] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const spec = makeSpec({ max_hospitals: maxH });
  const body = useMemo(
    () => ({ spec, runs: runs.map((r) => ({ ...r, config: { ...r.config, max_evals: budget, seed } })), polish: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(spec), runs, budget, seed],
  );
  const opt = useCachedJob<{ runs: RunResult[] }>("optimize", body);
  const [ref, setRef] = useState<ExactResult | null>(null);

  useEffect(() => {
    let alive = true;
    setRef(null);
    (async () => {
      for (const tl of [300, 120, 60, 30]) {
        const r = await postJSON<ExactResult | null>("/api/cached/exact", { spec, time_limit: tl }).catch(() => null);
        if (r && alive) return setRef(r);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec), opt.result]);

  if (!instance || !params) return null;
  const types = scenarioTypes(params, scenario);
  const result = opt.result;

  return (
    <>
    <PageHeader
      step={4}
      title="Optimizasyon süreci"
      actions={
        <button className="btn primary" disabled={opt.running || runs.length === 0} onClick={() => opt.run()}>
          {opt.running ? "Çalışıyor…" : result ? "Yeniden çalıştır" : "Çalıştır"}
        </button>
      }
    >
      Seçilen algoritmalar Ankara örneğinde aynı değerlendirme bütçesiyle yarışır. Zaman çizelgesini oynattıkça haritada o ana
      kadarki en iyi çözüm, grafikte maliyetin nasıl düştüğü görünür. Yatay çizgiler MIP'in bulduğu en iyi çözümü ve alt sınırı gösterir.
    </PageHeader>
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Yarışan algoritmalar</h2>
            <p className="hint">En fazla 4 çalışma. "Ayarlar" ile popülasyon, olasılıklar ve operatörler değiştirilebilir.</p>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <label className="field inline">Bütçe
              <select value={budget} onChange={(e) => setBudget(Number(e.target.value))}>
                {[2000, 5000, 10000, 20000, 40000].map((b) => <option key={b} value={b}>{n0(b)} değerlendirme</option>)}
              </select>
            </label>
            <label className="field inline">Seed <input type="number" value={seed} min={0} style={{ width: 60 }} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
            <label className="field inline">
              <input type="checkbox" checked={maxH != null} onChange={(e) => setMaxH(e.target.checked ? 12 : null)} />
              Hastane ≤
              {maxH != null && <input type="number" min={1} max={60} value={maxH} style={{ width: 56 }} onChange={(e) => setMaxH(Number(e.target.value) || 1)} />}
            </label>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {runs.map((r, i) => (
            <div key={i} className="stack" style={{ gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}>
                  <i className="dot" style={{ background: `var(--run-${i + 1})` }} />
                  <b>{r.label}</b>
                  <span className="hint">{Object.entries(r.config).map(([k, v]) => `${k}=${v}`).join(", ")}</span>
                </span>
                <span className="row">
                  <button className="btn small ghost" onClick={() => setEditing(editing === i ? null : i)}>{editing === i ? "Kapat" : "Ayarlar"}</button>
                  <button className="btn small ghost" onClick={() => setRuns(runs.filter((_, k) => k !== i))} aria-label="Kaldır">✕</button>
                </span>
              </div>
              {editing === i && <RunConfigEditor run={r} onChange={(nr) => setRuns(runs.map((x, k) => (k === i ? nr : x)))} />}
            </div>
          ))}
          {runs.length < 4 && (
            <div className="row" style={{ marginTop: 4 }}>
              <span className="hint">Ekle:</span>
              {PRESETS.map((p) => (
                <button key={p.label} className="btn small" onClick={() => setRuns([...runs, { ...p, label: autoLabel(p) }])}>{p.label}</button>
              ))}
            </div>
          )}
        </div>
        {(opt.job || opt.error) && <div style={{ marginTop: 10 }}><JobStatus job={opt.job} error={opt.error} /></div>}
      </div>

      {!result && !opt.running && <div className="notice">Henüz sonuç yok. "Çalıştır" ile başlatın (bütçe başına birkaç saniye sürer).</div>}
      {result && <Player result={result} reference={ref} types={types} instance={instance} districts={districts} beds={params.beds_per_1000} />}
    </div>
    </>
  );
}

function Player(props: {
  result: { runs: RunResult[] };
  reference: ExactResult | null;
  types: ReturnType<typeof scenarioTypes>;
  instance: NonNullable<ReturnType<typeof useApp>["instance"]>;
  districts: GeoJSON.FeatureCollection | null;
  beds: number;
}) {
  const { result, reference, types, instance, districts, beds } = props;
  const runs = result.runs;
  const tMax = Math.max(...runs.map((r) => r.generations[r.generations.length - 1].evals));
  const [t, setT] = useState(tMax);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sel, setSel] = useState(0);
  const [zoom, setZoom] = useState<"near" | "full">("near");
  const last = useRef<number | null>(null);

  useEffect(() => {
    setT(tMax);
    setSel(0);
    setPlaying(false);
  }, [result, tMax]);

  // oynatma: tüm bütçe 1× hızda ~20 saniyede biter
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      if (last.current != null) {
        const dt = (now - last.current) / 1000;
        setT((x) => {
          const nx = x + (tMax / 20) * speed * dt;
          if (nx >= tMax) {
            setPlaying(false);
            return tMax;
          }
          return nx;
        });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed, tMax]);

  const run = runs[Math.min(sel, runs.length - 1)];
  const gens = run.generations;
  const idx = genAt(gens, t);
  const g = gens[idx];
  const cur = solutionAt(gens, idx);
  const newOpen = cur.prevGenes ? cur.genes.flatMap((v, j) => (v > 0 && v !== cur.prevGenes![j] ? [j] : [])) : [];
  const closed = cur.prevGenes ? cur.genes.flatMap((v, j) => (v === 0 && cur.prevGenes![j] > 0 ? [j] : [])) : [];
  const improvements = gens.filter((x) => x.improved);
  const refBest = reference?.solution.cost.total ?? null;
  const refBound = reference?.solver.bound ?? null;
  const demandBeds = useMemo(() => instance.demand.map((d) => (d.population * beds) / 1000), [instance, beds]);
  const byType = types.map((tp, k) => `${cur.genes.filter((v) => v === k + 1).length} ${tp.name.toLowerCase()}`).join(" · ");

  const jump = (dir: 1 | -1) => {
    setPlaying(false);
    if (dir > 0) {
      const nx = improvements.find((x) => x.evals > t + 1e-9);
      setT(nx ? nx.evals : tMax);
    } else {
      const pv = [...improvements].reverse().find((x) => x.evals < g.evals - 1e-9 || (x.evals < t - 1e-9 && x.gen !== g.gen));
      setT(pv ? pv.evals : 0);
    }
  };

  const yRange = useMemo(() => {
    const finals = runs.map((r) => r.generations[r.generations.length - 1].best);
    const lo = Math.min(...finals, refBound ?? Infinity, refBest ?? Infinity);
    if (zoom === "full") return { min: undefined, max: undefined };
    return { min: lo * 0.985, max: lo * 1.25 };
  }, [runs, refBest, refBound, zoom]);

  const conv = useMemo<ChartConfiguration>(() => {
    const ds = runs.flatMap((r, i) => {
      const c = runColor(i);
      const upto = r.generations.filter((x) => x.evals <= t + 1e-9);
      const base = {
        best: {
          label: r.label,
          data: upto.map((x) => ({ x: x.evals, y: x.best })),
          borderColor: c,
          backgroundColor: c,
          borderWidth: 2,
          pointRadius: 0,
          stepped: "before" as const,
        },
      };
      const out: object[] = [base.best];
      if (i === sel)
        out.push({
          label: `${r.label} (popülasyon ortalaması)`,
          data: upto.map((x) => ({ x: x.evals, y: x.mean })),
          borderColor: withAlpha(c, 0.55),
          borderWidth: 1,
          borderDash: [4, 3],
          pointRadius: 0,
        });
      return out;
    });
    const refLines = [];
    if (refBest != null) refLines.push({ y: refBest, label: `MIP en iyi ${mtl(refBest)}`, color: cssVar("--ink-2") });
    if (refBound != null && reference?.solver.status !== "optimal") refLines.push({ y: refBound, label: `MIP alt sınır ${mtl(refBound)}`, color: cssVar("--muted"), dash: [2, 3], below: true });
    return {
      type: "line",
      data: { datasets: ds as never },
      options: merge(baseOptions(), {
        plugins: {
          legend: { display: true, position: "top", align: "end" },
          overlay: { x: t, refLines, band: refBest != null && refBound != null ? { from: refBound, to: refBest, color: withAlpha(cssVar("--good"), 0.08) } : null },
          tooltip: { callbacks: { title: (it: { parsed: { x: number } }[]) => `${n0(it[0]?.parsed.x)} değerlendirme`, label: (it: { dataset: { label: string }; parsed: { y: number } }) => `${it.dataset.label}: ${mtl(it.parsed.y)}` } },
        },
        scales: {
          x: { type: "linear", min: 0, max: tMax, title: { display: true, text: "Değerlendirme sayısı" }, ticks: { callback: (v: number) => n0(v) } },
          y: { min: yRange.min, max: yRange.max, title: { display: true, text: "Toplam yıllık maliyet" }, ticks: { callback: (v: number) => mtl(v) } },
        },
      }),
    };
  }, [runs, t, sel, refBest, refBound, reference, tMax, yRange]);

  const small = (title: string, f: (x: GenSummary) => number, yfmt: (v: number) => string): ChartConfiguration => ({
    type: "line",
    data: {
      datasets: runs.map((r, i) => ({
        label: r.label,
        data: r.generations.filter((x) => x.evals <= t + 1e-9).map((x) => ({ x: x.evals, y: f(x) })),
        borderColor: runColor(i),
        backgroundColor: runColor(i),
        borderWidth: 1.6,
        pointRadius: 0,
      })),
    },
    options: merge(baseOptions(), {
      plugins: {
        title: { display: true, text: title, align: "start", color: cssVar("--ink"), font: { weight: 600, size: 12.5 } },
        overlay: { x: t },
        tooltip: { callbacks: { title: (it: { parsed: { x: number } }[]) => `${n0(it[0]?.parsed.x)} değerlendirme`, label: (it: { dataset: { label: string }; parsed: { y: number } }) => `${it.dataset.label}: ${yfmt(it.parsed.y)}` } },
      },
      scales: { x: { type: "linear", min: 0, max: tMax, ticks: { callback: (v: number) => n0(v), maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { callback: (v: number) => yfmt(v) } } },
    }),
  });
  const divCfg = useMemo(() => small("Popülasyon çeşitliliği (ort. Hamming)", (x) => x.diversity, (v) => pct(v, 0)), [runs, t, tMax]); // eslint-disable-line react-hooks/exhaustive-deps
  const openCfg = useMemo(() => small("En iyi çözümde açık hastane", (x) => x.n_open, n0), [runs, t, tMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalBest = run.polished ?? run.best;
  const gapNow = refBest ? (g.best - refBest) / refBest : null;

  return (
    <div className="stack">
      <div className="card sticky-player" style={{ boxShadow: "var(--shadow-md)" }}>
        <div className="player">
          <button className="btn icon" onClick={() => { setPlaying(false); setT(0); }} title="Başa sar" aria-label="Başa sar">⏮</button>
          <button className="btn icon" onClick={() => jump(-1)} title="Önceki iyileşme">◀</button>
          <button className="btn primary icon" onClick={() => { if (t >= tMax) setT(0); setPlaying(!playing); }} style={{ minWidth: 40 }}>{playing ? "⏸" : "▶"}</button>
          <button className="btn icon" onClick={() => jump(1)} title="Sonraki iyileşme">▶|</button>
          <div className="timeline">
            <div className="ticks">
              {improvements.map((x) => <i key={x.gen} style={{ left: `${(x.evals / tMax) * 100}%` }} title={`Nesil ${x.gen}: ${mtl(x.best)}`} />)}
            </div>
            <input type="range" min={0} max={tMax} step={1} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-label="Zaman çizelgesi" />
          </div>
          <span className="num small" style={{ minWidth: 150, textAlign: "right" }}>{n0(t)} / {n0(tMax)} değerlendirme</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Hız">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>Yeşil çentikler seçili çalışmanın en iyi çözümünü iyileştirdiği nesilleri gösterir; ◀ / ▶| ile aralarında gezinin.</p>
      </div>

      <div className="split-wide">
        <div className="card flush">
          <div className="row between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <span className="hint">Haritada gösterilen:</span>
            <Seg value={String(sel)} onChange={(v) => setSel(Number(v))} options={runs.map((r, i) => ({ value: String(i), label: <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><i className="dot" style={{ background: runColor(i) }} />{r.label}</span> }))} />
          </div>
          <MapView instance={instance} districts={districts} types={types} solution={cur} demandBeds={demandBeds} newOpen={newOpen} recentlyClosed={closed} height={580} candidateMode="plain" overlay={<MapLegend types={types} candidates={false} />} />
          <div className="card-foot hint">
            Son iyileşme (nesil {gens[cur.improvedAt].gen}): {newOpen.length ? `${newOpen.length} hastane açıldı/tipi değişti (yeşil halka)` : "yeni açılış yok"}
            {closed.length ? `, ${closed.length} hastane kapandı (kırmızı kesikli kare)` : ""}.
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>{run.label}</h2><span className="badge">nesil {g.gen} / {gens[gens.length - 1].gen}</span></div>
            <div className="kpis">
              <Kpi label="En iyi maliyet (şu an)" value={mtl(g.best)} sub={gapNow != null ? `MIP'e göre ${gapNow >= 0 ? "+" : ""}${pct(gapNow, 2)}` : "referans yok"} />
              <Kpi label="Popülasyon ortalaması" value={mtl(g.mean)} sub={`medyan ${mtl(g.median)}`} />
              <Kpi label="Açık hastane" value={g.n_open} sub={types.length > 1 ? byType : undefined} />
              <Kpi label="Çeşitlilik" value={pct(g.diversity, 1)} sub="ort. Hamming / J" />
              <Kpi label="Ceza" value={g.best_cost.penalty > 0 ? mtl(g.best_cost.penalty) : "Yok"} alert={g.best_cost.penalty > 0} sub={g.best_cost.penalty > 0 ? "talep karşılanmıyor" : "tüm talep karşılanıyor"} />
              <Kpi label="Değerlendirme" value={n0(g.evals)} />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Çalışma sonu</h2><span className="muted small">polish = seçilen hastaneler sabitken atamanın MIP ile çözülmesi</span></div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Çalışma</th><th className="r">Decoder</th><th className="r">Polish</th><th className="r">MIP'e fark</th><th className="r">Nesil</th><th className="r">Süre</th></tr></thead>
                <tbody>
                  {runs.map((r, i) => {
                    const fb = (r.polished ?? r.best).cost.total;
                    return (
                      <tr key={i}>
                        <td><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: runColor(i) }} />{r.label}</span></td>
                        <td className="r">{mtl(r.best.cost.total)}</td>
                        <td className="r">{r.polished ? mtl(r.polished.cost.total) : "–"}</td>
                        <td className="r">{refBest ? `${fb >= refBest ? "+" : ""}${pct((fb - refBest) / refBest, 2)}` : "–"}</td>
                        <td className="r">{r.stats.generations}</td>
                        <td className="r">{n1(r.stats.seconds)} sn</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {reference ? (
              <p className="muted small" style={{ marginTop: 8 }}>
                Referans: MIP en iyi {mtl(refBest)}{reference.solver.status !== "optimal" && refBound != null ? `, alt sınır ${mtl(refBound)} (optimum bu aralıkta, yeşil bant)` : " (optimal)"}.
                Seçili çalışmanın polish sonrası en iyisi {mtl(finalBest.cost.total)}.
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: 8 }}>MIP referansı yok. Aynı ayarlarla Sekme 2'de "MIP ile çöz" çalıştırılırsa burada görünür.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Yakınsama</h2>
          <Seg value={zoom} onChange={setZoom} options={[{ value: "near", label: "Yakın" }, { value: "full", label: "Tüm aralık" }]} />
        </div>
        <ChartBox config={conv} height={320} />
      </div>
      <div className="two">
        <div className="card"><ChartBox config={divCfg} height={200} /></div>
        <div className="card"><ChartBox config={openCfg} height={200} /></div>
      </div>
    </div>
  );
}
