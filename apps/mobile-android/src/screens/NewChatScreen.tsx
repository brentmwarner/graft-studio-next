import { Ionicons } from "@expo/vector-icons";
import type {
  GraftModelOption,
  GraftEnvironmentSummary,
  GraftInteractionMode,
  GraftThreadSummary,
} from "@graft/mobile-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import type { ModelCatalogStatus } from "../state/useModelCatalog";
import { graftRadius, useGraftPalette } from "../theme/tokens";
import { attachmentHostError, type ComposerSendOptions } from "./thread/composerAttachmentSend";
import { useComposerAttachments } from "./thread/useComposerAttachments";
import { useVoiceInput } from "./thread/useVoiceInput";
import { Composer } from "./thread/Composer";
import { composerBottomPadding } from "./thread/composerBottomSpacing";
import { useKeyboardVisibility } from "./thread/useKeyboardVisibility";
import { resolveModelEffort } from "./thread/threadModels";

export interface NewChatCreateRequest {
  readonly approvalPolicy?: string;
  readonly effort?: string;
  readonly mode: "local" | "worktree";
  readonly model?: GraftModelOption;
  readonly projectId: string;
  readonly text: string;
  readonly composer: ComposerSendOptions;
  readonly existingThread?: GraftThreadSummary;
}

interface NewChatScreenProps {
  readonly composerFeatures?: GraftEnvironmentSummary["composerFeatures"];
  readonly error?: string;
  readonly availableModels: readonly GraftModelOption[];
  readonly hostLabel: string;
  readonly initialProjectId?: string;
  readonly isConnected: boolean;
  readonly onBack: () => void;
  readonly onCreate: (
    request: NewChatCreateRequest,
  ) => Promise<{ readonly sent: boolean; readonly thread?: GraftThreadSummary }>;
  readonly onLoadModels: (force?: boolean) => Promise<void>;
  readonly modelCatalog: ModelCatalogStatus;
  readonly projects: readonly InboxProjectGroup[];
}

