import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "./types";

export async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

/** Arka plan işi başlatır ve bitene kadar ilerlemeyi sorar. */
export function useJob<T>(endpoint: string) {
  const [job, setJob] = useState<Job<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  const start = useCallback(
    async (body: unknown) => {
      const my = ++token.current;
      setError(null);
      try {
        let j = await postJSON<Job<T>>(endpoint, body);
        if (my !== token.current) return null;
        setJob(j);
        while (j.status === "queued" || j.status === "running") {
          await new Promise((res) => setTimeout(res, 600));
          if (my !== token.current) return null;
          j = await getJSON<Job<T>>(`/api/jobs/${j.id}`);
          if (my !== token.current) return null;
          setJob(j);
        }
        if (j.status === "error") setError(j.error ?? "Bilinmeyen hata");
        return j.result ?? null;
      } catch (e) {
        if (my === token.current) setError(String(e));
        return null;
      }
    },
    [endpoint],
  );

  const reset = useCallback(() => {
    token.current++;
    setJob(null);
    setError(null);
  }, []);

  const running = !!job && (job.status === "queued" || job.status === "running");
  return { job, result: job?.status === "done" ? (job.result as T) : null, running, error, start, reset };
}

/**
 * İstek gövdesi değişince önbellekte hazır sonuç var mı bakar (iş başlatmaz);
 * `run()` ile hesaplama işi başlatılır. Sonuç: işin sonucu ya da önbellekteki sonuç.
 */
export function useCachedJob<T>(kind: string, body: unknown | null) {
  const job = useJob<T>(`/api/${kind}`);
  const [cached, setCached] = useState<T | null>(null);
  const [checking, setChecking] = useState(false);
  const key = JSON.stringify(body);
  const { reset } = job;

  useEffect(() => {
    reset();
    setCached(null);
    if (body == null) return;
    let alive = true;
    setChecking(true);
    postJSON<T | null>(`/api/cached/${kind}`, body)
      .then((r) => alive && setCached(r))
      .catch(() => undefined)
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key, reset]);

  const run = useCallback(() => (body == null ? Promise.resolve(null) : job.start(body)), [job, body]);
  return { ...job, result: job.result ?? cached, checking, run };
}

/** Bir değer değişince kısa bir gecikmeyle günceller (form girişleri için). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
