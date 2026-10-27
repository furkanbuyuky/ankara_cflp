import type { RunSpec } from "./types";

export const PRESETS: RunSpec[] = [
  { label: "GA · Turnuva", algo: "ga", config: { selection: "tournament", crossover: "one_point" } },
  { label: "GA · Rulet", algo: "ga", config: { selection: "roulette", crossover: "one_point" } },
  { label: "GA · Rank", algo: "ga", config: { selection: "rank", crossover: "one_point" } },
  { label: "GA · Turnuva · Uniform", algo: "ga", config: { selection: "tournament", crossover: "uniform" } },
  { label: "DE · rand/1", algo: "de", config: { strategy: "rand1" } },
  { label: "DE · best/1", algo: "de", config: { strategy: "best1" } },
  { label: "DE · current-to-best/1", algo: "de", config: { strategy: "current_to_best1" } },
];

export const SELECTION_LABEL: Record<string, string> = { roulette: "Rulet", tournament: "Turnuva", rank: "Rank" };
export const CROSSOVER_LABEL: Record<string, string> = { one_point: "Tek nokta", two_point: "İki nokta", uniform: "Uniform" };
export const STRATEGY_LABEL: Record<string, string> = { rand1: "rand/1", best1: "best/1", current_to_best1: "current-to-best/1" };

export function autoLabel(r: RunSpec): string {
  const c = r.config as Record<string, string>;
  if (r.algo === "ga") return `GA · ${SELECTION_LABEL[c.selection ?? "tournament"]} · ${CROSSOVER_LABEL[c.crossover ?? "one_point"]}`;
  return `DE · ${STRATEGY_LABEL[c.strategy ?? "rand1"]}`;
}

interface Field {
  key: string;
  label: string;
  kind: "select" | "number";
  options?: Record<string, string>;
  step?: number;
  min?: number;
  max?: number;
  def: number | string | null;
  placeholder?: string;
}

export const GA_FIELDS: Field[] = [
  { key: "selection", label: "Seçim", kind: "select", options: SELECTION_LABEL, def: "tournament" },
  { key: "crossover", label: "Çaprazlama", kind: "select", options: CROSSOVER_LABEL, def: "one_point" },
  { key: "pop_size", label: "Popülasyon N", kind: "number", step: 2, min: 4, max: 400, def: 50 },
  { key: "p_cross", label: "Çaprazlama olas. p_c", kind: "number", step: 0.05, min: 0, max: 1, def: 0.9 },
  { key: "p_mut", label: "Mutasyon olas. p_m", kind: "number", step: 0.005, min: 0, max: 1, def: null, placeholder: "1/J" },
  { key: "elite", label: "Elit sayısı e", kind: "number", step: 1, min: 0, max: 20, def: 2 },
  { key: "tournament_k", label: "Turnuva k", kind: "number", step: 1, min: 2, max: 10, def: 3 },
  { key: "rank_pressure", label: "Rank baskısı s", kind: "number", step: 0.1, min: 1, max: 2, def: 1.7 },
  { key: "p_open", label: "Başlangıç p_open", kind: "number", step: 0.05, min: 0.01, max: 1, def: null, placeholder: "otomatik" },
];

export const DE_FIELDS: Field[] = [
  { key: "strategy", label: "Strateji", kind: "select", options: STRATEGY_LABEL, def: "rand1" },
  { key: "pop_size", label: "Popülasyon N", kind: "number", step: 2, min: 4, max: 400, def: 50 },
  { key: "F", label: "Ölçek F", kind: "number", step: 0.05, min: 0, max: 2, def: 0.5 },
  { key: "CR", label: "Çaprazlama CR", kind: "number", step: 0.05, min: 0, max: 1, def: 0.9 },
  { key: "p_open", label: "Başlangıç p_open", kind: "number", step: 0.05, min: 0.01, max: 1, def: null, placeholder: "otomatik" },
];

export function RunConfigEditor({ run, onChange, hide = [] }: { run: RunSpec; onChange: (r: RunSpec) => void; hide?: string[] }) {
  const fields = (run.algo === "ga" ? GA_FIELDS : DE_FIELDS).filter((f) => !hide.includes(f.key));
  const c = run.config as Record<string, unknown>;
  const set = (key: string, v: unknown) => {
    const cfg = { ...c };
    if (v === null || v === "") delete cfg[key];
    else cfg[key] = v;
    const next = { ...run, config: cfg };
    onChange({ ...next, label: run.label === autoLabel(run) ? autoLabel(next) : run.label });
  };
  return (
    <div className="fields" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
      {fields.map((f) =>
        f.kind === "select" ? (
          <label className="field" key={f.key}>
            {f.label}
            <select value={(c[f.key] as string) ?? (f.def as string)} onChange={(e) => set(f.key, e.target.value)}>
              {Object.entries(f.options!).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        ) : (
          <label className="field" key={f.key}>
            {f.label}
            <input
              type="number"
              step={f.step}
              min={f.min}
              max={f.max}
              placeholder={f.placeholder}
              value={(c[f.key] as number | undefined) ?? (f.def ?? "")}
              onChange={(e) => set(f.key, e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>
        ),
      )}
    </div>
  );
}
