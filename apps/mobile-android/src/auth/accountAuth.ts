export const ACCOUNT_TOKEN_KEY = "graft.account.jwt";
export const ACCOUNT_EMAIL_KEY = "graft.account.email";
export const ACCOUNT_NAME_KEY = "graft.account.name";
export const ACCOUNT_CALLBACK_SCHEME = "graft";
export const ACCOUNT_FLOW_VERSION = "2";
export const ACCOUNT_CONTROL_PLANE_URL = "https://api.graftapp.io";

export interface AccountSession {
  readonly token: string;
  readonly email: string;
  readonly name?: string;
}

export interface AuthCallback {
  readonly grant: string;
  readonly state: string;
}

export function controlPlaneBaseURL(): string {
  return process.env.EXPO_PUBLIC_GRAFT_CONTROL_PLANE_URL ?? ACCOUNT_CONTROL_PLANE_URL;
}

export function base64URLFromBase64(value: string): string {
  return value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function base64URLFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64URLFromBase64(btoa(binary));
}

export function loginURL(state: string, challenge: string): string {
  const url = new URL("/auth/mobile/login", controlPlaneBaseURL());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("flow_version", ACCOUNT_FLOW_VERSION);
  return url.toString();
}

export function parseAuthCallback(url: string): AuthCallback | null {
  try {
    const parsed = new URL(url);
    const grant = parsed.searchParams.get("grant");
    const state = parsed.searchParams.get("state");
    if (!grant || !state) return null;
    return { grant, state };
  } catch {
    return null;
  }
}

export function isAccountAuthCallback(url: string): boolean {
  return parseAuthCallback(url) !== null;
}

export function accountMonogram(displayName?: string, email?: string): string {
  const source = displayName?.trim() || email?.trim();
  const letter = source?.split("").find((character) => /\p{L}/u.test(character));
  return letter ? letter.toUpperCase() : "•";
}
