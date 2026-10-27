/**
 * Sunucusuz yayında karşılaştırma (Sekme 5): her (konfigürasyon, seed) çalışması ayrı bir
 * istek olarak paralel gönderilir; özet backend'deki run_benchmark ile aynı şekilde burada
 * hesaplanır. Böylece tek bir isteğin süre sınırına takılmadan çok sayıda çalışma yapılır.
 */
import { useCallback, useRef, useState } from "react";
import { postJSON } from "./api";
import type { BenchResult, BenchRow, Job, RunSpec, Spec } from "./types";

const CONCURRENCY = 6;

interface RunOut {
  label: string;
  seed: number;
  best: number;
  polished: number;
  n_open: number;
  seconds: number;
  algo_seconds: number;
  curve: [number, number][];
}

export interface BenchBody {
  spec: Spec;
  runs: RunSpec[];
  seeds: number;
  max_evals: number;
  polish: boolean;
  reference: number | null;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function evalsToReach(curve: [number, number][], target: number): number | null {
  for (const [e, b] of curve) if (b <= target) return e;
  return null;
}

export function summarize(body: BenchBody, results: RunOut[]): BenchResult {
  const ref = body.reference;
  const summary: BenchRow[] = body.runs.map((run) => {
    const rs = results.filter((r) => r.label === run.label).sort((a, b) => a.seed - b.seed);
    const finals = rs.map((r) => r.polished);
    const m = mean(finals);
    const std = finals.length > 1 ? Math.sqrt(finals.reduce((s, x) => s + (x - m) ** 2, 0) / (finals.length - 1)) : 0;
    const row: BenchRow = {
      label: run.label,
      algo: run.algo,
      config: run.config,
      n: rs.length,
      best: round(Math.min(...finals)),
      mean: round(m),
      std: round(std),
      worst: round(Math.max(...finals)),
      decoder_mean: round(mean(rs.map((r) => r.best))),
      seconds_mean: round(mean(rs.map((r) => r.seconds))),
      finals: finals.map((v) => round(v)),
      runs: rs.map((r) => ({ seed: r.seed, best: r.best, polished: r.polished, seconds: r.seconds, curve: r.curve })),
    };
    if (ref) {
      row.gap_mean_pct = round(((m - ref) / ref) * 100);
      row.gap_best_pct = round(((Math.min(...finals) - ref) / ref) * 100);
      const reach = rs.map((r) => evalsToReach(r.curve, ref * 1.01)).filter((x): x is number => x != null);
      row.reach1_rate = round(reach.length / rs.length);
      row.reach1_evals_mean = reach.length ? round(mean(reach), 1) : null;
    }
    return row;
  });
  return { reference: ref, seeds: body.seeds, summary };
}

/** Tarayıcıdan yürütülen karşılaştırma; useJob ile aynı biçimde durum döndürür. */
export function useClientBenchmark() {
  const [job, setJob] = useState<Job<BenchResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const memo = useRef(new Map<string, BenchResult>());
  const token = useRef(0);

  const run = useCallback(async (body: BenchBody) => {
    const key = JSON.stringify(body);
    const my = ++token.current;
    setError(null);
    const hit = memo.current.get(key);
    const base = { id: "client", kind: "benchmark", cached: !!hit, error: null };
    if (hit) {
      setJob({ ...base, status: "done", progress: 1, message: "", elapsed: 0, result: hit });
      return hit;
    }
    const tasks = body.runs.flatMap((run) => Array.from({ length: body.seeds }, (_, seed) => ({ run, seed })));
    const results: RunOut[] = [];
    const t0 = Date.now();
    const update = () =>
      my === token.current &&
      setJob({
        ...base,
        status: "running",
        progress: results.length / tasks.length,
        message: `${results.length}/${tasks.length} çalışma bitti`,
        elapsed: (Date.now() - t0) / 1000,
      });
    update();
    let next = 0;
    try {
      const worker = async () => {
        while (next < tasks.length && my === token.current) {
          const { run, seed } = tasks[next++];
          const r = await postJSON<RunOut>("/api/bench_run", {
            spec: body.spec, run, seed, max_evals: body.max_evals, polish: body.polish,
          });
          results.push(r);
          update();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
      if (my !== token.current) return null;
      const res = summarize(body, results);
      memo.current.set(key, res);
      setJob({ ...base, status: "done", progress: 1, message: "", elapsed: (Date.now() - t0) / 1000, result: res });
      return res;
    } catch (e) {
      if (my === token.current) {
        setJob(null);
        setError(String(e));
      }
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    token.current++;
    setJob(null);
    setError(null);
  }, []);

  const running = !!job && job.status === "running";
  return { job, result: job?.status === "done" ? job.result ?? null : null, running, error, run, reset };
}
