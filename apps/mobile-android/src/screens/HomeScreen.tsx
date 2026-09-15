import { Ionicons } from "@expo/vector-icons";
import type { GraftEnvironmentSnapshot, GraftSessionCredential } from "@graft/mobile-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { GatewayConnectionState } from "../api/gatewaySocket";
import { CircleIconButton } from "../components/CircleIconButton";
import { EdgeFade } from "../components/EdgeFade";
import { FloatingSurface } from "../components/FloatingSurface";
import { GlassStack } from "../components/GlassStack";
import { PressScale } from "../components/PressScale";
import { groupProjects, type InboxThreadItem } from "../state/mobileViewModels";
import { graftRadius, graftSpacing, useGraftPalette } from "../theme/tokens";

interface HomeScreenProps {
  readonly connectionState: GatewayConnectionState;
  readonly error?: string;
  readonly isRefreshing: boolean;
  readonly onNewChat: (projectId?: string) => void;
  readonly onOpenMenu: () => void;
  readonly onOpenThread: (thread: InboxThreadItem) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onUnpair: () => Promise<void>;
  readonly searchFocusNonce?: number;
  readonly session: GraftSessionCredential;
  readonly snapshot: GraftEnvironmentSnapshot | null;
}

interface ProjectSectionProps {
  readonly isExpanded: boolean;
  readonly name: string;
  readonly onCompose: () => void;
  readonly onOpenThread: (thread: InboxThreadItem) => void;
  readonly onToggle: () => void;
  readonly threads: readonly InboxThreadItem[];
}

function ProjectSection({
  isExpanded,
  name,
  onCompose,
  onOpenThread,
  onToggle,
  threads,
}: ProjectSectionProps) {
  const palette = useGraftPalette();
  return (
    <View style={styles.projectSection}>
      <View style={styles.projectHeader}>
        <Pressable
          accessibilityHint={isExpanded ? "Collapse project" : "Expand project"}
          accessibilityLabel={name}
          accessibilityRole="button"
          onPress={onToggle}
          style={styles.projectToggle}
        >
          {({ pressed }) => (
            <View style={[styles.projectToggleContent, { opacity: pressed ? 0.55 : 1 }]}>
              <Ionicons
                color={palette.foreground}
                name={isExpanded ? "folder-open-outline" : "folder-outline"}
                size={22}
              />
              <Text numberOfLines={1} style={[styles.projectName, { color: palette.foreground }]}>
                {name}
              </Text>
              <Ionicons
                color={palette.foregroundSubtle}
                name="chevron-down"
                size={15}
                style={{
                  transform: [{ rotate: isExpanded ? "0deg" : "-90deg" }],
                }}
              />
            </View>
          )}
        </Pressable>
        <PressScale accessibilityLabel={`New chat in ${name}`} onPress={onCompose}>
          <View style={styles.projectCompose}>
            <Ionicons color={palette.foreground} name="create-outline" size={21} />
          </View>
        </PressScale>
      </View>
      {isExpanded
        ? threads.map((thread) => (
            <Pressable
              accessibilityHint="Open thread"
              accessibilityRole="button"
              key={thread.id}
              onPress={() => onOpenThread(thread)}
            >
              {({ pressed }) => (
                <View style={[styles.threadRow, { opacity: pressed ? 0.5 : 1 }]}>
                  <Text
                    numberOfLines={2}
                    style={[styles.threadTitle, { color: palette.foreground }]}
                  >
                    {thread.title}
                  </Text>
                  {thread.showsAttentionDot ? (
                    <View
                      accessibilityLabel="Needs attention"
                      style={[styles.attentionDot, { backgroundColor: palette.info }]}
                    />
                  ) : null}
                </View>
              )}
            </Pressable>
          ))
        : null}
    </View>
  );
}

