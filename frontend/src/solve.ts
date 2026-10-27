/** Çözüm ekranının veri katmanı: canlı akış (NDJSON) okuyucu ve önceden hesaplanmış MIP tablosu. */
import type { GenSummary, Scenario, SolutionDict, SolverInfo } from "./types";

export type Method = "mip" | "ga_roulette" | "ga_tournament" | "ga_rank" | "de";

export const METHODS: { value: Method; label: string; short: string; desc: string }[] = [
  { value: "mip", label: "MIP (exact)", short: "MIP", desc: "HiGHS ile önceden 60 sn çözüldü. Diğer yöntemler için hedef çizgisi." },
  { value: "ga_roulette", label: "GA · Rulet", short: "GA-Rulet", desc: "Genetik algoritma, rulet çarkı seçimi" },
  { value: "ga_tournament", label: "GA · Turnuva", short: "GA-Turnuva", desc: "Genetik algoritma, 3'lü turnuva seçimi" },
  { value: "ga_rank", label: "GA · Rank", short: "GA-Rank", desc: "Genetik algoritma, sıralamaya dayalı seçim" },
  { value: "de", label: "Diferansiyel Evrim", short: "DE", desc: "DE/rand/1/bin" },
];

export interface MipPoint extends SolutionDict {
  solver: SolverInfo;
}

export interface MipTable {
  unlimited: MipPoint;
  n_star: number;
  by_p: Record<string, MipPoint>;
}

/** Hastane sayısı sınırı için MIP çözümü; sınır kısıtsız optimumdaki sayıdan büyükse sınırsız çözüm geçerlidir. */
export function mipFor(table: MipTable, limit: number | null): MipPoint {
  if (limit == null || limit >= table.n_star) return table.unlimited;
  return table.by_p[String(limit)] ?? table.unlimited;
}

export interface Run {
  id: number;
  scenario: Scenario;
  method: Method;
  limit: number | null;
  seed: number | null;
  status: "running" | "done" | "error";
  gens: GenSummary[];
  best: SolutionDict | null;
  solver?: SolverInfo;
  error?: string;
  seconds: number;
}

type Event =
  | { type: "start"; max_evals: number }
  | ({ type: "gen" } & GenSummary)
  | { type: "done"; best: SolutionDict; stats: { seconds: number } }
  | { type: "error"; message: string };

/** /api/solve akışını okur; her satır geldikçe onEvent çağrılır. */
export async function streamSolve(
  body: { scenario: Scenario; method: Exclude<Method, "mip">; max_hospitals: number | null; seed: number },
  onEvent: (e: Event) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

/** i. nesildeki en iyi çözüm: atama yalnızca iyileşme nesillerinde gelir, son iyileşmeden alınır. */
export function solutionAt(gens: GenSummary[], idx: number) {
  let a = idx;
  while (a > 0 && !gens[a].assign) a--;
  let p = a - 1;
  while (p > 0 && !gens[p].improved) p--;
  return {
    genes: gens[idx].best_genes,
    assign: gens[a].assign ?? [],
    prevGenes: p >= 0 ? gens[p].best_genes : null,
    improvedAt: gens[a].gen,
  };
}
