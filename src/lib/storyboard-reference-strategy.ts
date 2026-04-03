export type StoryboardReferenceStrategy =
  | "augment"
  | "explicit-only"
  | "parent-start-dominant";

export type StoryboardReferenceMode = "start" | "end" | "coverage";

function normalizeReferencePaths(
  referencePaths: ReadonlyArray<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      referencePaths
        .map((referencePath) => referencePath?.trim() ?? "")
        .filter(Boolean),
    ),
  );
}

export function resolveStoryboardReferenceStrategy(params: {
  mode: StoryboardReferenceMode;
  hasParentShot: boolean;
  strategy?: StoryboardReferenceStrategy;
}): StoryboardReferenceStrategy {
  if (params.strategy) {
    return params.strategy;
  }

  if (
    params.hasParentShot &&
    (params.mode === "start" || params.mode === "coverage")
  ) {
    return "parent-start-dominant";
  }

  return "augment";
}

export function composeStoryboardReferencePaths(params: {
  strategy: StoryboardReferenceStrategy;
  explicitReferenceImagePaths?: ReadonlyArray<string | null | undefined>;
  implicitReferenceImagePaths?: ReadonlyArray<string | null | undefined>;
  dominantReferenceImagePath?: string | null;
}): string[] {
  const explicitReferenceImagePaths = normalizeReferencePaths(
    params.explicitReferenceImagePaths ?? [],
  );
  const implicitReferenceImagePaths = normalizeReferencePaths(
    params.implicitReferenceImagePaths ?? [],
  );

  if (params.strategy === "explicit-only") {
    return explicitReferenceImagePaths;
  }

  if (params.strategy === "parent-start-dominant") {
    const dominantReferenceImagePath = params.dominantReferenceImagePath?.trim() ?? "";

    if (!dominantReferenceImagePath) {
      throw new Error("Parent START referansi gerekli.");
    }

    return normalizeReferencePaths([
      dominantReferenceImagePath,
      ...explicitReferenceImagePaths,
      ...implicitReferenceImagePaths,
    ]);
  }

  return normalizeReferencePaths([
    ...explicitReferenceImagePaths,
    ...implicitReferenceImagePaths,
  ]);
}
