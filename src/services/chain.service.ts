import { join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { getShotById, type ShotRow } from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";

export interface ChainResolveResult {
  refImagePath: string | null;
  waitForJobId: string | null;
  status: "ready" | "waiting" | "needs_production";
}

export async function resolveStartImage(shot: ShotRow): Promise<ChainResolveResult> {
  if (
    shot.chainStatus !== "continue" ||
    !shot.prevShotId ||
    !shot.usePreviousEndForStart
  ) {
    return { refImagePath: null, waitForJobId: null, status: "ready" };
  }

  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const previousShot = await getShotById(shot.prevShotId);

  if (!previousShot) {
    return { refImagePath: null, waitForJobId: null, status: "ready" };
  }

  const candidateReferencePaths = [
    previousShot.imageEndPath,
    previousShot.imageStartPath,
  ].filter((value): value is string => Boolean(value));

  for (const relativePath of candidateReferencePaths) {
    const absolutePath = await join(project.folderPath, relativePath);

    if (await exists(absolutePath)) {
      return {
        refImagePath: absolutePath,
        waitForJobId: null,
        status: "ready",
      };
    }
  }

  const pendingEndJob = useQueueStore.getState().jobs.find(
    (job) =>
      job.shotId === previousShot.id &&
      job.type === "image_end" &&
      (job.status === "active" || job.status === "queued"),
  );

  if (pendingEndJob) {
    return {
      refImagePath: null,
      waitForJobId: pendingEndJob.id,
      status: "waiting",
    };
  }

  return {
    refImagePath: null,
    waitForJobId: null,
    status: "needs_production",
  };
}

export async function waitForJob(jobId: string, timeoutMs = 300_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = useQueueStore.getState().jobs.find((item) => item.id === jobId);

    if (!job || job.status === "done") {
      return;
    }

    if (job.status === "error") {
      throw new Error(`Bagimli job basarisiz oldu: ${job.errorMsg ?? "unknown error"}`);
    }

    if (job.status === "cancelled") {
      throw new Error("Bagimli job iptal edildi.");
    }

    await sleep(1000);
  }

  throw new Error("Bagimli job bekleme zaman asimina ugradi.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
