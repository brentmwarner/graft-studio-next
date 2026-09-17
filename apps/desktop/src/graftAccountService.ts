import type { GraftAccountIdentity, GraftAccountIssue, GraftAccountState } from "@graft/contracts";

import {
  GRAFT_CONTROL_PLANE_URL,
  GraftAccountLoginService,
  readAccountResponseBody,
  validateControlPlaneBaseUrl,
} from "@graft/shared/graftAccountLogin";
import {
  AccountStorageUnavailable,
  type GraftAccountTokenStore,
  type VerifiedGraftAccount,
} from "./graftAccountTokenStore";

const REQUEST_TIMEOUT_MS = 10_000;

class RejectedAccountSession extends Error {}
class InvalidAccountResponse extends Error {}

function parseAccount(value: unknown): GraftAccountIdentity {
  if (!value || typeof value !== "object")
    throw new InvalidAccountResponse("Invalid account response.");
  const account = value as Record<string, unknown>;
  if (
    typeof account.accountId !== "string" ||
    account.accountId.trim().length === 0 ||
    account.accountId.length > 256 ||
    typeof account.email !== "string" ||
    account.email.trim().length === 0 ||
    account.email.length > 320
  ) {
    throw new InvalidAccountResponse("Invalid account response.");
  }
  return { accountId: account.accountId, email: account.email };
}

function storageIssue(error: unknown): GraftAccountIssue {
  return error instanceof AccountStorageUnavailable
    ? "secure-storage-unavailable"
    : "storage-failed";
}

