export interface ExternalReferenceLookupShot {
  id: string;
  shotNumber: string;
  parentShotId: string | null;
  prevShotId: string | null;
  requiresExternalReference: boolean;
  externalReferenceName: string | null;
  externalReferencePath: string | null;
}

function normalizeReferenceName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

export function resolveInheritedExternalReferencePath<
  TShot extends ExternalReferenceLookupShot,
>(
  shot: TShot,
  shots: readonly TShot[],
): string | null {
  if (shot.externalReferencePath) {
    return shot.externalReferencePath;
  }

  const shotsById = new Map(shots.map((candidate) => [candidate.id, candidate] as const));
  const referencePathByName = new Map<string, string>();

  for (const candidate of shots) {
    const normalizedName = normalizeReferenceName(candidate.externalReferenceName);

    if (
      normalizedName &&
      candidate.externalReferencePath &&
      !referencePathByName.has(normalizedName)
    ) {
      referencePathByName.set(normalizedName, candidate.externalReferencePath);
    }
  }

  const visited = new Set<string>();

  const visit = (candidate: TShot | undefined): string | null => {
    if (!candidate) {
      return null;
    }

    if (candidate.externalReferencePath) {
      return candidate.externalReferencePath;
    }

    const normalizedName = normalizeReferenceName(candidate.externalReferenceName);
    if (normalizedName) {
      const sharedPath = referencePathByName.get(normalizedName);
      if (sharedPath) {
        return sharedPath;
      }
    }

    if (visited.has(candidate.id)) {
      return null;
    }

    visited.add(candidate.id);

    const parentPath = visit(
      candidate.parentShotId ? shotsById.get(candidate.parentShotId) : undefined,
    );
    if (parentPath) {
      return parentPath;
    }

    return visit(candidate.prevShotId ? shotsById.get(candidate.prevShotId) : undefined);
  };

  return visit(shot);
}
