"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/primitives";

type ThemeMode = "system" | "light" | "dark";
const STORAGE_KEY = "campus-pathway:theme";

const LABELS: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色"
};

function applyTheme(mode: ThemeMode) {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
}

/**
 * Three-state theme switch: system (default), light and dark. The initial
 * markup is system mode so server/client HTML match; the stored override is
 * applied after mount. The inline layout script applies it before paint too.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      setMode(saved);
      applyTheme(saved);
    }
  }, []);

  function cycle() {
    const next: ThemeMode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    setMode(next);
    if (next === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    applyTheme(next);
  }

  const icon = mode === "light" ? "sun" : mode === "dark" ? "moon" : "monitor";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`切换主题，当前：${LABELS[mode]}`}
      title="切换主题（跟随系统 / 浅色 / 深色）"
    >
      <Icon name={icon} size={14} />
      <span className="theme-toggle-label">{LABELS[mode]}</span>
    </button>
  );
}
