import type { ReactNode } from "react";
import { mtl, n0, n1, pct, statusLabel } from "../format";
import type { Cost, HospitalType, Job, Kpi as KpiT, SolverInfo } from "../types";

export function Kpi({ label, value, sub, alert, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; alert?: boolean; icon?: ReactNode }) {
  return (
    <div className={`kpi${alert ? " alert" : ""}`}>
      <div className="label">{icon}{label}</div>
      <div className="value num">{value}</div>
      {sub != null && <div className="sub">{sub}</div>}
    </div>
  );
}

export function JobStatus<T>({ job, error, expectSeconds }: { job: Job<T> | null; error?: string | null; expectSeconds?: number }) {
  if (error) return <div className="notice error">Hata: {error}</div>;
  if (!job) return null;
  if (job.status === "done")
    return job.cached ? <span className="badge">önbellekten</span> : <span className="badge ok">tamamlandı · {n1(job.elapsed)} sn</span>;
  const frac = job.progress > 0 ? job.progress : expectSeconds ? Math.min(0.97, job.elapsed / expectSeconds) : 0.05;
  return (
    <div className="stack" style={{ gap: 4, minWidth: 220, flex: 1 }}>
      <div className="row between small">
        <span className="ink2">{job.message || "Kuyrukta"}</span>
        <span className="muted num">{n0(job.elapsed)} sn</span>
      </div>
      <div className="progress"><div style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}

export function SolverBadge({ info }: { info: SolverInfo }) {
  const cls = info.status === "optimal" ? "ok" : info.status === "time_limit" ? "warn" : "bad";
  return (
    <span className={`badge ${cls}`} title={info.bound != null ? `Alt sınır: ${n1(info.bound)}` : undefined}>
      {statusLabel[info.status] ?? info.status}
      {info.gap != null && info.status !== "optimal" ? ` · gap ${pct(info.gap, 2)}` : ""}
    </span>
  );
}

export function SolutionKpis({ cost, kpi, types, investment, extra }: { cost: Cost; kpi: KpiT; types: HospitalType[]; investment: number; extra?: ReactNode }) {
  const mix = types.map((t) => `${kpi.by_type[t.key] ?? 0} ${t.name.toLowerCase()}`).join(" · ");
  return (
    <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
      <Kpi label="Toplam yıllık maliyet" value={mtl(cost.total)} sub={`Toplam yatırım ${mtl(investment)}`} />
      <Kpi label="Açılan hastane" value={n0(kpi.n_open)} sub={`${types.length > 1 ? mix + " · " : ""}doluluk ${pct(kpi.avg_util)}`} />
      <Kpi label="Ortalama mesafe" value={`${n1(kpi.avg_dist_km)} km`} sub={`en uzak ${n1(kpi.max_dist_km)} km`} />
      <Kpi
        label="Karşılanmayan talep"
        value={kpi.unmet_beds > 0 ? `${n0(kpi.unmet_beds)} yatak` : "Yok"}
        sub={kpi.unmet_beds > 0 ? `${pct(kpi.unmet_pct / 100)} · ${kpi.unmet_count} mahalle` : "tüm mahalleler bir hastaneye bağlı"}
        alert={kpi.unmet_beds > 0}
      />
      {extra}
    </div>
  );
}

/** Her sayfanın üstündeki başlık: adım numarası, başlık, tek paragraflık açıklama ve eylemler. */
export function PageHeader({ step, title, children, actions }: { step?: number; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {step != null && <div className="eyebrow">Adım {step}</div>}
        <h1 className="page-title">{title}</h1>
        {children && <p className="page-desc">{children}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GenesView({ genes, types, marks, cuts, size = 22 }: { genes: number[]; types: HospitalType[]; marks?: number[]; cuts?: number[]; size?: number }) {
  const m = new Set(marks ?? []);
  const c = new Set(cuts ?? []);
  return (
    <span className="genes">
      {genes.map((g, j) => (
        <span
          key={j}
          className={`gene g${g > 0 ? "x" : "0"}${m.has(j) ? " mark" : ""}${c.has(j) ? " cut-before" : ""}`}
          style={{ ...(g > 0 ? { background: `var(--type-${types[g - 1]?.key})` } : {}), width: size, height: size }}
          title={`Aday ${j + 1}: ${g > 0 ? types[g - 1]?.name : "kapalı"}`}
        >
          {g > 0 ? types[g - 1]?.name[0] : "·"}
        </span>
      ))}
    </span>
  );
}

export function CostBar({ cost }: { cost: Cost }) {
  const parts = [
    { k: "Açılış (yıllıklandırılmış)", v: cost.fixed, c: "var(--accent)" },
    { k: "Ulaşım", v: cost.assign, c: "var(--type-S)" },
    { k: "Karşılanmama cezası", v: cost.penalty, c: "var(--critical)" },
  ].filter((p) => p.v > 0);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: "flex", height: 10, gap: 2, borderRadius: 99, overflow: "hidden" }}>
        {parts.map((p) => (
          <div key={p.k} title={`${p.k}: ${mtl(p.v)}`} style={{ width: `${(p.v / cost.total) * 100}%`, background: p.c }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.k}><i className="sq" style={{ background: p.c }} />{p.k} {mtl(p.v)} ({pct(p.v / cost.total)})</span>
        ))}
      </div>
    </div>
  );
}
