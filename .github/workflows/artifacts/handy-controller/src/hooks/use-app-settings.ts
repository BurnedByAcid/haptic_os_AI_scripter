import { useState, useEffect, useCallback, useContext, createContext } from "react";

export type Theme = "system" | "light" | "dark";
export type ScriptOutputFiletype = "funscript" | "csv";

interface AppSettings {
  theme: Theme;
  pulsingIcons: boolean;
  scriptOutputFiletype: ScriptOutputFiletype;
}

interface AppSettingsContextValue extends AppSettings {
  setTheme: (v: Theme) => void;
  setPulsingIcons: (v: boolean) => void;
  setScriptOutputFiletype: (v: ScriptOutputFiletype) => void;
  resetAll: () => void;
}

const STORAGE_KEY = "hc_app_settings";

export const DEFAULTS: AppSettings = {
  theme: "system",
  pulsingIcons: true,
  scriptOutputFiletype: "funscript",
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else if (theme === "light") {
    html.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }
}

function applyPulsingIcons(pulsingIcons: boolean) {
  if (pulsingIcons) {
    document.documentElement.removeAttribute("data-no-pulse");
  } else {
    document.documentElement.setAttribute("data-no-pulse", "true");
  }
}

export const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function useAppSettingsProvider() {
  const [settings, setSettings] = useState<AppSettings>(load);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    applyPulsingIcons(settings.pulsingIcons);
  }, [settings.pulsingIcons]);

  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme]);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      save(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    save(DEFAULTS);
    setSettings({ ...DEFAULTS });
  }, []);

  return {
    theme: settings.theme,
    pulsingIcons: settings.pulsingIcons,
    scriptOutputFiletype: settings.scriptOutputFiletype,
    setTheme: (v: Theme) => update("theme", v),
    setPulsingIcons: (v: boolean) => update("pulsingIcons", v),
    setScriptOutputFiletype: (v: ScriptOutputFiletype) => update("scriptOutputFiletype", v),
    resetAll,
  };
}

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return ctx;
}
