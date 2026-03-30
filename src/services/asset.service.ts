import { exists, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { buildAssetDetachUpdates } from "@/lib/asset-detach";
import { replaceAssetGroupTag, splitAssetTags } from "@/lib/asset-tags";
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
  metadata?: Record<string, unknown> | null;
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
  metadata_json: string | null;
  tags: string | null;
  created_at: number;
}

export type AssetWithTags = AssetRecord & {
  tagsList: string[];
  metadata: Record<string, unknown> | null;
};

export interface AssetDeletionImpact {
  shotCount: number;
  slotCount: number;
  slotLabels: string[];
  fileDeletePending?: boolean;
}

export interface BatchAssetDeletionImpact {
  deletedCount: number;
  slotCount: number;
  slotLabels: string[];
  fileDeletePending: boolean;
}

export interface ImportedProjectAsset {
  assetId: string;
  type: "image" | "video";
  relativePath: string;
  filename: string;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".mkv",
]);

function normalizeAssetPath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function removeAssetFileWithRetry(absolutePath: string, retries = 3): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (!(await exists(absolutePath))) {
      return;
    }

    try {
      await remove(absolutePath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function tryRemoveAssetFile(absolutePath: string): Promise<boolean> {
  try {
    await removeAssetFileWithRetry(absolutePath);
    return false;
  } catch (error) {
    console.warn("Failed to remove asset file after logical delete", {
      absolutePath,
      error,
    });
    return true;
  }
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

function parseAssetMetadata(metadataJson: string | null): Record<string, unknown> | null {
  if (!metadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getFileExtension(filePath: string): string {
  const match = /(\.[^./\\]+)$/.exec(filePath);
  return match?.[1]?.toLowerCase() ?? "";
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "asset";
}

function resolveImportedAssetType(filePath: string): "image" | "video" {
  const extension = getFileExtension(filePath);

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  throw new Error("Desteklenmeyen dosya tipi. Yalnizca image ve video dosyalari ice aktarilabilir.");
}

export async function saveAsset(input: AssetInput): Promise<string> {
  const db = await getProjectDb();
  const id = uuidv4();
  const now = Date.now();

  await db.execute(
    `INSERT INTO assets
      (id, project_id, type, file_path, filename, width, height,
       duration_s, resolution, model_used, prompt, cost_usd,
       fal_job_id, shot_id, metadata_json, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
      input.metadata ? JSON.stringify(input.metadata) : null,
      JSON.stringify(input.tags ?? []),
      now,
    ],
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
  return id;
}

export async function importProjectAsset(params: {
  sourcePath: string;
  type?: "image" | "video";
  shotId?: string;
  tags?: string[];
}): Promise<ImportedProjectAsset> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const assetType = params.type ?? resolveImportedAssetType(params.sourcePath);
  const originalFilename = params.sourcePath.split(/[\\/]/).pop() ?? "asset";
  const extension = getFileExtension(originalFilename);
  const baseName = extension
    ? originalFilename.slice(0, originalFilename.length - extension.length)
    : originalFilename;
  const targetFilename = `${sanitizeFilename(baseName)}_${uuidv4().slice(0, 8)}${extension}`;
  const targetFolder = assetType === "image" ? ["assets", "images"] : ["assets", "videos"];
  const relativePath = [...targetFolder, targetFilename].join("/");
  const absolutePath = await join(project.folderPath, ...targetFolder, targetFilename);

  await mkdir(await join(project.folderPath, ...targetFolder), { recursive: true });
  await writeFile(absolutePath, await readFile(params.sourcePath));

  const assetId = await saveAsset({
    projectId: project.id,
    type: assetType,
    filePath: relativePath,
    filename: targetFilename,
    shotId: params.shotId,
    modelUsed: "manual-import",
    costUsd: 0,
    tags: Array.from(new Set(["imported", ...(params.tags ?? [])])),
  });

  return {
    assetId,
    type: assetType,
    relativePath,
    filename: targetFilename,
  };
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
    metadata: parseAssetMetadata(row.metadata_json),
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
    metadata: parseAssetMetadata(row.metadata_json),
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
        metadata: parseAssetMetadata(row.metadata_json),
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

export async function updateAssetGroups(
  assetIds: string[],
  groupName: string | null,
): Promise<void> {
  const uniqueAssetIds = Array.from(new Set(assetIds.filter(Boolean)));

  if (uniqueAssetIds.length === 0) {
    return;
  }

  const db = await getProjectDb();
  const assets = await Promise.all(uniqueAssetIds.map((assetId) => getAssetById(assetId)));

  for (const asset of assets) {
    if (!asset) {
      continue;
    }

    await db.execute("UPDATE assets SET tags = $1 WHERE id = $2", [
      JSON.stringify(replaceAssetGroupTag(asset.tagsList, groupName)),
      asset.id,
    ]);
  }

  await syncProjectDbMirror();
}

export async function setAssetShotId(assetId: string, shotId: string | null): Promise<void> {
  const db = await getProjectDb();
  await db.execute("UPDATE assets SET shot_id = $1 WHERE id = $2", [shotId, assetId]);
  await syncProjectDbMirror();
}

export async function assignAssetToShot(
  assetId: string,
  shotId: string,
  target: "start" | "end" | "video" | "lipsync" | "reference",
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

  if (target === "lipsync") {
    await updateShotPaths(shotId, {
      lipsyncVideoPath: asset.file_path,
      lipsyncStatus: "done",
      lipsyncModelUsed: asset.model_used ?? "manual-assign",
      lipsyncCostUsd: asset.cost_usd ?? null,
      lipsyncError: null,
      lipsyncSourceVideoPath: null,
      lipsyncSourceAudioPath: null,
      lipsyncMetadataJson: asset.metadata_json,
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
    normalizeAssetPath(asset.file_path),
  );

  for (const detachUpdate of detachUpdates) {
    await updateShotPaths(detachUpdate.shotId, detachUpdate.updates);
  }

  const db = await getProjectDb();
  await db.execute("DELETE FROM assets WHERE id = $1", [assetId]);
  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
  const siblingRows = await db.select<Array<{ total: number }>>(
    "SELECT COUNT(*) AS total FROM assets WHERE REPLACE(file_path, '\\\\', '/') = $1",
    [normalizeAssetPath(asset.file_path)],
  );
  const hasSiblingAsset = Number(siblingRows[0]?.total ?? 0) > 0;

  const absolutePath = await join(
    project.folderPath,
    ...normalizeAssetPath(asset.file_path).split(/[\\/]+/).filter(Boolean),
  );
  let fileDeletePending = false;
  if (!hasSiblingAsset && (await exists(absolutePath))) {
    fileDeletePending = await tryRemoveAssetFile(absolutePath);
  }

  return {
    shotCount: detachUpdates.length,
    slotCount: detachUpdates.reduce((total, update) => total + update.slots.length, 0),
    slotLabels: detachUpdates.flatMap((update) =>
      update.slots.map((slot) => `${update.shotNumber} ${slot.toUpperCase()}`),
    ),
    fileDeletePending,
  };
}

export async function deleteAssetPath(assetPath: string): Promise<AssetDeletionImpact> {
  const project = useProjectStore.getState().activeProject;
  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const normalizedPath = normalizeAssetPath(assetPath);
  const detachUpdates = buildAssetDetachUpdates(
    await getShots(project.id, { includeArchived: true }),
    normalizedPath,
  );

  for (const detachUpdate of detachUpdates) {
    await updateShotPaths(detachUpdate.shotId, detachUpdate.updates);
  }

  const db = await getProjectDb();
  await db.execute(
    "DELETE FROM assets WHERE REPLACE(file_path, '\\\\', '/') = $1",
    [normalizedPath],
  );
  await syncProjectDbMirror();
  await syncActiveProjectPresentation();

  const absolutePath = await join(
    project.folderPath,
    ...normalizedPath.split(/[\\/]+/).filter(Boolean),
  );
  let fileDeletePending = false;
  if (await exists(absolutePath)) {
    fileDeletePending = await tryRemoveAssetFile(absolutePath);
  }

  return {
    shotCount: detachUpdates.length,
    slotCount: detachUpdates.reduce((total, update) => total + update.slots.length, 0),
    slotLabels: detachUpdates.flatMap((update) =>
      update.slots.map((slot) => `${update.shotNumber} ${slot.toUpperCase()}`),
    ),
    fileDeletePending,
  };
}

export async function deleteAssetsBatch(
  targets: Array<{
    assetId?: string | null;
    assetPath?: string | null;
  }>,
): Promise<BatchAssetDeletionImpact> {
  const processedAssetIds = new Set<string>();
  const processedPaths = new Set<string>();
  const slotLabels = new Set<string>();
  let deletedCount = 0;
  let fileDeletePending = false;

  for (const target of targets) {
    let impact: AssetDeletionImpact | null = null;

    if (target.assetId && !processedAssetIds.has(target.assetId)) {
      processedAssetIds.add(target.assetId);
      impact = await deleteAssetRecord(target.assetId);
    } else if (target.assetPath) {
      const normalizedPath = normalizeAssetPath(target.assetPath);
      if (!processedPaths.has(normalizedPath)) {
        processedPaths.add(normalizedPath);
        impact = await deleteAssetPath(normalizedPath);
      }
    }

    if (!impact) {
      continue;
    }

    deletedCount += 1;
    fileDeletePending ||= Boolean(impact.fileDeletePending);
    for (const slotLabel of impact.slotLabels) {
      slotLabels.add(slotLabel);
    }
  }

  return {
    deletedCount,
    slotCount: slotLabels.size,
    slotLabels: Array.from(slotLabels),
    fileDeletePending,
  };
}
