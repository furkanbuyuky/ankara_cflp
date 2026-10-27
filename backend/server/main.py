"""FastAPI uygulaması.  Çalıştırma:  uvicorn server.main:app --port 8000 (backend/ içinden)."""
from __future__ import annotations

import json
import os
import queue
import threading
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from cflp.benchmark import run_benchmark, run_one
from cflp.exact import solve_exact
from cflp.heuristics.pseudocode import PSEUDOCODE
from cflp.heuristics.runner import make_config, run_algorithm, run_full
from cflp.heuristics.trace import Tracer
from cflp.instance import PROCESSED, Constraints, Instance, Params, build_problem
from cflp.solution import solution_to_dict
from cflp.sweep import run_sweep

from .jobs import ROOT, SERVERLESS, JobManager, cache_get, cache_key

app = FastAPI(title="Ankara Hastane CFLP")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
jobs = JobManager(workers=int(os.environ.get("JOB_WORKERS", 3)))

# Sunucusuz ortamda bir istek en fazla ~300 sn sürebilir; uzun hesaplar buna göre kısıtlanır
MAX_TIME_LIMIT = 120 if SERVERLESS else 600
SWEEP_BUDGET = 230 if SERVERLESS else None


# ---------------------------------------------------------------- şemalar


class ConstraintsIn(BaseModel):
    max_hospitals: int | None = None
    budget_mtl: float | None = None
    max_distance_km: float | None = None
    min_utilization: float | None = None


class Spec(BaseModel):
    instance: str = "ankara"
    scenario: Literal["single", "multi"] = "multi"
    params: dict | None = None  # varsayılanlara uygulanacak değişiklikler
    constraints: ConstraintsIn = Field(default_factory=ConstraintsIn)


class ExactReq(BaseModel):
    spec: Spec
    time_limit: float = 60.0


class SweepReq(BaseModel):
    spec: Spec
    kind: Literal["count", "budget"]
    time_limit: float = 15.0
    base_time_limit: float = 60.0


class RunIn(BaseModel):
    label: str
    algo: Literal["ga", "de"]
    config: dict = Field(default_factory=dict)


class OptimizeReq(BaseModel):
    spec: Spec
    runs: list[RunIn]
    polish: bool = True


class TeachReq(BaseModel):
    algo: Literal["ga", "de"]
    config: dict = Field(default_factory=dict)
    scenario: Literal["single", "multi"] = "multi"
    trace_decoder: bool = True
    generations: int = 2


class BenchRunReq(BaseModel):
    spec: Spec
    run: RunIn
    seed: int
    max_evals: int = 10000
    polish: bool = True


class BenchmarkReq(BaseModel):
    spec: Spec
    runs: list[RunIn]
    seeds: int = 10
    max_evals: int = 10000
    polish: bool = True
    reference: float | None = None


def make_problem(spec: Spec):
    try:
        inst = Instance.load(spec.instance)
    except FileNotFoundError:
        raise HTTPException(404, f"Örnek bulunamadı: {spec.instance}")
    params = Params.defaults().with_overrides(spec.params)
    return build_problem(inst, params, spec.scenario, Constraints(**spec.constraints.model_dump()))


def spec_dict(spec: Spec) -> dict:
    return spec.model_dump()


# ---------------------------------------------------------------- veri


@app.get("/api/config")
def config():
    """Frontend'in çalışma ortamına göre davranması için (sunucusuz modda karşılaştırmayı
    tarayıcı yürütür, uzun süre seçenekleri kısıtlanır)."""
    return {"serverless": SERVERLESS, "max_time_limit": MAX_TIME_LIMIT}


@app.get("/api/defaults")
def defaults():
    return Params.defaults().to_dict()


@app.get("/api/instances")
def instances():
    out = []
    for p in sorted(PROCESSED.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        out.append({"id": d["id"], "name": d["name"], "source": d["source"],
                    "n_demand": len(d["demand"]), "n_cand": len(d["candidates"])})
    return out


@app.get("/api/instances/{instance_id}")
def instance(instance_id: str):
    try:
        return Instance.load(instance_id).to_dict()
    except FileNotFoundError:
        raise HTTPException(404, "Örnek bulunamadı")


@app.get("/api/districts")
def districts():
    return FileResponse(PROCESSED / "districts.geojson", media_type="application/geo+json")


@app.post("/api/problem")
def problem_summary(spec: Spec):
    """Sekme 1 için türetilmiş büyüklükler."""
    pb = make_problem(spec)
    per_bed = np.nanmin(pb.invest / pb.cap[None, :], axis=0)
    return {
        "scenario": pb.scenario,
        "types": [t.__dict__ for t in pb.types],
        "crf": round(pb.crf, 5),
        "demand_beds": np.round(pb.d, 2).tolist(),
        "total_population": int(pb.w.sum()),
        "total_beds": round(float(pb.d.sum()), 1),
        "kmax": pb.kmax.tolist(),
        "invest": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in pb.invest],
        "fixed": [[None if np.isnan(v) else round(float(v), 2) for v in row] for row in pb.fixed],
        "min_invest_per_bed": [round(float(v), 3) for v in per_bed],
        "penalty_per_bed": round(float(pb.penalty.sum() / pb.d.sum()), 3),
        "min_hospitals_by_capacity": int(np.ceil(pb.d.sum() / pb.cap.max())),
        "allowed_per_demand": int(pb.allowed.sum(axis=1).max()),
    }


