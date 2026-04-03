import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  getEffectiveShotExternalReferencePath,
  type ShotRow,
} from "@/services/import.service";
import { resolveShotCharacterContext } from "@/services/character.service";
import { useProjectStore } from "@/store/project.store";

export interface StoryboardExportResult {
  rootPath: string;
  shotCount: number;
  copiedFileCount: number;
  skippedFileCount: number;
}

export interface StoryboardExportOptions {
  includeMainShots: boolean;
  includeCoverageShots: boolean;
  includeVideos: boolean;
  includeAudio: boolean;
  includeVisuals: boolean;
  includeCharacters: boolean;
}

export const DEFAULT_STORYBOARD_EXPORT_OPTIONS: StoryboardExportOptions = {
  includeMainShots: true,
  includeCoverageShots: true,
  includeVideos: true,
  includeAudio: true,
  includeVisuals: true,
  includeCharacters: true,
};

export function hasStoryboardExportShotSelection(
  options: Pick<StoryboardExportOptions, "includeMainShots" | "includeCoverageShots">,
): boolean {
  return options.includeMainShots || options.includeCoverageShots;
}

export function hasStoryboardExportContentSelection(
  options: Pick<
    StoryboardExportOptions,
    "includeVideos" | "includeAudio" | "includeVisuals" | "includeCharacters"
  >,
): boolean {
  return (
    options.includeVideos ||
    options.includeAudio ||
    options.includeVisuals ||
    options.includeCharacters
  );
}

export function resolveStoryboardExportShots<
  TShot extends Pick<ShotRow, "parentShotId">,
>(
  shots: TShot[],
  options: Pick<StoryboardExportOptions, "includeMainShots" | "includeCoverageShots">,
): TShot[] {
  return shots.filter((shot) =>
    shot.parentShotId ? options.includeCoverageShots : options.includeMainShots,
  );
}

function normalizePathLikeValue(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

export function sanitizeExportSegment(value: string, fallback = "untitled"): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return normalized || fallback;
}

