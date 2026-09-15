import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInUp, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accountMonogram } from "../auth/accountAuth";
import type { AccountAuth } from "../auth/useAccountAuth";
import { FloatingSurface } from "../components/FloatingSurface";
import { GlassActionPill } from "../components/GlassActionPill";
import { PressScale } from "../components/PressScale";
import { WelcomeRibbon } from "../components/WelcomeRibbon.ios";
import { graftSpacing, useGraftPalette } from "../theme/tokens";
import { welcomeFootnote, welcomePrimaryAction } from "./welcomeCopy";

export function IosWelcomePairing({
  account,
  isPairing,
  onOpenPairing,
  pairingError,
}: {
  readonly account: AccountAuth;
  readonly isPairing: boolean;
  readonly onOpenPairing: () => void;
  readonly pairingError?: string;
}) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
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
      <WelcomeRibbon />
      <View style={styles.hero}>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(500).delay(360)}>
          <View style={styles.mark}>
            <Ionicons color="#FFFFFF" name="git-branch-outline" size={47} />
          </View>
        </Animated.View>
        <Animated.View entering={reduceMotion ? undefined : FadeInUp.duration(500).delay(500)}>
          <Text accessibilityRole="header" style={[styles.brand, { color: palette.foreground }]}>
            Graft
          </Text>
          <Text style={[styles.subtitle, { color: palette.foregroundSubtle }]}>
            Control your Graft Studio from anywhere.
          </Text>
        </Animated.View>
      </View>

      <Animated.View
        entering={reduceMotion ? undefined : FadeInUp.duration(500).delay(720)}
        style={styles.actions}
      >
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
              title="Pair with Graft Studio"
            />
          </>
        ) : (
          <GlassActionPill
            icon="person-circle-outline"
            isBusy={account.isSigningIn}
            onPress={() => void account.signIn()}
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
      </Animated.View>
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
  root: { flex: 1 },
  hero: { alignItems: "center", flex: 1, justifyContent: "center" },
  mark: {
    alignItems: "center",
    backgroundColor: "rgba(9, 9, 11, 0.93)",
    borderColor: "rgba(255, 255, 255, 0.22)",
    borderRadius: 54,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0 12px 34px rgba(0, 0, 0, 0.24)",
    height: 108,
    justifyContent: "center",
    width: 108,
  },
  brand: {
    fontSize: 32,
    fontWeight: "600",
    letterSpacing: -0.6,
    marginTop: graftSpacing.three,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 21,
    marginTop: graftSpacing.one,
    paddingHorizontal: graftSpacing.four,
    textAlign: "center",
  },
  actions: { gap: graftSpacing.two, paddingHorizontal: 30 },
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
  monogram: {
    alignItems: "center",
    borderRadius: 13,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  monogramText: { fontSize: 12, fontWeight: "600" },
  chipEmail: { flexShrink: 1, fontSize: 13 },
  signOut: { fontSize: 13, fontWeight: "500", paddingLeft: 4 },
  footnote: { fontSize: 13, lineHeight: 18, textAlign: "center" },
});
