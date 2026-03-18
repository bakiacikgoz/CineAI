import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";

export interface ModelPresetRecord {
  id: string;
  name: string;
  imageModel: string | null;
  videoModel: string | null;
  imageParams: string | null;
  videoParams: string | null;
  isDefault: boolean;
  createdAt: number;
}

export interface ModelPresetInput {
  name: string;
  imageModel?: string | null;
  videoModel?: string | null;
  imageParams?: string | null;
  videoParams?: string | null;
  isDefault?: boolean;
}

export interface ModelPresetSummary {
  total: number;
  defaultCount: number;
  imageCapable: number;
  videoCapable: number;
}

type ModelPresetRow = {
  id: string;
  name: string;
  imageModel: string | null;
  videoModel: string | null;
  imageParams: string | null;
  videoParams: string | null;
  isDefault: number;
  createdAt: number;
};

function mapRow(row: ModelPresetRow): ModelPresetRecord {
  return {
    id: row.id,
    name: row.name,
    imageModel: row.imageModel ?? null,
    videoModel: row.videoModel ?? null,
    imageParams: row.imageParams ?? null,
    videoParams: row.videoParams ?? null,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
  };
}

function normalizeNullableString(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeJson(value?: string | null): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(normalized), null, 2);
  } catch {
    throw new Error("Preset parametre JSON alanlari gecerli JSON olmali.");
  }
}

function buildPresetPayload(input: ModelPresetInput): Omit<ModelPresetRecord, "id" | "createdAt"> {
  const name = input.name.trim();
  const imageModel = normalizeNullableString(input.imageModel);
  const videoModel = normalizeNullableString(input.videoModel);

  if (!name) {
    throw new Error("Preset adi zorunludur.");
  }

  if (!imageModel && !videoModel) {
    throw new Error("En az bir image veya video modeli secilmelidir.");
  }

  return {
    name,
    imageModel,
    videoModel,
    imageParams: normalizeJson(input.imageParams),
    videoParams: normalizeJson(input.videoParams),
    isDefault: input.isDefault ?? false,
  };
}

export async function listModelPresets(): Promise<ModelPresetRecord[]> {
  const db = await getProjectDb();
  const rows = await db.select<ModelPresetRow[]>(
    `SELECT
       id,
       name,
       image_model AS imageModel,
       video_model AS videoModel,
       image_params AS imageParams,
       video_params AS videoParams,
       is_default AS isDefault,
       created_at AS createdAt
     FROM model_presets
     ORDER BY is_default DESC, created_at DESC, lower(name) ASC`,
  );
  return rows.map(mapRow);
}

export async function getModelPresetSummary(): Promise<ModelPresetSummary> {
  const presets = await listModelPresets();

  return {
    total: presets.length,
    defaultCount: presets.filter((preset) => preset.isDefault).length,
    imageCapable: presets.filter((preset) => Boolean(preset.imageModel)).length,
    videoCapable: presets.filter((preset) => Boolean(preset.videoModel)).length,
  };
}

export async function createModelPreset(input: ModelPresetInput): Promise<ModelPresetRecord> {
  const db = await getProjectDb();
  const payload = buildPresetPayload(input);
  const preset: ModelPresetRecord = {
    id: uuidv4(),
    ...payload,
    createdAt: Date.now(),
  };

  if (preset.isDefault) {
    await db.execute("UPDATE model_presets SET is_default = 0");
  }

  await db.execute(
    `INSERT INTO model_presets (
       id, name, image_model, video_model, image_params, video_params, is_default, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      preset.id,
      preset.name,
      preset.imageModel,
      preset.videoModel,
      preset.imageParams,
      preset.videoParams,
      preset.isDefault ? 1 : 0,
      preset.createdAt,
    ],
  );
  await syncProjectDbMirror();
  return preset;
}

export async function updateModelPreset(
  id: string,
  updates: ModelPresetInput,
): Promise<void> {
  const db = await getProjectDb();
  const payload = buildPresetPayload(updates);

  if (payload.isDefault) {
    await db.execute("UPDATE model_presets SET is_default = 0");
  }

  await db.execute(
    `UPDATE model_presets
     SET name = $1,
         image_model = $2,
         video_model = $3,
         image_params = $4,
         video_params = $5,
         is_default = $6
     WHERE id = $7`,
    [
      payload.name,
      payload.imageModel,
      payload.videoModel,
      payload.imageParams,
      payload.videoParams,
      payload.isDefault ? 1 : 0,
      id,
    ],
  );
  await syncProjectDbMirror();
}

export async function duplicateModelPreset(id: string): Promise<ModelPresetRecord> {
  const preset = await getModelPreset(id);

  if (!preset) {
    throw new Error("Model preset bulunamadi.");
  }

  return createModelPreset({
    name: `${preset.name} Copy`,
    imageModel: preset.imageModel,
    videoModel: preset.videoModel,
    imageParams: preset.imageParams,
    videoParams: preset.videoParams,
    isDefault: false,
  });
}

export async function deleteModelPreset(id: string): Promise<void> {
  const db = await getProjectDb();
  await db.execute("DELETE FROM model_presets WHERE id = $1", [id]);
  await syncProjectDbMirror();
}

export async function getModelPreset(id: string): Promise<ModelPresetRecord | null> {
  const db = await getProjectDb();
  const rows = await db.select<ModelPresetRow[]>(
    `SELECT
       id,
       name,
       image_model AS imageModel,
       video_model AS videoModel,
       image_params AS imageParams,
       video_params AS videoParams,
       is_default AS isDefault,
       created_at AS createdAt
     FROM model_presets
     WHERE id = $1
     LIMIT 1`,
    [id],
  );

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getDefaultModelPreset(): Promise<ModelPresetRecord | null> {
  const db = await getProjectDb();
  const rows = await db.select<ModelPresetRow[]>(
    `SELECT
       id,
       name,
       image_model AS imageModel,
       video_model AS videoModel,
       image_params AS imageParams,
       video_params AS videoParams,
       is_default AS isDefault,
       created_at AS createdAt
     FROM model_presets
     WHERE is_default = 1
     LIMIT 1`,
  );

  return rows[0] ? mapRow(rows[0]) : null;
}
