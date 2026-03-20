import { exists, remove } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { buildAssetDetachUpdates } from "@/lib/asset-detach";
import { splitAssetTags } from "@/lib/asset-tags";
import {
  getShotById,
  getShots,
  updateShotPaths,
} from "@/services/import.service";
import { syncActiveProjectPresentation } from "@/services/project-presentation.service";
import { useProjectStore } from "@/store/project.store";

export interface AssetInput {
  projectId: string;
  type: "image" | "video";
  filePath: string;
  filename: string;
  width?: number;
  height?: number;
  durationS?: number;
  resolution?: "HD" | "4K";
  modelUsed?: string;
  prompt?: string;
  costUsd?: number;
  falJobId?: string;
  shotId?: string;
  tags?: string[];
}

export interface AssetRecord {
  id: string;
  project_id: string;
  type: string;
  file_path: string;
  filename: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  resolution: string | null;
  model_used: string | null;
  prompt: string | null;
  cost_usd: number | null;
  fal_job_id: string | null;
  shot_id: string | null;
  tags: string | null;
  created_at: number;
}

export type AssetWithTags = AssetRecord & {
  tagsList: string[];
};

export interface AssetDeletionImpact {
  shotCount: number;
  slotCount: number;
  slotLabels: string[];
}

function parseAssetTags(tags: string | null): string[] {
  if (!tags) {
    return [];
  }

  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export async function saveAsset(input: AssetInput): Promise<string> {
  const db = await getProjectDb();
  const id = uuidv4();
  const now = Date.now();

  await db.execute(
    `INSERT INTO assets
      (id, project_id, type, file_path, filename, width, height,
       duration_s, resolution, model_used, prompt, cost_usd,
       fal_job_id, shot_id, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      id,
      input.projectId,
      input.type,
      input.filePath,
      input.filename,
      input.width ?? null,
      input.height ?? null,
      input.durationS ?? null,
      input.resolution ?? "HD",
      input.modelUsed ?? null,
      input.prompt ?? null,
      input.costUsd ?? 0,
      input.falJobId ?? null,
      input.shotId ?? null,
      JSON.stringify(input.tags ?? []),
      now,
    ],
  );

  await syncProjectDbMirror();
  return id;
}

export async function getAssets(
  projectId: string,
  type?: "image" | "video",
): Promise<AssetWithTags[]> {
  const db = await getProjectDb();
  const rows = type
    ? await db.select<AssetRecord[]>(
        `SELECT *
         FROM assets
         WHERE project_id = $1 AND type = $2
         ORDER BY created_at DESC`,
        [projectId, type],
      )
    : await db.select<AssetRecord[]>(
        `SELECT *
         FROM assets
         WHERE project_id = $1
         ORDER BY created_at DESC`,
        [projectId],
      );

  return rows.map((row) => ({
    ...row,
    tagsList: parseAssetTags(row.tags),
  }));
}

export async function getShotAssets(
  projectId: string,
  shotId: string,
  type?: "image" | "video",
): Promise<AssetWithTags[]> {
  const db = await getProjectDb();
  const rows = type
    ? await db.select<AssetRecord[]>(
        `SELECT *
         FROM assets
         WHERE project_id = $1 AND shot_id = $2 AND type = $3
         ORDER BY created_at DESC`,
        [projectId, shotId, type],
      )
    : await db.select<AssetRecord[]>(
        `SELECT *
         FROM assets
         WHERE project_id = $1 AND shot_id = $2
         ORDER BY created_at DESC`,
        [projectId, shotId],
      );

  return rows.map((row) => ({
    ...row,
    tagsList: parseAssetTags(row.tags),
  }));
}

export async function getAssetById(assetId: string): Promise<AssetWithTags | null> {
  const db = await getProjectDb();
  const rows = await db.select<AssetRecord[]>(
    `SELECT *
     FROM assets
     WHERE id = $1
     LIMIT 1`,
    [assetId],
  );

  const row = rows[0];
  return row
    ? {
        ...row,
        tagsList: parseAssetTags(row.tags),
      }
    : null;
}

export async function updateAssetTags(assetId: string, tags: string[]): Promise<void> {
  const db = await getProjectDb();
  await db.execute("UPDATE assets SET tags = $1 WHERE id = $2", [
    JSON.stringify(Array.from(new Set(tags))),
    assetId,
  ]);
  await syncProjectDbMirror();
}

export async function updateAssetUserTags(
  assetId: string,
  userTags: string[],
): Promise<void> {
  const asset = await getAssetById(assetId);

  if (!asset) {
    throw new Error("Asset bulunamadi.");
  }

  const { systemTags } = splitAssetTags(asset.tagsList);
  await updateAssetTags(assetId, [...systemTags, ...userTags]);
}

export async function setAssetShotId(assetId: string, shotId: string | null): Promise<void> {
  const db = await getProjectDb();
  await db.execute("UPDATE assets SET shot_id = $1 WHERE id = $2", [shotId, assetId]);
  await syncProjectDbMirror();
}

export async function assignAssetToShot(
  assetId: string,
  shotId: string,
  target: "start" | "end" | "video" | "reference",
): Promise<void> {
  const asset = await getAssetById(assetId);
  if (!asset) {
    throw new Error("Asset bulunamadi.");
  }

  const shot = await getShotById(shotId);
  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  await setAssetShotId(assetId, shotId);

  if (target === "reference") {
    await updateShotPaths(shotId, {
      externalReferencePath: asset.file_path,
    });
    return;
  }

  if (target === "start") {
    await updateShotPaths(shotId, {
      imageStartPath: asset.file_path,
      imageStatus: "done",
    });
    return;
  }

  if (target === "end") {
    await updateShotPaths(shotId, {
      imageEndPath: asset.file_path,
      imageStatus: "done",
    });
    return;
  }

  await updateShotPaths(shotId, {
    videoPath: asset.file_path,
    videoStatus: "done",
  });
}

export async function getAssetDeletionImpact(
  assetId: string,
): Promise<AssetDeletionImpact | null> {
  const asset = await getAssetById(assetId);
  if (!asset) {
    return null;
  }

  const project = useProjectStore.getState().activeProject;
  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const detachUpdates = buildAssetDetachUpdates(
    await getShots(project.id, { includeArchived: true }),
    asset.file_path,
  );

  return {
    shotCount: detachUpdates.length,
    slotCount: detachUpdates.reduce((total, update) => total + update.slots.length, 0),
    slotLabels: detachUpdates.flatMap((update) =>
      update.slots.map((slot) => `${update.shotNumber} ${slot.toUpperCase()}`),
    ),
  };
}

export async function deleteAssetRecord(assetId: string): Promise<AssetDeletionImpact | null> {
  const asset = await getAssetById(assetId);
  if (!asset) {
    return null;
  }

  const project = useProjectStore.getState().activeProject;
  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const detachUpdates = buildAssetDetachUpdates(
    await getShots(project.id, { includeArchived: true }),
    asset.file_path,
  );

  for (const detachUpdate of detachUpdates) {
    await updateShotPaths(detachUpdate.shotId, detachUpdate.updates);
  }

  const db = await getProjectDb();
  await db.execute("DELETE FROM assets WHERE id = $1", [assetId]);
  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
  const siblingRows = await db.select<Array<{ total: number }>>(
    "SELECT COUNT(*) AS total FROM assets WHERE file_path = $1",
    [asset.file_path],
  );
  const hasSiblingAsset = Number(siblingRows[0]?.total ?? 0) > 0;

  const absolutePath = await join(project.folderPath, ...asset.file_path.split(/[\\/]+/).filter(Boolean));
  if (!hasSiblingAsset && (await exists(absolutePath))) {
    await remove(absolutePath);
  }

  return {
    shotCount: detachUpdates.length,
    slotCount: detachUpdates.reduce((total, update) => total + update.slots.length, 0),
    slotLabels: detachUpdates.flatMap((update) =>
      update.slots.map((slot) => `${update.shotNumber} ${slot.toUpperCase()}`),
    ),
  };
}
