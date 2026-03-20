import { basename, join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import {
  buildCharacterGenerationPrompt,
  buildCharacterPromptHint,
  normalizeCharacterLookAttributes,
  normalizeCharacterProfile,
  summarizeCharacterProfile,
  type CharacterLookAttributes,
  type CharacterProfile,
} from "@/lib/character-studio";
import { moveCharacterReference, removeCharacterReference } from "@/lib/character-references";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { getAssets, type AssetWithTags } from "@/services/asset.service";
import {
  getShotById,
  getShots,
  updateShotCharacterBinding,
} from "@/services/import.service";
import { syncActiveProjectPresentation } from "@/services/project-presentation.service";
import { useProjectStore } from "@/store/project.store";

export interface CharacterLookRecord {
  id: string;
  characterId: string;
  name: string;
  attributes: CharacterLookAttributes;
  generationPrompt: string;
  promptHint: string | null;
  promptLocked: boolean;
  refImages: string[];
  primaryImage: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  klingElementId: string | null;
  refImages: string[];
  primaryImage: string | null;
  styleNotes: string | null;
  createdAt: number;
  updatedAt: number;
  profile: CharacterProfile;
  promptHint: string | null;
  defaultLookId: string | null;
  looks: CharacterLookRecord[];
}

export interface CharacterLookInput {
  id?: string | null;
  name: string;
  attributes?: Partial<CharacterLookAttributes> | null;
  generationPrompt?: string | null;
  promptHint?: string | null;
  promptLocked?: boolean;
  refImages?: string[];
  primaryImage?: string | null;
  isDefault?: boolean;
}

export interface CharacterStudioInput {
  name: string;
  description?: string | null;
  klingElementId?: string | null;
  profile?: Partial<CharacterProfile> | null;
  promptHint?: string | null;
  defaultLookId?: string | null;
  looks?: CharacterLookInput[];
  refImages?: string[];
  primaryImage?: string | null;
  styleNotes?: string | null;
}

export interface CharacterDeletionImpact {
  shotCount: number;
}

export interface ShotCharacterContext {
  character: CharacterRecord;
  look: CharacterLookRecord;
  promptHint: string | null;
  referencePaths: string[];
}

type CharacterRow = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  klingElementId: string | null;
  refImages: string | null;
  primaryImage: string | null;
  styleNotes: string | null;
  profileJson: string | null;
  promptHint: string | null;
  defaultLookId: string | null;
  createdAt: number;
  updatedAt: number;
};

type CharacterLookRow = {
  id: string;
  characterId: string;
  name: string;
  attributesJson: string | null;
  generationPrompt: string | null;
  promptHint: string | null;
  promptLocked: number;
  refImages: string | null;
  primaryImage: string | null;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
};

type PreparedLookInput = {
  id: string;
  name: string;
  attributes: CharacterLookAttributes;
  generationPrompt: string;
  promptHint: string | null;
  promptLocked: boolean;
  refImages: string[];
  primaryImage: string | null;
  isDefault: boolean;
};

function parseJsonList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? Array.from(
          new Set(
            parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
          ),
        )
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T extends object>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? ({ ...fallback, ...(parsed as T) } as T)
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dedupePaths(paths: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(paths.map((path) => path?.trim()).filter((path): path is string => Boolean(path))),
  );
}

function mapLookRow(row: CharacterLookRow): CharacterLookRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    name: row.name,
    attributes: normalizeCharacterLookAttributes(
      parseJsonObject<Partial<CharacterLookAttributes>>(row.attributesJson, {}),
    ),
    generationPrompt: row.generationPrompt?.trim() || "",
    promptHint: normalizeString(row.promptHint),
    promptLocked: Boolean(row.promptLocked),
    refImages: parseJsonList(row.refImages),
    primaryImage: normalizeString(row.primaryImage),
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCharacterRecord(
  row: CharacterRow,
  looks: CharacterLookRecord[],
): CharacterRecord {
  const sortedLooks = looks
    .slice()
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.createdAt - right.createdAt);
  const defaultLook =
    sortedLooks.find((look) => look.id === row.defaultLookId) ??
    sortedLooks.find((look) => look.isDefault) ??
    sortedLooks[0] ??
    null;
  const profile = normalizeCharacterProfile(
    parseJsonObject<Partial<CharacterProfile>>(row.profileJson, {}),
  );

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? summarizeCharacterProfile(profile, row.styleNotes),
    klingElementId: row.klingElementId ?? null,
    refImages: defaultLook?.refImages ?? parseJsonList(row.refImages),
    primaryImage: defaultLook?.primaryImage ?? row.primaryImage ?? null,
    styleNotes: row.styleNotes ?? profile.globalNotes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    profile,
    promptHint: normalizeString(row.promptHint) ?? defaultLook?.promptHint ?? null,
    defaultLookId: defaultLook?.id ?? row.defaultLookId ?? null,
    looks: sortedLooks,
  };
}