export function NewChatScreen({
  composerFeatures,
  error,
  availableModels,
  hostLabel,
  initialProjectId,
  isConnected,
  onBack,
  onCreate,
  onLoadModels,
  modelCatalog,
  projects,
}: NewChatScreenProps) {
  const palette = useGraftPalette();
  const insets = useSafeAreaInsets();
  const headerTop = insets.top + 12;
  const keyboardVisible = useKeyboardVisibility();
  const [draft, setDraft] = useState("");
  const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [mode, setMode] = useState<"local" | "worktree">("local");
  const [selectedApproval, setSelectedApproval] = useState<string>();
  const [selectedEffort, setSelectedEffort] = useState<string>();
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? projects[0]?.id);
  const [showProjects, setShowProjects] = useState(false);
  const attachments = useComposerAttachments("new-chat");
  const attachmentBlocked = attachmentHostError(attachments.attachments, composerFeatures);
  const voice = useVoiceInput("new-chat", !isCreating && !attachments.isPicking, setDraft);
  const [interactionMode, setInteractionMode] = useState<GraftInteractionMode>("default");
  const [selectedFastMode, setSelectedFastMode] = useState(false);
  const sendInFlight = useRef(false);
  const createdThread = useRef<{ key: string; thread: GraftThreadSummary } | undefined>(undefined);

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
  const resolvedEffort = resolveModelEffort(currentModel, selectedEffort);
  const approvalOptions = currentModel?.approvalPolicyOptions ?? [];
  const currentApproval =
    selectedApproval && approvalOptions.some((option) => option.value === selectedApproval)
      ? selectedApproval
      : (currentModel?.defaultApprovalPolicy ?? approvalOptions[0]?.value);
  const canUseWorktree = selectedProject?.kind === "repo";
  const fastMode = Boolean(currentModel?.supportsFastMode && selectedFastMode);
  const canSend = Boolean(
    (draft.trim() || attachments.attachments.length) &&
    selectedProject &&
    isConnected &&
    !isCreating &&
    !attachmentBlocked &&
    !attachments.isPicking &&
    !voice.isActive,
  );

  useEffect(() => {
    if (isConnected) void onLoadModels();
  }, [isConnected, onLoadModels]);

  useEffect(() => {
    setSelectedEffort(undefined);
    setSelectedApproval(currentModel?.defaultApprovalPolicy);
  }, [currentModel?.id, currentModel?.providerId]);

  useEffect(() => {
    if (!canUseWorktree) setMode("local");
  }, [canUseWorktree]);

  async function send(message = draft, fromDictation = false) {
    const text = message.trim();
    if (
      (!text && !attachments.attachments.length) ||
      !selectedProject ||
      !isConnected ||
      sendInFlight.current ||
      attachments.isPicking ||
      attachmentBlocked ||
      (voice.isActive && !fromDictation)
    )
      return;
    sendInFlight.current = true;
    setIsCreating(true);
    const releaseAttachments = attachments.retainForSend();
    const key = JSON.stringify([
      selectedProject.id,
      mode,
      currentModel?.providerId,
      currentModel?.id,
      currentApproval,
    ]);
    try {
      const result = await onCreate({
        projectId: selectedProject.id,
        text,
        mode,
        model: currentModel,
        effort: resolvedEffort,
        approvalPolicy: currentApproval,
        ...(createdThread.current?.key === key
          ? { existingThread: createdThread.current.thread }
          : {}),
        composer: {
          attachments: attachments.attachments,
          ...(composerFeatures?.interactionModes ? { interactionMode } : {}),
          ...(composerFeatures?.fastMode ? { fastMode } : {}),
        },
      });
      if (result.thread) createdThread.current = { key, thread: result.thread };
      if (result.sent) {
        attachments.remove(attachments.attachments.map((attachment) => attachment.id));
        setDraft("");
      }
    } finally {
      releaseAttachments();
      sendInFlight.current = false;
      setIsCreating(false);
    }
  }

  async function sendDictation() {
    const text = await voice.stop();
    if (text) await send(text, true);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.flex, { backgroundColor: palette.background }]}
    >
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.heroContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={[styles.hero, { top: insets.top + 84, bottom: bottomChromeHeight + 12 }]}
        >
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
        </ScrollView>

        <EdgeFade edge="top" style={[styles.topFade, { height: insets.top + 84 }]} />
        {/* Preserve the original row's 14 dp centering around its 44 dp controls. */}
        <View style={[styles.topBar, { top: headerTop - 14 }]}>
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
          onLayout={({ nativeEvent }) => setBottomChromeHeight(nativeEvent.layout.height)}
          style={[
            styles.bottomChrome,
            {
              paddingBottom: composerBottomPadding(insets.bottom, keyboardVisible),
            },
          ]}
        >
          {error ? (
            <Text style={{ color: palette.danger, fontSize: 12, padding: 8 }}>{error}</Text>
          ) : null}
          <Composer
            voice={voice}
            onSendDictation={() => {
              void sendDictation();
            }}
            attachments={attachments.attachments}
            attachmentError={attachments.error ?? attachmentBlocked}
            onRemoveAttachment={(id) => attachments.remove([id])}
            activeRunId={undefined}
            canSend={canSend}
            currentModelName={currentModel?.id}
            draft={draft}
            hostLabel={hostLabel}
            isConnected={isConnected}
            isSending={isCreating}
            onCancel={() => undefined}
            onDraftChange={setDraft}
            menuConfig={{
              catalog: modelCatalog,
              onReloadModels: () => {
                void onLoadModels(true);
              },
              extras: {
                attachmentsEnabled: composerFeatures?.attachments === true,
                modesEnabled: composerFeatures?.interactionModes === true,
                fastModeEnabled: composerFeatures?.fastMode === true,
                interactionMode,
                fastMode,
                busy: isCreating || attachments.isPicking || voice.isActive,
                onAttach: (source) => {
                  void attachments.pick(source);
                },
                onSelectMode: setInteractionMode,
                onSelectFastMode: setSelectedFastMode,
              },
              currentApproval,
              approvalOptions,
              currentModel,
              models: availableModels,
              efforts,
              resolvedEffort,
              enabled: isConnected && !isCreating,
              onSelectApproval: (policy) => {
                setSelectedApproval(policy);
                return true;
              },
              onSelectModel: (model) => {
                setSelectedModelId(model.id);
                setSelectedProviderId(model.providerId);
                return true;
              },
              onSelectEffort: setSelectedEffort,
            }}
            onSend={() => void send()}
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
    left: 20,
    position: "absolute",
    right: 20,
  },
  heroContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
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
