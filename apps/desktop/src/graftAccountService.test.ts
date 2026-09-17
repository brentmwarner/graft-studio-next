import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraftAccountService } from "./graftAccountService";
import { AccountStorageUnavailable } from "./graftAccountTokenStore";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2N0X3Rlc3QifQ.signature";
const ACCOUNT = { accountId: "account-existing", email: "person@example.test" };
const services: GraftAccountService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.useRealTimers();
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(initialToken: string | null = null) {
  let token = initialToken;
  const store = {
    assertAvailable: vi.fn(),
    read: vi.fn(() => token),
    readVerifiedAccount: vi.fn(() => null),
    write: vi.fn((next: string) => {
      token = next;
    }),
    clear: vi.fn(() => {
      token = null;
    }),
  };
  const fetchImpl = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/account/me") ? json(ACCOUNT) : json({ token: TOKEN }),
  );
  const openExternal = vi.fn();
  const onState = vi.fn();
  const onSessionInvalidated = vi.fn(async () => {});
  const connectRelay = vi.fn(async (_token: string) => {});
  const service = new GraftAccountService({
    store,
    fetchImpl,
    openExternal,
    onState,
    onSessionInvalidated,
    connectRelay,
  });
  services.push(service);
  return { service, store, fetchImpl, openExternal, onState, onSessionInvalidated, connectRelay };
}

async function completeLogin(signInUrl: string) {
  const login = new URL(signInUrl);
  return fetch(`http://127.0.0.1:${login.searchParams.get("callback_port")}/auth/callback`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      state: login.searchParams.get("state")!,
      grant: "g".repeat(43),
    }).toString(),
  });
}