async function ensureProject(): Promise<NonNullable<ReturnType<typeof useProjectStore.getState>["activeProject"]>> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  return project;
}

function buildLegacyLookInput(input: CharacterStudioInput): CharacterLookInput {
  return {
    name: "Default Look",
    attributes: {
      continuityNotes: input.styleNotes ?? "",
    },
    refImages: input.refImages ?? [],
    primaryImage: input.primaryImage ?? input.refImages?.[0] ?? null,
  };
}

function prepareLookInputs(
  characterName: string,
  profile: CharacterProfile,
  input: CharacterStudioInput,
): {
  looks: PreparedLookInput[];
  defaultLookId: string;
} {
  const rawLooks =
    input.looks && input.looks.length > 0 ? input.looks : [buildLegacyLookInput(input)];

  const prepared = rawLooks.map((look, index) => {
    const id = look.id?.trim() || uuidv4();
    const attributes = normalizeCharacterLookAttributes(look.attributes);
    const refImages = dedupePaths(look.refImages ?? []);
    const primaryImageCandidate = look.primaryImage?.trim() || null;
    const primaryImage = primaryImageCandidate
      ? refImages.includes(primaryImageCandidate)
        ? primaryImageCandidate
        : refImages[0] ?? primaryImageCandidate
      : refImages[0] ?? null;
    const promptLocked = Boolean(look.promptLocked);
    const generatedPrompt = buildCharacterGenerationPrompt(characterName, profile, attributes);
    const generatedHint = buildCharacterPromptHint(characterName, profile, attributes);

    return {
      id,
      name: look.name?.trim() || `Look ${index + 1}`,
      attributes,
      generationPrompt:
        promptLocked && look.generationPrompt?.trim()
          ? look.generationPrompt.trim()
          : generatedPrompt,
      promptHint:
        promptLocked && look.promptHint?.trim()
          ? look.promptHint.trim()
          : generatedHint,
      promptLocked,
      refImages,
      primaryImage,
      isDefault: Boolean(look.isDefault),
    };
  });

  const requestedDefaultLookId =
    input.defaultLookId?.trim() ||
    prepared.find((look) => look.isDefault)?.id ||
    prepared[0]?.id;

  const defaultLookId =
    prepared.find((look) => look.id === requestedDefaultLookId)?.id ?? prepared[0]?.id;

  if (!defaultLookId) {
    throw new Error("Karakter icin en az bir look gerekli.");
  }

  return {
    looks: prepared.map((look) => ({
      ...look,
      isDefault: look.id === defaultLookId,
    })),
    defaultLookId,
  };
}

async function listCharacterRows(): Promise<CharacterRow[]> {
  const db = await getProjectDb();
  const project = await ensureProject();
  return db.select<CharacterRow[]>(
    `SELECT
       id,
       project_id AS projectId,
       name,
       description,
       kling_element_id AS klingElementId,
       ref_images AS refImages,
       primary_image AS primaryImage,
       style_notes AS styleNotes,
       profile_json AS profileJson,
       prompt_hint AS promptHint,
       default_look_id AS defaultLookId,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM characters
     WHERE project_id = $1
     ORDER BY updated_at DESC, lower(name) ASC`,
    [project.id],
  );
}

