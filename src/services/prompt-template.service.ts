import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";

export interface PromptTemplateRecord {
  id: string;
  name: string;
  category: string | null;
  content: string;
  model: string | null;
  createdAt: number;
}

type PromptTemplateRow = {
  id: string;
  name: string;
  category: string | null;
  content: string;
  model: string | null;
  createdAt: number;
};

function mapRow(row: PromptTemplateRow): PromptTemplateRecord {
  return {
    ...row,
    category: row.category ?? null,
    model: row.model ?? null,
  };
}

export async function listPromptTemplates(): Promise<PromptTemplateRecord[]> {
  const db = await getProjectDb();
  const rows = await db.select<PromptTemplateRow[]>(
    `SELECT
       id,
       name,
       category,
       content,
       model,
       created_at AS createdAt
     FROM prompt_templates
     ORDER BY created_at DESC, lower(name) ASC`,
  );

  return rows.map(mapRow);
}

export async function createPromptTemplate(input: {
  name: string;
  category?: string | null;
  content: string;
  model?: string | null;
}): Promise<PromptTemplateRecord> {
  const db = await getProjectDb();
  const record: PromptTemplateRecord = {
    id: uuidv4(),
    name: input.name.trim(),
    category: input.category?.trim() || null,
    content: input.content.trim(),
    model: input.model?.trim() || null,
    createdAt: Date.now(),
  };

  await db.execute(
    `INSERT INTO prompt_templates (id, name, category, content, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      record.id,
      record.name,
      record.category,
      record.content,
      record.model,
      record.createdAt,
    ],
  );
  await syncProjectDbMirror();
  return record;
}

export async function updatePromptTemplate(
  id: string,
  updates: {
    name: string;
    category?: string | null;
    content: string;
    model?: string | null;
  },
): Promise<void> {
  const db = await getProjectDb();
  await db.execute(
    `UPDATE prompt_templates
     SET name = $1, category = $2, content = $3, model = $4
     WHERE id = $5`,
    [
      updates.name.trim(),
      updates.category?.trim() || null,
      updates.content.trim(),
      updates.model?.trim() || null,
      id,
    ],
  );
  await syncProjectDbMirror();
}

export async function duplicatePromptTemplate(id: string): Promise<PromptTemplateRecord> {
  const template = await getPromptTemplate(id);

  if (!template) {
    throw new Error("Prompt template bulunamadi.");
  }

  return createPromptTemplate({
    name: `${template.name} Copy`,
    category: template.category,
    content: template.content,
    model: template.model,
  });
}

export async function deletePromptTemplate(id: string): Promise<void> {
  const db = await getProjectDb();
  await db.execute("DELETE FROM prompt_templates WHERE id = $1", [id]);
  await syncProjectDbMirror();
}

export async function getPromptTemplate(id: string): Promise<PromptTemplateRecord | null> {
  const db = await getProjectDb();
  const rows = await db.select<PromptTemplateRow[]>(
    `SELECT
       id,
       name,
       category,
       content,
       model,
       created_at AS createdAt
     FROM prompt_templates
     WHERE id = $1
     LIMIT 1`,
    [id],
  );

  return rows[0] ? mapRow(rows[0]) : null;
}