describe("Graft account lifecycle", () => {
  it("disconnects saved remote access before exposing signed-out startup without marking legacy import complete", async () => {
    const { service, store, fetchImpl, onSessionInvalidated } = harness();
    const disconnect = deferred<void>();
    onSessionInvalidated.mockReturnValueOnce(disconnect.promise);
    const restoring = service.getState();
    expect(store.read).toHaveBeenCalledOnce();
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    expect((await service.getState()).status).toBe("checking");
    disconnect.resolve();
    expect(await restoring).toEqual({ status: "signed-out", account: null, issue: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it("retries failed signed-out startup cleanup after reading the account store again", async () => {
    const { service, store, onSessionInvalidated } = harness();
    onSessionInvalidated.mockRejectedValueOnce(new Error("backend unavailable"));
    expect(await service.getState()).toEqual({
      status: "unavailable",
      account: null,
      issue: "disconnect-failed",
    });
    expect((await service.refresh()).status).toBe("signed-out");
    expect(store.read).toHaveBeenCalledTimes(2);
    expect(onSessionInvalidated).toHaveBeenCalledTimes(2);
    expect(store.clear).not.toHaveBeenCalled();
  });

  it("restores the existing account through the hosted service without exposing its token", async () => {
    const { service, fetchImpl, onState } = harness(TOKEN);
    expect(await service.getState()).toEqual({
      status: "signed-in",
      account: ACCOUNT,
      issue: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.graftapp.io/account/me"),
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
        redirect: "error",
      }),
    );
    expect(JSON.stringify(onState.mock.calls)).not.toContain(TOKEN);
  });

  it.each(["credential", "verified cache"])("disconnects paired access when the %s cannot be read and preserves retry", async (source) => {
    const { service, store, fetchImpl, onSessionInvalidated } = harness(TOKEN);
    const read = source === "credential" ? store.read : store.readVerifiedAccount;
    read.mockImplementationOnce(() => { throw new AccountStorageUnavailable(); });
    const disconnect = deferred<void>();
    onSessionInvalidated.mockReturnValueOnce(disconnect.promise);
    const restoring = service.getState();
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    expect((await service.getState()).status).toBe("checking");
    expect(fetchImpl).not.toHaveBeenCalled();
    disconnect.resolve();
    expect(await restoring).toEqual({ status: "unavailable", account: null, issue: "secure-storage-unavailable" });
    expect(store.clear).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect((await service.refresh()).status).toBe("signed-in");
    expect(store.read()).toBe(TOKEN);
  });

  it("disconnects paired access after verified-token persistence fails and preserves the saved token for retry", async () => {
    const { service, store, onSessionInvalidated } = harness(TOKEN);
    await service.getState();
    store.write.mockImplementationOnce(() => { throw new Error("disk full"); });
    expect(await service.refresh()).toEqual({ status: "unavailable", account: null, issue: "storage-failed" });
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    expect(store.clear).not.toHaveBeenCalled();
    expect(store.read()).toBe(TOKEN);
    expect((await service.refresh()).status).toBe("signed-in");
  });

  it("retries failed paired cleanup before restored storage can reopen the account", async () => {
    const { service, store, fetchImpl, onSessionInvalidated } = harness(TOKEN);
    store.read.mockImplementationOnce(() => { throw new AccountStorageUnavailable(); });
    onSessionInvalidated.mockRejectedValueOnce(new Error("backend unavailable"));
    expect((await service.getState()).issue).toBe("disconnect-failed");
    const disconnect = deferred<void>();
    onSessionInvalidated.mockReturnValueOnce(disconnect.promise);
    const retry = service.refresh();
    expect(onSessionInvalidated).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    disconnect.resolve();
    expect((await retry).status).toBe("signed-in");
    expect(store.clear).not.toHaveBeenCalled();
  });

  it("does not overwrite a new sign-in when unavailable-account cleanup finishes late", async () => {
    const { service, store, onSessionInvalidated } = harness(TOKEN);
    store.read.mockImplementationOnce(() => { throw new AccountStorageUnavailable(); });
    const disconnect = deferred<void>();
    onSessionInvalidated.mockReturnValueOnce(disconnect.promise);
    const restoring = service.getState();
    expect((await service.signIn()).status).toBe("signing-in");
    disconnect.resolve();
    expect((await restoring).status).toBe("signing-in");
  });

  it("disconnects a previously verified account after a malformed authority response and retries without offline grace", async () => {
    vi.useFakeTimers();
    const token = "header." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".signature";
    const { service, store, fetchImpl, onSessionInvalidated } = harness(token);
    await service.getState();
    fetchImpl.mockResolvedValueOnce(json({ accountId: "incomplete" }));
    expect((await service.refresh()).status).toBe("unavailable");
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    expect(store.clear).not.toHaveBeenCalled();
    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await service.getState()).status).toBe("unavailable");
    expect(onSessionInvalidated).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await service.getState()).status).toBe("signed-in");
  });

  it("validates the account before saving a browser login and uses the original PKCE verifier", async () => {
    const { service, store, openExternal, fetchImpl } = harness();
    expect((await service.signIn()).status).toBe("signing-in");
    const loginUrl = openExternal.mock.calls[0]![0] as string;
    const response = await completeLogin(loginUrl);
    expect(response.status).toBe(200);
    await response.text();
    expect(store.write).toHaveBeenCalledWith(TOKEN, undefined);
    expect((await service.getState()).account).toEqual(ACCOUNT);
    const exchange = fetchImpl.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/desktop/exchange"),
    )!;
    const body = JSON.parse(String(exchange[1]!.body)) as { code_verifier: string };
    expect(createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(
      new URL(loginUrl).searchParams.get("code_challenge"),
    );
  });

  it("does not persist an exchange token that /account/me rejects", async () => {
    const { service, store, openExternal, fetchImpl } = harness();
    fetchImpl.mockImplementation(async (url) =>
      String(url).endsWith("/account/me") ? json({}, 401) : json({ token: TOKEN }),
    );
    await service.signIn();
    const response = await completeLogin(openExternal.mock.calls[0]![0] as string);
    await response.text();
    expect(store.write).not.toHaveBeenCalled();
    expect((await service.getState()).status).toBe("signed-out");
  });

  it("clears expired sessions, but retains them during an outage and supports retry", async () => {
    const { service, store, fetchImpl } = harness(TOKEN);
    fetchImpl.mockRejectedValueOnce(new Error("network failed"));
    expect((await service.getState()).issue).toBe("service-unavailable");
    expect(store.clear).not.toHaveBeenCalled();
    expect((await service.refresh()).status).toBe("signed-in");
    fetchImpl.mockResolvedValueOnce(json({}, 401));
    expect(await service.refresh()).toEqual({
      status: "signed-out",
      account: null,
      issue: "session-expired",
    });
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it("cannot restore a session after sign-out wins a pending account check", async () => {
    const { service, store, fetchImpl } = harness(TOKEN);
    const pending = deferred<Response>();
    fetchImpl.mockReturnValueOnce(pending.promise);
    const restoring = service.getState();
    await service.signOut();
    pending.resolve(json(ACCOUNT));
    await restoring;
    expect(await service.getState()).toEqual({ status: "signed-out", account: null, issue: null });
    expect(store.read()).toBeNull();
  });

  it("cannot save a login when sign-out wins the pending account verification", async () => {
    const { service, store, fetchImpl, openExternal } = harness();
    const pending = deferred<Response>();
    fetchImpl.mockImplementation(async (url) =>
      String(url).endsWith("/account/me") ? pending.promise : json({ token: TOKEN }),
    );
    await service.signIn();
    const callback = completeLogin(openExternal.mock.calls[0]![0] as string).catch(() => null);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const signOut = service.signOut();
    pending.resolve(json(ACCOUNT));
    await signOut;
    const response = await callback;
    if (response) await response.text();
    expect(store.write).not.toHaveBeenCalled();
    expect((await service.getState()).status).toBe("signed-out");
  });

  it("does not open the browser when secure storage is unavailable", async () => {
    const { service, store, openExternal } = harness();
    store.assertAvailable.mockImplementation(() => {
      throw new AccountStorageUnavailable();
    });
    expect((await service.signIn()).issue).toBe("secure-storage-unavailable");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports a failed durable sign-out and allows retry", async () => {
    const { service, store } = harness(TOKEN);
    await service.getState();
    store.clear.mockImplementationOnce(() => {
      throw new Error("disk denied");
    });
    expect((await service.signOut()).issue).toBe("storage-failed");
    expect((await service.signOut()).status).toBe("signed-out");
    expect(store.read()).toBeNull();
  });
  it("keeps a previously verified unexpired account during an outage and retries automatically", async () => {
    vi.useFakeTimers();
    const token =
      "header." +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        "base64url",
      ) +
      ".signature";
    const { service, fetchImpl, onSessionInvalidated } = harness(token);
    await service.getState();
    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await service.getState()).toEqual({
      status: "signed-in",
      account: ACCOUNT,
      issue: "service-unavailable",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await service.getState()).issue).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onSessionInvalidated).not.toHaveBeenCalled();
  });

  it("never authenticates an unverified token during an outage", async () => {
    vi.useFakeTimers();
    const { service, fetchImpl, onSessionInvalidated } = harness(TOKEN);
    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    expect((await service.getState()).status).toBe("unavailable");
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await service.getState()).status).toBe("signed-in");
  });

  it("disconnects remote access on sign-out, account switch and expired session", async () => {
    const { service, fetchImpl, onSessionInvalidated } = harness(TOKEN);
    await service.getState();
    await service.signIn();
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    await service.cancelSignIn();
    fetchImpl.mockResolvedValueOnce(json({}, 401));
    await service.refresh();
    expect(onSessionInvalidated).toHaveBeenCalledTimes(2);
    await service.signOut();
    expect(onSessionInvalidated).toHaveBeenCalledTimes(3);
  });

  it("does not report sign-out complete when remote access could not be disconnected", async () => {
    const { service, onSessionInvalidated } = harness(TOKEN);
    onSessionInvalidated.mockRejectedValueOnce(new Error("backend unavailable"));
    expect((await service.signOut()).issue).toBe("disconnect-failed");
    expect((await service.refresh()).status).toBe("signed-out");
    expect(onSessionInvalidated).toHaveBeenCalledTimes(2);
  });

  it("ends offline grace at the verified session expiry and disconnects paired access", async () => {
    vi.useFakeTimers();
    const token =
      "header." +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString(
        "base64url",
      ) +
      ".signature";
    const { service, fetchImpl, onSessionInvalidated, store } = harness(token);
    await service.getState();
    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await service.getState()).toEqual({
      status: "signed-out",
      account: null,
      issue: "session-expired",
    });
    expect(onSessionInvalidated).toHaveBeenCalledOnce();
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it("connects remote access with the verified desktop account without exposing or reopening its login", async () => {
    const { service, connectRelay, openExternal } = harness(TOKEN);
    await expect(service.connectRelay()).rejects.toThrow("Sign in");
    await service.getState();
    await service.connectRelay();
    expect(connectRelay).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("rejects relay registration after logout wins its pending identity check", async () => {
    const { service, fetchImpl, connectRelay } = harness(TOKEN);
    await service.getState();
    const pending = deferred<Response>();
    fetchImpl.mockReturnValueOnce(pending.promise);
    const connecting = service.connectRelay();
    await service.signOut();
    pending.resolve(json(ACCOUNT));
    await expect(connecting).rejects.toThrow("session changed");
    expect(connectRelay).not.toHaveBeenCalled();
  });

  it("preserves offline grace when a verified account response stream disconnects", async () => {
    const token =
      "header." +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        "base64url",
      ) +
      ".signature";
    const { service, fetchImpl } = harness(token);
    await service.getState();
    fetchImpl.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    expect(await service.refresh()).toEqual({
      status: "signed-in",
      account: ACCOUNT,
      issue: "service-unavailable",
    });
  });
});
