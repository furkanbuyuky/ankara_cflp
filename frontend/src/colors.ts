/** Renkleri CSS değişkenlerinden okur; böylece açık/koyu tema tek yerden yönetilir. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function typeColor(key: string): string {
  return cssVar(`--type-${key}`) || cssVar("--accent");
}

export const RUN_VARS = ["--run-1", "--run-2", "--run-3", "--run-4"];
export function runColor(i: number): string {
  return cssVar(RUN_VARS[i % RUN_VARS.length]);
}

export function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Tema değişince yeniden çizim tetiklemek için. */
import { useEffect, useState } from "react";
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setV((x) => x + 1);
    mq.addEventListener("change", bump);
    const obs = new MutationObserver(bump);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", bump);
      obs.disconnect();
    };
  }, []);
  return v;
}

export function isDark(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

const THEME_KEY = "cflp-theme";

/** Varsayılan açık tema; kullanıcının seçimi tarayıcıda hatırlanır. */
export function initTheme(): void {
  let t = "light";
  try {
    t = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    /* depolama kapalıysa varsayılan */
  }
  document.documentElement.setAttribute("data-theme", t);
}

export function setTheme(t: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* depolama kapalıysa yalnızca bu oturum */
  }
}
