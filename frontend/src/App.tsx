import { lazy, Suspense, useEffect, useState } from "react";
import { isDark, setTheme, useThemeVersion } from "./colors";
import ErrorBoundary from "./components/ErrorBoundary";
import { useApp } from "./state";
import SolveTab from "./tabs/SolveTab";

const TeachTab = lazy(() => import("./tabs/TeachTab"));

const TABS = [
  { id: "solve", label: "Çözüm" },
  { id: "teach", label: "Algoritma adım adım" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function initialTab(): TabId {
  const h = window.location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "solve") as TabId;
}

function ThemeToggle() {
  useThemeVersion();
  const dark = isDark();
  return (
    <button className="btn ghost small" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Açık temaya geç" : "Koyu temaya geç"}>
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

export default function App() {
  const { instance, loadError } = useApp();
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
    <div className="app">
      <header className="topnav">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden><path d="M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z" fill="#fff" /></svg>
          </div>
          <div>
            <h1>Ankara Hastane Yerleşimi</h1>
            <div className="muted">Kapasiteli tesis yerleşimi · MIP, GA, DE</div>
          </div>
        </div>
        <div className="spacer" />
        <nav className="navtabs" aria-label="Sayfalar">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <ThemeToggle />
      </header>

      <main className="content">
        <div className="content-inner">
          {loadError && <div className="notice error">Sunucuya ulaşılamadı: {loadError}. API'nin çalıştığından emin olun.</div>}
          {!instance && !loadError && <div className="notice">Veri yükleniyor…</div>}
          {instance && (
            <Suspense fallback={<div className="notice">Yükleniyor…</div>}>
              {TABS.map((t) =>
                visited.has(t.id) ? (
                  <section key={t.id} hidden={tab !== t.id}>
                    <ErrorBoundary>
                      {t.id === "solve" && <SolveTab />}
                      {t.id === "teach" && <TeachTab />}
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
