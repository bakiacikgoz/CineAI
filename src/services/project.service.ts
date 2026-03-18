import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";
import { v4 as uuidv4 } from "uuid";

const PROJECT_META_FILE = "project.json";
const REGISTRY_DB_PATH = "sqlite:cineai-registry.db";

let registryDbPromise: Promise<Database> | null = null;

export interface ProjectMeta {
  id: string;
  name: string;
  folderPath: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
}

type RegistryProjectRow = {
  id: string;
  name: string;
  folderPath: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string | null;
};

function toFolderSafeName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function toProjectFolderName(projectName: string): string {
  return toFolderSafeName(projectName) || "cineai-project";
}

function normalizeProjectMeta(meta: RegistryProjectRow | ProjectMeta): ProjectMeta {
  return {
    id: meta.id,
    name: meta.name,
    folderPath: meta.folderPath,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    thumbnail: meta.thumbnail ?? undefined,
  };
}

async function getProjectJsonPath(projectFolderPath: string): Promise<string> {
  return join(projectFolderPath, PROJECT_META_FILE);
}

async function writeProjectMeta(meta: ProjectMeta): Promise<void> {
  const projectJsonPath = await getProjectJsonPath(meta.folderPath);
  await writeTextFile(projectJsonPath, JSON.stringify(meta, null, 2));
}

async function ensureProjectFolderAvailable(projectFolderPath: string): Promise<void> {
  const alreadyExists = await exists(projectFolderPath);

  if (alreadyExists) {
    throw new Error("Ayni isimde bir klasor zaten var. Farkli bir proje adi secin.");
  }
}

async function getRegistryDb(): Promise<Database> {
  if (!registryDbPromise) {
    registryDbPromise = (async () => {
      const db = await Database.load(REGISTRY_DB_PATH);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS projects (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          folder_path  TEXT NOT NULL,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          thumbnail    TEXT
        )
      `);

      return db;
    })();
  }

  return registryDbPromise;
}

async function upsertRegistryProject(meta: ProjectMeta): Promise<void> {
  const db = await getRegistryDb();
  const existing = await db.select<Array<{ id: string }>>(
    "SELECT id FROM projects WHERE id = $1",
    [meta.id],
  );

  if (existing.length === 0) {
    await db.execute(
      `INSERT INTO projects (id, name, folder_path, created_at, updated_at, thumbnail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [meta.id, meta.name, meta.folderPath, meta.createdAt, meta.updatedAt, meta.thumbnail ?? null],
    );
    return;
  }

  await db.execute(
    `UPDATE projects
     SET name = $1, folder_path = $2, updated_at = $3, thumbnail = $4
     WHERE id = $5`,
    [meta.name, meta.folderPath, meta.updatedAt, meta.thumbnail ?? null, meta.id],
  );
}

export async function createProject(
  name: string,
  baseFolderPath: string,
): Promise<ProjectMeta> {
  const now = Date.now();
  const projectFolderName = toProjectFolderName(name);
  const projectFolderPath = await join(baseFolderPath, projectFolderName);

  await ensureProjectFolderAvailable(projectFolderPath);
  await mkdir(projectFolderPath, { recursive: true });

  const subDirs = [
    "storyboard",
    "assets",
    "assets/images",
    "assets/videos",
    "assets/characters",
    "prompts",
    "exports",
  ];

  for (const subDir of subDirs) {
    await mkdir(await join(projectFolderPath, subDir), { recursive: true });
  }

  const meta: ProjectMeta = {
    id: uuidv4(),
    name: name.trim(),
    folderPath: projectFolderPath,
    createdAt: now,
    updatedAt: now,
  };

  await writeProjectMeta(meta);
  await upsertRegistryProject(meta);

  return meta;
}

export async function openProject(folderPath: string): Promise<ProjectMeta> {
  const projectJsonPath = await getProjectJsonPath(folderPath);
  const hasProjectJson = await exists(projectJsonPath);

  if (!hasProjectJson) {
    throw new Error("Secilen klasorde project.json bulunamadi.");
  }

  const raw = await readTextFile(projectJsonPath);
  const parsed = JSON.parse(raw) as Partial<ProjectMeta>;

  if (
    !parsed.id ||
    !parsed.name ||
    !parsed.folderPath ||
    typeof parsed.createdAt !== "number" ||
    typeof parsed.updatedAt !== "number"
  ) {
    throw new Error("project.json gecersiz veya eksik alanlar iceriyor.");
  }

  const meta = normalizeProjectMeta({
    ...parsed,
    folderPath,
  } as ProjectMeta);

  await upsertRegistryProject(meta);
  return meta;
}

export async function getRecentProjects(): Promise<ProjectMeta[]> {
  const db = await getRegistryDb();
  const rows = await db.select<RegistryProjectRow[]>(
    `SELECT
       id,
       name,
       folder_path AS folderPath,
       created_at AS createdAt,
       updated_at AS updatedAt,
       thumbnail
     FROM projects
     ORDER BY updated_at DESC
     LIMIT 20`,
  );

  const validProjects: ProjectMeta[] = [];

  for (const row of rows) {
    try {
      const projectJsonPath = await getProjectJsonPath(row.folderPath);
      if (await exists(projectJsonPath)) {
        validProjects.push(normalizeProjectMeta(row));
      }
    } catch {
      // Ignore paths outside the current scope. They can be re-added via the folder picker.
    }
  }

  return validProjects;
}

export async function deleteProjectFromRegistry(id: string): Promise<void> {
  const db = await getRegistryDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

export async function touchProject(id: string): Promise<void> {
  const db = await getRegistryDb();
  await db.execute("UPDATE projects SET updated_at = $1 WHERE id = $2", [Date.now(), id]);
}
