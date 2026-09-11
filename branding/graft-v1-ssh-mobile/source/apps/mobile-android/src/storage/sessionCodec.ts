import {
  GraftSessionCredentialSchema,
  type GraftSessionCredential,
} from "@graft/shared/mobile";

type PersistedSessionMetadata = Omit<GraftSessionCredential, "bearerToken">;

export class SessionStorageError extends Error {
  override readonly name = "SessionStorageError";
}

export function encodeSessionMetadata(session: GraftSessionCredential): string {
  const { bearerToken: _bearerToken, ...metadata } = session;
  return JSON.stringify(metadata satisfies PersistedSessionMetadata);
}

export function decodeSessionMetadata(
  encoded: string,
  bearerToken: string,
): GraftSessionCredential {
  let metadata: unknown;
  try {
    metadata = JSON.parse(encoded);
  } catch {
    throw new SessionStorageError("Stored session metadata is unreadable.");
  }

  const parsed = GraftSessionCredentialSchema.safeParse({
    ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
    bearerToken,
  });
  if (!parsed.success) {
    throw new SessionStorageError("Stored session metadata is invalid.");
  }
  return parsed.data;
}
