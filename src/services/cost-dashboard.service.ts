import { getProjectDb } from "@/db/project-db";
import { useProjectStore } from "@/store/project.store";

export type CostRange = "7d" | "30d" | "90d" | "all";

export interface CostFilters {
  range: CostRange;
}

export interface CostOverview {
  range: CostRange;
  totalUsd: number;
  imageUsd: number;
  videoUsd: number;
  lipsyncUsd: number;
  upscaleUsd: number;
  llmUsd: number;
  ttsUsd: number;
  assetBackedUsd: number;
  avgDailyUsd: number;
  spendDays: number;
  byModel: Array<{ model: string; totalUsd: number; count: number }>;
  byType: Array<{ type: string; totalUsd: number; count: number }>;
  byShot: Array<{ shotNumber: string; totalUsd: number; count: number }>;
  daily: Array<{ day: string; totalUsd: number }>;
  recentLogs: CostLogRow[];
}

type AggregateRow = {
  key: string;
  totalUsd: number;
  count: number;
};

export interface CostLogRow {
  id: string;
  model: string;
  type: string;
  amountUsd: number;
  units: number | null;
  loggedAt: number;
  shotNumber: string | null;
  assetFilename: string | null;
}

function getRangeStart(range: CostRange): number | null {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (range === "7d") {
    return now - 7 * oneDayMs;
  }

  if (range === "30d") {
    return now - 30 * oneDayMs;
  }

  if (range === "90d") {
    return now - 90 * oneDayMs;
  }

  return null;
}

function buildCostWhereClause(projectId: string, range: CostRange): {
  whereSql: string;
  params: Array<string | number>;
} {
  const params: Array<string | number> = [projectId];
  const since = getRangeStart(range);
  const clauses = ["cost_logs.project_id = $1"];

  if (since !== null) {
    clauses.push(`cost_logs.logged_at >= $${params.length + 1}`);
    params.push(since);
  }

  return {
    whereSql: clauses.join(" AND "),
    params,
  };
}

function buildShotNumberExpression() {
  return `COALESCE(
    (SELECT shots.shot_number FROM shots WHERE shots.id = job_queue.shot_id LIMIT 1),
    (
      SELECT shots.shot_number
      FROM shots
      WHERE shots.id = (
        SELECT assets.shot_id
        FROM assets
        WHERE assets.id = cost_logs.job_id
           OR assets.fal_job_id = cost_logs.job_id
        ORDER BY assets.created_at DESC
        LIMIT 1
      )
      LIMIT 1
    ),
    'Unassigned'
  )`;
}

function buildAssetFilenameExpression() {
  return `(
    SELECT assets.filename
    FROM assets
    WHERE assets.id = cost_logs.job_id
       OR assets.fal_job_id = cost_logs.job_id
    ORDER BY assets.created_at DESC
    LIMIT 1
  )`;
}