@app.get("/api/pseudocode")
def pseudocode():
    return PSEUDOCODE


# ---------------------------------------------------------------- işler


def _exact_job(req: ExactReq):
    def fn(job):
        job.message = "MIP çözülüyor (HiGHS)"
        pb = make_problem(req.spec)
        sol, info = solve_exact(pb, time_limit=min(req.time_limit, MAX_TIME_LIMIT))
        return {"solution": solution_to_dict(pb, sol), "solver": info.to_dict()}

    return fn


@app.post("/api/exact")
def exact(req: ExactReq):
    return jobs.submit("exact", req.model_dump(), _exact_job(req)).public()


_CACHED_MODELS = {"exact": ExactReq, "sweep": SweepReq, "optimize": OptimizeReq, "benchmark": BenchmarkReq}


@app.post("/api/cached/{kind}")
def cached(kind: str, body: dict):
    """İş başlatmadan, aynı istek daha önce hesaplandıysa sonucunu döndürür; yoksa null."""
    model = _CACHED_MODELS.get(kind)
    if model is None:
        raise HTTPException(404, "Bilinmeyen tür")
    req = model(**body)
    return cache_get(kind, cache_key(kind, req.model_dump()))


@app.post("/api/sweep")
def sweep(req: SweepReq):
    def fn(job):
        pb = make_problem(req.spec)

        def progress(f, m):
            job.progress, job.message = f, m

        base_tl = min(req.base_time_limit, 40) if SERVERLESS else req.base_time_limit
        return run_sweep(pb, req.kind, time_limit=req.time_limit, base_time_limit=base_tl,
                         progress=progress, total_budget=SWEEP_BUDGET)

    return jobs.submit("sweep", req.model_dump(), fn).public()


@app.post("/api/optimize")
def optimize(req: OptimizeReq):
    def fn(job):
        pb = make_problem(req.spec)
        out = []
        total = sum(r.config.get("max_evals", 10000) for r in req.runs)
        done = 0
        for r in req.runs:
            evals = r.config.get("max_evals", 10000)

            def on_gen(g, done=done, evals=evals, label=r.label):
                job.progress = min(0.99, (done + min(g["evals"], evals)) / total)
                job.message = f"{label}: nesil {g['gen']}"

            res = run_full(pb, r.algo, r.config, tracer=Tracer(on_generation=on_gen), do_polish=req.polish)
            res["label"] = r.label
            out.append(res)
            done += evals
            job.partial = [x["label"] for x in out]
        return {"runs": out}

    return jobs.submit("optimize", req.model_dump(), fn).public()


@app.post("/api/benchmark")
def benchmark(req: BenchmarkReq):
    def fn(job):
        def progress(f, m):
            job.progress, job.message = f, m

        runs = [{"label": r.label, "algo": r.algo, "config": {**r.config, "max_evals": req.max_evals}}
                for r in req.runs]
        return run_benchmark(spec_dict(req.spec), runs, req.seeds, req.reference, req.polish, progress)

    return jobs.submit("benchmark", req.model_dump(), fn).public()


@app.post("/api/bench_run")
def bench_run(req: BenchRunReq):
    """Karşılaştırmanın tek bir (konfigürasyon, seed) çalışması. Sunucusuz modda tarayıcı bu
    istekleri paralel gönderir ve özeti kendisi hesaplar."""
    run = {"label": req.run.label, "algo": req.run.algo, "config": {**req.run.config, "max_evals": req.max_evals}}
    return run_one(spec_dict(req.spec), run, req.seed, req.polish)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "İş bulunamadı")
    return job.public()


# ---------------------------------------------------------------- öğretim (senkron, küçük)


