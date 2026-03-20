import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readFile, readTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { parseShot, type ParsedShot } from "@/lib/markdown-parser";
import { syncActiveProjectPresentation } from "@/services/project-presentation.service";
import { useProjectStore } from "@/store/project.store";

export interface ImportPreview {
  totalShots: number;
  coverageShots: number;
  chainLinks: number;
  parsedShotCount: number;
  files: string[];
}

export interface ShotRow {
  id: string;
  shotNumber: string;
  parentShotId: string | null;
  act: number | null;
  scene: number | null;
  shotType: string;
  cameraAngle: string | null;
  durationS: number | null;
  tensionLevel: number | null;
  chainStatus: string;
  prevShotId: string | null;
  promptStart: string | null;
  promptEnd: string | null;
  promptVideo: string | null;
  summaryTr: string | null;
  model: string | null;
  cfg: number | null;
  klingPreset: string | null;
  transitionMode: string | null;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  video4kPath: string | null;
  imageStatus: string;
  videoStatus: string;
  upscaleStatus: string;
  imageModelUsed: string | null;
  videoModelUsed: string | null;
  isArchived: boolean;
  requiresExternalReference: boolean;
  externalReferenceName: string | null;
  externalReferenceNotes: string | null;
  externalReferencePath: string | null;
  characterId: string | null;
  characterLookId: string | null;
  includeCharacterPrompt: boolean;
  sourceFile: string | null;
  createdAt: number;
  updatedAt: number;
}

const SHOT_SELECT_SQL = `SELECT
  id,
  shot_number AS shotNumber,
  parent_shot_id AS parentShotId,
  act,
  scene,
  shot_type AS shotType,
  camera_angle AS cameraAngle,
  duration_s AS durationS,
  tension_level AS tensionLevel,
  chain_status AS chainStatus,
  prev_shot_id AS prevShotId,
  prompt_start AS promptStart,
  prompt_end AS promptEnd,
  prompt_video AS promptVideo,
  summary_tr AS summaryTr,
  model,
  cfg,
  kling_preset AS klingPreset,
  transition_mode AS transitionMode,
  image_start_path AS imageStartPath,
  image_end_path AS imageEndPath,
  video_path AS videoPath,
  video_4k_path AS video4kPath,
  image_status AS imageStatus,
  video_status AS videoStatus,
  upscale_status AS upscaleStatus,
  COALESCE(
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'image'
        AND asset.file_path = shot.image_start_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    ),
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'image'
        AND asset.file_path = shot.image_end_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    )
  ) AS imageModelUsed,
  COALESCE(
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'video'
        AND asset.file_path = shot.video_4k_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    ),
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'video'
        AND asset.file_path = shot.video_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    )
  ) AS videoModelUsed,
  COALESCE(is_archived, 0) AS isArchived,
  COALESCE(requires_external_reference, 0) AS requiresExternalReference,
  external_reference_name AS externalReferenceName,
  external_reference_notes AS externalReferenceNotes,
  external_reference_path AS externalReferencePath,
  character_id AS characterId,
  character_look_id AS characterLookId,
  COALESCE(include_character_prompt, 1) AS includeCharacterPrompt,
  source_file AS sourceFile,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM shots shot`;

export type StoryboardReferenceMode = "start" | "end" | "coverage";
export type ShotMediaAssignmentTarget =
  | "start"
  | "end"
  | "video"
  | "external-reference";

export async function previewImport(outputsFolder: string): Promise<ImportPreview> {
  const files = await collectMdFiles(outputsFolder);
  let totalShots = 0;
  let coverageShots = 0;
  let chainLinks = 0;
  let parsedShotCount = 0;

  for (const file of files) {
    const raw = await readTextFile(file);
    const parsedShots = parseShot(raw, file);
    parsedShotCount += parsedShots.length;

    for (const shot of parsedShots) {
      if (shot.parentShotNum) {
        coverageShots += 1;
      } else {
        totalShots += 1;
      }

      if (shot.chainStatus === "continue") {
        chainLinks += 1;
      }
    }
  }

  return {
    totalShots,
    coverageShots,
    chainLinks,
    parsedShotCount,
    files,
  };
}

