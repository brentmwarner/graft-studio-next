export type WelcomePrimary = "continue" | "pair";

export function welcomePrimaryAction(isSignedIn: boolean): WelcomePrimary {
  return isSignedIn ? "pair" : "continue";
}

export function welcomeFootnote(input: {
  readonly authError?: string;
  readonly isSignedIn: boolean;
  readonly pairingError?: string;
}): { readonly text: string; readonly tone: "danger" | "muted" } {
  if (input.authError) return { text: input.authError, tone: "danger" };
  if (input.pairingError) return { text: input.pairingError, tone: "danger" };
  if (input.isSignedIn) {
    return {
      text: "Open Graft Studio on this computer,\nthen scan or paste the pairing link.",
      tone: "muted",
    };
  }
  return { text: "Sign in to connect this iPhone to your Studio.", tone: "muted" };
}
