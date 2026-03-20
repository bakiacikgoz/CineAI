const SYSTEM_TAG_PREFIXES = ["stage:", "variant:", "character:", "look:"];
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
