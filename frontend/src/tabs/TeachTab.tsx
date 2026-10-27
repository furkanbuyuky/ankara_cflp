import { useEffect, useMemo, useState } from "react";
import { postJSON } from "../api";
import { Seg } from "../components/common";
import MapView, { MapLegend } from "../components/MapView";
import { explain, OperatorView, PopulationList, PseudocodePanel, VISUAL_KINDS } from "../components/TeachViz";
import { mtl, n0, n1 } from "../format";
import { CROSSOVER_LABEL, SELECTION_LABEL, STRATEGY_LABEL } from "../runs";
import { useApp } from "../state";
import type { TeachResult, TraceEvent } from "../types";

type Ev = TraceEvent & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface View {
  genes: number[] | null;
  assign: number[] | null;
  dim: number[];
  focusDemand: number | null;
  focusCands: number[];
}

const DECODE_KINDS = new Set(["decode_open", "decode_regret", "decode_order", "decode_assign", "decode_fix"]);

/** Olay dizisinden her adımda haritada gösterilecek durumu türetir. */
function deriveViews(events: Ev[], nDemand: number): View[] {
  const out: View[] = [];
  const assignOf = new Map<string, number[]>();
  let v: View = { genes: null, assign: null, dim: [], focusDemand: null, focusCands: [] };
  for (const ev of events) {
    v = { ...v, focusDemand: null, focusCands: [] };
    switch (ev.kind) {
      case "init_individual":
        v = { ...v, genes: ev.genes, assign: null, dim: [] };
        break;
      case "mutate":
        v = { ...v, genes: ev.after, assign: null, dim: [], focusCands: ev.changes.map((c: { pos: number }) => c.pos) };
        break;
      case "crossover":
      case "no_crossover":
        v = { ...v, genes: ev.children[0], assign: null, dim: [] };
        break;
      case "de_map":
        v = { ...v, genes: ev.genes, assign: null, dim: [] };
        break;
      case "repair":
        v = { ...v, genes: ev.genes, focusCands: ev.closed.map((c: { cand: number }) => c.cand) };
        break;
      case "decode_open":
      case "decode_regret":
      case "decode_order":
        v = { ...v, assign: Array(nDemand).fill(-1), dim: Array.from({ length: nDemand }, (_, i) => i) };
        break;
      case "decode_assign": {
        const a = [...(v.assign ?? Array(nDemand).fill(-1))];
        a[ev.i] = ev.j;
        v = { ...v, assign: a, dim: v.dim.filter((x) => x !== ev.i), focusDemand: ev.i, focusCands: ev.j >= 0 ? [ev.j] : [] };
        break;
      }
      case "decode_fix": {
        const a = [...(v.assign ?? Array(nDemand).fill(-1))];
        if (ev.j >= 0) {
          a[ev.i] = ev.j;
          a[ev.moved.i] = ev.moved.to;
        }
        v = { ...v, assign: a, focusDemand: ev.i, focusCands: ev.moved ? [ev.moved.from, ev.moved.to] : [] };
        break;
      }
      case "decode":
        v = { ...v, assign: ev.assign, dim: [] };
        break;
      case "evaluate":
        assignOf.set(JSON.stringify(ev.genes), ev.assign);
        v = { ...v, genes: ev.genes, assign: ev.assign, dim: [] };
        break;
      case "de_selection":
        v = { ...v, genes: ev.trial_genes, assign: assignOf.get(JSON.stringify(ev.trial_genes)) ?? null, dim: [] };
        break;
      case "generation_start":
      case "best_update":
      case "replace":
      case "done":
      case "elitism": {
        const b = ev.state.best?.genes ?? null;
        v = { ...v, genes: b, assign: b ? assignOf.get(JSON.stringify(b)) ?? null : null, dim: [] };
        break;
      }
      default:
        break;
    }
    out.push(v);
  }
  return out;
}

