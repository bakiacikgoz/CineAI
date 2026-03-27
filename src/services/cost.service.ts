import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";

export interface CostInput {
  projectId?: string;
  jobId?: string;
  model: string;
  type: "image" | "video" | "upscale" | "llm" | "tts";
  amountUsd: number;
  units?: number;
}

export async function logCost(input: CostInput): Promise<void> {
  const db = await getProjectDb();

  await db.execute(
    `INSERT INTO cost_logs
      (id, project_id, job_id, model, type, amount_usd, units, logged_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuidv4(),
      input.projectId ?? null,
      input.jobId ?? null,
      input.model,
      input.type,
      input.amountUsd,
      input.units ?? null,
      Date.now(),
    ],
  );

  await syncProjectDbMirror();
}