export async function getCostOverview(
  filters: CostFilters = { range: "30d" },
): Promise<CostOverview> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const db = await getProjectDb();
  const { whereSql, params } = buildCostWhereClause(project.id, filters.range);
  const shotNumberExpression = buildShotNumberExpression();
  const assetFilenameExpression = buildAssetFilenameExpression();
  const [totalsRow] = await db.select<Array<{
    totalUsd: number | null;
    imageUsd: number | null;
    videoUsd: number | null;
    lipsyncUsd: number | null;
    upscaleUsd: number | null;
    llmUsd: number | null;
    ttsUsd: number | null;
    assetBackedUsd: number | null;
  }>>(
    `SELECT
       COALESCE(SUM(amount_usd), 0) AS totalUsd,
       COALESCE(SUM(CASE WHEN type = 'image' THEN amount_usd ELSE 0 END), 0) AS imageUsd,
       COALESCE(SUM(CASE WHEN type = 'video' THEN amount_usd ELSE 0 END), 0) AS videoUsd,
       COALESCE(SUM(CASE WHEN type = 'lipsync' THEN amount_usd ELSE 0 END), 0) AS lipsyncUsd,
       COALESCE(SUM(CASE WHEN type = 'upscale' THEN amount_usd ELSE 0 END), 0) AS upscaleUsd,
       COALESCE(SUM(CASE WHEN type = 'llm' THEN amount_usd ELSE 0 END), 0) AS llmUsd,
       COALESCE(SUM(CASE WHEN type = 'tts' THEN amount_usd ELSE 0 END), 0) AS ttsUsd,
       COALESCE(SUM(CASE
         WHEN EXISTS (
           SELECT 1
           FROM assets
           WHERE assets.id = cost_logs.job_id
              OR assets.fal_job_id = cost_logs.job_id
         )
         THEN amount_usd
         ELSE 0
       END), 0) AS assetBackedUsd
     FROM cost_logs
     WHERE ${whereSql}`,
    params,
  );

  const byModelRows = await db.select<AggregateRow[]>(
    `SELECT
       model AS key,
       SUM(amount_usd) AS totalUsd,
       COUNT(*) AS count
     FROM cost_logs
     WHERE ${whereSql}
     GROUP BY model
     ORDER BY totalUsd DESC`,
    params,
  );

  const byTypeRows = await db.select<AggregateRow[]>(
    `SELECT
       type AS key,
       SUM(amount_usd) AS totalUsd,
       COUNT(*) AS count
     FROM cost_logs
     WHERE ${whereSql}
     GROUP BY type
     ORDER BY totalUsd DESC`,
    params,
  );

  const byShotRows = await db.select<Array<{
    shotNumber: string;
    totalUsd: number;
    count: number;
  }>>(
    `SELECT
       ${shotNumberExpression} AS shotNumber,
       SUM(cost_logs.amount_usd) AS totalUsd,
       COUNT(*) AS count
     FROM cost_logs
     LEFT JOIN job_queue ON job_queue.id = cost_logs.job_id
     WHERE ${whereSql}
     GROUP BY ${shotNumberExpression}
     ORDER BY totalUsd DESC`,
    params,
  );

  const dailyRows = await db.select<Array<{ day: string; totalUsd: number }>>(
    `SELECT
       strftime('%Y-%m-%d', logged_at / 1000, 'unixepoch', 'localtime') AS day,
       SUM(amount_usd) AS totalUsd
     FROM cost_logs
     WHERE ${whereSql}
     GROUP BY day
     ORDER BY day ASC`,
    params,
  );

  const recentLogs = await db.select<CostLogRow[]>(
    `SELECT
       cost_logs.id AS id,
       cost_logs.model AS model,
       cost_logs.type AS type,
       cost_logs.amount_usd AS amountUsd,
       cost_logs.units AS units,
       cost_logs.logged_at AS loggedAt,
       NULLIF(${shotNumberExpression}, 'Unassigned') AS shotNumber,
       ${assetFilenameExpression} AS assetFilename
     FROM cost_logs
     LEFT JOIN job_queue ON job_queue.id = cost_logs.job_id
     WHERE ${whereSql}
     ORDER BY cost_logs.logged_at DESC
     LIMIT 16`,
    params,
  );

  const spendDays = dailyRows.length;
  const avgDailyUsd =
    spendDays > 0 ? (totalsRow?.totalUsd ?? 0) / spendDays : 0;

  return {
    range: filters.range,
    totalUsd: totalsRow?.totalUsd ?? 0,
    imageUsd: totalsRow?.imageUsd ?? 0,
    videoUsd: totalsRow?.videoUsd ?? 0,
    lipsyncUsd: totalsRow?.lipsyncUsd ?? 0,
    upscaleUsd: totalsRow?.upscaleUsd ?? 0,
    llmUsd: totalsRow?.llmUsd ?? 0,
    ttsUsd: totalsRow?.ttsUsd ?? 0,
    assetBackedUsd: totalsRow?.assetBackedUsd ?? 0,
    avgDailyUsd,
    spendDays,
    byModel: byModelRows.map((row) => ({
      model: row.key,
      totalUsd: row.totalUsd,
      count: row.count,
    })),
    byType: byTypeRows.map((row) => ({
      type: row.key,
      totalUsd: row.totalUsd,
      count: row.count,
    })),
    byShot: byShotRows,
    daily: dailyRows,
    recentLogs,
  };
}

export function exportCostOverviewCsv(overview: CostOverview): string {
  const header = [
    "section",
    "label",
    "count",
    "amount_usd",
    "units",
    "date",
    "shot",
    "asset",
  ];

  const rows: string[][] = [header];

  rows.push(["summary", "total", "", overview.totalUsd.toFixed(4), "", "", "", ""]);
  rows.push(["summary", "image", "", overview.imageUsd.toFixed(4), "", "", "", ""]);
  rows.push(["summary", "video", "", overview.videoUsd.toFixed(4), "", "", "", ""]);
  rows.push(["summary", "lipsync", "", overview.lipsyncUsd.toFixed(4), "", "", "", ""]);
  rows.push(["summary", "upscale", "", overview.upscaleUsd.toFixed(4), "", "", "", ""]);
  rows.push(["summary", "llm", "", overview.llmUsd.toFixed(4), "", "", "", ""]);

  overview.byModel.forEach((row) => {
    rows.push(["by_model", row.model, String(row.count), row.totalUsd.toFixed(4), "", "", "", ""]);
  });

  overview.byType.forEach((row) => {
    rows.push(["by_type", row.type, String(row.count), row.totalUsd.toFixed(4), "", "", "", ""]);
  });

  overview.byShot.forEach((row) => {
    rows.push(["by_shot", row.shotNumber, String(row.count), row.totalUsd.toFixed(4), "", "", "", ""]);
  });

  overview.daily.forEach((row) => {
    rows.push(["daily", "", "", row.totalUsd.toFixed(4), "", row.day, "", ""]);
  });

  overview.recentLogs.forEach((row) => {
    rows.push([
      "recent_logs",
      row.model,
      "",
      row.amountUsd.toFixed(4),
      row.units == null ? "" : String(row.units),
      new Date(row.loggedAt).toISOString(),
      row.shotNumber ?? "",
      row.assetFilename ?? "",
    ]);
  });

  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).split('"').join('""')}"`)
        .join(","),
    )
    .join("\n");
}