export default function TeachTab() {
  const { scenario, districts } = useApp();
  const [algo, setAlgo] = useState<"ga" | "de">("ga");
  const [selection, setSelection] = useState("roulette");
  const [crossover, setCrossover] = useState("one_point");
  const [strategy, setStrategy] = useState("rand1");
  const [gens, setGens] = useState(2);
  const [traceDecoder, setTraceDecoder] = useState(true);
  const [seed, setSeed] = useState(0);
  const [data, setData] = useState<TeachResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);

  useEffect(() => {
    const config = algo === "ga" ? { selection, crossover, seed } : { strategy, seed };
    setErr(null);
    postJSON<TeachResult>("/api/teach", { algo, config, scenario, trace_decoder: traceDecoder, generations: gens })
      .then((d) => {
        setData(d);
        setStep(0);
        setPlaying(false);
      })
      .catch((e) => setErr(String(e)));
  }, [algo, selection, crossover, strategy, gens, traceDecoder, seed, scenario]);

  const events = (data?.events ?? []) as Ev[];
  const views = useMemo(() => (data ? deriveViews(events, data.instance.demand.length) : []), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const N = events.length;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => {
      if (s >= N - 1) {
        setPlaying(false);
        return s;
      }
      return s + 1;
    }), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, N]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (!document.querySelector('[role="tabpanel"]:not([hidden]) .teach-root')) return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(N - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [N]);

  if (err) return <div className="notice error">{err}</div>;
  if (!data || !N) return <div className="notice">Yükleniyor…</div>;
  const ev = events[Math.min(step, N - 1)];
  const view = views[Math.min(step, N - 1)];
  const types = data.problem.types;
  const variants = algo === "ga" ? [selection, crossover] : [strategy];
  const inst = data.instance;

  const jumpTo = (pred: (e: Ev) => boolean) => {
    setPlaying(false);
    const k = events.findIndex((e, i) => i > step && pred(e));
    setStep(k >= 0 ? k : N - 1);
  };
  const opt = data.optimum.solution;

  return (
    <div className="stack teach-root">
      <div className="card">
        <div className="row between">
          <div className="row" style={{ gap: 12 }}>
            <Seg value={algo} onChange={setAlgo} options={[{ value: "ga", label: "Genetik Algoritma" }, { value: "de", label: "Diferansiyel Evrim" }]} />
            {algo === "ga" ? (
              <>
                <label className="field inline">Seçim
                  <select value={selection} onChange={(e) => setSelection(e.target.value)}>
                    {Object.entries(SELECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field inline">Çaprazlama
                  <select value={crossover} onChange={(e) => setCrossover(e.target.value)}>
                    {Object.entries(CROSSOVER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label className="field inline">Strateji
                <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                  {Object.entries(STRATEGY_LABEL).map(([k, v]) => <option key={k} value={k}>DE/{v}/bin</option>)}
                </select>
              </label>
            )}
            <label className="field inline">Nesil
              <select value={gens} onChange={(e) => setGens(Number(e.target.value))}>{[1, 2, 3].map((g) => <option key={g} value={g}>{g}</option>)}</select>
            </label>
            <label className="field inline">Seed <input type="number" min={0} value={seed} style={{ width: 56 }} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
            <label className="field inline"><input type="checkbox" checked={traceDecoder} onChange={(e) => setTraceDecoder(e.target.checked)} /> Decoder adımları</label>
          </div>
          <span className="muted small">Öğretim örneği: {inst.demand.length} mahalle, {inst.candidates.length} aday, popülasyon {String(data.config.pop_size)}</span>
        </div>
        <div className="player" style={{ marginTop: 10 }}>
          <button className="btn icon" onClick={() => { setPlaying(false); setStep(0); }} title="Başa sar">⏮</button>
          <button className="btn icon" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} title="Geri (←)">◀</button>
          <button className="btn primary icon" style={{ minWidth: 40 }} onClick={() => { if (step >= N - 1) setStep(0); setPlaying(!playing); }}>{playing ? "⏸" : "▶"}</button>
          <button className="btn icon" onClick={() => { setPlaying(false); setStep((s) => Math.min(N - 1, s + 1)); }} title="İleri (→)">▶</button>
          <input type="range" min={0} max={N - 1} value={step} onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} aria-label="Adım" />
          <span className="num small" style={{ minWidth: 92, textAlign: "right" }}>adım {step + 1} / {N}</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Hız">
            {[0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s} adım/sn</option>)}
          </select>
          <button className="btn small" onClick={() => jumpTo((e) => !DECODE_KINDS.has(e.kind))} disabled={!DECODE_KINDS.has(ev.kind)}>Decoder'ı atla</button>
          <button className="btn small" onClick={() => jumpTo((e) => e.kind === "generation_start" || e.kind === "done")}>Sonraki nesil ⏭</button>
        </div>
        <div className="explain" style={{ marginTop: 10 }} aria-live="polite">{explain(ev, types, inst)}</div>
      </div>

      <div className="teach-grid">
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Pseudocode</h2>
          <PseudocodePanel code={data.pseudocode} line={ev.line} sub={ev.sub} variants={variants} />
        </div>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>İşlem</h2>
            <OperatorView ev={ev} types={types} genes={view.genes} inst={inst} />
            {!VISUAL_KINDS.has(ev.kind) && <div className="muted small">Bu adımda gösterilecek ek görsel yok.</div>}
          </div>
          <div className="card">
            <PopulationList ev={ev} types={types} isDE={algo === "de"} />
          </div>
        </div>
        <div className="stack">
          <div className="card flush">
            <MapView
              instance={inst}
              districts={districts}
              types={types}
              solution={view.genes ? { genes: view.genes, assign: view.assign ?? [] } : null}
              demandBeds={data.problem.demand_beds}
              dimDemand={view.dim}
              focusDemand={view.focusDemand}
              focusCands={view.focusCands}
              height={360}
              showDistrictLabels={false}
            />
            <div style={{ padding: "8px 12px" }}><MapLegend types={types} /></div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>Örnek verisi</h2>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Gen</th><th>Aday</th><th className="r">Arazi</th><th>Sığan tipler</th></tr></thead>
                <tbody>
                  {inst.candidates.map((c, j) => (
                    <tr key={j}>
                      <td>{j + 1}</td>
                      <td className="small">{c.district}</td>
                      <td className="r">{n0(c.land_m2 / 1000)} bin m²</td>
                      <td className="small">{data.problem.kmax[j] === 0 ? "—" : types.slice(0, data.problem.kmax[j]).map((t) => t.name).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              Toplam yatak ihtiyacı {n1(data.problem.demand_beds.reduce((a, b) => a + b, 0))}. Kontrol için exact optimum: <b>{mtl(opt.cost.total)}</b>
              {" "}({opt.hospitals.map((h) => `Aday ${h.cand + 1} ${types.find((t) => t.key === h.type)?.name.toLowerCase()}`).join(", ")}).
              Kromozomdaki her kutu bir adaydır: harf tipi, "·" kapalı anlamına gelir.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