async function listLookRowsByCharacterIds(
  characterIds: string[],
): Promise<CharacterLookRow[]> {
  if (characterIds.length === 0) {
    return [];
  }

  const db = await getProjectDb();
  const placeholders = characterIds.map((_, index) => `$${index + 1}`).join(", ");

  return db.select<CharacterLookRow[]>(
    `SELECT
       id,
       character_id AS characterId,
       name,
       attributes_json AS attributesJson,
       generation_prompt AS generationPrompt,
       prompt_hint AS promptHint,
       prompt_locked AS promptLocked,
       ref_images AS refImages,
       primary_image AS primaryImage,
       is_default AS isDefault,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM character_looks
     WHERE character_id IN (${placeholders})
     ORDER BY is_default DESC, created_at ASC`,
    characterIds,
  );
}

async function getCharacterRowById(id: string): Promise<CharacterRow | null> {
  const db = await getProjectDb();
  const rows = await db.select<CharacterRow[]>(
    `SELECT
       id,
       project_id AS projectId,
       name,
       description,
       kling_element_id AS klingElementId,
       ref_images AS refImages,
       primary_image AS primaryImage,
       style_notes AS styleNotes,
       profile_json AS profileJson,
       prompt_hint AS promptHint,
       default_look_id AS defaultLookId,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM characters
     WHERE id = $1
     LIMIT 1`,
    [id],
  );

  return rows[0] ?? null;
}

async function getLookRowsForCharacter(characterId: string): Promise<CharacterLookRow[]> {
  return listLookRowsByCharacterIds([characterId]);
}

async function syncLookPrimaryBindings(
  lookId: string,
  primaryImage: string | null,
): Promise<void> {
  const db = await getProjectDb();
  await db.execute(
    `UPDATE shots
     SET external_reference_path = $1,
         updated_at = $2
     WHERE character_look_id = $3`,
    [primaryImage, Date.now(), lookId],
  );
}

async function rebindRemovedLooks(
  characterId: string,
  removedLookIds: string[],
  fallbackLookId: string | null,
  fallbackPrimaryImage: string | null,
): Promise<void> {
  if (removedLookIds.length === 0) {
    return;
  }

  const db = await getProjectDb();
  const placeholders = removedLookIds.map((_, index) => `$${index + 3}`).join(", ");

  if (fallbackLookId) {
    await db.execute(
      `UPDATE shots
       SET character_look_id = $1,
           external_reference_path = $2,
           updated_at = $${removedLookIds.length + 3}
       WHERE character_id = $${removedLookIds.length + 4}
         AND character_look_id IN (${placeholders})`,
      [
        fallbackLookId,
        fallbackPrimaryImage,
        ...removedLookIds,
        Date.now(),
        characterId,
      ],
    );
    return;
  }

  await db.execute(
    `UPDATE shots
     SET character_id = NULL,
         character_look_id = NULL,
         external_reference_path = NULL,
         updated_at = $1
     WHERE character_id = $2
       AND character_look_id IN (${placeholders})`,
    [Date.now(), characterId, ...removedLookIds],
  );
}

async function upsertLooks(
  characterId: string,
  characterName: string,
  profile: CharacterProfile,
  looks: PreparedLookInput[],
  defaultLookId: string,
  timestamp: number,
): Promise<void> {
  const db = await getProjectDb();

  for (const look of looks) {
    const generationPrompt = look.promptLocked
      ? look.generationPrompt
      : buildCharacterGenerationPrompt(characterName, profile, look.attributes);
    const promptHint = look.promptLocked
      ? look.promptHint
      : buildCharacterPromptHint(characterName, profile, look.attributes);

    const existing = await db.select<Array<{ id: string }>>(
      "SELECT id FROM character_looks WHERE id = $1 LIMIT 1",
      [look.id],
    );

    if (existing[0]) {
      await db.execute(
        `UPDATE character_looks
         SET name = $1,
             attributes_json = $2,
             generation_prompt = $3,
             prompt_hint = $4,
             prompt_locked = $5,
             ref_images = $6,
             primary_image = $7,
             is_default = $8,
             updated_at = $9
         WHERE id = $10`,
        [
          look.name,
          JSON.stringify(look.attributes),
          generationPrompt,
          promptHint,
          look.promptLocked ? 1 : 0,
          JSON.stringify(look.refImages),
          look.primaryImage,
          look.id === defaultLookId ? 1 : 0,
          timestamp,
          look.id,
        ],
      );
      continue;
    }

    await db.execute(
      `INSERT INTO character_looks (
        id, character_id, name, attributes_json, generation_prompt,
        prompt_hint, prompt_locked, ref_images, primary_image, is_default,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12
      )`,
      [
        look.id,
        characterId,
        look.name,
        JSON.stringify(look.attributes),
        generationPrompt,
        promptHint,
        look.promptLocked ? 1 : 0,
        JSON.stringify(look.refImages),
        look.primaryImage,
        look.id === defaultLookId ? 1 : 0,
        timestamp,
        timestamp,
      ],
    );
  }
}

