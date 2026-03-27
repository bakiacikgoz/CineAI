import { create } from "zustand";

export type ActiveScreen =
  | "dashboard"
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

interface UIStore {
  activeScreen: ActiveScreen;
  sidebarExpanded: boolean;
  setActiveScreen: (screen: ActiveScreen) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeScreen: "dashboard",
  sidebarExpanded: true,
  setActiveScreen: (screen) => set({ activeScreen: screen }),
  toggleSidebar: () =>
    set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
}));
