export const ASSET_GROUP_TAG_PREFIX = "group:";

const SYSTEM_TAG_PREFIXES = ["stage:", "variant:", "character:", "look:", ASSET_GROUP_TAG_PREFIX];
const SYSTEM_TAGS = new Set(["autonomous", "candidate", "selected", "upscale", "4k"]);

export function isSystemAssetTag(tag: string): boolean {
  return SYSTEM_TAGS.has(tag) || SYSTEM_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix));
}

export function splitAssetTags(tags: string[]): {
  systemTags: string[];
  userTags: string[];
} {
  const uniqueTags = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));

  return {
    systemTags: uniqueTags.filter(isSystemAssetTag),
    userTags: uniqueTags.filter((tag) => !isSystemAssetTag(tag)),
  };
}

export function parseUserAssetTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeAssetGroupName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 48);
  return normalized ? normalized : null;
}

export function getAssetGroupName(tags: string[]): string | null {
  const match = tags.find((tag) => tag.startsWith(ASSET_GROUP_TAG_PREFIX));
  return match ? normalizeAssetGroupName(match.slice(ASSET_GROUP_TAG_PREFIX.length)) : null;
}

export function replaceAssetGroupTag(tags: string[], groupName: string | null): string[] {
  const nextTags = tags.filter((tag) => !tag.startsWith(ASSET_GROUP_TAG_PREFIX));
  const normalizedGroupName = normalizeAssetGroupName(groupName ?? "");

  if (!normalizedGroupName) {
    return Array.from(new Set(nextTags));
  }

  return Array.from(new Set([...nextTags, `${ASSET_GROUP_TAG_PREFIX}${normalizedGroupName}`]));
}