async function loadCharacterWithRows(row: CharacterRow): Promise<CharacterRecord> {
  const lookRows = await getLookRowsForCharacter(row.id);
  return toCharacterRecord(row, lookRows.map(mapLookRow));
}

export async function importCharacterReferenceFiles(
  characterName: string,
  paths: string[],
): Promise<string[]> {
  const project = await ensureProject();
  const safePrefix = characterName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "character";
  const targetDir = await join(project.folderPath, "assets", "characters");

  await mkdir(targetDir, { recursive: true });

  const importedPaths: string[] = [];

  for (const sourcePath of paths) {
    const name = await basename(sourcePath);
    const targetName = `${safePrefix}-${uuidv4().slice(0, 8)}-${name}`;
    const targetAbsolutePath = await join(targetDir, targetName);
    const sourceBytes = await readFile(sourcePath);
    await writeFile(targetAbsolutePath, sourceBytes);
    importedPaths.push(`assets/characters/${targetName}`);
  }

  return importedPaths;
}

export async function listCharacters(): Promise<CharacterRecord[]> {
  const rows = await listCharacterRows();
  const lookRows = await listLookRowsByCharacterIds(rows.map((row) => row.id));
  const looksByCharacterId = new Map<string, CharacterLookRecord[]>();

  for (const lookRow of lookRows) {
    const mapped = mapLookRow(lookRow);
    const bucket = looksByCharacterId.get(mapped.characterId) ?? [];
    bucket.push(mapped);
    looksByCharacterId.set(mapped.characterId, bucket);
  }

  return rows.map((row) => toCharacterRecord(row, looksByCharacterId.get(row.id) ?? []));
}

export async function getCharacterById(id: string): Promise<CharacterRecord | null> {
  const row = await getCharacterRowById(id);
  return row ? loadCharacterWithRows(row) : null;
}

export async function createCharacter(input: CharacterStudioInput): Promise<CharacterRecord> {
  const db = await getProjectDb();
  const project = await ensureProject();
  const timestamp = Date.now();
  const id = uuidv4();
  const name = input.name.trim();

  if (!name) {
    throw new Error("Karakter adi zorunludur.");
  }

  const profile = normalizeCharacterProfile({
    ...input.profile,
    globalNotes: input.profile?.globalNotes ?? input.styleNotes ?? "",
  });
  const { looks, defaultLookId } = prepareLookInputs(name, profile, input);
  const defaultLook = looks.find((look) => look.id === defaultLookId) ?? looks[0];

  await db.execute(
    `INSERT INTO characters (
      id, project_id, name, description, kling_element_id, ref_images,
      primary_image, style_notes, profile_json, prompt_hint, default_look_id,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13
    )`,
    [
      id,
      project.id,
      name,
      normalizeString(input.description),
      normalizeString(input.klingElementId),
      JSON.stringify(defaultLook?.refImages ?? []),
      defaultLook?.primaryImage ?? null,
      normalizeString(input.styleNotes) ?? normalizeString(profile.globalNotes),
      JSON.stringify(profile),
      defaultLook?.promptHint ?? normalizeString(input.promptHint),
      defaultLookId,
      timestamp,
      timestamp,
    ],
  );

  await upsertLooks(id, name, profile, looks, defaultLookId, timestamp);
  await syncProjectDbMirror();
  return (await getCharacterById(id)) as CharacterRecord;
}

