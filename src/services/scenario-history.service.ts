import { getProjectDb } from "@/db/project-db";
import type { KlingPreset, ScenarioStatus, ShotPlan, TargetVideoModel } from "@/lib/scenario-types";

export interface ScenarioHistoryEntry {
  id: string;
  scenarioText: string;
  shotPlan: ShotPlan | null;
  targetModel: TargetVideoModel;
  klingPreset: KlingPreset | null;
  llmModel: string;
  status: ScenarioStatus;
  createdAt: number;
  updatedAt: number;
  totalMainShots: number | null;
  totalCoverageShots: number | null;
}

function parseShotPlan(value: string | null | undefined): ShotPlan | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as ShotPlan;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function listScenarioHistory(
  projectId: string,
  options?: { limit?: number },
): Promise<ScenarioHistoryEntry[]> {
  const db = await getProjectDb();
  const limit = Math.max(1, Math.min(50, options?.limit ?? 12));
  const rows = await db.select<Array<{
    id: string;
    scenarioText: string;
    shotPlanJson: string | null;
    targetModel: TargetVideoModel;
    klingPreset: KlingPreset | null;
    llmModel: string | null;
    status: ScenarioStatus;
    createdAt: number;
    updatedAt: number;
  }>>(
    `SELECT
       id,
       scenario_text AS scenarioText,
       shot_plan_json AS shotPlanJson,
       target_model AS targetModel,
       kling_preset AS klingPreset,
       llm_model AS llmModel,
       status,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM scenarios
     WHERE project_id = $1
     ORDER BY updated_at DESC, created_at DESC
     LIMIT $2`,
    [projectId, limit],
  );

  return rows.map((row) => {
    const shotPlan = parseShotPlan(row.shotPlanJson);

    return {
      id: row.id,
      scenarioText: row.scenarioText,
      shotPlan,
      targetModel: row.targetModel,
      klingPreset: row.klingPreset,
      llmModel: row.llmModel?.trim() || "openrouter/auto",
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      totalMainShots: shotPlan?.totalMainShots ?? null,
      totalCoverageShots: shotPlan?.totalCoverageShots ?? null,
    };
  });
}
