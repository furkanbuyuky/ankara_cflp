import { cssVar } from "../colors";
import { mtl, n0, n1, pct } from "../format";
import type { HospitalType, Instance, PseudoLine, Pseudocode, TraceEvent } from "../types";
import { GenesView } from "./common";

type Ev = TraceEvent & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ------------------------------------------------------------------ pseudocode

export function PseudocodePanel({ code, line, sub, variants }: { code: Pseudocode; line: string; sub?: string; variants: string[] }) {
  const isActive = (l: PseudoLine) => l.id === line || l.id === sub || (sub?.startsWith("dec.") && l.id === "main.decode" && line === "main.decode");
  const dim = (l: PseudoLine) => !!l.variant && !variants.includes(l.variant);
  return (
    <div className="code" aria-label="Pseudocode">
      <div className="code-block-title">{code.title}</div>
      {code.main.map((l, i) => (
        <div key={l.id} className={`code-line${isActive(l) ? " active" : ""}${dim(l) ? " dim" : ""}`}>
          <span className="ln">{i + 1}</span>
          <span style={{ paddingLeft: l.indent * 16 }}>{l.text}</span>
        </div>
      ))}
      {code.blocks.map((b) => {
        const lines = b.lines.filter((l) => !l.variant || variants.includes(l.variant));
        return (
          <div key={b.title} style={{ marginTop: 8 }}>
            <div className="code-block-title">{b.title}</div>
            {lines.map((l, i) => (
              <div key={l.id} className={`code-line${l.id === sub ? " active" : ""}`}>
                <span className="ln">{i + 1}</span>
                <span style={{ paddingLeft: l.indent * 16 }}>{l.text}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ açıklama metni

export function explain(ev: Ev, types: HospitalType[], inst: Instance): string {
  const name = (i: number) => inst.demand[i]?.name ?? `#${i}`;
  const cand = (j: number) => `Aday ${j + 1}`;
  const s = ev.state;
  switch (ev.kind) {
    case "init_individual":
      return `Başlangıç popülasyonu: ${ev.index + 1}. birey rastgele üretildi. Her aday p_open olasılıkla açık, açıksa arazisine sığan tiplerden biri seçilir.`;
    case "repair":
      return ev.closed?.length
        ? `Onarım: ${ev.closed.map((c: { cand: number; reason: string }) => `${cand(c.cand)} kapatıldı (${c.reason} sınırı)`).join(", ")}.`
        : "Onarım: sayı/bütçe sınırı aşılmıyor, değişiklik yok.";
    case "decode_open":
      return `Decoder başladı: ${ev.open.length} açık hastane (${ev.open.map((j: number) => cand(j)).join(", ")}). Kapasiteler yatak cinsinden.`;
    case "decode_regret":
      return "Her mahalle için pişmanlık hesaplandı: en yakın hastaneye gidemezse ikinci en yakına gitmenin ek mesafesi × nüfus. Seçeneği az olanlar önce atanır.";
    case "decode_order":
      return `Atama sırası: ${ev.order.slice(0, 5).map((i: number) => name(i)).join(" → ")}${ev.order.length > 5 ? " → …" : ""}`;
    case "decode_assign":
      if (ev.j < 0) return `${name(ev.i)} atanamadı: ${ev.why}.`;
      return ev.j === ev.nearest
        ? `${name(ev.i)} en yakın hastane ${cand(ev.j)}'e atandı. Kalan kapasite: ${n1(ev.cap_left[ev.j])} yatak.`
        : `${name(ev.i)} için en yakın hastane (${cand(ev.nearest)}) dolu; kapasitesi yeten bir sonraki hastane ${cand(ev.j)} seçildi.`;
    case "decode_fix":
      return ev.j < 0
        ? `${name(ev.i)} hâlâ karşılanamıyor: ${ev.why}. Ceza uygulanacak.`
        : `Yer açma: ${name(ev.moved.i)} ${cand(ev.moved.from)} → ${cand(ev.moved.to)} kaydırıldı, böylece ${name(ev.i)} ${cand(ev.j)}'e sığdı.`;
    case "decode":
      return "Decoder çalıştı (adımlar gizli).";
    case "evaluate":
      return `Maliyet = açılış ${mtl(ev.cost.fixed)} + ulaşım ${mtl(ev.cost.assign)} + ceza ${mtl(ev.cost.penalty)} = ${mtl(ev.cost.total)} (yıllık).`;
    case "generation_start":
      return `Nesil ${ev.gen} başlıyor. Şimdiye kadarki en iyi maliyet: ${mtl(s.best?.cost)}.`;
    case "elitism":
      return `Elitizm: en iyi ${ev.indices.length} birey (${ev.indices.map((i: number) => `#${i + 1}`).join(", ")}) değişmeden yeni popülasyona aktarıldı.`;
    case "select_roulette":
      if (ev.sub === "sel.roulette.fit") return "Rulet maksimizasyon içindir; maliyet fitness'a çevrilir: fᵢ = c_max − cᵢ + ε. En pahalı birey neredeyse sıfır pay alır.";
      if (ev.sub === "sel.roulette.prob") return `Olasılıklar: ${ev.prob.map((p: number, i: number) => `#${i + 1} ${pct(p, 0)}`).join(", ")}. Ceza alan çok kötü bireyler varsa iyi bireylerin payları birbirine yaklaşır (ölçek sorunu).`;
      return `Çark çevrildi: r = ${ev.r.toFixed(3)} → ebeveyn ${ev.which}: #${ev.chosen + 1} (maliyet ${mtl(s.P[ev.chosen]?.cost)}).`;
    case "select_tournament":
      if (ev.sub === "sel.tournament.pick") return `Turnuva: rastgele ${ev.competitors.length} birey seçildi: ${ev.competitors.map((i: number) => `#${i + 1}`).join(", ")}.`;
      return `Kazanan en düşük maliyetli #${ev.chosen + 1} (${mtl(s.P[ev.chosen]?.cost)}) → ebeveyn ${ev.which}.`;
    case "select_rank":
      if (ev.sub === "sel.rank.sort") return "Rank seçimi: bireyler maliyete göre sıralanır; olasılık maliyetin büyüklüğüne değil sırasına bağlıdır.";
      if (ev.sub === "sel.rank.prob") return `Doğrusal sıralama olasılıkları: en iyi ${pct(Math.max(...ev.prob), 0)}, en kötü ${pct(Math.min(...ev.prob), 0)}.`;
      return `r = ${ev.r.toFixed(3)} → ebeveyn ${ev.which}: #${ev.chosen + 1} (sıra ${ev.rank[ev.chosen]}).`;
    case "crossover":
      if (ev.cuts?.length === 1) return `Tek noktalı çaprazlama: ${ev.cuts[0]}. genden sonra kesildi; çocuklar ebeveynlerin parçalarını değiş tokuş etti.`;
      if (ev.cuts?.length === 2) return `İki noktalı çaprazlama: [${ev.cuts[0]}, ${ev.cuts[1]}) aralığındaki genler değiş tokuş edildi.`;
      return "Uniform çaprazlama: her gen için yazı-tura atıldı (1 = ç1 geni e1'den).";
    case "no_crossover":
      return "rand ≥ p_c: çaprazlama yapılmadı, çocuklar ebeveynlerin kopyası.";
    case "mutate":
      return ev.changes.length
        ? `Mutasyon: ${ev.changes.map((c: { pos: number; old: number; new: number }) => `${cand(c.pos)} ${c.old ? types[c.old - 1].name : "kapalı"} → ${c.new ? types[c.new - 1].name : "kapalı"}`).join(", ")}.`
        : "Mutasyon: hiçbir gen değişmedi (her gen düşük olasılıkla değişir).";
    case "add_child":
      return `Çocuk yeni popülasyona eklendi (#${ev.index + 1}, maliyet ${mtl(ev.cost.total)}).`;
    case "replace":
      return "Eski popülasyon yeni popülasyonla değiştirildi.";
    case "best_update":
      return ev.improved ? `Yeni en iyi çözüm bulundu: ${mtl(ev.best_cost)}.` : `En iyi çözüm değişmedi (${mtl(ev.best_cost)}).`;
    case "de_target":
      return `Hedef vektör x_${ev.target + 1} için deneme vektörü üretilecek.`;
    case "de_pick":
      return `Hedeften ve birbirinden farklı rastgele bireyler: r1 = #${ev.r[0] + 1}, r2 = #${ev.r[1] + 1}, r3 = #${ev.r[2] + 1}.`;
    case "de_mutation":
      return `Mutant vektör v hesaplandı (F = ${ev.F}). Fark vektörü popülasyonun yayılımını ölçekleyerek arama yönü verir.`;
    case "de_bound":
      return "Sınır dışına çıkan bileşenler [0, kmax+1) aralığına geri yansıtıldı.";
    case "de_crossover":
      return `Binom çaprazlama: CR = ${ev.CR} olasılıkla (ve j_rand = ${ev.jrand + 1} için kesin) bileşen v'den, aksi halde hedeften alınır.`;
    case "de_map":
      return "Sürekli vektör tamsayı genlere çevrildi: gen = ⌊u⌋ (0 kapalı, 1..K tip).";
    case "de_selection":
      return ev.trial_wins
        ? `Deneme (${mtl(ev.trial_cost.total)}) hedeften (${mtl(ev.target_cost)}) iyi ya da eşit → hedefin yerini aldı.`
        : `Deneme (${mtl(ev.trial_cost.total)}) hedeften (${mtl(ev.target_cost)}) kötü → hedef korundu.`;
    case "done":
      return `Algoritma bitti. En iyi maliyet ${mtl(ev.best_cost)}.`;
    default:
      return ev.kind;
  }
}

// ------------------------------------------------------------------ popülasyon

export function PopulationList({ ev, types, isDE }: { ev: Ev; types: HospitalType[]; isDE: boolean }) {
  const P = ev.state.P ?? [];
  const Q = ev.state.Q ?? [];
  const sel = new Set<number>();
  const win = new Set<number>();
  if (ev.kind.startsWith("select_")) {
    if (ev.kind === "select_tournament") (ev.competitors as number[]).forEach((i) => sel.add(i));
    if (!ev.sub?.endsWith("fit") && !ev.sub?.endsWith("prob") && !ev.sub?.endsWith("sort") && !ev.sub?.endsWith("pick")) win.add(ev.chosen);
  }
  if (ev.kind === "crossover" || ev.kind === "no_crossover") (ev.parents as number[]).forEach((i) => sel.add(i));
  if (ev.kind === "elitism") (ev.indices as number[]).forEach((i) => win.add(i));
  const tags = new Map<number, string>();
  if (isDE && ev.state.target != null) tags.set(ev.state.target, "hedef");
  if (ev.kind === "de_pick" || ev.kind === "de_mutation") {
    (ev.r as number[] | undefined)?.forEach((i, k) => tags.set(i, `r${k + 1}`));
    if (ev.kind === "de_mutation" && ev.strategy !== "rand1") tags.set(ev.best, (tags.get(ev.best) ? tags.get(ev.best) + ", " : "") + "best");
  }
  const bestCost = ev.state.best?.cost;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div>
        <h3 style={{ marginBottom: 4 }}>P · nesil {ev.state.gen} popülasyonu {bestCost != null && <span className="muted">· en iyi {mtl(bestCost)}</span>}</h3>
        {P.length === 0 && <div className="muted small">henüz birey yok</div>}
        {P.map((p, i) => (
          <div key={i} className={`pop-row${win.has(i) ? " win" : sel.has(i) ? " sel" : ""}`}>
            <span className="idx">#{i + 1}</span>
            <GenesView genes={p.genes} types={types} size={20} />
            <span className="num small" style={{ marginLeft: "auto" }}>{mtl(p.cost)}</span>
            {tags.get(i) && <span className="badge">{tags.get(i)}</span>}
          </div>
        ))}
      </div>
      {!isDE && Q.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 4 }}>Q · yeni popülasyon ({Q.length})</h3>
          {Q.map((p, i) => (
            <div key={i} className="pop-row">
              <span className="idx">#{i + 1}</span>
              <GenesView genes={p.genes} types={types} size={20} />
              <span className="num small" style={{ marginLeft: "auto" }}>{mtl(p.cost)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ operatör görselleri

export const VISUAL_KINDS = new Set([
  "select_roulette", "select_tournament", "select_rank", "crossover", "no_crossover", "mutate", "repair",
  "init_individual", "de_map", "add_child", "decode_open", "decode_assign", "decode_fix", "decode_regret",
  "evaluate", "de_mutation", "de_bound", "de_crossover", "de_selection",
]);

function Roulette({ prob, r, chosen, spin }: { prob: number[]; r: number; chosen: number; spin: boolean }) {
  const R = 70;
  let acc = 0;
  const shades = [cssVar("--surface-3"), cssVar("--axis")];
  const arcs = prob.map((p, i) => {
    const a0 = acc * 2 * Math.PI;
    acc += p;
    const a1 = acc * 2 * Math.PI;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = R * Math.sin(a0), y0 = -R * Math.cos(a0), x1 = R * Math.sin(a1), y1 = -R * Math.cos(a1);
    const mid = (a0 + a1) / 2;
    return (
      <g key={i}>
        <path d={`M0,0 L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`} fill={spin && i === chosen ? cssVar("--good") : shades[i % 2]} stroke={cssVar("--surface")} strokeWidth={2} />
        {p > 0.04 && <text x={0.68 * R * Math.sin(mid)} y={-0.68 * R * Math.cos(mid) + 4} textAnchor="middle" fontSize={11} fill={cssVar("--ink")}>#{i + 1}</text>}
      </g>
    );
  });
  const ang = r * 2 * Math.PI;
  return (
    <svg viewBox="-90 -90 180 180" width={180} height={180} role="img" aria-label="Rulet çarkı">
      {arcs}
      {spin && <line x1={0} y1={0} x2={(R + 12) * Math.sin(ang)} y2={-(R + 12) * Math.cos(ang)} stroke={cssVar("--critical")} strokeWidth={3} strokeLinecap="round" />}
      <circle r={5} fill={cssVar("--ink")} />
    </svg>
  );
}

function CapBars({ ev, types, genes }: { ev: Ev; types: HospitalType[]; genes: number[] | null }) {
  const cap: number[] = ev.cap_left ?? [];
  if (!genes) return null;
  const open = genes.flatMap((g, j) => (g > 0 ? [j] : []));
  return (
    <div className="stack" style={{ gap: 4 }}>
      {open.map((j) => {
        const t = types[genes[j] - 1];
        const used = t.beds - (cap[j] ?? t.beds);
        return (
          <div key={j} className="row" style={{ gap: 8 }}>
            <span className="small" style={{ width: 62 }}>Aday {j + 1}</span>
            <div style={{ flex: 1, height: 12, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden", outline: ev.j === j ? "2px solid var(--warning)" : undefined }}>
              <div style={{ width: `${Math.min(100, (used / t.beds) * 100)}%`, height: "100%", background: `var(--type-${t.key})` }} />
            </div>
            <span className="small num muted" style={{ width: 92, textAlign: "right" }}>{n0(used)} / {n0(t.beds)}</span>
          </div>
        );
      })}
    </div>
  );
}

function VecTable({ rows, mask }: { rows: [string, number[]][]; mask?: number[] }) {
  return (
    <div className="vec" style={{ overflowX: "auto" }}>
      {rows.map(([name, v]) => (
        <div key={name} className="vec-row">
          <span className="name">{name}</span>
          {v.map((x, j) => <span key={j} className={`vec-cell${mask && mask[j] && (name === "u" || name === "v") ? " on" : ""}`}>{x.toFixed(2)}</span>)}
        </div>
      ))}
      {mask && (
        <div className="vec-row">
          <span className="name">maske</span>
          {mask.map((m, j) => <span key={j} className={`vec-cell${m ? " on" : ""}`}>{m ? "v" : "x"}</span>)}
        </div>
      )}
    </div>
  );
}

export function OperatorView({ ev, types, genes, inst }: { ev: Ev; types: HospitalType[]; genes: number[] | null; inst: Instance }) {
  const P = ev.state.P ?? [];
  switch (ev.kind) {
    case "select_roulette":
      return (
        <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
          <Roulette prob={ev.prob} r={ev.r} chosen={ev.chosen} spin={ev.sub === "sel.roulette.spin"} />
          <table className="data" style={{ width: "auto" }}>
            <thead><tr><th>#</th><th className="r">maliyet</th><th className="r">fitness</th><th className="r">olasılık</th></tr></thead>
            <tbody>
              {P.map((p, i) => (
                <tr key={i} style={ev.sub === "sel.roulette.spin" && i === ev.chosen ? { background: "rgba(12,163,12,0.12)" } : undefined}>
                  <td>{i + 1}</td><td className="r">{n0(p.cost)}</td><td className="r">{n0(ev.fitness[i])}</td>
                  <td className="r">{ev.sub === "sel.roulette.fit" ? "" : pct(ev.prob[i], 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "select_tournament":
      return (
        <div className="row" style={{ gap: 10 }}>
          {(ev.competitors as number[]).map((i, k) => (
            <div key={i} className="kpi" style={{ outline: ev.sub === "sel.tournament.win" && i === ev.chosen ? "2px solid var(--good)" : undefined }}>
              <div className="label">#{i + 1}</div>
              <div className="value" style={{ fontSize: 15 }}>{mtl(ev.costs[k])}</div>
              {ev.sub === "sel.tournament.win" && i === ev.chosen && <div className="sub" style={{ color: "var(--good)" }}>kazanan</div>}
            </div>
          ))}
        </div>
      );
    case "select_rank": {
      const order = P.map((_, i) => i).sort((a, b) => ev.rank[a] - ev.rank[b]);
      return (
        <div className="stack" style={{ gap: 3 }}>
          {order.map((i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <span className="small" style={{ width: 70 }}>sıra {ev.rank[i]} · #{i + 1}</span>
              <div style={{ flex: 1, height: 12, background: "var(--surface-3)", borderRadius: 3 }}>
                {ev.sub !== "sel.rank.sort" && <div style={{ width: `${ev.prob[i] * 100 * 2.5}%`, maxWidth: "100%", height: "100%", borderRadius: 3, background: ev.sub === "sel.rank.spin" && i === ev.chosen ? "var(--good)" : "var(--accent)" }} />}
              </div>
              <span className="small num muted" style={{ width: 48, textAlign: "right" }}>{ev.sub === "sel.rank.sort" ? n0(P[i].cost) : pct(ev.prob[i], 1)}</span>
            </div>
          ))}
        </div>
      );
    }
    case "crossover":
    case "no_crossover": {
      const cuts: number[] = ev.cuts ?? [];
      const pg: number[][] = ev.parent_genes ?? [P[ev.parents[0]]?.genes, P[ev.parents[1]]?.genes];
      return (
        <div className="stack" style={{ gap: 6 }}>
          {["e1", "e2"].map((n, k) => (
            <div key={n} className="row"><span className="small" style={{ width: 70 }}>{n} (#{ev.parents[k] + 1})</span><GenesView genes={pg[k]} types={types} cuts={cuts} /></div>
          ))}
          {ev.mask && !cuts.length && (
            <div className="row"><span className="small" style={{ width: 70 }}>maske</span>
              <span className="genes">{(ev.mask as number[]).map((m, j) => <span key={j} className="gene g0" style={{ color: m ? "var(--accent-ink)" : "var(--muted)" }}>{m ? "1" : "2"}</span>)}</span>
            </div>
          )}
          {["ç1", "ç2"].map((n, k) => (
            <div key={n} className="row"><span className="small" style={{ width: 70 }}>{n}</span><GenesView genes={ev.children[k]} types={types} cuts={cuts} /></div>
          ))}
        </div>
      );
    }
    case "mutate":
      return (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row"><span className="small" style={{ width: 70 }}>önce</span><GenesView genes={ev.before} types={types} marks={ev.changes.map((c: { pos: number }) => c.pos)} /></div>
          <div className="row"><span className="small" style={{ width: 70 }}>sonra</span><GenesView genes={ev.after} types={types} marks={ev.changes.map((c: { pos: number }) => c.pos)} /></div>
        </div>
      );
    case "repair":
    case "init_individual":
    case "de_map":
    case "add_child":
      return genes ? <div className="row"><span className="small" style={{ width: 70 }}>genler</span><GenesView genes={genes} types={types} /></div> : null;
    case "decode_open":
    case "decode_assign":
    case "decode_fix":
      return <CapBars ev={ev} types={types} genes={genes} />;
    case "decode_regret": {
      const top = (ev.regret as (number | null)[]).map((r, i) => ({ r, i })).sort((a, b) => (b.r ?? Infinity) - (a.r ?? Infinity)).slice(0, 6);
      return (
        <table className="data" style={{ width: "auto" }}>
          <thead><tr><th>Mahalle</th><th className="r">pişmanlık</th></tr></thead>
          <tbody>{top.map(({ r, i }) => <tr key={i}><td>{inst.demand[i].name}</td><td className="r">{r == null ? "∞ (tek seçenek)" : n0(r)}</td></tr>)}</tbody>
        </table>
      );
    }
    case "evaluate":
      return (
        <div className="kpis">
          <div className="kpi"><div className="label">Açılış</div><div className="value" style={{ fontSize: 15 }}>{mtl(ev.cost.fixed)}</div></div>
          <div className="kpi"><div className="label">Ulaşım</div><div className="value" style={{ fontSize: 15 }}>{mtl(ev.cost.assign)}</div></div>
          <div className={`kpi${ev.cost.penalty > 0 ? " alert" : ""}`}><div className="label">Ceza</div><div className="value" style={{ fontSize: 15 }}>{mtl(ev.cost.penalty)}</div></div>
          <div className="kpi"><div className="label">Toplam</div><div className="value" style={{ fontSize: 15 }}>{mtl(ev.cost.total)}</div></div>
        </div>
      );
    case "de_mutation": {
      const rows: [string, number[]][] = Object.entries(ev.vectors as Record<string, number[]>).map(([k, v]) => [k === "best" ? "x_best" : k === "target" ? "x_t" : `x_${k}`, v]);
      rows.push(["v", ev.v]);
      return <VecTable rows={rows} />;
    }
    case "de_bound":
      return <VecTable rows={[["önce", ev.before], ["sonra", ev.after]]} />;
    case "de_crossover":
      return <VecTable rows={[["x_t (hedef)", ev.target], ["v", ev.v], ["u", ev.u]]} mask={ev.mask} />;
    case "de_selection":
      return (
        <div className="row" style={{ gap: 10 }}>
          <div className="kpi" style={{ outline: !ev.trial_wins ? "2px solid var(--good)" : undefined }}><div className="label">Hedef x_{ev.target + 1}</div><div className="value" style={{ fontSize: 15 }}>{mtl(ev.target_cost)}</div></div>
          <div className="kpi" style={{ outline: ev.trial_wins ? "2px solid var(--good)" : undefined }}><div className="label">Deneme u</div><div className="value" style={{ fontSize: 15 }}>{mtl(ev.trial_cost.total)}</div></div>
          <GenesView genes={ev.trial_genes} types={types} />
        </div>
      );
    default:
      return null;
  }
}
