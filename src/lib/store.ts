import { Store } from "@tauri-apps/plugin-store";

let storeInstance: Store | null = null;

export type ApiKeyName =
  | "FAL_API_KEY"
  | "TENSORPIX_API_KEY"
  | "OPENROUTER_API_KEY";

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load("settings.dat");
  }

  return storeInstance;
}

export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>(key)) ?? null;
}

export async function setApiKey(key: ApiKeyName, value: string): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
