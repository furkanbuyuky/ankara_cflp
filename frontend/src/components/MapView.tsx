import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { cssVar, isDark, typeColor, useThemeVersion } from "../colors";
import { n0, n1, pct } from "../format";
import type { HospitalType, Instance } from "../types";

export interface MapSolution {
  genes: number[];
  assign: number[];
}

interface Props {
  instance: Instance;
  districts?: GeoJSON.FeatureCollection | null;
  types: HospitalType[]; // gen k → types[k-1]
  solution?: MapSolution | null;
  demandBeds?: number[];
  /** Adaylar: "eligibility" = arazisine sığan en büyük tipin rengiyle; "plain"; "hidden" */
  candidateMode?: "eligibility" | "plain" | "hidden";
  kmax?: number[];
  newOpen?: number[];
  recentlyClosed?: number[];
  focusDemand?: number | null;
  focusCands?: number[];
  dimDemand?: number[]; // öğretimde henüz atanmamış mahalleler
  height?: number | string;
  showLines?: boolean;
  group?: string; // aynı gruptaki haritalar birlikte kayar/yakınlaşır
  showDistrictLabels?: boolean;
}

// --- senkron haritalar (karşılaştırma görünümü)
const groups = new Map<string, Set<L.Map>>();
let syncing = false;

// OSM standart karoları; koyu temada CSS filtresiyle karartılır (styles.css: .tiles-dark)
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function hospitalSize(typeIndex: number, nTypes: number): number {
  if (nTypes === 1) return 20;
  return [16, 21, 27][Math.min(typeIndex, 2)];
}

