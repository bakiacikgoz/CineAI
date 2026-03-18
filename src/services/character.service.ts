import { basename, join } from "@tauri-apps/api/path";
import { copyFile, mkdir } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { useProjectStore } from "@/store/project.store";

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
  createdAt: number;
};

function parseJsonList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapRow(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? null,
    klingElementId: row.klingElementId ?? null,
    refImages: parseJsonList(row.refImages),
    primaryImage: row.primaryImage ?? null,
    styleNotes: row.styleNotes ?? null,
    createdAt: row.createdAt,
  };
}

async function ensureProject(): Promise<NonNullable<ReturnType<typeof useProjectStore.getState>["activeProject"]>> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  return project;
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
    await copyFile(sourcePath, targetAbsolutePath);
    importedPaths.push(`assets/characters/${targetName}`);
  }

  return importedPaths;
}

export async function listCharacters(): Promise<CharacterRecord[]> {
  const db = await getProjectDb();
  const project = await ensureProject();
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
       created_at AS createdAt
     FROM characters
     WHERE project_id = $1
     ORDER BY created_at DESC, lower(name) ASC`,
    [project.id],
  );

  return rows.map(mapRow);
}

export async function createCharacter(input: {
  name: string;
  description?: string | null;
  klingElementId?: string | null;
  refImages?: string[];
  primaryImage?: string | null;
  styleNotes?: string | null;
}): Promise<CharacterRecord> {
  const db = await getProjectDb();
  const project = await ensureProject();
  const record: CharacterRecord = {
    id: uuidv4(),
    projectId: project.id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    klingElementId: input.klingElementId?.trim() || null,
    refImages: input.refImages ?? [],
    primaryImage: input.primaryImage ?? input.refImages?.[0] ?? null,
    styleNotes: input.styleNotes?.trim() || null,
    createdAt: Date.now(),
  };

  await db.execute(
    `INSERT INTO characters (
       id,
       project_id,
       name,
       description,
       kling_element_id,
       ref_images,
       primary_image,
       style_notes,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.id,
      record.projectId,
      record.name,
      record.description,
      record.klingElementId,
      JSON.stringify(record.refImages),
      record.primaryImage,
      record.styleNotes,
      record.createdAt,
    ],
  );
  await syncProjectDbMirror();
  return record;
}

export async function updateCharacter(
  id: string,
  updates: {
    name: string;
    description?: string | null;
    klingElementId?: string | null;
    refImages?: string[];
    primaryImage?: string | null;
    styleNotes?: string | null;
  },
): Promise<void> {
  const db = await getProjectDb();
  const refImages = updates.refImages ?? [];
  const primaryImage = updates.primaryImage ?? refImages[0] ?? null;

  await db.execute(
    `UPDATE characters
     SET name = $1,
         description = $2,
         kling_element_id = $3,
         ref_images = $4,
         primary_image = $5,
         style_notes = $6
     WHERE id = $7`,
    [
      updates.name.trim(),
      updates.description?.trim() || null,
      updates.klingElementId?.trim() || null,
      JSON.stringify(refImages),
      primaryImage,
      updates.styleNotes?.trim() || null,
      id,
    ],
  );
  await syncProjectDbMirror();
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await getProjectDb();
  await db.execute("DELETE FROM characters WHERE id = $1", [id]);
  await syncProjectDbMirror();
}
