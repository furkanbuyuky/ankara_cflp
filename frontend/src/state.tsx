import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJSON, useDebounced } from "./api";
import type { Constraints, Instance, Params, Scenario, Spec } from "./types";

interface AppState {
  defaults: Params | null;
  params: Params | null; // varsayılan + kullanıcı değişiklikleri
  overrides: Partial<Params>;
  setOverrides: (o: Partial<Params>) => void;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  instance: Instance | null;
  districts: GeoJSON.FeatureCollection | null;
  makeSpec: (constraints?: Constraints, scenario?: Scenario) => Spec;
  loadError: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [defaults, setDefaults] = useState<Params | null>(null);
  const [overrides, setOverrides] = useState<Partial<Params>>({});
  const [scenario, setScenario] = useState<Scenario>("multi");
  const [instance, setInstance] = useState<Instance | null>(null);
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJSON<Params>("/api/defaults"),
      getJSON<Instance>("/api/instances/ankara"),
      getJSON<GeoJSON.FeatureCollection>("/api/districts"),
    ])
      .then(([d, i, g]) => {
        setDefaults(d);
        setInstance(i);
        setDistricts(g);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  // Parametre değişiklikleri tüm sekmelere kısa bir gecikmeyle yansır
  const debounced = useDebounced(overrides, 500);
  const params = useMemo(() => (defaults ? { ...defaults, ...debounced } : null), [defaults, debounced]);

  const makeSpec = useMemo(
    () =>
      (constraints: Constraints = {}, sc: Scenario = scenario): Spec => ({
        instance: "ankara",
        scenario: sc,
        params: Object.keys(debounced).length ? debounced : null,
        constraints: {
          max_hospitals: constraints.max_hospitals ?? null,
          budget_mtl: constraints.budget_mtl ?? null,
          max_distance_km: constraints.max_distance_km ?? null,
          min_utilization: constraints.min_utilization ?? null,
        },
      }),
    [debounced, scenario],
  );

  const value: AppState = {
    defaults,
    params,
    overrides,
    setOverrides,
    scenario,
    setScenario,
    instance,
    districts,
    makeSpec,
    loadError,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider eksik");
  return v;
}

/** Senaryoya göre (arazi ihtiyacına göre sıralı) hastane tipleri; gen k → types[k-1]. */
export function scenarioTypes(params: Params | null, scenario: Scenario) {
  if (!params) return [];
  if (scenario === "single") return params.hospital_types.filter((t) => t.key === params.single_type_key);
  return [...params.hospital_types].sort((a, b) => a.land_m2 - b.land_m2);
}
