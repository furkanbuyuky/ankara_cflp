"""FastAPI uygulaması.  Çalıştırma:  uvicorn api.main:app --port 8000 (backend/ içinden)."""
from __future__ import annotations

import json
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from cflp.benchmark import run_benchmark
from cflp.exact import solve_exact
from cflp.heuristics.pseudocode import PSEUDOCODE
from cflp.heuristics.runner import run_full
from cflp.heuristics.trace import Tracer
from cflp.instance import PROCESSED, Constraints, Instance, Params, build_problem
from cflp.solution import solution_to_dict
from cflp.sweep import run_sweep

from .jobs import ROOT, JobManager, cache_get, cache_key

app = FastAPI(title="Ankara Hastane CFLP")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
jobs = JobManager(workers=3)


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
        sol, info = solve_exact(pb, time_limit=req.time_limit)
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

        return run_sweep(pb, req.kind, time_limit=req.time_limit, base_time_limit=req.base_time_limit,
                         progress=progress)

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


# ---------------------------------------------------------------- derlenmiş frontend (üretim)

_DIST = ROOT / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")
