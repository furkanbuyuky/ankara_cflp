"""Örnek (instance) verisi, parametreler ve türetilmiş problem matrisleri.

Para birimi her yerde milyon TL (M₺); yıllık maliyetler M₺/yıl.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from functools import lru_cache
from pathlib import Path

import numpy as np

from .costs import capital_recovery_factor, haversine_km

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "processed"
DEFAULTS = ROOT / "config" / "defaults.json"


@dataclass(frozen=True)
class HospitalType:
    key: str
    name: str
    beds: int
    land_m2: float
    construction_mtl: float


@dataclass(frozen=True)
class Params:
    beds_per_1000: float
    alpha_tl_per_person_km: float
    discount_rate: float
    lifetime_years: int
    circuity: float
    assign_k_nearest: int | None  # her mahalle yalnızca en yakın k adaya atanabilir
    penalty_multiplier: float
    single_type_key: str
    hospital_types: tuple[HospitalType, ...]

    @staticmethod
    def defaults() -> "Params":
        return Params.from_dict(json.loads(DEFAULTS.read_text(encoding="utf-8")))

    @staticmethod
    def from_dict(d: dict) -> "Params":
        base = {k: v for k, v in d.items() if not k.startswith("_")}
        types = tuple(HospitalType(**t) for t in base.pop("hospital_types"))
        return Params(hospital_types=types, **base)

    def to_dict(self) -> dict:
        return asdict(self)

    def with_overrides(self, overrides: dict | None) -> "Params":
        if not overrides:
            return self
        merged = {**self.to_dict(), **overrides}
        return Params.from_dict(merged)


@dataclass(frozen=True)
class Constraints:
    """Opsiyonel kısıtlar; None = kapalı."""

    max_hospitals: int | None = None
    budget_mtl: float | None = None
    max_distance_km: float | None = None
    min_utilization: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Instance:
    id: str
    name: str
    source: str
    districts: list[dict]
    demand: list[dict]
    candidates: list[dict]
    meta: dict = field(default_factory=dict)

    @staticmethod
    def load(instance_id: str) -> "Instance":
        return _load_instance(instance_id)

    def to_dict(self) -> dict:
        return asdict(self)


@lru_cache(maxsize=8)
def _load_instance(instance_id: str) -> Instance:
    data = json.loads((PROCESSED / f"{instance_id}.json").read_text(encoding="utf-8"))
    return Instance(**data)


@dataclass
class Problem:
    """Bir örnek + parametreler + senaryo + kısıtlardan türetilmiş sayısal problem.

    Hem exact model hem metasezgiseller aynı nesneyi kullanır; böylece amaç
    fonksiyonu ve izin verilen atamalar birebir aynıdır.
    """

    instance: Instance
    params: Params
    scenario: str  # "single" | "multi"
    constraints: Constraints
    types: tuple[HospitalType, ...]  # arazi ihtiyacına göre artan sırada
    w: np.ndarray  # (I,) nüfus
    d: np.ndarray  # (I,) yatak ihtiyacı
    dist: np.ndarray  # (I, J) km
    assign_cost: np.ndarray  # (I, J) M₺/yıl
    allowed: np.ndarray  # (I, J) bool
    cap: np.ndarray  # (K,) yatak
    invest: np.ndarray  # (J, K) M₺, geçersiz tipler için nan
    fixed: np.ndarray  # (J, K) M₺/yıl, geçersiz tipler için nan
    kmax: np.ndarray  # (J,) arazisine sığan en büyük tip numarası (0 = hiçbiri)
    penalty: np.ndarray  # (I,) karşılanmama cezası M₺/yıl
    crf: float

    @property
    def n_demand(self) -> int:
        return self.d.shape[0]

    @property
    def n_cand(self) -> int:
        return self.dist.shape[1]

    @property
    def n_types(self) -> int:
        return len(self.types)


def build_problem(
    instance: Instance,
    params: Params,
    scenario: str = "multi",
    constraints: Constraints | None = None,
) -> Problem:
    constraints = constraints or Constraints()
    if scenario == "single":
        types = tuple(t for t in params.hospital_types if t.key == params.single_type_key)
        if not types:
            raise ValueError(f"Tek tip senaryosu için '{params.single_type_key}' tipi bulunamadı")
    elif scenario == "multi":
        types = tuple(sorted(params.hospital_types, key=lambda t: t.land_m2))
    else:
        raise ValueError(f"Bilinmeyen senaryo: {scenario}")

    dem = instance.demand
    cand = instance.candidates
    w = np.array([p["population"] for p in dem], dtype=float)
    d = w * params.beds_per_1000 / 1000.0
    dist = haversine_km(
        np.array([[p["lat"], p["lon"]] for p in dem]),
        np.array([[c["lat"], c["lon"]] for c in cand]),
    ) * params.circuity
    assign_cost = params.alpha_tl_per_person_km * w[:, None] * dist / 1e6

    allowed = np.ones_like(dist, dtype=bool)
    if params.assign_k_nearest is not None and params.assign_k_nearest < dist.shape[1]:
        rank = np.argsort(np.argsort(dist, axis=1, kind="stable"), axis=1)
        allowed &= rank < params.assign_k_nearest
    if constraints.max_distance_km is not None:
        allowed &= dist <= constraints.max_distance_km

    cap = np.array([t.beds for t in types], dtype=float)
    land_area = np.array([c["land_m2"] for c in cand], dtype=float)
    land_price = np.array([c["land_price_tl_m2"] for c in cand], dtype=float)
    invest = np.full((len(cand), len(types)), np.nan)
    for k, t in enumerate(types):
        ok = land_area >= t.land_m2
        invest[ok, k] = t.construction_mtl + land_price[ok] * t.land_m2 / 1e6
    # arazi ihtiyacı arttıkça uygunluk azalır → geçerli tipler her zaman 1..kmax önekidir
    kmax = (~np.isnan(invest)).sum(axis=1).astype(int)

    crf = capital_recovery_factor(params.discount_rate, params.lifetime_years)
    fixed = invest * crf

    # Ceza: bir yatağı karşılamanın mümkün en pahalı yolunun `penalty_multiplier` katı
    per_bed_fixed = np.nanmax(fixed / cap[None, :])
    per_bed_assign = np.max(np.where(allowed, assign_cost, 0.0) / d[:, None])
    penalty = params.penalty_multiplier * (per_bed_fixed + per_bed_assign) * d

    return Problem(
        instance=instance,
        params=params,
        scenario=scenario,
        constraints=constraints,
        types=types,
        w=w,
        d=d,
        dist=dist,
        assign_cost=assign_cost,
        allowed=allowed,
        cap=cap,
        invest=invest,
        fixed=fixed,
        kmax=kmax,
        penalty=penalty,
        crf=crf,
    )


def with_constraints(problem: Problem, constraints: Constraints) -> Problem:
    """Aynı örnek/parametrelerle yalnızca kısıtları değiştirilmiş problem."""
    if constraints.max_distance_km == problem.constraints.max_distance_km:
        return replace(problem, constraints=constraints)
    return build_problem(problem.instance, problem.params, problem.scenario, constraints)