@app.post("/api/teach")
def teach(req: TeachReq):
    inst = Instance.load("toy")
    pb = build_problem(inst, Params.defaults(), req.scenario)
    cfg = {"pop_size": 6, "seed": 0, **req.config, "max_generations": max(1, min(req.generations, 5))}
    cfg["max_evals"] = 10**9
    tr = Tracer(detail=True, trace_decoder=req.trace_decoder, max_events=6000)
    res = run_full(pb, req.algo, cfg, tracer=tr, do_polish=False)
    opt, info = solve_exact(pb, time_limit=20)
    return {
        "instance": inst.to_dict(),
        "problem": {
            "types": [t.__dict__ for t in pb.types],
            "demand_beds": np.round(pb.d, 1).tolist(),
            "kmax": pb.kmax.tolist(),
            "fixed": [[None if np.isnan(v) else round(float(v), 1) for v in row] for row in pb.fixed],
            "dist": np.round(pb.dist, 2).tolist(),
            "allowed": pb.allowed.astype(int).tolist(),
        },
        "pseudocode": PSEUDOCODE[req.algo],
        "events": tr.events,
        "truncated": tr.truncated,
        "generations": tr.generations,
        "best": res["best"],
        "config": res["config"],
        "optimum": {"solution": solution_to_dict(pb, opt), "solver": info.to_dict()},
    }


# ---------------------------------------------------------------- sunum ekranı: canlı çözüm

# Sunum ekranındaki yöntemler; parametreler sabittir (README'deki varsayılanlar)
METHODS = {
    "ga_roulette": ("ga", {"selection": "roulette", "crossover": "one_point"}),
    "ga_tournament": ("ga", {"selection": "tournament", "crossover": "one_point"}),
    "ga_rank": ("ga", {"selection": "rank", "crossover": "one_point"}),
    "de": ("de", {"strategy": "rand1"}),
}
LIVE_EVALS = 10_000


class SolveReq(BaseModel):
    scenario: Literal["single", "multi"]
    method: Literal["ga_roulette", "ga_tournament", "ga_rank", "de"]
    max_hospitals: int | None = Field(default=None, ge=1, le=200)
    seed: int = Field(default=0, ge=0, le=10**9)


@app.post("/api/solve")
def solve(req: SolveReq):
    """GA/DE'yi çalıştırır ve her nesli bir satır (NDJSON) olarak akıtır; arayüz haritayı
    hesap sürerken günceller. Son satır en iyi çözümün tamamını taşır."""
    pb = make_problem(Spec(scenario=req.scenario, constraints=ConstraintsIn(max_hospitals=req.max_hospitals)))
    algo, cfg = METHODS[req.method]
    config = make_config(algo, {**cfg, "seed": req.seed, "max_evals": LIVE_EVALS})
    q: queue.Queue = queue.Queue()

    def work():
        try:
            tr = Tracer(on_generation=lambda g: q.put({"type": "gen", **g}))
            best, stats = run_algorithm(pb, algo, config, tr)
            q.put({"type": "done", "best": solution_to_dict(pb, best), "stats": stats})
        except Exception as e:  # noqa: BLE001 - hata akış içinde arayüze iletilir
            q.put({"type": "error", "message": f"{type(e).__name__}: {e}"})
        finally:
            q.put(None)

    threading.Thread(target=work, daemon=True).start()

    def stream():
        yield json.dumps({"type": "start", "max_evals": LIVE_EVALS}) + "\n"
        while (item := q.get()) is not None:
            yield json.dumps(item, ensure_ascii=False) + "\n"

    return StreamingResponse(
        stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.get("/api/mip/{scenario}")
def mip_table(scenario: Literal["single", "multi"]):
    """Önceden hesaplanmış MIP sonuçları: sınırsız çözüm ve her hastane sayısı üst sınırı için çözüm."""
    spec = Spec(scenario=scenario)
    ex = cache_get("exact", cache_key("exact", ExactReq(spec=spec, time_limit=60).model_dump()))
    sw = cache_get(
        "sweep", cache_key("sweep", SweepReq(spec=spec, kind="count", time_limit=15, base_time_limit=60).model_dump())
    )
    if ex is None:
        raise HTTPException(404, "MIP sonuçları önceden hesaplanmamış (backend/scripts/precompute.py)")
    unlimited = {**ex["solution"], "solver": ex["solver"]}
    n_star = unlimited["kpi"]["n_open"]
    # sınır n_star'dan küçükse o sınır için çözülmüş nokta; değilse sınırsız çözüm geçerlidir
    by_p = {str(pt["value"]): pt for pt in (sw or {}).get("points", []) if pt["value"] < n_star}
    return {"unlimited": unlimited, "n_star": n_star, "by_p": by_p}


# ---------------------------------------------------------------- derlenmiş frontend (üretim)

_DIST = ROOT / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")