export default function MapView(props: Props) {
  const {
    instance, districts, types, solution, demandBeds, candidateMode = "plain", kmax, newOpen, recentlyClosed,
    focusDemand, focusCands, dimDemand, height = 520, showLines = true, group, showDistrictLabels = true,
  } = props;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const layers = useRef<{ districts: L.LayerGroup; lines: L.LayerGroup; demand: L.LayerGroup; sites: L.LayerGroup } | null>(null);
  const theme = useThemeVersion();

  // harita bir kez kurulur
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { preferCanvas: true, zoomControl: true, attributionControl: true });
    map.current = m;
    layers.current = {
      districts: L.layerGroup().addTo(m),
      lines: L.layerGroup().addTo(m),
      demand: L.layerGroup().addTo(m),
      sites: L.layerGroup().addTo(m),
    };
    const pts = instance.demand.map((d) => [d.lat, d.lon] as [number, number]);
    m.fitBounds(L.latLngBounds(pts), { padding: [16, 16] });
    if (group) {
      if (!groups.has(group)) groups.set(group, new Set());
      groups.get(group)!.add(m);
      m.on("move", () => {
        if (syncing) return;
        syncing = true;
        groups.get(group)?.forEach((o) => o !== m && o.setView(m.getCenter(), m.getZoom(), { animate: false }));
        syncing = false;
      });
    }
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      if (group) groups.get(group)?.delete(m);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  // altlık harita (tema)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILE_URL, {
      maxZoom: 18,
      className: isDark() ? "tiles-dark" : "tiles-light",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları',
    }).addTo(m);
    tiles.current.bringToBack();
  }, [theme, instance]);

  // ilçe sınırları
  useEffect(() => {
    const lg = layers.current?.districts;
    if (!lg) return;
    lg.clearLayers();
    if (!districts) return;
    const gj = L.geoJSON(districts, {
      style: { color: cssVar("--muted"), weight: 1.2, dashArray: "4 4", fill: false, opacity: 0.8 },
      interactive: false,
    });
    lg.addLayer(gj);
    if (showDistrictLabels) {
      gj.eachLayer((layer) => {
        const f = (layer as L.GeoJSON).feature as GeoJSON.Feature;
        const name = (f.properties as { name: string }).name;
        const d = instance.districts.find((x) => x.name === name);
        const c = d ? L.latLng(d.center[0], d.center[1]) : (layer as L.Polygon).getBounds().getCenter();
        L.tooltip({ permanent: true, direction: "center", className: "district-label" }).setLatLng(c).setContent(name).addTo(lg);
      });
    }
  }, [districts, theme, instance, showDistrictLabels]);

  // talep noktaları, atama çizgileri, adaylar ve hastaneler
  useEffect(() => {
    const ls = layers.current;
    if (!ls) return;
    ls.lines.clearLayers();
    ls.demand.clearLayers();
    ls.sites.clearLayers();
    const genes = solution?.genes;
    const assign = solution?.assign;
    const typeOf = (j: number) => (genes && genes[j] > 0 ? types[genes[j] - 1] : null);
    const muted = cssVar("--muted");
    const critical = cssVar("--critical");
    const ink = cssVar("--ink-2");
    const surface = cssVar("--surface");
    const dim = new Set(dimDemand ?? []);

    // hastane yükleri (tooltip için)
    const load = new Map<number, number>();
    if (assign && demandBeds) assign.forEach((j, i) => j >= 0 && load.set(j, (load.get(j) ?? 0) + demandBeds[i]));

    if (showLines && assign) {
      assign.forEach((j, i) => {
        if (j < 0 || dim.has(i)) return;
        const t = typeOf(j);
        const d = instance.demand[i];
        const c = instance.candidates[j];
        L.polyline([[d.lat, d.lon], [c.lat, c.lon]], {
          color: t ? typeColor(t.key) : muted,
          weight: focusDemand === i ? 3 : 1.1,
          opacity: focusDemand === i ? 0.95 : 0.5,
          interactive: false,
        }).addTo(ls.lines);
      });
    }

    instance.demand.forEach((d, i) => {
      const unmet = !!assign && assign[i] < 0 && !dim.has(i);
      const r = 2.5 + Math.sqrt(d.population / 1000) * 1.15;
      const j = assign ? assign[i] : -1;
      const t = j >= 0 ? typeOf(j) : null;
      const marker = L.circleMarker([d.lat, d.lon], {
        radius: focusDemand === i ? r + 3 : r,
        color: unmet ? critical : focusDemand === i ? cssVar("--warning") : surface,
        weight: unmet || focusDemand === i ? 2.5 : 1,
        fillColor: dim.has(i) ? muted : t ? typeColor(t.key) : ink,
        fillOpacity: dim.has(i) ? 0.25 : t ? 0.55 : 0.45,
      });
      marker.bindTooltip(() => {
        let html = `<b>${d.name}</b> <span style="color:${muted}">${d.district}</span><br>Nüfus: ${n0(d.population)}`;
        if (demandBeds) html += `<br>Yatak ihtiyacı: ${n1(demandBeds[i])}`;
        if (assign) {
          if (j >= 0) {
            const c = instance.candidates[j];
            const km = L.latLng(d.lat, d.lon).distanceTo(L.latLng(c.lat, c.lon)) / 1000;
            html += `<br>Hastane: Aday ${j + 1} (${t?.name ?? "?"})<br>Kuş uçuşu: ${n1(km)} km`;
          } else if (!dim.has(i)) html += `<br><b style="color:${critical}">Karşılanmadı</b>`;
        }
        return html;
      }, { sticky: true });
      marker.addTo(ls.demand);
    });

    if (candidateMode !== "hidden") {
      const focus = new Set(focusCands ?? []);
      const fresh = new Set(newOpen ?? []);
      const closed = new Set(recentlyClosed ?? []);
      instance.candidates.forEach((c, j) => {
        const t = typeOf(j);
        if (t) {
          const k = genes![j] - 1;
          const size = hospitalSize(k, types.length);
          const cls = ["hosp-icon", fresh.has(j) ? "new" : "", focus.has(j) ? "focus" : ""].join(" ");
          const icon = L.divIcon({
            className: "",
            html: `<div class="${cls}" style="width:${size}px;height:${size}px;background:${typeColor(t.key)}">${t.name[0]}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
          const mk = L.marker([c.lat, c.lon], { icon, zIndexOffset: 1000 + k * 10, keyboard: false });
          mk.bindTooltip(() => {
            const ld = load.get(j) ?? 0;
            let html = `<b>Aday ${j + 1}</b> · ${t.name} hastane (${n0(t.beds)} yatak)<br><span style="color:${muted}">${c.district} · ${c.name.replace(/^Aday \d+ /, "")}</span>`;
            if (demandBeds) html += `<br>Yük: ${n0(ld)} / ${n0(t.beds)} yatak (${pct(ld / t.beds)})`;
            if (assign) html += `<br>Bağlı mahalle: ${assign.filter((x) => x === j).length}`;
            return html;
          });
          mk.addTo(ls.sites);
        } else {
          let border = muted;
          if (candidateMode === "eligibility" && kmax) border = kmax[j] > 0 ? typeColor(types[kmax[j] - 1].key) : critical;
          const cls = ["cand-icon", closed.has(j) ? "closed-recent" : ""].join(" ");
          const size = candidateMode === "eligibility" ? 12 : 9;
          const icon = L.divIcon({
            className: "",
            html: `<div class="${cls}" style="width:${size}px;height:${size}px;border-color:${closed.has(j) ? critical : border};${focus.has(j) ? `outline:2px solid ${cssVar("--warning")};` : ""}"></div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
          const mk = L.marker([c.lat, c.lon], { icon, zIndexOffset: 500, keyboard: false });
          mk.bindTooltip(() => {
            let html = `<b>Aday ${j + 1}</b> <span style="color:${muted}">${c.district}</span><br>Arazi: ${n0(c.land_m2 / 1000)} bin m²<br>Arsa: ${n0(c.land_price_tl_m2)} ₺/m²`;
            if (kmax) html += `<br>Sığan en büyük tip: ${kmax[j] > 0 ? types[kmax[j] - 1].name : "hiçbiri"}`;
            return html;
          });
          mk.addTo(ls.sites);
        }
      });
    }
  }, [instance, solution, types, demandBeds, candidateMode, kmax, newOpen, recentlyClosed, focusDemand, focusCands,
      dimDemand, showLines, theme]);

  return <div ref={el} className="map" style={{ height }} />;
}

export function MapLegend({ types, unmet = true, candidates = true }: { types: HospitalType[]; unmet?: boolean; candidates?: boolean }) {
  return (
    <div className="legend">
      {types.map((t, k) => {
        const s = hospitalSize(k, types.length) * 0.6;
        return (
          <span key={t.key}>
            <i className="dot" style={{ background: `var(--type-${t.key})`, width: s, height: s }} />
            {t.name} ({n0(t.beds)} yatak)
          </span>
        );
      })}
      <span><i className="dot" style={{ background: "var(--ink-2)", opacity: 0.5 }} /> Mahalle (alan ∝ nüfus)</span>
      {candidates && <span><i className="sq" style={{ border: "2px solid var(--muted)" }} /> Kapalı aday</span>}
      {unmet && <span><i className="dot" style={{ border: "2px solid var(--critical)" }} /> Karşılanmayan</span>}
    </div>
  );
}
