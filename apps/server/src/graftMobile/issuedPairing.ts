let lastPairingUrl: string | null = null;
let lastPairingExpiresAt: number | null = null;

export function rememberIssuedPairing(input: {
  readonly pairingUrl: string;
  readonly expiresAt: number;
}): void {
  lastPairingUrl = input.pairingUrl;
  lastPairingExpiresAt = input.expiresAt;
}

export function getIssuedPairing(): {
  readonly pairingUrl: string | null;
  readonly pairingExpiresAt: number | null;
} {
  if (lastPairingUrl && lastPairingExpiresAt && lastPairingExpiresAt > Date.now()) {
    return { pairingUrl: lastPairingUrl, pairingExpiresAt: lastPairingExpiresAt };
  }
  return { pairingUrl: null, pairingExpiresAt: null };
}