export async function updateCharacter(
  id: string,
  updates: CharacterStudioInput,
): Promise<void> {
  const db = await getProjectDb();
  const existing = await getCharacterById(id);

  if (!existing) {
    throw new Error("Karakter bulunamadi.");
  }

  const timestamp = Date.now();
  const name = updates.name.trim();

  if (!name) {
    throw new Error("Karakter adi zorunludur.");
  }

  const profile = normalizeCharacterProfile({
    ...updates.profile,
    globalNotes: updates.profile?.globalNotes ?? updates.styleNotes ?? "",
  });
  const { looks, defaultLookId } = prepareLookInputs(name, profile, updates);
  const defaultLook = looks.find((look) => look.id === defaultLookId) ?? looks[0];
  const previousLooks = existing.looks;
  const previousLookIds = new Set(previousLooks.map((look) => look.id));
  const nextLookIds = new Set(looks.map((look) => look.id));
  const removedLookIds = previousLooks
    .filter((look) => !nextLookIds.has(look.id))
    .map((look) => look.id);

  await db.execute(
    `UPDATE characters
     SET name = $1,
         description = $2,
         kling_element_id = $3,
         ref_images = $4,
         primary_image = $5,
         style_notes = $6,
         profile_json = $7,
         prompt_hint = $8,
         default_look_id = $9,
         updated_at = $10
     WHERE id = $11`,
    [
      name,
      normalizeString(updates.description),
      normalizeString(updates.klingElementId),
      JSON.stringify(defaultLook?.refImages ?? []),
      defaultLook?.primaryImage ?? null,
      normalizeString(updates.styleNotes) ?? normalizeString(profile.globalNotes),
      JSON.stringify(profile),
      defaultLook?.promptHint ?? normalizeString(updates.promptHint),
      defaultLookId,
      timestamp,
      id,
    ],
  );

  await upsertLooks(id, name, profile, looks, defaultLookId, timestamp);
  await rebindRemovedLooks(
    id,
    removedLookIds,
    defaultLookId,
    defaultLook?.primaryImage ?? null,
  );

  for (const removedLookId of removedLookIds) {
    await db.execute("DELETE FROM character_looks WHERE id = $1", [removedLookId]);
  }

  for (const look of looks) {
    const previousLook = previousLooks.find((candidate) => candidate.id === look.id);

    if (!previousLook || previousLook.primaryImage !== look.primaryImage) {
      await syncLookPrimaryBindings(look.id, look.primaryImage);
    }

    if (!previousLookIds.has(look.id)) {
      await syncLookPrimaryBindings(look.id, look.primaryImage);
    }
  }

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function appendCharacterLookReference(
  characterId: string,
  lookId: string,
  relativePath: string,
  options?: { makePrimary?: boolean },
): Promise<CharacterRecord> {
  const character = await getCharacterById(characterId);

  if (!character) {
    throw new Error("Karakter bulunamadi.");
  }

  const look = character.looks.find((item) => item.id === lookId);

  if (!look) {
    throw new Error("Look bulunamadi.");
  }

  const refImages = Array.from(new Set([...look.refImages, relativePath]));
  const nextPrimaryImage =
    options?.makePrimary || !look.primaryImage ? relativePath : look.primaryImage;

  await updateCharacter(character.id, {
    name: character.name,
    description: character.description,
    klingElementId: character.klingElementId,
    profile: character.profile,
    promptHint: character.promptHint,
    defaultLookId: character.defaultLookId,
    styleNotes: character.styleNotes,
    looks: character.looks.map((item) =>
      item.id === lookId
        ? {
            ...item,
            refImages,
            primaryImage: nextPrimaryImage,
          }
        : item,
    ),
  });

  return (await getCharacterById(characterId)) as CharacterRecord;
}

export async function setCharacterLookPrimaryImage(
  characterId: string,
  lookId: string,
  primaryImage: string,
): Promise<CharacterRecord> {
  return appendCharacterLookReference(characterId, lookId, primaryImage, {
    makePrimary: true,
  });
}

export async function assignCharacterLookToShot(
  shotId: string,
  characterId: string,
  lookId: string,
  includeCharacterPrompt = true,
): Promise<void> {
  const character = await getCharacterById(characterId);

  if (!character) {
    throw new Error("Karakter bulunamadi.");
  }

  const look = character.looks.find((item) => item.id === lookId);

  if (!look) {
    throw new Error("Look bulunamadi.");
  }

  await updateShotCharacterBinding(shotId, {
    characterId,
    characterLookId: look.id,
    includeCharacterPrompt,
    externalReferencePath: look.primaryImage ?? null,
  });
}

export async function clearShotCharacterLookBinding(shotId: string): Promise<void> {
  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  await updateShotCharacterBinding(shotId, {
    characterId: null,
    characterLookId: null,
    includeCharacterPrompt: true,
    externalReferencePath: null,
  });
}

export async function resolveShotCharacterContext(input: {
  characterId: string | null;
  characterLookId: string | null;
}): Promise<ShotCharacterContext | null> {
  if (!input.characterId || !input.characterLookId) {
    return null;
  }

  const project = await ensureProject();
  const character = await getCharacterById(input.characterId);

  if (!character) {
    return null;
  }

  const look =
    character.looks.find((item) => item.id === input.characterLookId) ??
    character.looks.find((item) => item.id === character.defaultLookId) ??
    character.looks[0];

  if (!look) {
    return null;
  }

  const relativePaths = dedupePaths([look.primaryImage, ...look.refImages]);
  const referencePaths: string[] = [];

  for (const relativePath of relativePaths) {
    const absolutePath = await join(
      project.folderPath,
      ...relativePath.split(/[\\/]+/).filter(Boolean),
    );

    if (await exists(absolutePath)) {
      referencePaths.push(absolutePath);
    }
  }

  return {
    character,
    look,
    promptHint: look.promptHint ?? character.promptHint ?? null,
    referencePaths,
  };
}

export async function listCharacterCandidateAssets(
  characterId: string,
  lookId: string,
): Promise<AssetWithTags[]> {
  const project = await ensureProject();
  const assets = await getAssets(project.id, "image");

  return assets.filter(
    (asset) =>
      asset.tagsList.includes("candidate") &&
      asset.tagsList.includes("character") &&
      asset.tagsList.includes(`character:${characterId}`) &&
      asset.tagsList.includes(`look:${lookId}`),
  );
}

export async function listCharacterLookOptions(): Promise<
  Array<{
    characterId: string;
    characterName: string;
    lookId: string;
    lookName: string;
    promptHint: string | null;
    primaryImage: string | null;
    isDefault: boolean;
  }>
> {
  const characters = await listCharacters();
  return characters.flatMap((character) =>
    character.looks.map((look) => ({
      characterId: character.id,
      characterName: character.name,
      lookId: look.id,
      lookName: look.name,
      promptHint: look.promptHint ?? character.promptHint ?? null,
      primaryImage: look.primaryImage,
      isDefault: look.id === character.defaultLookId,
    })),
  );
}

export async function getCharacterDeletionImpact(
  characterId: string,
): Promise<CharacterDeletionImpact> {
  const project = await ensureProject();
  const shots = await getShots(project.id, { includeArchived: true });
  const shotCount = shots.filter((shot) => shot.characterId === characterId).length;
  return { shotCount };
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await getProjectDb();
  await db.execute(
    `UPDATE shots
     SET character_id = NULL,
         character_look_id = NULL,
         external_reference_path = NULL,
         updated_at = $1
     WHERE character_id = $2`,
    [Date.now(), id],
  );
  await db.execute("DELETE FROM character_looks WHERE character_id = $1", [id]);
  await db.execute("DELETE FROM characters WHERE id = $1", [id]);
  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export function buildCharacterCandidateTags(
  characterId: string,
  lookId: string,
): string[] {
  return ["character", "candidate", `character:${characterId}`, `look:${lookId}`];
}

export function buildDefaultLookName(characterName: string): string {
  const trimmed = characterName.trim();
  return trimmed ? `${trimmed} Default Look` : "Default Look";
}

export function reorderLookReference(
  refImages: string[],
  refImage: string,
  direction: -1 | 1,
): string[] {
  return moveCharacterReference(refImages, refImage, direction);
}

export function removeLookReference(
  refImages: string[],
  primaryImage: string | null,
  refImage: string,
): {
  refImages: string[];
  primaryImage: string | null;
} {
  return removeCharacterReference(refImages, primaryImage, refImage);
}
