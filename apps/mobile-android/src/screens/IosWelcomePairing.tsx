import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accountMonogram } from "../auth/accountAuth";
import type { AccountAuth } from "../auth/useAccountAuth";
import { DitherWaveBackground } from "../components/DitherWaveBackground";
import { FloatingSurface } from "../components/FloatingSurface";
import { GlassActionPill } from "../components/GlassActionPill";
import { GraftMark } from "../components/GraftMark";
import { PressScale } from "../components/PressScale";
import { graftSpacing, useGraftPalette } from "../theme/tokens";
import { welcomeFootnote, welcomePrimaryAction } from "./welcomeCopy";

interface IosWelcomePairingProps {
  readonly account: AccountAuth;
  readonly isPairing: boolean;
  readonly onOpenPairing: () => void;
  readonly pairingError?: string;
}

/// First-run welcome — native `WelcomeView`: official mark, Continue with
/// Graft, then a quiet inset Pair pill after account sign-in.
export function IosWelcomePairing({
  account,
  isPairing,
  onOpenPairing,
  pairingError,
}: IosWelcomePairingProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const primary = welcomePrimaryAction(account.isSignedIn);
  const footnote = welcomeFootnote({
    authError: account.lastError,
    isSignedIn: account.isSignedIn,
    pairingError,
  });

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: palette.background,
          paddingBottom: insets.bottom + 40,
          paddingTop: insets.top + 24,
        },
      ]}
    >
      <DitherWaveBackground />
      <View style={styles.hero}>
        <GraftMark />
        <Text accessibilityRole="header" style={[styles.brand, { color: palette.foreground }]}>
          Graft
        </Text>
      </View>

      <View style={styles.actions}>
        {primary === "pair" ? (
          <>
            <AccountChip
              displayName={account.displayName}
              email={account.email}
              onSignOut={account.signOut}
            />
            <GlassActionPill
              icon="link-outline"
              isBusy={isPairing}
              onPress={onOpenPairing}
              title="Pair with Studio"
            />
          </>
        ) : (
          <GlassActionPill
            icon="person-circle-outline"
            isBusy={account.isSigningIn}
            onPress={() => {
              void account.signIn();
            }}
            title="Continue with Graft"
          />
        )}
        <Text
          style={[
            styles.footnote,
            { color: footnote.tone === "danger" ? palette.danger : palette.foregroundSubtle },
          ]}
        >
          {footnote.text}
        </Text>
      </View>
    </View>
  );
}

function AccountChip({
  displayName,
  email,
  onSignOut,
}: {
  readonly displayName?: string;
  readonly email?: string;
  readonly onSignOut: () => void;
}) {
  const palette = useGraftPalette();

  return (
    <FloatingSurface interactive={false} style={styles.chip}>
      <View style={[styles.monogram, { backgroundColor: palette.subtle }]}>
        <Text style={[styles.monogramText, { color: palette.foreground }]}>
          {accountMonogram(displayName, email)}
        </Text>
      </View>
      <Text numberOfLines={1} style={[styles.chipEmail, { color: palette.foregroundMuted }]}>
        {email ?? "Signed in"}
      </Text>
      <PressScale accessibilityLabel="Sign out" onPress={onSignOut}>
        <Text style={[styles.signOut, { color: palette.foreground }]}>Sign out</Text>
      </PressScale>
    </FloatingSurface>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: graftSpacing.two,
    paddingHorizontal: 30,
  },
  brand: {
    fontSize: 32,
    fontWeight: "600",
    letterSpacing: -0.6,
    marginTop: graftSpacing.three,
  },
  chip: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
    maxWidth: "100%",
    minHeight: 38,
    paddingLeft: 6,
    paddingRight: 16,
    paddingVertical: 6,
  },
  chipEmail: {
    flexShrink: 1,
    fontSize: 13,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  hero: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  monogram: {
    alignItems: "center",
    borderRadius: 13,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  monogramText: {
    fontSize: 12,
    fontWeight: "600",
  },
  root: {
    flex: 1,
  },
  signOut: {
    fontSize: 13,
    fontWeight: "500",
    paddingLeft: 4,
  },
});
