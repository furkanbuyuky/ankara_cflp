import type { ChartConfiguration } from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { postJSON, useCachedJob } from "../api";
import { cssVar, runColor, withAlpha } from "../colors";
import ChartBox, { baseOptions, merge } from "../components/ChartBox";
import { JobStatus } from "../components/common";
import { mtl, n0, n1, pct } from "../format";
import { PRESETS } from "../runs";
import { useApp } from "../state";
import type { BenchResult, ExactResult } from "../types";

const MAX_CONFIGS = 4;

export default function CompareTab() {
  const { scenario, makeSpec } = useApp();
  const [chosen, setChosen] = useState<string[]>([PRESETS[0].label, PRESETS[1].label, PRESETS[2].label, PRESETS[4].label]);
  const [seeds, setSeeds] = useState(10);
  const [budget, setBudget] = useState(10000);
  const [polish, setPolish] = useState(true);
  const [ref, setRef] = useState<ExactResult | null>(null);
  const spec = makeSpec();
  const specKey = JSON.stringify(spec);

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
  }, [specKey]);

  const runs = PRESETS.filter((p) => chosen.includes(p.label));
  const body = useMemo(
    () => ({ spec, runs, seeds, max_evals: budget, polish, reference: ref?.solution.cost.total ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [specKey, chosen, seeds, budget, polish, ref],
  );
  const bench = useCachedJob<BenchResult>("benchmark", body);
  const toggle = (label: string) =>
    setChosen((c) => (c.includes(label) ? c.filter((x) => x !== label) : c.length < MAX_CONFIGS ? [...c, label] : c));
  const res = bench.result;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Çoklu seed karşılaştırması</h2>
            <p className="muted small">
              Her konfigürasyon {seeds} farklı seed ile, aynı değerlendirme bütçesiyle çalışır ({scenario === "single" ? "S1 · Tek tip" : "S2 · Üç tip"}).
              Tek bir şanslı çalışma yerine dağılım karşılaştırılır. En fazla {MAX_CONFIGS} konfigürasyon.
            </p>
          </div>
          <button className="btn primary" disabled={bench.running || runs.length === 0} onClick={() => bench.run()}>
            {bench.running ? "Çalışıyor…" : res ? "Yeniden çalıştır" : "Karşılaştırmayı başlat"}
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {PRESETS.map((p) => {
            const on = chosen.includes(p.label);
            const idx = runs.findIndex((r) => r.label === p.label);
            return (
              <button key={p.label} className="btn small" aria-pressed={on} onClick={() => toggle(p.label)}
                style={on ? { borderColor: runColor(idx), background: withAlpha(runColor(idx), 0.12) } : undefined}
                disabled={!on && chosen.length >= MAX_CONFIGS}>
                {on && <i className="dot" style={{ background: runColor(idx) }} />}{p.label}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ gap: 14, marginTop: 10 }}>
          <label className="field inline">Seed sayısı
            <select value={seeds} onChange={(e) => setSeeds(Number(e.target.value))}>{[3, 5, 10, 20].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <label className="field inline">Bütçe
            <select value={budget} onChange={(e) => setBudget(Number(e.target.value))}>{[2000, 5000, 10000, 20000].map((b) => <option key={b} value={b}>{n0(b)} değerlendirme</option>)}</select>
          </label>
          <label className="field inline"><input type="checkbox" checked={polish} onChange={(e) => setPolish(e.target.checked)} /> Polish (atamayı MIP ile iyileştir)</label>
          <span className="muted small">
            {ref ? `Referans: MIP en iyi ${mtl(ref.solution.cost.total)}${ref.solver.status !== "optimal" && ref.solver.bound ? `, alt sınır ${mtl(ref.solver.bound)}` : ""}` : "MIP referansı yok (Sekme 2'de çözün)"}
          </span>
        </div>
        {(bench.job || bench.error) && <div style={{ marginTop: 10 }}><JobStatus job={bench.job} error={bench.error} /></div>}
      </div>

      {!res && !bench.running && <div className="notice">Henüz sonuç yok. Seçili konfigürasyonlarla "Karşılaştırmayı başlat"a basın. Çalışmalar paralel koşar.</div>}
      {res && <Results res={res} refBound={ref?.solver.bound ?? null} />}
    </div>
  );
}

function Results({ res, refBound }: { res: BenchResult; refBound: number | null }) {
  const rows = res.summary;
  const reference = res.reference;

  const strip = useMemo<ChartConfiguration>(() => {
    const pts = rows.flatMap((r, i) => r.finals.map((v, k) => ({ x: i + ((k * 0.37) % 1 - 0.5) * 0.36, y: v, label: r.label, seed: r.runs[k]?.seed })));
    return {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Seed sonucu",
            data: pts,
            backgroundColor: pts.map((p) => withAlpha(runColor(rows.findIndex((r) => r.label === p.label)), 0.75)),
            borderColor: cssVar("--surface"),
            borderWidth: 1.5,
            pointRadius: 5,
            pointHoverRadius: 7,
          },
          {
            label: "Ortalama",
            data: rows.map((r, i) => ({ x: i, y: r.mean })),
            pointStyle: "line",
            pointRadius: 18,
            pointBorderWidth: 3,
            borderColor: cssVar("--ink"),
            backgroundColor: cssVar("--ink"),
            showLine: false,
          },
        ],
      },
      options: merge(baseOptions(), {
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          overlay: {
            refLines: [
              ...(reference ? [{ y: reference, label: `MIP en iyi ${mtl(reference)}`, color: cssVar("--ink-2") }] : []),
              ...(refBound ? [{ y: refBound, label: `alt sınır ${mtl(refBound)}`, color: cssVar("--muted"), dash: [2, 3], below: true }] : []),
            ],
          },
          tooltip: {
            callbacks: {
              label: (it: { datasetIndex: number; raw: { y: number; label?: string; seed?: number; x: number } }) =>
                it.datasetIndex === 0 ? `${it.raw.label} · seed ${it.raw.seed}: ${mtl(it.raw.y)}` : `${rows[Math.round(it.raw.x)].label} ortalama: ${mtl(it.raw.y)}`,
            },
          },
        },
        scales: {
          x: { type: "linear", min: -0.6, max: rows.length - 0.4, grid: { display: false }, ticks: { stepSize: 1, callback: (v: number) => (Number.isInteger(v) ? rows[v]?.label ?? "" : "") } },
          y: {
            min: Math.min(...rows.flatMap((r) => r.finals), reference ?? Infinity, refBound ?? Infinity) * 0.995,
            ticks: { callback: (v: number) => mtl(v) },
            title: { display: true, text: "Nihai yıllık maliyet" },
          },
        },
      }),
    };
  }, [rows, reference, refBound]);

  const conv = useMemo<ChartConfiguration>(() => {
    const maxE = Math.max(...rows.flatMap((r) => r.runs.map((x) => x.curve[x.curve.length - 1][0])));
    const grid = Array.from({ length: 60 }, (_, k) => Math.round((maxE * (k + 1)) / 60));
    const valueAt = (curve: [number, number][], e: number) => {
      let v = curve[0][1];
      for (const [x, y] of curve) {
        if (x <= e) v = y;
        else break;
      }
      return v;
    };
    const lo = Math.min(...rows.map((r) => r.best), refBound ?? Infinity, reference ?? Infinity);
    return {
      type: "line",
      data: {
        datasets: rows.map((r, i) => ({
          label: r.label,
          data: grid.map((e) => ({ x: e, y: r.runs.reduce((s, x) => s + valueAt(x.curve, e), 0) / r.runs.length })),
          borderColor: runColor(i),
          backgroundColor: runColor(i),
          borderWidth: 2,
          pointRadius: 0,
        })),
      },
      options: merge(baseOptions(), {
        plugins: {
          legend: { display: true, position: "top", align: "end" },
          overlay: { refLines: reference ? [{ y: reference, label: `MIP en iyi ${mtl(reference)}`, color: cssVar("--ink-2") }] : [] },
          tooltip: { callbacks: { title: (it: { parsed: { x: number } }[]) => `${n0(it[0]?.parsed.x)} değerlendirme`, label: (it: { dataset: { label: string }; parsed: { y: number } }) => `${it.dataset.label}: ${mtl(it.parsed.y)}` } },
        },
        scales: {
          x: { type: "linear", min: 0, max: maxE, title: { display: true, text: "Değerlendirme sayısı" }, ticks: { callback: (v: number) => n0(v) } },
          y: { min: lo * 0.99, max: lo * 1.2, title: { display: true, text: "Ortalama en iyi maliyet (seed'ler üzerinden)" }, ticks: { callback: (v: number) => mtl(v) } },
        },
      }),
    };
  }, [rows, reference, refBound]);

  const best = Math.min(...rows.map((r) => r.mean));
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h2>Özet tablo</h2><span className="muted small">{res.seeds} seed · polish sonrası maliyetler · gap = (maliyet − MIP en iyi) / MIP en iyi</span></div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Konfigürasyon</th><th className="r">En iyi</th><th className="r">Ortalama ± std</th><th className="r">En kötü</th>
                <th className="r">Ort. gap</th><th className="r">En iyi gap</th><th className="r">%1 gap'e ulaşan</th><th className="r">Ulaşma (ort. değ.)</th>
                <th className="r">Decoder ort.</th><th className="r">Süre / çalışma</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.label}>
                  <td><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: runColor(i) }} />{r.label}{r.mean === best && <span className="badge ok">en iyi ort.</span>}</span></td>
                  <td className="r">{mtl(r.best)}</td>
                  <td className="r">{mtl(r.mean)} ± {mtl(r.std)}</td>
                  <td className="r">{mtl(r.worst)}</td>
                  <td className="r">{r.gap_mean_pct != null ? pct(r.gap_mean_pct / 100, 2) : "–"}</td>
                  <td className="r">{r.gap_best_pct != null ? pct(r.gap_best_pct / 100, 2) : "–"}</td>
                  <td className="r">{r.reach1_rate != null ? pct(r.reach1_rate, 0) : "–"}</td>
                  <td className="r">{r.reach1_evals_mean != null ? n0(r.reach1_evals_mean) : "–"}</td>
                  <td className="r">{mtl(r.decoder_mean)}</td>
                  <td className="r">{n1(r.seconds_mean)} sn</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Negatif gap, metasezgiselin zaman limitli MIP çözümünden daha iyi bir çözüm bulduğu anlamına gelir. "%1 gap'e ulaşan": decoder maliyeti MIP en iyisinin %1 yakınına inen çalışmaların oranı.
        </p>
      </div>
      <div className="two">
        <div className="card">
          <div className="card-head"><h2>Seed başına nihai maliyet</h2><span className="muted small">her nokta bir çalışma, çizgi ortalama</span></div>
          <ChartBox config={strip} height={300} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Ortalama yakınsama</h2></div>
          <ChartBox config={conv} height={300} />
        </div>
      </div>
    </div>
  );
}