export async function executeImport(outputsFolder: string): Promise<void> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const db = await getProjectDb();
  const files = await collectMdFiles(outputsFolder);
  const now = Date.now();
  const parsedShots: ParsedShot[] = [];

  for (const file of files) {
    const raw = await readTextFile(file);
    parsedShots.push(...parseShot(raw, file));
  }

  if (files.length === 0) {
    throw new Error("Secilen klasorde SHOT*.md dosyasi bulunamadi.");
  }

  if (parsedShots.length === 0) {
    throw new Error(
      "Markdown dosyalari bulundu ama hicbir shot parse edilemedi. Film-kit formatini kontrol edin.",
    );
  }

  const existingShots = await getShots(project.id, { includeArchived: true });
  const existingByShotNumber = new Map(
    existingShots.map((shot) => [shot.shotNumber.toUpperCase(), shot] as const),
  );
  const persistedIdsByShotNumber = new Map<string, string>();

  for (const shot of parsedShots) {
    const existingShot = existingByShotNumber.get(shot.shotNumber.toUpperCase());
    persistedIdsByShotNumber.set(
      shot.shotNumber.toUpperCase(),
      existingShot?.id ?? uuidv4(),
    );
  }

  await db.execute("DELETE FROM shots WHERE project_id = $1", [project.id]);

  for (const shot of parsedShots) {
    const existingShot = existingByShotNumber.get(shot.shotNumber.toUpperCase());
    const sharedExternalReferencePath =
      shot.externalReferenceName
        ? existingShots.find(
            (candidate) =>
              candidate.externalReferenceName?.toLowerCase() ===
                shot.externalReferenceName?.toLowerCase() &&
              Boolean(candidate.externalReferencePath),
          )?.externalReferencePath ?? null
        : null;
    const id = persistedIdsByShotNumber.get(shot.shotNumber.toUpperCase()) ?? uuidv4();
    const parentId = shot.parentShotNum
      ? (persistedIdsByShotNumber.get(shot.parentShotNum.toUpperCase()) ?? null)
      : null;
    const prevShotId = shot.prevShotRef
      ? (persistedIdsByShotNumber.get(shot.prevShotRef.toUpperCase()) ?? null)
      : null;

    await db.execute(
      `INSERT INTO shots (
        id, project_id, shot_number, parent_shot_id,
        act, scene, shot_type, camera_angle,
        duration_s, tension_level, chain_status, prev_shot_id,
        prompt_start, prompt_end, prompt_video, summary_tr,
        model, cfg, kling_preset, transition_mode,
        requires_external_reference, external_reference_name, external_reference_notes,
        external_reference_path, character_id, character_look_id, include_character_prompt,
        image_start_path, image_end_path, video_path, video_4k_path,
        image_status, video_status, upscale_status,
        is_archived, source_file, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38
      )`,
      [
        id,
        project.id,
        shot.shotNumber,
        parentId,
        shot.act,
        shot.scene,
        shot.shotType,
        shot.cameraAngle,
        shot.durationS,
        shot.tensionLevel,
        shot.chainStatus,
        prevShotId,
        shot.promptStart,
        shot.promptEnd,
        shot.promptVideo,
        shot.summaryTr,
        shot.model,
        shot.cfg,
        shot.klingPreset,
        shot.transitionMode,
        shot.requiresExternalReference ? 1 : 0,
        shot.externalReferenceName,
        shot.externalReferenceNotes,
        existingShot?.externalReferencePath ?? sharedExternalReferencePath ?? null,
        existingShot?.characterId ?? null,
        existingShot?.characterLookId ?? null,
        existingShot?.includeCharacterPrompt ? 1 : 0,
        existingShot?.imageStartPath ?? null,
        existingShot?.imageEndPath ?? null,
        existingShot?.videoPath ?? null,
        existingShot?.video4kPath ?? null,
        existingShot?.imageStatus ?? "pending",
        existingShot?.videoStatus ?? "pending",
        existingShot?.upscaleStatus ?? "none",
        existingShot?.isArchived ? 1 : 0,
        shot.sourceFile,
        existingShot?.createdAt ?? now,
        now,
      ],
    );
  }

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function getShots(
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<ShotRow[]> {
  const db = await getProjectDb();
  const includeArchived = options?.includeArchived ?? false;
  return db.select<ShotRow[]>(
    `${SHOT_SELECT_SQL}
     WHERE shot.project_id = $1
       ${includeArchived ? "" : "AND COALESCE(shot.is_archived, 0) = 0"}
     ORDER BY shot.act, shot.scene, shot.shot_number`,
    [projectId],
  );
}

export async function getShotById(shotId: string): Promise<ShotRow | null> {
  const db = await getProjectDb();
  const rows = await db.select<ShotRow[]>(
    `${SHOT_SELECT_SQL}
     WHERE shot.id = $1
     LIMIT 1`,
    [shotId],
  );
  return rows[0] ?? null;
}

export async function updateShotPaths(
  shotId: string,
  updates: Partial<{
    imageStartPath: string | null;
    imageEndPath: string | null;
    videoPath: string | null;
    video4kPath: string | null;
    externalReferencePath: string | null;
    imageStatus: string;
    videoStatus: string;
    upscaleStatus: string;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const setClauses: string[] = ["updated_at = $1"];
  const values: unknown[] = [Date.now()];
  let parameterIndex = values.length + 1;

  if (updates.imageStartPath !== undefined) {
    setClauses.push(`image_start_path = $${parameterIndex}`);
    values.push(updates.imageStartPath);
    parameterIndex += 1;
  }

  if (updates.imageEndPath !== undefined) {
    setClauses.push(`image_end_path = $${parameterIndex}`);
    values.push(updates.imageEndPath);
    parameterIndex += 1;
  }

  if (updates.videoPath !== undefined) {
    setClauses.push(`video_path = $${parameterIndex}`);
    values.push(updates.videoPath);
    parameterIndex += 1;
  }

  if (updates.video4kPath !== undefined) {
    setClauses.push(`video_4k_path = $${parameterIndex}`);
    values.push(updates.video4kPath);
    parameterIndex += 1;
  }

  if (updates.externalReferencePath !== undefined) {
    setClauses.push(`external_reference_path = $${parameterIndex}`);
    values.push(updates.externalReferencePath);
    parameterIndex += 1;
  }

  if (updates.imageStatus !== undefined) {
    setClauses.push(`image_status = $${parameterIndex}`);
    values.push(updates.imageStatus);
    parameterIndex += 1;
  }

  if (updates.videoStatus !== undefined) {
    setClauses.push(`video_status = $${parameterIndex}`);
    values.push(updates.videoStatus);
    parameterIndex += 1;
  }

  if (updates.upscaleStatus !== undefined) {
    setClauses.push(`upscale_status = $${parameterIndex}`);
    values.push(updates.upscaleStatus);
    parameterIndex += 1;
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${setClauses.join(", ")}
     WHERE id = $${parameterIndex}`,
    values,
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function updateShotPromptFields(
  shotId: string,
  updates: Partial<{
    promptStart: string | null;
    promptEnd: string | null;
    promptVideo: string | null;
    model: string | null;
    cfg: number | null;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const clauses = ["updated_at = $1"];
  const values: Array<string | number | null> = [Date.now()];

  if (updates.promptStart !== undefined) {
    clauses.push(`prompt_start = $${values.length + 1}`);
    values.push(updates.promptStart);
  }

  if (updates.promptEnd !== undefined) {
    clauses.push(`prompt_end = $${values.length + 1}`);
    values.push(updates.promptEnd);
  }

  if (updates.promptVideo !== undefined) {
    clauses.push(`prompt_video = $${values.length + 1}`);
    values.push(updates.promptVideo);
  }

  if (updates.model !== undefined) {
    clauses.push(`model = $${values.length + 1}`);
    values.push(updates.model);
  }

  if (updates.cfg !== undefined) {
    clauses.push(`cfg = $${values.length + 1}`);
    values.push(updates.cfg);
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${clauses.join(", ")}
     WHERE id = $${values.length}`,
    values,
  );

  await syncProjectDbMirror();
}

export async function updateShotCharacterBinding(
  shotId: string,
  updates: Partial<{
    characterId: string | null;
    characterLookId: string | null;
    includeCharacterPrompt: boolean;
    externalReferencePath: string | null;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const clauses = ["updated_at = $1"];
  const values: Array<string | number | null> = [Date.now()];

  if (updates.characterId !== undefined) {
    clauses.push(`character_id = $${values.length + 1}`);
    values.push(updates.characterId);
  }

  if (updates.characterLookId !== undefined) {
    clauses.push(`character_look_id = $${values.length + 1}`);
    values.push(updates.characterLookId);
  }

  if (updates.includeCharacterPrompt !== undefined) {
    clauses.push(`include_character_prompt = $${values.length + 1}`);
    values.push(updates.includeCharacterPrompt ? 1 : 0);
  }

  if (updates.externalReferencePath !== undefined) {
    clauses.push(`external_reference_path = $${values.length + 1}`);
    values.push(updates.externalReferencePath);
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${clauses.join(", ")}
     WHERE id = $${values.length}`,
    values,
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function assignShotMediaPath(
  shotId: string,
  target: ShotMediaAssignmentTarget,
  filePath: string | null,
): Promise<void> {
  if (target === "start") {
    await updateShotPaths(shotId, {
      imageStartPath: filePath,
      imageStatus: filePath ? "done" : "pending",
    });
    return;
  }

  if (target === "end") {
    await updateShotPaths(shotId, {
      imageEndPath: filePath,
      imageStatus: filePath ? "done" : "pending",
    });
    return;
  }

  if (target === "video") {
    await updateShotPaths(shotId, {
      videoPath: filePath,
      videoStatus: filePath ? "done" : "pending",
    });
    return;
  }

  await updateShotExternalReferencePath(shotId, filePath);
}

export async function setShotArchived(
  shotId: string,
  archived: boolean,
): Promise<void> {
  const db = await getProjectDb();
  const timestamp = Date.now();

  await db.execute(
    `UPDATE shots
     SET is_archived = $1, updated_at = $2
     WHERE id = $3 OR parent_shot_id = $3`,
    [archived ? 1 : 0, timestamp, shotId],
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export function shotNeedsExternalReferenceForMode(
  shot: Pick<
    ShotRow,
    "requiresExternalReference" | "externalReferencePath" | "chainStatus"
  >,
  mode: StoryboardReferenceMode,
): boolean {
  if (!shot.requiresExternalReference || shot.externalReferencePath) {
    return false;
  }

  if (mode === "start" && shot.chainStatus === "continue") {
    return false;
  }

  return true;
}

export function getShotMissingExternalReferenceMessage(
  shot: Pick<
    ShotRow,
    "shotNumber" | "requiresExternalReference" | "externalReferencePath" | "chainStatus" | "externalReferenceName"
  >,
  mode: StoryboardReferenceMode,
): string | null {
  if (!shotNeedsExternalReferenceForMode(shot, mode)) {
    return null;
  }

  const expectedName = shot.externalReferenceName
    ? ` (${shot.externalReferenceName})`
    : "";
  return `${shot.shotNumber} icin harici referans gorseli${expectedName} gerekli. Once detay modalinden yukleyin.`;
}

export async function saveShotExternalReference(
  shotId: string,
  sourcePath: string,
): Promise<string> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const sourceBytes = await readFile(sourcePath);
  const originalFileName = sourcePath.split(/[\\/]/).pop() ?? "reference-image";
  const canonicalFileName = shot.externalReferenceName ?? originalFileName;
  const sanitizedFileName = canonicalFileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const targetFileName = sanitizedFileName;
  const targetRelativePath = `assets/references/${targetFileName}`;
  const targetAbsolutePath = await join(project.folderPath, "assets", "references", targetFileName);

  await mkdir(await join(project.folderPath, "assets", "references"), {
    recursive: true,
  });
  await writeFile(targetAbsolutePath, sourceBytes);

  await updateShotExternalReferencePath(shotId, targetRelativePath);

  if (shot.externalReferenceName) {
    await propagateSharedExternalReferencePath(
      project.id,
      shot.externalReferenceName,
      targetRelativePath,
    );
  }

  return targetRelativePath;
}

export async function clearShotExternalReference(shotId: string): Promise<void> {
  await updateShotExternalReferencePath(shotId, null);
}

export async function resolveShotExternalReferencePath(shot: Pick<ShotRow, "externalReferencePath">): Promise<string | undefined> {
  const project = useProjectStore.getState().activeProject;

  if (!project || !shot.externalReferencePath) {
    return undefined;
  }

  const absolutePath = await join(
    project.folderPath,
    ...shot.externalReferencePath.split(/[\\/]+/).filter(Boolean),
  );

  return (await exists(absolutePath)) ? absolutePath : undefined;
}

async function updateShotExternalReferencePath(
  shotId: string,
  externalReferencePath: string | null,
): Promise<void> {
  await updateShotPaths(shotId, { externalReferencePath });
}

export async function setShotExternalReferencePath(
  shotId: string,
  externalReferencePath: string | null,
): Promise<void> {
  await updateShotExternalReferencePath(shotId, externalReferencePath);
}

export async function assignAssetToShotMedia(
  shotId: string,
  mode: "start" | "end" | "video",
  relativePath: string | null,
): Promise<void> {
  if (mode === "start") {
    await updateShotPaths(shotId, {
      imageStartPath: relativePath,
      imageStatus: relativePath ? "done" : "pending",
    });
    return;
  }

  if (mode === "end") {
    await updateShotPaths(shotId, {
      imageEndPath: relativePath,
      imageStatus: relativePath ? "done" : "pending",
    });
    return;
  }

  await updateShotPaths(shotId, {
    videoPath: relativePath,
    videoStatus: relativePath ? "done" : "pending",
  });
}

export async function assignShotExternalReferencePath(
  shotId: string,
  relativePath: string | null,
): Promise<void> {
  await updateShotExternalReferencePath(shotId, relativePath);
}

async function propagateSharedExternalReferencePath(
  projectId: string,
  externalReferenceName: string,
  externalReferencePath: string,
): Promise<void> {
  const db = await getProjectDb();
  await db.execute(
    `UPDATE shots
     SET external_reference_path = $1, updated_at = $2
     WHERE project_id = $3
       AND lower(COALESCE(external_reference_name, '')) = $4`,
    [externalReferencePath, Date.now(), projectId, externalReferenceName.toLowerCase()],
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readDir(currentDir);

    for (const entry of entries) {
      const entryPath =
        "path" in entry && typeof (entry as { path?: string }).path === "string"
          ? (entry as { path: string }).path
          : await join(currentDir, entry.name);

      if (entry.isDirectory) {
        await walk(entryPath);
      } else if (entry.isFile && /^SHOT.*\.md$/i.test(entry.name)) {
        results.push(entryPath);
      }
    }
  }

  await walk(dir);
  return results.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
