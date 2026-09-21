import { Ionicons } from "@expo/vector-icons";
import type { GraftEnvironmentSnapshot, GraftSessionCredential } from "@graft/mobile-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
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
import { AnchoredMenu, MenuItem } from "../components/AnchoredMenu";
import { CircleIconButton } from "../components/CircleIconButton";
import { EdgeFade } from "../components/EdgeFade";
import { FloatingSurface } from "../components/FloatingSurface";
import { ThreadActivityIndicator } from "../components/ThreadActivityIndicator";
import type { ThreadReadState } from "../state/threadActivity";
import { PressScale } from "../components/PressScale";
import { groupInboxThreads, inboxViewModes, type InboxViewMode } from "../state/inboxGrouping";
import { groupProjects, type InboxThreadItem } from "../state/mobileViewModels";
import { graftRadius, graftSpacing, useGraftPalette } from "../theme/tokens";

export interface MachineFilter {
  readonly id: string;
  readonly label: string;
  readonly connected: boolean;
}

interface HomeScreenProps {
  readonly machines?: readonly MachineFilter[];
  readonly selectedMachineId?: string;
  readonly onSelectMachine?: (id?: string) => void;
  readonly onAddMachine?: () => void;
  readonly reads?: ThreadReadState;
  readonly connectionState: GatewayConnectionState;
  readonly error?: string;
  readonly isRefreshing: boolean;
  readonly onNewChat: (projectId?: string) => void;
  readonly onOpenMenu: () => void;
  readonly onOpenThread: (thread: InboxThreadItem) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onSettings: () => void;
  readonly viewMode: InboxViewMode;
  readonly onViewModeChange: (mode: InboxViewMode) => void;
  readonly expandedProjectIds: ReadonlySet<string>;
  readonly onToggleProject: (id: string) => void;
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
          accessibilityState={{ expanded: isExpanded }}
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
            <ThreadRow key={thread.id} thread={thread} onOpenThread={onOpenThread} indented />
          ))
        : null}
    </View>
  );
}

const viewOptions = {
  priority: { title: "Priority", icon: "notifications-outline" },
  project: { title: "By Project", icon: "folder-outline" },
  chronological: { title: "Chronological", icon: "time-outline" },
} as const;

function ThreadRow({
  thread,
  onOpenThread,
  projectName,
  indented = false,
}: {
  readonly thread: InboxThreadItem;
  readonly onOpenThread: (thread: InboxThreadItem) => void;
  readonly projectName?: string;
  readonly indented?: boolean;
}) {
  const palette = useGraftPalette();
  return (
    <Pressable
      accessibilityHint="Open thread"
      accessibilityRole="button"
      onPress={() => onOpenThread(thread)}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.threadRow,
            { paddingLeft: indented ? 52 : 20, opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <View style={styles.threadCopy}>
            <Text numberOfLines={1} style={[styles.threadTitle, { color: palette.foreground }]}>
              {thread.title}
            </Text>
            {projectName ? (
              <View style={styles.threadMetadata}>
                <Ionicons name="folder-outline" size={14} color={palette.foregroundSubtle} />
                <Text
                  numberOfLines={1}
                  style={[styles.projectLabel, { color: palette.foregroundSubtle }]}
                >
                  {projectName}
                </Text>
              </View>
            ) : null}
          </View>
          <ThreadActivityIndicator activity={thread.activity} />
        </View>
      )}
    </Pressable>
  );
}

