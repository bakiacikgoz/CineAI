import { create } from "zustand";

export type JobStatus = "queued" | "active" | "done" | "error" | "cancelled";
export type JobType =
  | "image_start"
  | "image_end"
  | "image_upscale"
  | "character_image"
  | "video"
  | "lipsync"
  | "upscale"
  | "coverage_image"
  | "coverage_video"
  | "audio_dialogue";

export interface Job {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  shotId?: string;
  assetId?: string;
  model?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  refImagePath?: string;
  falJobId?: string;
  tensorpixJobId?: string;
  progress: number;
  errorMsg?: string;
  costUsd?: number;
  resultPath?: string;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  sequenceOrder?: number;
}

interface QueueStore {
  jobs: Job[];
  parallelLimit: number;
  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (id: string, updates: Partial<Job>) => void;
  removeJob: (id: string) => void;
  setParallelLimit: (limit: number) => void;
  getActiveJobs: () => Job[];
  getPendingJobs: () => Job[];
}

export const useQueueStore = create<QueueStore>((set, get) => ({
  jobs: [],
  parallelLimit: 3,
  setJobs: (jobs) => set({ jobs }),
  addJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  updateJob: (id, updates) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...updates } : job)),
    })),
  removeJob: (id) =>
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  setParallelLimit: (limit) => set({ parallelLimit: limit }),
  getActiveJobs: () => get().jobs.filter((job) => job.status === "active"),
  getPendingJobs: () => get().jobs.filter((job) => job.status === "queued"),
}));
