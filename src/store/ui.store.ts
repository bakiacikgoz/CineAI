import { create } from "zustand";
import { setAppSetting } from "@/lib/store";

export type ActiveScreen =
  | "dashboard"
  | "scenario-studio"
  | "image-generator"
  | "video-generator"
  | "storyboard"
  | "job-queue"
  | "asset-library"
  | "characters"
  | "audio-pipeline"
  | "prompt-library"
  | "model-manager"
  | "cost-dashboard"
  | "settings";

export type ThemeMode = "light" | "dark" | "system";

function applyThemeToDOM(theme: ThemeMode): void {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme === "light") {
    document.documentElement.classList.remove("dark");
  } else {
    // system
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}

interface UIStore {
  activeScreen: ActiveScreen;
  sidebarExpanded: boolean;
  theme: ThemeMode;
  setActiveScreen: (screen: ActiveScreen) => void;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeScreen: "dashboard",
  sidebarExpanded: true,
  theme: "light",
  setActiveScreen: (screen) => set({ activeScreen: screen }),
  toggleSidebar: () =>
    set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
  setTheme: (theme) => {
    applyThemeToDOM(theme);
    void setAppSetting("THEME_PREFERENCE", theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const next: ThemeMode = state.theme === "light" ? "dark" : "light";
      applyThemeToDOM(next);
      void setAppSetting("THEME_PREFERENCE", next);
      return { theme: next };
    }),
}));
