import { Ionicons } from "@expo/vector-icons";
import type { GraftModelOption } from "@graft/mobile-contract";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheet } from "../components/BottomSheet";
import { CircleIconButton } from "../components/CircleIconButton";
import { EdgeFade } from "../components/EdgeFade";
import { FloatingSurface } from "../components/FloatingSurface";
import { PressScale } from "../components/PressScale";
import type { InboxProjectGroup } from "../state/mobileViewModels";
import { graftRadius, useGraftPalette } from "../theme/tokens";
import { Composer } from "./thread/Composer";
import { composerBottomPadding } from "./thread/composerBottomSpacing";
import { ComposerConfigMenu } from "./thread/ComposerConfigMenu";
import { ApprovalPickerSheet, ComposerActionsSheet, ModelPickerSheet } from "./thread/ThreadSheets";
import { useKeyboardVisibility } from "./thread/useKeyboardVisibility";

export interface NewChatCreateRequest {
  readonly approvalPolicy?: string;
  readonly effort?: string;
  readonly mode: "local" | "worktree";
  readonly model?: GraftModelOption;
  readonly projectId: string;
  readonly text: string;
}

interface NewChatScreenProps {
  readonly availableModels: readonly GraftModelOption[];
  readonly hostLabel: string;
  readonly initialProjectId?: string;
  readonly isConnected: boolean;
  readonly onBack: () => void;
  readonly onCreate: (request: NewChatCreateRequest) => Promise<boolean>;
  readonly onLoadModels: () => Promise<void>;
  readonly projects: readonly InboxProjectGroup[];
}

function preferredEffort(efforts: readonly string[]): string | undefined {
  return efforts.includes("xhigh") ? "xhigh" : efforts.includes("high") ? "high" : efforts[0];
}

