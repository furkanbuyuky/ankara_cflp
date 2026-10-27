import { Chart, registerables, type ChartConfiguration, type Plugin } from "chart.js";
import { useEffect, useRef } from "react";
import { cssVar, useThemeVersion } from "../colors";

/** Dikey imleç (x değeri) ve yatay referans çizgileri için küçük eklenti. */
interface RefLine {
  y: number;
  label: string;
  color: string;
  dash?: number[];
  below?: boolean; // etiketi çizginin altına yaz (yakın iki çizgi üst üste binmesin)
}
interface CursorOpts {
  x?: number | null;
  refLines?: RefLine[];
  band?: { from: number; to: number; color: string } | null;
}
declare module "chart.js" {
  interface PluginOptionsByType<TType> {
    overlay?: CursorOpts & { _t?: TType };
  }
}

const overlay: Plugin = {
  id: "overlay",
  afterDatasetsDraw(chart, _args, opts: CursorOpts) {
    const { ctx, chartArea, scales } = chart;
    const xs = scales.x;
    const ys = scales.y;
    if (!xs || !ys) return;
    ctx.save();
    if (opts.band) {
      const y1 = ys.getPixelForValue(opts.band.from);
      const y2 = ys.getPixelForValue(opts.band.to);
      ctx.fillStyle = opts.band.color;
      ctx.fillRect(chartArea.left, Math.min(y1, y2), chartArea.right - chartArea.left, Math.abs(y2 - y1));
    }
    for (const r of opts.refLines ?? []) {
      const y = ys.getPixelForValue(r.y);
      if (y < chartArea.top - 1 || y > chartArea.bottom + 1) continue;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(r.dash ?? [5, 4]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--ink-2");
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(r.label, chartArea.right - 4, r.below ? y + 13 : y - 4);
    }
    if (opts.x != null) {
      const x = xs.getPixelForValue(opts.x);
      if (x >= chartArea.left && x <= chartArea.right) {
        ctx.strokeStyle = cssVar("--ink-2");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
      }
    }
    ctx.restore();
  },
};

Chart.register(...registerables, overlay);

/** Tema renklerini kullanan ortak eksen/ızgara ayarları. */
export function baseOptions(): Record<string, unknown> {
  const grid = cssVar("--grid");
  const muted = cssVar("--muted");
  const ink2 = cssVar("--ink-2");
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = ink2;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { display: false, labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
      tooltip: {
        backgroundColor: cssVar("--surface"),
        titleColor: cssVar("--ink"),
        bodyColor: ink2,
        borderColor: cssVar("--border-strong"),
        borderWidth: 1,
        padding: 8,
        boxPadding: 4,
        usePointStyle: true,
      },
    },
    scales: {
      x: { grid: { color: grid, drawTicks: false }, border: { color: cssVar("--axis") }, ticks: { color: muted, padding: 6 } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, padding: 6 } },
    },
  };
}

export function merge<T extends Record<string, unknown>>(a: T, b: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const av = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && av && typeof av === "object" && !Array.isArray(av)
        ? merge(av as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out as T;
}

export default function ChartBox({ config, height = 240 }: { config: ChartConfiguration; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const theme = useThemeVersion();

  useEffect(() => {
    if (!canvas.current) return;
    chart.current = new Chart(canvas.current, config);
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type, theme]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.data = config.data;
    c.options = config.options ?? {};
    c.update("none");
  }, [config]);

  return (
    <div style={{ position: "relative", height, width: "100%", minWidth: 0 }}>
      <canvas ref={canvas} role="img" />
    </div>
  );
}
