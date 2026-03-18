import Database from "@tauri-apps/plugin-sql";
import { BaseDirectory, mkdir } from "@tauri-apps/plugin-fs";
import initialMigration from "@/db/migrations/001_initial.sql?raw";

const connections = new Map<string, Promise<Database>>();

export function hashProjectPath(projectFolderPath: string): string {
  let hash = 5381;

  for (const char of projectFolderPath) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }

  return Math.abs(hash >>> 0).toString(16);
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function resolveDbConnectionPath(projectFolderPath: string): string {
  if (!projectFolderPath || projectFolderPath === "workspace") {
    return "sqlite:cineai.db";
  }

  // The SQL plugin resolves sqlite paths relative to the app config directory.
  const projectKey = hashProjectPath(projectFolderPath);
  return `sqlite:projects/${projectKey}/cineai.db`;
}

export function getProjectDbRelativePath(projectFolderPath: string): string {
  const projectKey = hashProjectPath(projectFolderPath);
  return `projects/${projectKey}/cineai.db`;
}

export async function ensureProjectDbDirectory(projectFolderPath: string): Promise<void> {
  if (!projectFolderPath || projectFolderPath === "workspace") {
    return;
  }

  const projectKey = hashProjectPath(projectFolderPath);

  await mkdir(`projects/${projectKey}`, {
    baseDir: BaseDirectory.AppConfig,
    recursive: true,
  });
}

async function runInitialMigration(db: Database): Promise<void> {
  await db.execute("PRAGMA journal_mode = DELETE");
  await db.execute("PRAGMA foreign_keys = ON");

  const statements = splitSqlStatements(initialMigration);

  for (const statement of statements) {
    await db.execute(statement);
  }

  await ensureShotColumns(db);
}

async function ensureShotColumns(db: Database): Promise<void> {
  const columns = await db.select<Array<{ name: string }>>("PRAGMA table_info(shots)");
  const knownColumns = new Set(columns.map((column) => column.name));
  const missingColumns = [
    {
      name: "is_archived",
      sql: "ALTER TABLE shots ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "requires_external_reference",
      sql: "ALTER TABLE shots ADD COLUMN requires_external_reference INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "external_reference_name",
      sql: "ALTER TABLE shots ADD COLUMN external_reference_name TEXT",
    },
    {
      name: "external_reference_notes",
      sql: "ALTER TABLE shots ADD COLUMN external_reference_notes TEXT",
    },
    {
      name: "external_reference_path",
      sql: "ALTER TABLE shots ADD COLUMN external_reference_path TEXT",
    },
  ];

  for (const column of missingColumns) {
    if (!knownColumns.has(column.name)) {
      await db.execute(column.sql);
    }
  }
}

export async function getDb(projectFolderPath: string): Promise<Database> {
  const connectionPath = resolveDbConnectionPath(projectFolderPath);
  const existingConnection = connections.get(connectionPath);

  if (existingConnection) {
    return existingConnection;
  }

  const nextConnection = (async () => {
    await ensureProjectDbDirectory(projectFolderPath);
    const db = await Database.load(connectionPath);
    await runInitialMigration(db);
    return db;
  })();

  connections.set(connectionPath, nextConnection);
  return nextConnection;
}

export function resetDb(projectFolderPath?: string) {
  if (!projectFolderPath) {
    connections.clear();
    return;
  }

  connections.delete(resolveDbConnectionPath(projectFolderPath));
}
