import { lazy, Suspense, useEffect, useState } from "react";
import { setTheme, useThemeVersion, isDark } from "./colors";
import { Seg } from "./components/common";
import ErrorBoundary from "./components/ErrorBoundary";
import { useApp } from "./state";
import DataTab from "./tabs/DataTab";
import ExactTab from "./tabs/ExactTab";
import type { Scenario } from "./types";

const TeachTab = lazy(() => import("./tabs/TeachTab"));
const ProcessTab = lazy(() => import("./tabs/ProcessTab"));
const CompareTab = lazy(() => import("./tabs/CompareTab"));

export const TABS = [
  { id: "data", label: "Problem ve veri", desc: "Mahalleler, aday yerler, parametreler" },
  { id: "exact", label: "Exact çözüm", desc: "MIP ile en iyi yerleşim, S1 ve S2" },
  { id: "teach", label: "Algoritma nasıl çalışır", desc: "GA ve DE adım adım" },
  { id: "process", label: "Optimizasyon süreci", desc: "Algoritmalar yarışıyor" },
  { id: "compare", label: "Karşılaştırma", desc: "Çoklu seed istatistikleri" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function initialTab(): TabId {
  const h = window.location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "data") as TabId;
}

function ThemeToggle() {
  useThemeVersion();
  const dark = isDark();
  return (
    <button className="btn ghost small" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Temayı değiştir">
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
      {dark ? "Açık tema" : "Koyu tema"}
    </button>
  );
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
    window.scrollTo({ top: 0 });
  }, [tab]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden><path d="M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z" fill="#fff" /></svg>
          </div>
          <div>
            <h1>Ankara Hastane Yerleşimi</h1>
            <div className="muted">Kapasiteli tesis yerleşimi</div>
          </div>
        </div>

        <nav className="nav" aria-label="Bölümler">
          <div className="nav-label">Bölümler</div>
          {TABS.map((t, i) => (
            <button key={t.id} className="nav-item" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              <span className="n">{i + 1}</span>
              <span>
                <span className="t">{t.label}</span>
                <span className="d">{t.desc}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="side-block">
          <div className="nav-label" style={{ padding: 0 }}>Senaryo</div>
          <Seg<Scenario>
            value={scenario}
            onChange={setScenario}
            options={[
              { value: "single", label: "S1 · Tek tip" },
              { value: "multi", label: "S2 · Üç tip" },
            ]}
          />
          <p className="hint">
            {scenario === "single"
              ? "Tüm hastaneler aynı büyüklükte: orta boy, 600 yatak."
              : "Her aday yere küçük (250), orta (600) ya da büyük (1.200 yatak) hastane açılabilir."}
          </p>
        </div>

        <div className="side-foot">
          <span className="hint">MIP · GA · DE</span>
          <ThemeToggle />
        </div>
      </aside>

      <main className="content">
        <div className="content-inner">
          {loadError && <div className="notice error">Sunucuya ulaşılamadı: {loadError}. API'nin çalıştığından emin olun.</div>}
          {!instance && !loadError && <div className="notice">Veri yükleniyor…</div>}
          {instance && (
            <Suspense fallback={<div className="notice">Yükleniyor…</div>}>
              {TABS.map((t) =>
                visited.has(t.id) ? (
                  <section key={t.id} hidden={tab !== t.id}>
                    <ErrorBoundary resetKey={scenario}>
                      {t.id === "data" && <DataTab />}
                      {t.id === "exact" && <ExactTab />}
                      {t.id === "teach" && <TeachTab />}
                      {t.id === "process" && <ProcessTab />}
                      {t.id === "compare" && <CompareTab />}
                    </ErrorBoundary>
                  </section>
                ) : null,
              )}
            </Suspense>
          )}
        </div>
      </main>
    </div>
  );
}
