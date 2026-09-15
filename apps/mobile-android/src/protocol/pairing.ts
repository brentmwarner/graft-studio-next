import {
  GraftPairingPayloadSchema,
  parseGraftPairingUrl,
  type GraftPairingPayload,
} from "@graft/mobile-contract";

export class PairingInputError extends Error {
  override readonly name = "PairingInputError";
}

export function parsePairingInput(raw: string): GraftPairingPayload {
  const input = raw.trim();
  if (!input) {
    throw new PairingInputError("Enter a pairing link or scan its QR code.");
  }

  const linkPayload = parseGraftPairingUrl(input);
  if (linkPayload) return linkPayload;

  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    throw new PairingInputError("That is not a valid Graft pairing link or payload.");
  }

  const parsed = GraftPairingPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new PairingInputError(
      "The pairing payload is invalid or uses an unsupported protocol version.",
    );
  }

  return parsed.data;
}
