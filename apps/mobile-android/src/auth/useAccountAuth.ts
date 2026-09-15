import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";

import {
  ACCOUNT_CALLBACK_SCHEME,
  ACCOUNT_EMAIL_KEY,
  ACCOUNT_FLOW_VERSION,
  ACCOUNT_NAME_KEY,
  ACCOUNT_TOKEN_KEY,
  base64URLFromBase64,
  base64URLFromBytes,
  controlPlaneBaseURL,
  developmentAccountFixture,
  loginURL,
  parseAuthCallback,
  type AccountSession,
} from "./accountAuth";

WebBrowser.maybeCompleteAuthSession();

export interface AccountAuth {
  readonly displayName?: string;
  readonly email?: string;
  readonly isSignedIn: boolean;
  readonly isSigningIn: boolean;
  readonly lastError?: string;
  readonly signIn: () => Promise<boolean>;
  readonly signOut: () => void;
}

interface AccountAuthState {
  readonly displayName?: string;
  readonly email?: string;
  readonly isSignedIn: boolean;
  readonly isSigningIn: boolean;
  readonly lastError?: string;
}

const idle: AccountAuthState = { isSignedIn: false, isSigningIn: false };

async function randomToken(): Promise<string> {
  return base64URLFromBytes(await Crypto.getRandomBytesAsync(32));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return base64URLFromBase64(digest);
}

async function readStoredSession(): Promise<AccountSession | null> {
  const token = await SecureStore.getItemAsync(ACCOUNT_TOKEN_KEY);
  const email = await SecureStore.getItemAsync(ACCOUNT_EMAIL_KEY);
  if (!token || !email) return null;
  return {
    token,
    email,
    name: (await SecureStore.getItemAsync(ACCOUNT_NAME_KEY)) ?? undefined,
  };
}

async function writeStoredSession(session: AccountSession): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_TOKEN_KEY, session.token);
  await SecureStore.setItemAsync(ACCOUNT_EMAIL_KEY, session.email);
  if (session.name) await SecureStore.setItemAsync(ACCOUNT_NAME_KEY, session.name);
  else await SecureStore.deleteItemAsync(ACCOUNT_NAME_KEY);
}

async function clearStoredSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCOUNT_TOKEN_KEY),
    SecureStore.deleteItemAsync(ACCOUNT_EMAIL_KEY),
    SecureStore.deleteItemAsync(ACCOUNT_NAME_KEY),
  ]);
}

async function exchange(grant: string, verifier: string): Promise<AccountSession> {
  const response = await fetch(new URL("/auth/mobile/exchange", controlPlaneBaseURL()), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant,
      code_verifier: verifier,
      flow_version: ACCOUNT_FLOW_VERSION,
    }),
  });
  if (!response.ok) throw new Error("Sign-in exchange was rejected");
  const decoded = (await response.json()) as {
    token?: string;
    email?: string;
    name?: string | null;
  };
  if (!decoded.token || !decoded.email) throw new Error("Sign-in exchange was malformed");
  return { token: decoded.token, email: decoded.email, name: decoded.name ?? undefined };
}

export function useAccountAuth(): AccountAuth {
  const fixture = developmentAccountFixture(
    __DEV__,
    process.env.EXPO_PUBLIC_GRAFT_SIMULATOR_ACCOUNT_EMAIL,
  );
  const [state, setState] = useState<AccountAuthState>(() =>
    fixture
      ? {
          email: fixture.email,
          isSignedIn: true,
          isSigningIn: false,
        }
      : idle,
  );

  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    void readStoredSession().then((session) => {
      if (cancelled || !session) return;
      setState({
        displayName: session.name,
        email: session.email,
        isSignedIn: true,
        isSigningIn: false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fixture]);

  const signIn = useCallback(async () => {
    if (state.isSigningIn) return false;
    setState((current) => ({ ...current, isSigningIn: true, lastError: undefined }));
    try {
      const verifier = await randomToken();
      const authState = await randomToken();
      const challenge = await pkceChallenge(verifier);
      const result = await WebBrowser.openAuthSessionAsync(
        loginURL(authState, challenge),
        `${ACCOUNT_CALLBACK_SCHEME}://`,
        { preferEphemeralSession: false },
      );
      if (result.type !== "success") {
        setState((current) => ({ ...current, isSigningIn: false }));
        return false;
      }
      const callback = parseAuthCallback(result.url);
      if (!callback || callback.state !== authState) {
        throw new Error("Sign-in callback was malformed");
      }
      const session = await exchange(callback.grant, verifier);
      await writeStoredSession(session);
      setState({
        displayName: session.name,
        email: session.email,
        isSignedIn: true,
        isSigningIn: false,
      });
      return true;
    } catch {
      setState((current) => ({
        ...current,
        isSigningIn: false,
        lastError: "Sign-in failed. Please try again.",
      }));
      return false;
    }
  }, [state.isSigningIn]);

  const signOut = useCallback(() => {
    void clearStoredSession();
    setState(idle);
  }, []);

  return {
    displayName: state.displayName,
    email: state.email,
    isSignedIn: state.isSignedIn,
    isSigningIn: state.isSigningIn,
    lastError: state.lastError,
    signIn,
    signOut,
  };
}