export function buildStoryboardExportFolderName(
  projectName: string,
  timestamp = Date.now(),
): string {
  const date = new Date(timestamp);
  const stamp = [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");

  return `${sanitizeExportSegment(projectName, "project")}_storyboard_export_${stamp}`;
}

function buildLabeledFilename(label: string, sourcePath: string): string {
  const filename = normalizePathLikeValue(sourcePath).split("/").pop() ?? "asset";
  return `${label}_${filename}`;
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function resolveProjectRelativeAbsolutePath(
  projectFolderPath: string,
  relativePath: string | null | undefined,
): Promise<string | null> {
  if (!relativePath) {
    return null;
  }

  const normalized = normalizePathLikeValue(relativePath);

  if (!normalized) {
    return null;
  }

  return join(projectFolderPath, ...normalized.split("/").filter(Boolean));
}

async function copyAbsoluteFile(
  sourcePath: string | null,
  destinationPath: string,
): Promise<boolean> {
  if (!sourcePath) {
    return false;
  }

  if (!(await exists(sourcePath))) {
    return false;
  }

  const bytes = await readFile(sourcePath);
  await writeFile(destinationPath, bytes, { create: true });
  return true;
}

async function copyProjectRelativeFile(
  projectFolderPath: string,
  relativePath: string | null | undefined,
  destinationPath: string,
): Promise<boolean> {
  const sourcePath = await resolveProjectRelativeAbsolutePath(projectFolderPath, relativePath);
  return copyAbsoluteFile(sourcePath, destinationPath);
}

async function buildUniqueExportRootPath(
  destinationDirectory: string,
  folderName: string,
): Promise<string> {
  let candidatePath = await join(destinationDirectory, folderName);

  if (!(await exists(candidatePath))) {
    return candidatePath;
  }

  let suffix = 2;

  while (true) {
    candidatePath = await join(destinationDirectory, `${folderName}_${suffix}`);

    if (!(await exists(candidatePath))) {
      return candidatePath;
    }

    suffix += 1;
  }
}

async function copyCharacterReferencesForShot(params: {
  shot: ShotRow;
  shotFolder: string;
  projectFolderPath: string;
}): Promise<{ copied: number; skipped: number }> {
  const characterContext = await resolveShotCharacterContext({
    characterId: params.shot.characterId,
    characterLookId: params.shot.characterLookId,
  });

  if (!characterContext) {
    return { copied: 0, skipped: 0 };
  }

  const characterFolder = await join(
    params.shotFolder,
    "characters",
    sanitizeExportSegment(characterContext.character.name, "character"),
  );
  await ensureDirectory(characterFolder);

  let copied = 0;
  let skipped = 0;
  const seenRelativePaths = new Set<string>();

  const primaryRelativePath = characterContext.look.primaryImage
    ? normalizePathLikeValue(characterContext.look.primaryImage)
    : null;

  if (primaryRelativePath) {
    const destinationPath = await join(
      characterFolder,
      buildLabeledFilename("primary", primaryRelativePath),
    );
    if (
      await copyProjectRelativeFile(
        params.projectFolderPath,
        primaryRelativePath,
        destinationPath,
      )
    ) {
      copied += 1;
      seenRelativePaths.add(primaryRelativePath);
    } else {
      skipped += 1;
    }
  }

  let referenceIndex = 1;
  for (const referencePath of characterContext.look.refImages) {
    const normalized = normalizePathLikeValue(referencePath);

    if (!normalized || seenRelativePaths.has(normalized)) {
      continue;
    }

    const destinationPath = await join(
      characterFolder,
      buildLabeledFilename(`reference_${String(referenceIndex).padStart(2, "0")}`, normalized),
    );
    if (await copyProjectRelativeFile(params.projectFolderPath, normalized, destinationPath)) {
      copied += 1;
    } else {
      skipped += 1;
    }

    seenRelativePaths.add(normalized);
    referenceIndex += 1;
  }

  return { copied, skipped };
}

export async function exportStoryboardShotsBundle(params: {
  destinationDirectory: string;
  shots: ShotRow[];
  referenceLookupShots?: ShotRow[];
  options?: Partial<StoryboardExportOptions>;
}): Promise<StoryboardExportResult> {
  const project = useProjectStore.getState().activeProject;
  const options: StoryboardExportOptions = {
    ...DEFAULT_STORYBOARD_EXPORT_OPTIONS,
    ...params.options,
  };

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  if (!hasStoryboardExportShotSelection(options)) {
    throw new Error("En az bir shot tipi secmelisin.");
  }

  if (!hasStoryboardExportContentSelection(options)) {
    throw new Error("En az bir icerik kategorisi secmelisin.");
  }

  const exportableShots = resolveStoryboardExportShots(params.shots, options);

  if (exportableShots.length === 0) {
    throw new Error("Secilen filtrelerle export edilecek shot bulunamadi.");
  }

  const sortedShots = exportableShots
    .slice()
    .sort((left, right) =>
      left.shotNumber.localeCompare(right.shotNumber, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

  const rootFolderName = buildStoryboardExportFolderName(project.name);
  const rootPath = await buildUniqueExportRootPath(params.destinationDirectory, rootFolderName);
  await ensureDirectory(rootPath);

  let copiedFileCount = 0;
  let skippedFileCount = 0;

  for (const shot of sortedShots) {
    const shotFolder = await join(rootPath, sanitizeExportSegment(shot.shotNumber, shot.id));
    await ensureDirectory(shotFolder);

    const videoFolder = options.includeVideos ? await join(shotFolder, "video") : null;
    const audioFolder = options.includeAudio ? await join(shotFolder, "audio") : null;
    const visualsFolder = options.includeVisuals ? await join(shotFolder, "visuals") : null;

    if (videoFolder) {
      await ensureDirectory(videoFolder);
    }

    if (audioFolder) {
      await ensureDirectory(audioFolder);
    }

    if (visualsFolder) {
      await ensureDirectory(visualsFolder);
    }

    const effectiveExternalReferencePath = visualsFolder
      ? await getEffectiveShotExternalReferencePath(shot, {
          shots: params.referenceLookupShots ?? params.shots,
        })
      : null;

    const copyOperations: Array<Promise<boolean>> = [];

    if (videoFolder && shot.videoPath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          shot.videoPath,
          await join(videoFolder, buildLabeledFilename("video", shot.videoPath)),
        ),
      );
    }

    if (videoFolder && shot.video4kPath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          shot.video4kPath,
          await join(videoFolder, buildLabeledFilename("video_4k", shot.video4kPath)),
        ),
      );
    }

    if (videoFolder && shot.lipsyncVideoPath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          shot.lipsyncVideoPath,
          await join(
            videoFolder,
            buildLabeledFilename("lipsync_master", shot.lipsyncVideoPath),
          ),
        ),
      );
    }

    if (audioFolder && shot.audioMasterPath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          shot.audioMasterPath,
          await join(audioFolder, buildLabeledFilename("audio_master", shot.audioMasterPath)),
        ),
      );
    }

    if (visualsFolder && shot.imageStartPath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          shot.imageStartPath,
          await join(visualsFolder, buildLabeledFilename("start", shot.imageStartPath)),
        ),
      );
    }

    if (visualsFolder && shot.imageEndPath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          shot.imageEndPath,
          await join(visualsFolder, buildLabeledFilename("end", shot.imageEndPath)),
        ),
      );
    }

    if (visualsFolder && effectiveExternalReferencePath) {
      copyOperations.push(
        copyProjectRelativeFile(
          project.folderPath,
          effectiveExternalReferencePath,
          await join(
            visualsFolder,
            buildLabeledFilename("external_reference", effectiveExternalReferencePath),
          ),
        ),
      );
    }

    for (const copied of await Promise.all(copyOperations)) {
      if (copied) {
        copiedFileCount += 1;
      } else {
        skippedFileCount += 1;
      }
    }

    if (options.includeCharacters) {
      const characterResult = await copyCharacterReferencesForShot({
        shot,
        shotFolder,
        projectFolderPath: project.folderPath,
      });
      copiedFileCount += characterResult.copied;
      skippedFileCount += characterResult.skipped;
    }
  }

  return {
    rootPath,
    shotCount: sortedShots.length,
    copiedFileCount,
    skippedFileCount,
  };
}
