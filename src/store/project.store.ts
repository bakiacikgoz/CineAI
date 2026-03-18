import { create } from "zustand";

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

interface ProjectStore {
  activeProject: Project | null;
  recentProjects: Project[];
  setActiveProject: (project: Project | null) => void;
  clearActiveProject: () => void;
  setRecentProjects: (projects: Project[]) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  activeProject: null,
  recentProjects: [],
  setActiveProject: (project) => set({ activeProject: project }),
  clearActiveProject: () => set({ activeProject: null }),
  setRecentProjects: (projects) => set({ recentProjects: projects }),
}));
