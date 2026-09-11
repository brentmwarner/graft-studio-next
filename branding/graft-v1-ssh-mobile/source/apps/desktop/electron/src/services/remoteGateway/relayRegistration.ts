import {
  GRAFT_RELAY_ENVIRONMENTS_PATH,
  GraftRelayEnvironmentRegistrationSchema,
  type GraftRelayEnvironmentRegistration,
} from "@graft/shared";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore.js";

/**
 * Registers this desktop as a relay environment and remembers the uplink
 * secret.
 *
 * The secret lives in the same encrypted store as mobile session bearers, and
 * the environment id is kept alongside it so a re-registration refreshes the
 * secret without changing the relay URL already paired phones hold.
 */

const RELAY_CREDENTIAL_ACCOUNT_KEY = "relay-uplink";
const REGISTRATION_TIMEOUT_MS = 15_000;

export type RelayCredential = {
  environmentId: string;
  uplinkSecret: string;
  httpBaseUrl: string;
  wsBaseUrl: string;
  uplinkUrl: string;
};

export class RelaySignedOutError extends Error {
  constructor() {
    super("Sign in to your Graft account to use the managed relay.");
    this.name = "RelaySignedOutError";
  }
}

export type RelayRegistrationDependencies = {
  controlPlaneBaseUrl: string;
  /** Graft account JWT, or null when signed out. */
  getAccountToken: () => Promise<string | null>;
  secretStore: RemoteSessionSecretStore;
  label?: string;
  fetchImpl?: typeof fetch;
};

export function readStoredRelayCredential(
  secretStore: RemoteSessionSecretStore,
): RelayCredential | null {
  let serialized: string | null;
  try {
    serialized = secretStore.get(RELAY_CREDENTIAL_ACCOUNT_KEY);
  } catch {
    return null;
  }
  if (!serialized) return null;

  try {
    const parsed = GraftRelayEnvironmentRegistrationSchema.safeParse(
      JSON.parse(serialized),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearStoredRelayCredential(
  secretStore: RemoteSessionSecretStore,
): void {
  try {
    secretStore.delete(RELAY_CREDENTIAL_ACCOUNT_KEY);
  } catch {
    // A stale credential fails closed at the relay anyway.
  }
}

/**
 * Return a usable relay credential, registering with the control plane when
 * none is stored. Throws `RelaySignedOutError` when there is no account token
 * and drops any leftover uplink secret so a previous sign-in cannot keep the
 * relay connected.
 */
export async function ensureRelayCredential(
  dependencies: RelayRegistrationDependencies,
): Promise<RelayCredential> {
  const token = await dependencies.getAccountToken();
  if (!token) {
    clearStoredRelayCredential(dependencies.secretStore);
    throw new RelaySignedOutError();
  }
  const stored = readStoredRelayCredential(dependencies.secretStore);
  if (stored) return stored;
  return registerRelayEnvironment(dependencies);
}

export async function registerRelayEnvironment(
  dependencies: RelayRegistrationDependencies,
  input: { environmentId?: string } = {},
): Promise<RelayCredential> {
  const token = await dependencies.getAccountToken();
  if (!token) {
    throw new RelaySignedOutError();
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRATION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(
      `${dependencies.controlPlaneBaseUrl.replace(/\/+$/, "")}${GRAFT_RELAY_ENVIRONMENTS_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(dependencies.label ? { label: dependencies.label } : {}),
          ...(input.environmentId
            ? { environmentId: input.environmentId }
            : {}),
        }),
        signal: controller.signal,
      },
    );
  } catch (error) {
    throw new Error(
      `Could not reach the Graft relay service: ${describeError(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new RelaySignedOutError();
  }
  if (!response.ok) {
    throw new Error(
      `The Graft relay service rejected registration (${response.status}).`,
    );
  }

  const parsed = GraftRelayEnvironmentRegistrationSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new Error("The Graft relay service returned an unusable response.");
  }

  dependencies.secretStore.set(
    RELAY_CREDENTIAL_ACCOUNT_KEY,
    JSON.stringify(parsed.data),
  );
  return parsed.data;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
