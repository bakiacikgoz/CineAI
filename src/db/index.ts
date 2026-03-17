import Database from "@tauri-apps/plugin-sql";
import initialMigration from "@/db/migrations/001_initial.sql?raw";

const connections = new Map<string, Promise<Database>>();

function hashProjectPath(projectFolderPath: string): string {
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
  // The SQL plugin expects sqlite paths relative to the app data directory.
  const projectKey = hashProjectPath(projectFolderPath || "workspace");
  return `sqlite:projects/${projectKey}/cineai.db`;
}

async function runInitialMigration(db: Database): Promise<void> {
  const statements = splitSqlStatements(initialMigration);

  for (const statement of statements) {
    await db.execute(statement);
  }
}

export async function getDb(projectFolderPath: string): Promise<Database> {
  const connectionPath = resolveDbConnectionPath(projectFolderPath);
  const existingConnection = connections.get(connectionPath);

  if (existingConnection) {
    return existingConnection;
  }

  const nextConnection = (async () => {
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
