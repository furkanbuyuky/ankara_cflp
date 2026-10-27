export type Scenario = "single" | "multi";

export interface HospitalType {
  key: string;
  name: string;
  beds: number;
  land_m2: number;
  construction_mtl: number;
}

export interface Params {
  beds_per_1000: number;
  alpha_tl_per_person_km: number;
  discount_rate: number;
  lifetime_years: number;
  circuity: number;
  assign_k_nearest: number | null;
  penalty_multiplier: number;
  single_type_key: string;
  hospital_types: HospitalType[];
}

export interface Demand {
  id: number;
  name: string;
  district: string;
  lat: number;
  lon: number;
  population: number;
  area_km2?: number;
}

export interface Candidate {
  id: number;
  name: string;
  district: string;
  lat: number;
  lon: number;
  land_m2: number;
  land_price_tl_m2: number;
}

export interface District {
  name: string;
  population: number;
  land_price_tl_m2: number;
  center: [number, number];
}

export interface Instance {
  id: string;
  name: string;
  source: string;
  districts: District[];
  demand: Demand[];
  candidates: Candidate[];
  meta: { sources?: Record<string, string>; [k: string]: unknown };
}

export interface Hospital {
  cand: number;
  type: string;
  beds: number;
  load: number;
  util: number;
  fixed: number;
  invest: number;
  n_assigned: number;
}

export interface Cost {
  total: number;
  fixed: number;
  assign: number;
  penalty: number;
}

export interface Kpi {
  n_open: number;
  by_type: Record<string, number>;
  avg_dist_km: number | null;
  max_dist_km: number | null;
  unmet_beds: number;
  unmet_pct: number;
  unmet_count: number;
  avg_util: number | null;
}

export interface SolutionDict {
  genes: number[];
  assign: number[];
  hospitals: Hospital[];
  cost: Cost;
  investment: number;
  kpi: Kpi;
}

export interface SolverInfo {
  status: string;
  gap: number | null;
  seconds: number;
  objective: number | null;
  bound: number | null;
}

export interface ExactResult {
  solution: SolutionDict;
  solver: SolverInfo;
}

export interface Constraints {
  max_hospitals?: number | null;
  budget_mtl?: number | null;
  max_distance_km?: number | null;
  min_utilization?: number | null;
}

export interface Spec {
  instance: string;
  scenario: Scenario;
  params: Partial<Params> | null;
  constraints: Constraints;
}

export interface Job<T> {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  message: string;
  cached: boolean;
  elapsed: number;
  error: string | null;
  result?: T;
}

export interface SweepPoint extends SolutionDict {
  value: number;
  binding: boolean;
  solver: SolverInfo;
}

export interface SweepResult {
  kind: "count" | "budget";
  p_star: number;
  b_star: number;
  base: SolutionDict & { solver: SolverInfo };
  points: SweepPoint[];
}

export interface GenSummary {
  gen: number;
  evals: number;
  best: number;
  mean: number;
  median: number;
  worst: number;
  diversity: number;
  n_open: number;
  best_genes: number[];
  best_cost: Cost;
  improved: boolean;
  assign?: number[];
}

export interface RunResult {
  label: string;
  algo: "ga" | "de";
  config: Record<string, unknown>;
  stats: { evals: number; generations: number; seconds: number; p_open: number };
  generations: GenSummary[];
  best: SolutionDict;
  polished: SolutionDict | null;
}

export interface RunSpec {
  label: string;
  algo: "ga" | "de";
  config: Record<string, unknown>;
}

export interface ProblemSummary {
  scenario: Scenario;
  types: HospitalType[];
  crf: number;
  demand_beds: number[];
  total_population: number;
  total_beds: number;
  kmax: number[];
  invest: (number | null)[][];
  fixed: (number | null)[][];
  min_invest_per_bed: number[];
  penalty_per_bed: number;
  min_hospitals_by_capacity: number;
  allowed_per_demand: number;
}

export interface PseudoLine {
  id: string;
  text: string;
  indent: number;
  variant?: string;
}

export interface Pseudocode {
  title: string;
  main: PseudoLine[];
  blocks: { title: string; group: string; lines: PseudoLine[] }[];
}

export interface TraceEvent {
  step: number;
  line: string;
  kind: string;
  sub?: string;
  state: {
    gen: number;
    P: { genes: number[]; cost: number; x?: number[] }[];
    Q?: { genes: number[]; cost: number }[];
    best: { genes: number[]; cost: number } | null;
    evals: number;
    target?: number;
  };
  [k: string]: unknown;
}

export interface TeachResult {
  instance: Instance;
  problem: {
    types: HospitalType[];
    demand_beds: number[];
    kmax: number[];
    fixed: (number | null)[][];
    dist: number[][];
    allowed: number[][];
  };
  pseudocode: Pseudocode;
  events: TraceEvent[];
  truncated: boolean;
  generations: GenSummary[];
  best: SolutionDict;
  config: Record<string, unknown>;
  optimum: ExactResult;
}

export interface BenchRow {
  label: string;
  algo: string;
  config: Record<string, unknown>;
  n: number;
  best: number;
  mean: number;
  std: number;
  worst: number;
  decoder_mean: number;
  seconds_mean: number;
  finals: number[];
  gap_mean_pct?: number;
  gap_best_pct?: number;
  reach1_rate?: number;
  reach1_evals_mean?: number | null;
  runs: { seed: number; best: number; polished: number; seconds: number; curve: [number, number][] }[];
}

export interface BenchResult {
  reference: number | null;
  seeds: number;
  summary: BenchRow[];
}
