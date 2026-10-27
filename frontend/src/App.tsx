import { lazy, Suspense, useEffect, useState } from "react";
import { Seg } from "./components/common";
import { useApp } from "./state";
import DataTab from "./tabs/DataTab";
import ExactTab from "./tabs/ExactTab";
import type { Scenario } from "./types";

const TeachTab = lazy(() => import("./tabs/TeachTab"));
const ProcessTab = lazy(() => import("./tabs/ProcessTab"));
const CompareTab = lazy(() => import("./tabs/CompareTab"));

const TABS = [
  { id: "data", label: "Problem & Veri" },
  { id: "exact", label: "Exact çözüm" },
  { id: "teach", label: "Algoritma nasıl çalışır" },
  { id: "process", label: "Optimizasyon süreci" },
  { id: "compare", label: "Karşılaştırma" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function initialTab(): TabId {
  const h = window.location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "data") as TabId;
}

export default function App() {
  const { instance, loadError, scenario, setScenario } = useApp();
  const [tab, setTab] = useState<TabId>(initialTab);
  // ziyaret edilen sekmeler bağlı kalır; sekme değiştirince durum kaybolmaz
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([initialTab()]));

  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", `#${tab}`);
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M6 1h4v5h5v4h-5v5H6v-5H1V6h5z" fill="#fff" /></svg>
          </div>
          <div>
            <h1>Ankara Hastane Yerleşimi</h1>
            <div className="muted small">Kapasiteli tesis yerleşim problemi · MIP, GA ve DE</div>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              <span className="idx">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <Seg<Scenario>
          value={scenario}
          onChange={setScenario}
          options={[
            { value: "single", label: "S1 · Tek tip" },
            { value: "multi", label: "S2 · Üç tip" },
          ]}
        />
      </header>
      <main className="main">
        {loadError && <div className="notice error">Backend'e ulaşılamadı: {loadError}. Önce API sunucusunu başlatın (port 8000).</div>}
        {!instance && !loadError && <div className="notice">Veri yükleniyor…</div>}
        {instance && (
          <Suspense fallback={<div className="notice">Yükleniyor…</div>}>
            {TABS.map((t) =>
              visited.has(t.id) ? (
                <section key={t.id} hidden={tab !== t.id} role="tabpanel">
                  {t.id === "data" && <DataTab />}
                  {t.id === "exact" && <ExactTab />}
                  {t.id === "teach" && <TeachTab />}
                  {t.id === "process" && <ProcessTab />}
                  {t.id === "compare" && <CompareTab />}
                </section>
              ) : null,
            )}
          </Suspense>
        )}
      </main>
    </div>
  );
}