export function NewChatScreen({
  availableModels,
  hostLabel,
  initialProjectId,
  isConnected,
  onBack,
  onCreate,
  onLoadModels,
  projects,
}: NewChatScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisibility();
  const [draft, setDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [mode, setMode] = useState<"local" | "worktree">("local");
  const [selectedApproval, setSelectedApproval] = useState<string>();
  const [selectedEffort, setSelectedEffort] = useState<string>();
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? projects[0]?.id);
  const [showActions, setShowActions] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [showIntelligence, setShowIntelligence] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [showProjects, setShowProjects] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const currentModel = useMemo(
    () =>
      availableModels.find(
        (model) => model.id === selectedModelId && model.providerId === selectedProviderId,
      ) ??
      availableModels.find((model) => model.isDefault) ??
      availableModels[0],
    [availableModels, selectedModelId, selectedProviderId],
  );
  const efforts = currentModel?.reasoningEfforts ?? [];
  const resolvedEffort =
    selectedEffort && efforts.includes(selectedEffort) ? selectedEffort : preferredEffort(efforts);
  const approvalOptions = currentModel?.approvalPolicyOptions ?? [];
  const currentApproval =
    selectedApproval && approvalOptions.some((option) => option.value === selectedApproval)
      ? selectedApproval
      : (currentModel?.defaultApprovalPolicy ?? approvalOptions[0]?.value);
  const currentApprovalLabel =
    approvalOptions.find((option) => option.value === currentApproval)?.label ?? "Permissions";
  const approvalIsElevated = Boolean(
    currentApproval &&
    currentModel?.defaultApprovalPolicy &&
    currentApproval !== currentModel.defaultApprovalPolicy,
  );
  const canUseWorktree = selectedProject?.kind === "repo";
  const canSend = Boolean(draft.trim() && selectedProject && isConnected && !isCreating);

  useEffect(() => {
    void onLoadModels();
  }, [onLoadModels]);

  useEffect(() => {
    setSelectedEffort(preferredEffort(efforts));
    setSelectedApproval(currentModel?.defaultApprovalPolicy);
  }, [currentModel?.id, currentModel?.providerId]);

  useEffect(() => {
    if (!canUseWorktree) setMode("local");
  }, [canUseWorktree]);

  async function send() {
    const text = draft.trim();
    if (!text || !selectedProject || isCreating) return;
    setIsCreating(true);
    const sent = await onCreate({
      projectId: selectedProject.id,
      text,
      mode,
      model: currentModel,
      effort: resolvedEffort,
      approvalPolicy: currentApproval,
    });
    if (!sent) setIsCreating(false);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.flex, { backgroundColor: palette.background }]}
    >
      <View style={styles.flex}>
        <View style={styles.hero}>
          <Text style={[styles.heroTitle, { color: palette.foreground }]}>Let&apos;s work on</Text>
          <PressScale accessibilityLabel="Choose project" onPress={() => setShowProjects(true)}>
            <View style={styles.projectTrigger}>
              <Ionicons color={palette.foregroundMuted} name="folder-outline" size={23} />
              <Text
                numberOfLines={1}
                style={[styles.projectName, { color: palette.foregroundMuted }]}
              >
                {selectedProject?.name ?? "No project"}
              </Text>
              <Ionicons color={palette.foregroundSubtle} name="chevron-down" size={16} />
            </View>
          </PressScale>

          <View style={[styles.modePicker, { borderColor: palette.border }]}>
            {(["local", "worktree"] as const).map((option) => {
              const selected = option === mode;
              const disabled = option === "worktree" && !canUseWorktree;
              return (
                <Pressable
                  accessibilityLabel={option === "local" ? "Workspace" : "Worktree"}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  key={option}
                  onPress={() => setMode(option)}
                  style={[
                    styles.modeOption,
                    option === "local" ? styles.modeDivider : null,
                    {
                      backgroundColor: selected ? palette.muted : "transparent",
                      borderRightColor: palette.border,
                      opacity: disabled ? 0.38 : 1,
                    },
                  ]}
                >
                  {selected ? (
                    <Ionicons color={palette.foregroundMuted} name="checkmark" size={20} />
                  ) : null}
                  <Text style={[styles.modeText, { color: palette.foreground }]}>
                    {option === "local" ? "Workspace" : "Worktree"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <EdgeFade edge="top" style={[styles.topFade, { height: insets.top + 84 }]} />
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <CircleIconButton
            accessibilityLabel="Back to projects"
            icon="chevron-back"
            iconSize={24}
            onPress={onBack}
          />
          <FloatingSurface style={styles.headerPill}>
            <Text style={[styles.headerTitle, { color: palette.foreground }]}>New chat</Text>
            <View style={styles.headerContext}>
              <Ionicons color={palette.foregroundSubtle} name="folder-outline" size={13} />
              <Text
                numberOfLines={1}
                style={[styles.headerContextText, { color: palette.foregroundSubtle }]}
              >
                {selectedProject?.name ?? "Project"}
              </Text>
              <Ionicons color={palette.foregroundSubtle} name="laptop-outline" size={13} />
              <Text
                numberOfLines={1}
                style={[styles.headerContextText, { color: palette.foregroundSubtle }]}
              >
                {hostLabel}
              </Text>
            </View>
          </FloatingSurface>
        </View>

        <EdgeFade edge="bottom" style={[styles.bottomFade, { height: insets.bottom + 116 }]} />
        <View
          style={[
            styles.bottomChrome,
            {
              paddingBottom: composerBottomPadding(insets.bottom, keyboardVisible),
            },
          ]}
        >
          <Composer
            activeRunId={undefined}
            approvalIsElevated={approvalIsElevated}
            availableModels={availableModels}
            canSend={canSend}
            currentApprovalLabel={currentApprovalLabel}
            currentModel={currentModel}
            currentModelName={currentModel?.id}
            draft={draft}
            canChangeApproval={approvalOptions.length > 1}
            hasApprovalOptions={approvalOptions.length > 0}
            hostLabel={hostLabel}
            isConnected={isConnected}
            isSending={isCreating}
            onCancel={() => undefined}
            onDraftChange={setDraft}
            onOpenActions={() => setShowActions(true)}
            onOpenApproval={() => setShowApproval(true)}
            onOpenModel={() => setShowIntelligence(true)}
            onSend={() => void send()}
            resolvedEffort={resolvedEffort}
          />
        </View>
      </View>

      <BottomSheet
        maxHeightRatio={0.64}
        onClose={() => setShowProjects(false)}
        title="Project"
        visible={showProjects}
      >
        <ScrollView>
          {projects.map((project) => (
            <Pressable
              accessibilityRole="button"
              key={project.id}
              onPress={() => {
                setSelectedProjectId(project.id);
                setShowProjects(false);
              }}
              style={styles.projectOption}
            >
              <Ionicons color={palette.foreground} name="folder-outline" size={21} />
              <Text style={[styles.projectOptionText, { color: palette.foreground }]}>
                {project.name}
              </Text>
              {project.id === selectedProject?.id ? (
                <Ionicons color={palette.accent} name="checkmark" size={20} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <ComposerActionsSheet
        hasApprovalOptions={approvalOptions.length > 0}
        onClose={() => setShowActions(false)}
        onOpenApproval={() => setShowApproval(true)}
        onOpenModel={() => setShowIntelligence(true)}
        visible={showActions}
      />
      <ApprovalPickerSheet
        currentApproval={currentApproval}
        onClose={() => setShowApproval(false)}
        onSelect={setSelectedApproval}
        options={approvalOptions}
        visible={showApproval}
      />
      <ComposerConfigMenu
        currentModel={currentModel}
        efforts={efforts}
        onClose={() => setShowIntelligence(false)}
        onOpenModel={() => {
          setShowIntelligence(false);
          setShowModels(true);
        }}
        onSelectEffort={setSelectedEffort}
        onSpeedPress={() => Alert.alert("Speed", "Normal is currently the supported host speed.")}
        resolvedEffort={resolvedEffort}
        visible={showIntelligence}
      />
      <ModelPickerSheet
        currentModel={currentModel}
        efforts={efforts}
        models={availableModels}
        onClose={() => setShowModels(false)}
        onSelectEffort={setSelectedEffort}
        onSelectModel={(modelOption) => {
          setSelectedModelId(modelOption.id);
          setSelectedProviderId(modelOption.providerId);
          setShowModels(false);
        }}
        resolvedEffort={resolvedEffort}
        visible={showModels}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topFade: { top: 0 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    height: 72,
    left: 12,
    position: "absolute",
    right: 12,
    top: 4,
  },
  headerPill: {
    height: 44,
    justifyContent: "center",
    maxWidth: 322,
    paddingHorizontal: 16,
  },
  headerTitle: { fontSize: 12, fontWeight: "700" },
  headerContext: { alignItems: "center", flexDirection: "row", gap: 4 },
  headerContextText: { flexShrink: 1, fontSize: 11 },
  hero: {
    alignItems: "center",
    left: 20,
    position: "absolute",
    right: 20,
    top: "48%",
    transform: [{ translateY: -66 }],
  },
  heroTitle: { fontSize: 19, fontWeight: "700", marginBottom: 14 },
  projectTrigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginBottom: 22,
  },
  projectName: { fontSize: 17, fontWeight: "600", maxWidth: 220 },
  modePicker: {
    borderRadius: graftRadius.pill,
    borderWidth: 1,
    flexDirection: "row",
    height: 40,
    overflow: "hidden",
    width: 230,
  },
  modeOption: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  modeDivider: { borderRightWidth: 1 },
  modeText: { fontSize: 14, fontWeight: "600" },
  bottomFade: { bottom: 0 },
  bottomChrome: {
    bottom: 0,
    left: 14,
    position: "absolute",
    right: 14,
  },
  projectOption: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  projectOptionText: { flex: 1, fontSize: 16, marginLeft: 12 },
});