/** Hosted product identity is separate from the local server's bootstrap/session policy. */
export class GraftAccountService {
  private state: GraftAccountState = { status: "signed-out", account: null, issue: null };
  private generation = 0;
  private initialized = false;
  private disposed = false;
  private signOutPending = false;
  private offlineBlockedToken: string | null = null;
  private verifiedSession: { token: string; value: VerifiedGraftAccount } | null = null;
  private verification: AbortController | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly login: GraftAccountLoginService;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly dependencies: {
      readonly store: GraftAccountTokenStore;
      readonly openExternal: (url: string) => void | Promise<void>;
      readonly onState: (state: GraftAccountState) => void;
      readonly onSessionInvalidated?: () => Promise<void>;
      readonly connectRelay?: (token: string) => Promise<void>;
      readonly baseUrl?: string;
      readonly fetchImpl?: typeof fetch;
    },
  ) {
    this.baseUrl = validateControlPlaneBaseUrl(dependencies.baseUrl ?? GRAFT_CONTROL_PLANE_URL);
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.login = new GraftAccountLoginService({
      controlPlaneBaseUrl: this.baseUrl.toString(),
      openExternal: dependencies.openExternal,
      fetchImpl: this.fetchImpl,
      persistToken: (token) => this.acceptToken(token, this.generation),
      onComplete: (completion) => {
        if (this.disposed || this.state.status !== "signing-in" || completion.ok) return;
        this.setState({
          status: "signed-out",
          account: null,
          issue: completion.error === "timeout" ? "timeout" : "sign-in-failed",
        });
      },
    });
  }

  async getState(): Promise<GraftAccountState> {
    if (!this.initialized && !this.disposed) return this.refresh();
    return this.state;
  }

  private setState(state: GraftAccountState): void {
    this.state = state;
    if (!this.disposed) {
      try {
        this.dependencies.onState(state);
      } catch {
        // Window delivery cannot change the result of an account operation.
      }
    }
  }

  private invalidate(): number {
    this.generation += 1;
    this.verification?.abort();
    this.verification = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    return this.generation;
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  async signIn(): Promise<GraftAccountState> {
    if (this.disposed) return this.state;
    this.initialized = true;
    const generation = this.invalidate();
    this.setState({ status: "checking", account: null, issue: null });
    await this.login.cancel();
    if (!this.current(generation)) return this.state;
    try {
      this.dependencies.store.assertAvailable();
    } catch (error) {
      this.setState({ status: "signed-out", account: null, issue: storageIssue(error) });
      return this.state;
    }
    try {
      await this.dependencies.onSessionInvalidated?.();
    } catch {
      if (this.current(generation))
        this.setState({ status: "unavailable", account: null, issue: "disconnect-failed" });
      return this.state;
    }
    if (!this.current(generation)) return this.state;
    this.setState({ status: "signing-in", account: null, issue: null });
    try {
      await this.login.start();
    } catch {
      if (this.current(generation) && this.state.status === "signing-in") {
        this.setState({ status: "signed-out", account: null, issue: "sign-in-failed" });
      }
    }
    return this.state;
  }

  async connectRelay(): Promise<void> {
    if (this.state.status !== "signed-in" || !this.dependencies.connectRelay)
      throw new Error("Sign in to Graft before connecting remote access.");
    const token = this.dependencies.store.read();
    if (!token) throw new Error("Sign in to Graft before connecting remote access.");
    const generation = this.generation;
    try {
      await this.verifyAccount(token);
    } catch (error) {
      if (this.current(generation) && error instanceof RejectedAccountSession) await this.signOut();
      throw new Error("Could not verify the Graft account for remote access.");
    }
    if (!this.current(generation) || this.state.status !== "signed-in")
      throw new Error("The Graft account session changed.");
    await this.dependencies.connectRelay(token);
  }

  async cancelSignIn(): Promise<GraftAccountState> {
    const generation = this.invalidate();
    this.setState({ status: "signed-out", account: null, issue: null });
    await this.login.cancel();
    return this.current(generation) ? this.refresh() : this.state;
  }

  async signOut(): Promise<GraftAccountState> {
    this.initialized = true;
    this.signOutPending = true;
    const generation = this.invalidate();
    this.verifiedSession = null;
    this.setState({ status: "checking", account: null, issue: null });
    let issue: GraftAccountIssue | null = null;
    try {
      this.dependencies.store.clear();
    } catch {
      issue = "storage-failed";
    }
    try {
      await this.dependencies.onSessionInvalidated?.();
    } catch {
      issue = "disconnect-failed";
    }
    await this.login.cancel();
    if (this.current(generation)) {
      this.signOutPending = issue !== null;
      this.setState({ status: issue ? "unavailable" : "signed-out", account: null, issue });
    }
    return this.state;
  }

  async refresh(): Promise<GraftAccountState> {
    if (this.disposed || this.state.status === "signing-in") return this.state;
    if (this.signOutPending) return this.signOut();
    this.initialized = true;
    const generation = this.invalidate();
    let token: string | null;
    let cached: VerifiedGraftAccount | null = null;
    try {
      token = this.dependencies.store.read();
      if (token && token !== this.offlineBlockedToken)
        cached =
          this.verifiedSession?.token === token
            ? this.verifiedSession.value
            : (this.dependencies.store.readVerifiedAccount?.(token) ?? null);
    } catch (error) {
      this.setState({ status: "unavailable", account: null, issue: storageIssue(error) });
      return this.state;
    }
    if (!token) {
      this.setState({ status: "checking", account: null, issue: null });
      try {
        // A saved relay may outlive a missing account credential. Read/import the
        // credential first, then stop paired access before exposing signed-out.
        await this.dependencies.onSessionInvalidated?.();
      } catch {
        if (this.current(generation))
          this.setState({ status: "unavailable", account: null, issue: "disconnect-failed" });
        return this.state;
      }
      if (this.current(generation))
        this.setState({ status: "signed-out", account: null, issue: null });
      return this.state;
    }
    if (this.state.status !== "signed-in" || (cached && cached.expiresAt <= Date.now()))
      this.setState({ status: "checking", account: this.state.account, issue: null });
    try {
      const account = await this.verifyAccount(token);
      if (this.current(generation)) {
        const verified = this.verifiedAccount(token, account);
        try {
          this.dependencies.store.write(token, verified);
        } catch (error) {
          this.setState({ status: "unavailable", account: null, issue: storageIssue(error) });
          return this.state;
        }
        this.verifiedSession = verified ? { token, value: verified } : null;
        this.offlineBlockedToken = null;
        this.setState({ status: "signed-in", account, issue: null });
        this.scheduleSessionCheck(token);
      }
    } catch (error) {
      if (!this.current(generation)) return this.state;
      if (error instanceof RejectedAccountSession || (cached && cached.expiresAt <= Date.now())) {
        await this.signOut();
        if (this.state.status === "signed-out")
          this.setState({ status: "signed-out", account: null, issue: "session-expired" });
      } else if (error instanceof InvalidAccountResponse) {
        this.offlineBlockedToken = token;
        this.verifiedSession = null;
        try {
          this.dependencies.store.write(token);
        } catch {
          /* Never grant offline access from malformed authority responses. */
        }
        this.setState({ status: "unavailable", account: null, issue: "service-unavailable" });
        this.scheduleSessionCheck(token, 30_000);
      } else if (cached && cached.expiresAt > Date.now()) {
        // Only an identity previously verified by /account/me can receive offline grace.
        this.verifiedSession = { token, value: cached };
        this.setState({
          status: "signed-in",
          account: cached.account,
          issue: "service-unavailable",
        });
        this.scheduleSessionCheck(token, 30_000);
      } else {
        this.setState({ status: "unavailable", account: null, issue: "service-unavailable" });
        this.scheduleSessionCheck(token, 30_000);
      }
    }
    return this.state;
  }

  private async acceptToken(token: string, generation: number): Promise<void> {
    const account = await this.verifyAccount(token);
    if (!this.current(generation) || this.state.status !== "signing-in") {
      throw new Error("Sign-in was cancelled.");
    }
    try {
      const verified = this.verifiedAccount(token, account);
      this.dependencies.store.write(token, verified);
      this.verifiedSession = verified ? { token, value: verified } : null;
    } catch (error) {
      this.setState({ status: "signed-out", account: null, issue: storageIssue(error) });
      throw new Error("Could not save account session.");
    }
    this.signOutPending = false;
    this.offlineBlockedToken = null;
    this.setState({ status: "signed-in", account, issue: null });
    this.scheduleSessionCheck(token);
  }

  private async verifyAccount(token: string): Promise<GraftAccountIdentity> {
    const controller = new AbortController();
    this.verification = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(new URL("/account/me", this.baseUrl), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) throw new RejectedAccountSession();
      if (response.status === 429 || response.status >= 500)
        throw new Error("Account service is unavailable.");
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (!response.ok || mediaType !== "application/json")
        throw new InvalidAccountResponse("Invalid account response.");
      const body = await readAccountResponseBody(response);
      if (body === null) throw new InvalidAccountResponse("Invalid account response.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new InvalidAccountResponse("Invalid account response.");
      }
      return parseAccount(parsed);
    } finally {
      clearTimeout(timeout);
      if (this.verification === controller) this.verification = null;
    }
  }

  private verifiedAccount(
    token: string,
    account: GraftAccountIdentity,
  ): VerifiedGraftAccount | undefined {
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      );
      if (
        payload &&
        typeof payload === "object" &&
        "exp" in payload &&
        typeof payload.exp === "number" &&
        Number.isFinite(payload.exp)
      ) {
        return { account, expiresAt: payload.exp * 1_000 };
      }
    } catch {
      /* Opaque tokens cannot grant offline access. */
    }
    return undefined;
  }

  private scheduleSessionCheck(token: string, retryDelay?: number): void {
    // Claims are scheduling hints only; /account/me is the authentication authority.
    let delay = retryDelay ?? 5 * 60_000;
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      ) as { exp?: unknown };
      if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
        delay = Math.max(1_000, Math.min(delay, payload.exp * 1_000 - Date.now()));
      }
    } catch {
      // The server already accepted the token. An opaque token uses periodic checks.
    }
    this.expiryTimer = setTimeout(() => void this.refresh(), delay);
    this.expiryTimer.unref();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.invalidate();
    await this.login.dispose();
  }
}
