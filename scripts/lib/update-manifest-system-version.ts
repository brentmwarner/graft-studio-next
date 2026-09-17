interface ApplyMinimumSystemVersionInput {
  readonly raw: string;
  readonly sourcePath: string;
  readonly minimumSystemVersion: string;
}

export function applyMinimumSystemVersionToUpdateManifest(
  input: ApplyMinimumSystemVersionInput,
): string {
  if (!/^\d+(?:\.\d+)+$/.test(input.minimumSystemVersion)) {
    throw new Error(
      `Invalid minimum system version '${input.minimumSystemVersion}' for ${input.sourcePath}.`,
    );
  }

  const propertyPattern = /^minimumSystemVersion:\s*.*$/gm;
  const matches = input.raw.match(propertyPattern) ?? [];
  if (matches.length > 1) {
    throw new Error(`Duplicate minimumSystemVersion fields in ${input.sourcePath}.`);
  }

  const property = `minimumSystemVersion: ${input.minimumSystemVersion}`;
  if (matches.length === 1) {
    return input.raw.replace(propertyPattern, property);
  }

  if (!/^releaseDate:\s*.+$/m.test(input.raw)) {
    throw new Error(`Cannot add minimumSystemVersion to ${input.sourcePath}: missing releaseDate.`);
  }

  return input.raw.replace(/^releaseDate:/m, `${property}\nreleaseDate:`);
}
