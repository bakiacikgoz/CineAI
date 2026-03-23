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
  await ensureAssetSchema(db);
  await ensureCharacterSchema(db);
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

async function ensureCharacterSchema(db: Database): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS character_looks (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      attributes_json TEXT,
      generation_prompt TEXT,
      prompt_hint TEXT,
      prompt_locked INTEGER NOT NULL DEFAULT 0,
      ref_images TEXT,
      primary_image TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_character_looks_character_id ON character_looks(character_id)",
  );

  const characterColumns = await db.select<Array<{ name: string }>>(
    "PRAGMA table_info(characters)",
  );
  const knownCharacterColumns = new Set(characterColumns.map((column) => column.name));
  const missingCharacterColumns = [
    {
      name: "profile_json",
      sql: "ALTER TABLE characters ADD COLUMN profile_json TEXT",
    },
    {
      name: "prompt_hint",
      sql: "ALTER TABLE characters ADD COLUMN prompt_hint TEXT",
    },
    {
      name: "default_look_id",
      sql: "ALTER TABLE characters ADD COLUMN default_look_id TEXT",
    },
    {
      name: "updated_at",
      sql: "ALTER TABLE characters ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
    },
  ];

  for (const column of missingCharacterColumns) {
    if (!knownCharacterColumns.has(column.name)) {
      await db.execute(column.sql);
    }
  }

  await db.execute(
    "UPDATE characters SET updated_at = COALESCE(NULLIF(updated_at, 0), created_at)",
  );

  const shotColumns = await db.select<Array<{ name: string }>>("PRAGMA table_info(shots)");
  const knownShotColumns = new Set(shotColumns.map((column) => column.name));
  const missingShotColumns = [
    {
      name: "character_id",
      sql: "ALTER TABLE shots ADD COLUMN character_id TEXT",
    },
    {
      name: "character_look_id",
      sql: "ALTER TABLE shots ADD COLUMN character_look_id TEXT",
    },
    {
      name: "include_character_prompt",
      sql: "ALTER TABLE shots ADD COLUMN include_character_prompt INTEGER NOT NULL DEFAULT 1",
    },
  ];

  for (const column of missingShotColumns) {
    if (!knownShotColumns.has(column.name)) {
      await db.execute(column.sql);
    }
  }

  await backfillLegacyCharacterLooks(db);
}

async function ensureAssetSchema(db: Database): Promise<void> {
  const assetColumns = await db.select<Array<{ name: string }>>(
    "PRAGMA table_info(assets)",
  );
  const knownAssetColumns = new Set(assetColumns.map((column) => column.name));
  const missingAssetColumns = [
    {
      name: "metadata_json",
      sql: "ALTER TABLE assets ADD COLUMN metadata_json TEXT",
    },
  ];

  for (const column of missingAssetColumns) {
    if (!knownAssetColumns.has(column.name)) {
      await db.execute(column.sql);
    }
  }
}

async function backfillLegacyCharacterLooks(db: Database): Promise<void> {
  const characters = await db.select<
    Array<{
      id: string;
      name: string;
      description: string | null;
      style_notes: string | null;
      ref_images: string | null;
      primary_image: string | null;
      prompt_hint: string | null;
      default_look_id: string | null;
      created_at: number;
      updated_at: number;
    }>
  >(
    `SELECT
       id,
       name,
       description,
       style_notes,
       ref_images,
       primary_image,
       prompt_hint,
       default_look_id,
       created_at,
       updated_at
     FROM characters`,
  );

  for (const character of characters) {
    const looks = await db.select<Array<{ id: string }>>(
      `SELECT id
       FROM character_looks
       WHERE character_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [character.id],
    );

    if (looks.length === 0) {
      const lookId = crypto.randomUUID();
      const timestamp = character.updated_at || character.created_at || Date.now();
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
          lookId,
          character.id,
          "Default Look",
          JSON.stringify({
            continuityNotes: character.style_notes ?? "",
          }),
          character.prompt_hint ?? character.style_notes ?? character.description ?? "",
          character.prompt_hint ?? character.style_notes ?? character.description ?? "",
          0,
          character.ref_images ?? JSON.stringify([]),
          character.primary_image ?? null,
          1,
          timestamp,
          timestamp,
        ],
      );
      await db.execute(
        `UPDATE characters
         SET default_look_id = $1,
             updated_at = COALESCE(NULLIF(updated_at, 0), created_at, $2)
         WHERE id = $3`,
        [lookId, timestamp, character.id],
      );
      continue;
    }

    const defaultLookId =
      character.default_look_id &&
      looks.some((look) => look.id === character.default_look_id)
        ? character.default_look_id
        : looks[0]?.id ?? null;

    if (defaultLookId && defaultLookId !== character.default_look_id) {
      await db.execute(
        "UPDATE characters SET default_look_id = $1 WHERE id = $2",
        [defaultLookId, character.id],
      );
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