export function HomeScreen({
  connectionState,
  error,
  isRefreshing,
  onNewChat,
  onOpenMenu,
  onOpenThread,
  onRefresh,
  onUnpair,
  searchFocusNonce = 0,
  session,
  snapshot,
}: HomeScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInput>(null);
  const [searchText, setSearchText] = useState("");
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(new Set());
  const projects = useMemo(() => groupProjects(snapshot, searchText), [searchText, snapshot]);
  const isConnected = connectionState === "connected";

  function toggleProject(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  useEffect(() => {
    if (searchFocusNonce === 0) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [searchFocusNonce]);

  function confirmUnpair() {
    Alert.alert("Environment", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => void onUnpair(),
      },
    ]);
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 104, paddingTop: insets.top + 78 },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={() => void onRefresh()}
            progressViewOffset={insets.top + 52}
            refreshing={isRefreshing}
            tintColor={palette.foregroundSubtle}
          />
        }
      >
        {!snapshot && isRefreshing ? (
          <View style={styles.centerState}>
            <Text style={[styles.stateText, { color: palette.foregroundSubtle }]}>
              Connecting to Studio…
            </Text>
          </View>
        ) : projects.length === 0 ? (
          <View style={styles.centerState}>
            <Ionicons color={palette.foregroundSubtle} name="folder-outline" size={34} />
            <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No projects yet</Text>
            <Text style={[styles.stateText, { color: palette.foregroundSubtle }]}>
              Open a project in Graft Studio to see it here.
            </Text>
          </View>
        ) : (
          projects.map((project) => (
            <ProjectSection
              isExpanded={!collapsedProjectIds.has(project.id)}
              key={project.id}
              name={project.name}
              onCompose={() => onNewChat(project.id)}
              onOpenThread={onOpenThread}
              onToggle={() => toggleProject(project.id)}
              threads={project.threads}
            />
          ))
        )}
      </ScrollView>

      <EdgeFade edge="top" style={[styles.topFade, { height: insets.top + 82 }]} />
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <CircleIconButton accessibilityLabel="Menu" icon="menu" onPress={onOpenMenu} />
        <View style={styles.titleLockup}>
          <Text style={[styles.screenTitle, { color: palette.foreground }]}>Projects</Text>
          <View style={styles.connectionRow}>
            <View
              style={[
                styles.connectionDot,
                {
                  backgroundColor: isConnected ? palette.success : palette.foregroundSubtle,
                },
              ]}
            />
            <Text numberOfLines={1} style={[styles.hostLabel, { color: palette.foregroundSubtle }]}>
              {session.environmentLabel}
            </Text>
          </View>
        </View>
        <CircleIconButton
          accessibilityLabel="More"
          icon="ellipsis-horizontal"
          onPress={confirmUnpair}
        />
      </View>

      {error ? (
        <FloatingSurface
          interactive={false}
          style={[styles.errorBanner, { bottom: insets.bottom + 78 }]}
        >
          <Ionicons color={palette.warning} name="warning" size={17} />
          <Text numberOfLines={2} style={[styles.errorText, { color: palette.foregroundMuted }]}>
            {error}
          </Text>
        </FloatingSurface>
      ) : null}

      <EdgeFade edge="bottom" style={[styles.bottomFade, { height: insets.bottom + 92 }]} />
      <GlassStack spacing={10} style={[styles.bottomBar, { bottom: insets.bottom + 10 }]}>
        <FloatingSurface style={styles.searchPill}>
          <Ionicons color={palette.foregroundSubtle} name="search" size={20} />
          <TextInput
            accessibilityLabel="Search chats"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchText}
            ref={searchRef}
            placeholder="Search Chats"
            placeholderTextColor={palette.foregroundSubtle}
            style={[styles.searchInput, { color: palette.foreground }]}
            value={searchText}
          />
        </FloatingSurface>
        <PressScale accessibilityLabel="New chat" onPress={() => onNewChat()}>
          <FloatingSurface style={styles.composeButton} tintColor="#09090B">
            <Ionicons color="#FFFFFF" name="create-outline" size={22} />
          </FloatingSurface>
        </PressScale>
      </GlassStack>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
  topFade: { top: 0 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    height: 72,
    justifyContent: "space-between",
    // Matches the bottom bar, so the floating circles line up with the edges
    // of the search pill directly below them.
    left: graftSpacing.two,
    position: "absolute",
    right: graftSpacing.two,
    top: 0,
  },
  titleLockup: { alignItems: "center", maxWidth: "68%" },
  screenTitle: { fontSize: 17, fontWeight: "600", letterSpacing: -0.25 },
  connectionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  connectionDot: { borderRadius: 4, height: 7, width: 7 },
  hostLabel: { fontSize: 12, maxWidth: 210 },
  projectSection: { paddingBottom: 10 },
  projectHeader: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
    paddingLeft: 20,
    paddingRight: 14,
  },
  projectToggle: { flex: 1 },
  projectToggleContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  projectName: { flexShrink: 1, fontSize: 16, fontWeight: "600" },
  projectCompose: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  threadRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 44,
    paddingLeft: 52,
    paddingRight: 20,
    paddingVertical: 10,
  },
  threadTitle: { flex: 1, fontSize: 16, lineHeight: 21 },
  attentionDot: { borderRadius: 4, height: 8, marginLeft: 12, width: 8 },
  centerState: {
    alignItems: "center",
    flex: 1,
    gap: 10,
    justifyContent: "center",
    minHeight: 430,
    paddingHorizontal: 36,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600", marginTop: 4 },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  bottomFade: { bottom: 0 },
  bottomBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    left: graftSpacing.two,
    position: "absolute",
    right: graftSpacing.two,
  },
  searchPill: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  composeButton: {
    alignItems: "center",
    borderRadius: graftRadius.pill,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  errorBanner: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    left: 16,
    maxWidth: 420,
    minHeight: 44,
    overflow: "hidden",
    paddingHorizontal: 12,
    position: "absolute",
    right: 16,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 16 },
});
