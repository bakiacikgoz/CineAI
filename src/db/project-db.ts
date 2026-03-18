import { join } from "@tauri-apps/api/path";
import {
  BaseDirectory,
  exists,
  readFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import type Database from "@tauri-apps/plugin-sql";
import { ensureProjectDbDirectory, getDb, getProjectDbRelativePath } from "@/db";
import { useProjectStore } from "@/store/project.store";

const PROJECT_DB_FILENAME = "cineai.db";

let currentProjectId: string | null = null;
let currentProjectFolderPath: string | null = null;
let projectDbPromise: Promise<Database> | null = null;

async function copyProjectDbToMirror(projectFolderPath: string): Promise<void> {
  const sourcePath = await join(projectFolderPath, PROJECT_DB_FILENAME);

  if (!(await exists(sourcePath))) {
    return;
  }

  const sourceBytes = await readFile(sourcePath);
  await writeFile(getProjectDbRelativePath(projectFolderPath), sourceBytes, {
    baseDir: BaseDirectory.AppConfig,
  });
}

async function copyMirrorToProjectDb(projectFolderPath: string, db: Database): Promise<void> {
  await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");

  const mirroredBytes = await readFile(getProjectDbRelativePath(projectFolderPath), {
    baseDir: BaseDirectory.AppConfig,
  });
  const projectDbPath = await join(projectFolderPath, PROJECT_DB_FILENAME);

  await writeFile(projectDbPath, mirroredBytes);
}

async function ensureActiveProjectRow(db: Database): Promise<void> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  await db.execute(
    `INSERT INTO projects (
      id,
      name,
      folder_path,
      created_at,
      updated_at,
      thumbnail,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      folder_path = excluded.folder_path,
      updated_at = excluded.updated_at,
      thumbnail = excluded.thumbnail,
      metadata = excluded.metadata`,
    [
      project.id,
      project.name,
      project.folderPath,
      project.createdAt,
      project.updatedAt,
      project.thumbnail ?? null,
      project.metadata ? JSON.stringify(project.metadata) : null,
    ],
  );
}

async function initializeProjectDb(projectFolderPath: string): Promise<Database> {
  await ensureProjectDbDirectory(projectFolderPath);
  await copyProjectDbToMirror(projectFolderPath);

  const db = await getDb(projectFolderPath);
  await ensureActiveProjectRow(db);
  await copyMirrorToProjectDb(projectFolderPath, db);

  return db;
}

export async function getProjectDb(): Promise<Database> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  if (currentProjectId !== project.id) {
    resetProjectDb();
    currentProjectId = project.id;
    currentProjectFolderPath = project.folderPath;
  }

  if (!projectDbPromise) {
    projectDbPromise = initializeProjectDb(project.folderPath);
  }

  return projectDbPromise;
}

export async function syncProjectDbMirror(projectFolderPath?: string): Promise<void> {
  const activeProjectFolderPath =
    projectFolderPath ??
    currentProjectFolderPath ??
    useProjectStore.getState().activeProject?.folderPath;

  if (!activeProjectFolderPath) {
    throw new Error("Aktif proje yok.");
  }

  const db = await getProjectDb();
  await copyMirrorToProjectDb(activeProjectFolderPath, db);
}

export function resetProjectDb() {
  currentProjectId = null;
  currentProjectFolderPath = null;
  projectDbPromise = null;
}
