function normalizeLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveServerEnvironmentLabel(input: {
  readonly cwdBaseName: string;
  readonly hostname?: string | null;
}): string {
  return normalizeLabel(input.hostname) ?? normalizeLabel(input.cwdBaseName) ?? "Graft";
}
