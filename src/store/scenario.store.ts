import { create } from "zustand";
import type { GenerationProgress, ShotPlan } from "@/lib/scenario-types";

export interface GenerationLogEntry {
  timestamp: number;
  pass: number;
  message: string;
  shotNumber?: string;
}

interface ScenarioState {
  scenarioText: string;
  scenarioId: string | null;
  shotPlan: ShotPlan | null;
  generationProgress: GenerationProgress | null;
  generationLog: GenerationLogEntry[];
  completedShotNumbers: string[];
  isAnalyzing: boolean;
  isGenerating: boolean;
  error: string | null;
  setScenarioText: (text: string) => void;
  setScenarioId: (id: string | null) => void;
  setShotPlan: (plan: ShotPlan | null) => void;
  setGenerationProgress: (progress: GenerationProgress | null) => void;
  addLogEntry: (entry: Omit<GenerationLogEntry, "timestamp">) => void;
  addCompletedShot: (shotNumber: string) => void;
  setIsAnalyzing: (value: boolean) => void;
  setIsGenerating: (value: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useScenarioStore = create<ScenarioState>((set) => ({
  scenarioText: "",
  scenarioId: null,
  shotPlan: null,
  generationProgress: null,
  generationLog: [],
  completedShotNumbers: [],
  isAnalyzing: false,
  isGenerating: false,
  error: null,
  setScenarioText: (text) => set({ scenarioText: text }),
  setScenarioId: (id) => set({ scenarioId: id }),
  setShotPlan: (plan) => set({ shotPlan: plan }),
  setGenerationProgress: (progress) => set({ generationProgress: progress }),
  addLogEntry: (entry) =>
    set((state) => ({
      generationLog: [...state.generationLog, { ...entry, timestamp: Date.now() }],
    })),
  addCompletedShot: (shotNumber) =>
    set((state) => ({
      completedShotNumbers: [...state.completedShotNumbers, shotNumber],
    })),
  setIsAnalyzing: (value) => set({ isAnalyzing: value }),
  setIsGenerating: (value) => set({ isGenerating: value }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      scenarioText: "",
      scenarioId: null,
      shotPlan: null,
      generationProgress: null,
      generationLog: [],
      completedShotNumbers: [],
      isAnalyzing: false,
      isGenerating: false,
      error: null,
    }),
}));