function toggleId(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function HomeScreen({
  machines,
  selectedMachineId,
  onSelectMachine,
  onAddMachine,
  reads,
  connectionState,
  error,
  isRefreshing,
  onNewChat,
  onOpenMenu,
  onOpenThread,
  onRefresh,
  onSettings,
  viewMode,
  onViewModeChange,
  expandedProjectIds,
  onToggleProject,
  session,
  snapshot,
}: HomeScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const machineFilterTop = Math.max(insets.top + 40, 72);
  const scrollRef = useRef<ScrollView>(null);
  const [searchText, setSearchText] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(new Set());
  const [collapsedSearchProjects, setCollapsedSearchProjects] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [collapsedSearchSections, setCollapsedSearchSections] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [now, setNow] = useState(() => new Date());
  const isSearching = searchText.trim().length > 0;
  const sections = useMemo(
    () => groupInboxThreads(snapshot, viewMode, searchText, now, reads),
    [snapshot, viewMode, searchText, now, reads],
  );
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") update();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [viewMode]);
  const projects = useMemo(
    () => groupProjects(snapshot, searchText, reads),
    [searchText, snapshot, reads],
  );
  const isConnected = connectionState === "connected";

  return (
    <View style={styles.flex}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 104, paddingTop: machineFilterTop + 60 },
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
        ) : projects.length === 0 || (viewMode !== "project" && sections.length === 0) ? (
          <View style={styles.centerState}>
            <Ionicons color={palette.foregroundSubtle} name="folder-outline" size={34} />
            <Text style={[styles.emptyTitle, { color: palette.foreground }]}>
              {isSearching
                ? "No matching chats"
                : viewMode === "project"
                  ? "No projects yet"
                  : "No chats yet"}
            </Text>
            <Text style={[styles.stateText, { color: palette.foregroundSubtle }]}>
              {isSearching
                ? "Try another name or project."
                : "Open a project or start a chat in Graft Studio to see it here."}
            </Text>
          </View>
        ) : viewMode === "project" ? (
          <>
            <View style={styles.projectHeader}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: palette.foreground, flex: 1, paddingLeft: 20 },
                ]}
              >
                Chats
              </Text>
              {projects.find(
                (project) => project.kind === "desktop" && project.id !== "_orphans",
              ) ? (
                <PressScale
                  accessibilityLabel="New chat in Chats"
                  onPress={() =>
                    onNewChat(
                      !selectedMachineId && (machines?.length ?? 0) > 1
                        ? undefined
                        : projects.find(
                            (project) => project.kind === "desktop" && project.id !== "_orphans",
                          )?.id,
                    )
                  }
                >
                  <View style={styles.projectCompose}>
                    <Ionicons color={palette.foreground} name="create-outline" size={21} />
                  </View>
                </PressScale>
              ) : null}
            </View>
            {projects
              .filter((project) => project.kind === "desktop" && project.id !== "_orphans")
              .flatMap((project) => project.threads)
              .map((thread) => (
                <ThreadRow key={thread.id} thread={thread} onOpenThread={onOpenThread} />
              ))}
            {!projects.some(
              (project) =>
                project.kind === "desktop" &&
                project.id !== "_orphans" &&
                project.threads.length > 0,
            ) ? (
              <Text
                style={[
                  styles.stateText,
                  { color: palette.foregroundSubtle, paddingHorizontal: 20, paddingBottom: 16 },
                ]}
              >
                {isSearching ? "No matching chats" : "Chats started in Studio appear here."}
              </Text>
            ) : null}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Projects</Text>
            </View>
            {projects
              .filter((project) => project.kind !== "desktop" || project.id === "_orphans")
              .map((project) => (
                <ProjectSection
                  isExpanded={
                    isSearching
                      ? !collapsedSearchProjects.has(project.id)
                      : expandedProjectIds.has(project.id)
                  }
                  key={project.id}
                  name={project.name}
                  onCompose={() => onNewChat(project.id)}
                  onOpenThread={onOpenThread}
                  onToggle={() =>
                    isSearching
                      ? setCollapsedSearchProjects((current) => toggleId(current, project.id))
                      : onToggleProject(project.id)
                  }
                  threads={project.threads}
                />
              ))}
          </>
        ) : (
          sections.map((section) => {
            const key = `${viewMode}/${section.id}`;
            const isExpanded = !(isSearching ? collapsedSearchSections : collapsedSections).has(
              key,
            );
            return (
              <View key={section.id} style={styles.listSection}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={section.title}
                  accessibilityState={{ expanded: isExpanded }}
                  onPress={() =>
                    (isSearching ? setCollapsedSearchSections : setCollapsedSections)((current) =>
                      toggleId(current, key),
                    )
                  }
                  style={styles.sectionHeader}
                >
                  <Text style={[styles.sectionTitle, { color: palette.foreground }]}>
                    {section.title}
                  </Text>
                  <Ionicons
                    name={isExpanded ? "chevron-down" : "chevron-forward"}
                    size={15}
                    color={palette.foregroundSubtle}
                  />
                </Pressable>
                {isExpanded
                  ? section.threads.map((entry) => (
                      <ThreadRow
                        key={entry.thread.id}
                        thread={entry.thread}
                        onOpenThread={onOpenThread}
                        projectName={viewMode === "priority" ? entry.projectName : undefined}
                      />
                    ))
                  : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <EdgeFade edge="top" style={[styles.topFade, { height: insets.top + 82 }]} />
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <CircleIconButton accessibilityLabel="Menu" icon="menu" onPress={onOpenMenu} />
        <View style={styles.titleLockup}>
          <Text style={[styles.screenTitle, { color: palette.foreground }]}>Projects</Text>
        </View>
        <AnchoredMenu
          trigger={(open) => (
            <CircleIconButton
              accessibilityLabel="Projects options"
              icon="ellipsis-horizontal"
              onPress={open}
            />
          )}
        >
          {(close) => (
            <>
              {inboxViewModes.map((mode) => (
                <MenuItem
                  key={mode}
                  label={viewOptions[mode].title}
                  icon={viewOptions[mode].icon}
                  selected={viewMode === mode}
                  onPress={() => {
                    onViewModeChange(mode);
                    close();
                  }}
                />
              ))}
              {onAddMachine ? (
                <MenuItem
                  label="Add computer"
                  icon="add-outline"
                  onPress={() => {
                    close();
                    onAddMachine();
                  }}
                />
              ) : null}
              <MenuItem
                label="Settings"
                icon="settings-outline"
                onPress={() => {
                  close();
                  onSettings();
                }}
              />
            </>
          )}
        </AnchoredMenu>
      </View>

      <View
        style={{
          position: "absolute",
          top: machineFilterTop,
          left: 0,
          right: 0,
          backgroundColor: palette.background,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 4, gap: 7 }}
        >
          {[
            { id: undefined, label: "All", connected: false },
            ...(machines ?? [
              {
                id: session.environmentId,
                label: session.environmentLabel,
                connected: isConnected,
              },
            ]),
          ].map((machine) => {
            const selected = machine.id === selectedMachineId;
            return (
              <Pressable
                key={machine.id ?? "all"}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  machine.id
                    ? `${machine.label}, ${machine.connected ? "Connected" : "Offline"}`
                    : "All computers"
                }
                onPress={() => onSelectMachine?.(machine.id)}
                hitSlop={{ left: 2, right: 2 }}
                style={styles.machineFilterTarget}
              >
                <View
                  style={[
                    styles.machineFilterPill,
                    !machine.id && styles.allMachinesPill,
                    { backgroundColor: selected ? palette.foreground : palette.subtle },
                  ]}
                >
                  {machine.id ? (
                    <>
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 3.5,
                          marginRight: 4,
                          backgroundColor: machine.connected ? "#1DBF89" : "#FF375F",
                        }}
                      />
                      <Ionicons
                        name="laptop-outline"
                        size={16}
                        color={selected ? palette.background : palette.foreground}
                      />
                    </>
                  ) : null}
                  <Text
                    style={{
                      fontSize: 12,
                      lineHeight: 16,
                      color: selected ? palette.background : palette.foreground,
                    }}
                  >
                    {machine.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error ? (
        <FloatingSurface style={[styles.errorBanner, { bottom: insets.bottom + 78 }]}>
          <Ionicons color={palette.warning} name="warning" size={17} />
          <Text numberOfLines={2} style={[styles.errorText, { color: palette.foregroundMuted }]}>
            {error}
          </Text>
        </FloatingSurface>
      ) : null}

      <EdgeFade edge="bottom" style={[styles.bottomFade, { height: insets.bottom + 92 }]} />
      <View style={[styles.bottomBar, { bottom: insets.bottom + 10 }]}>
        <FloatingSurface style={styles.searchPill}>
          <Ionicons color={palette.foregroundSubtle} name="search" size={20} />
          <TextInput
            accessibilityLabel="Search chats"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(text) => {
              setSearchText(text);
              setCollapsedSearchProjects(new Set());
              setCollapsedSearchSections(new Set());
            }}
            placeholder="Search Chats"
            placeholderTextColor={palette.foregroundSubtle}
            style={[styles.searchInput, { color: palette.foreground }]}
            value={searchText}
          />
        </FloatingSurface>
        <PressScale accessibilityLabel="New chat" onPress={() => onNewChat()}>
          <View style={[styles.composeButton, { backgroundColor: palette.foreground }]}>
            <Ionicons color={palette.background} name="create-outline" size={22} />
          </View>
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  machineFilterTarget: { minWidth: 44, minHeight: 48, justifyContent: "center" },
  machineFilterPill: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: graftRadius.pill,
  },
  allMachinesPill: { minWidth: 42, justifyContent: "center" },
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
  threadCopy: { flex: 1, gap: 5 },
  threadTitle: { fontSize: 16, lineHeight: 21 },
  threadMetadata: { flexDirection: "row", alignItems: "center", gap: 5 },
  projectLabel: { flexShrink: 1, fontSize: 12 },
  listSection: { paddingBottom: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 20,
  },
  sectionTitle: { fontSize: 17, fontWeight: "600" },
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
    flexDirection: "row",
    gap: 8,
    left: 16,
    maxWidth: 420,
    minHeight: 44,
    paddingHorizontal: 12,
    position: "absolute",
    right: 16,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 16 },
});
