export function moveCharacterReference(
  refImages: string[],
  target: string,
  direction: -1 | 1,
): string[] {
  const currentIndex = refImages.indexOf(target);

  if (currentIndex === -1) {
    return refImages;
  }

  const nextIndex = currentIndex + direction;

  if (nextIndex < 0 || nextIndex >= refImages.length) {
    return refImages;
  }

  const next = refImages.slice();
  const [item] = next.splice(currentIndex, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function removeCharacterReference(
  refImages: string[],
  primaryImage: string | null,
  target: string,
): {
  refImages: string[];
  primaryImage: string | null;
} {
  const nextRefImages = refImages.filter((refImage) => refImage !== target);

  return {
    refImages: nextRefImages,
    primaryImage:
      primaryImage && primaryImage !== target
        ? primaryImage
        : nextRefImages[0] ?? null,
  };
}
