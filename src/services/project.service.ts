import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";
import { v4 as uuidv4 } from "uuid";
import type { ProjectSummaryMetadata } from "@/lib/project-summary";
import { useProjectStore } from "@/store/project.store";

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
  metadata?: ProjectSummaryMetadata;
}

type RegistryProjectRow = {
  id: string;
  name: string;
  folderPath: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string | null;
};

type StoredProjectMeta = Partial<ProjectMeta>;

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
    metadata:
      "metadata" in meta && meta.metadata
        ? normalizeProjectMetadata(meta.metadata)
        : undefined,
  };
}

function normalizeProjectMetadata(
  metadata: Partial<ProjectSummaryMetadata>,
): ProjectSummaryMetadata {
  return {
    mainShotCount: Number(metadata.mainShotCount) || 0,
    coverageShotCount: Number(metadata.coverageShotCount) || 0,
    archivedShotCount: Number(metadata.archivedShotCount) || 0,
    readyStartCount: Number(metadata.readyStartCount) || 0,
    readyEndCount: Number(metadata.readyEndCount) || 0,
    readyVideoCount: Number(metadata.readyVideoCount) || 0,
  };
}

async function getProjectJsonPath(projectFolderPath: string): Promise<string> {
  return join(projectFolderPath, PROJECT_META_FILE);
}

async function writeProjectMeta(meta: ProjectMeta): Promise<void> {
  const projectJsonPath = await getProjectJsonPath(meta.folderPath);
  await writeTextFile(projectJsonPath, JSON.stringify(meta, null, 2));
}

async function readProjectMetaFile(projectFolderPath: string): Promise<ProjectMeta> {
  const raw = await readTextFile(await getProjectJsonPath(projectFolderPath));
  const parsed = JSON.parse(raw) as StoredProjectMeta;

  if (
    !parsed.id ||
    !parsed.name ||
    typeof parsed.createdAt !== "number" ||
    typeof parsed.updatedAt !== "number"
  ) {
    throw new Error("project.json gecersiz veya eksik alanlar iceriyor.");
  }

  return normalizeProjectMeta({
    ...parsed,
    folderPath: projectFolderPath,
    metadata: parsed.metadata ? normalizeProjectMetadata(parsed.metadata) : undefined,
  } as ProjectMeta);
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

  const meta = await readProjectMetaFile(folderPath);
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
        const storedMeta = await readProjectMetaFile(row.folderPath);
        validProjects.push(
          normalizeProjectMeta({
            ...storedMeta,
            updatedAt: row.updatedAt,
            thumbnail: row.thumbnail ?? storedMeta.thumbnail,
          }),
        );
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

export async function updateProjectPresentation(
  project: ProjectMeta,
  updates: {
    thumbnail?: string | null;
    metadata?: ProjectSummaryMetadata;
  },
): Promise<ProjectMeta> {
  const nextMeta: ProjectMeta = normalizeProjectMeta({
    ...project,
    updatedAt: Date.now(),
    thumbnail:
      updates.thumbnail === undefined ? project.thumbnail : updates.thumbnail ?? undefined,
    metadata: updates.metadata ?? project.metadata,
  });

  await writeProjectMeta(nextMeta);
  await upsertRegistryProject(nextMeta);

  const state = useProjectStore.getState();

  if (state.activeProject?.id === nextMeta.id) {
    state.setActiveProject(nextMeta);
  }

  if (state.recentProjects.some((entry) => entry.id === nextMeta.id)) {
    state.setRecentProjects(
      state.recentProjects.map((entry) => (entry.id === nextMeta.id ? nextMeta : entry)),
    );
  }

  return nextMeta;
}
