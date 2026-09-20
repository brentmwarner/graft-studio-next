import { StatusBar } from "expo-status-bar";
import type { GraftSessionCredential, GraftThreadSummary } from "@graft/mobile-contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BottomSheet } from "./src/components/BottomSheet";
import { MachineRuntime, type MachineController } from "./src/state/MachineRuntime";
import { machineInbox, parseMachineResourceId } from "./src/state/machineInbox";
import { loadSessions } from "./src/storage/sessionRepository";
import { parsePairingInput } from "./src/protocol/pairing";

import { MenuProvider } from "./src/components/MenuProvider";
import { recentInboxThreads } from "./src/state/inboxGrouping";
import { NavDrawerLayout } from "./src/components/NavDrawer";
import { HomeScreen } from "./src/screens/HomeScreen";
import { NewChatScreen } from "./src/screens/NewChatScreen";
import { PairingScreen } from "./src/screens/PairingScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { SplashScreen } from "./src/screens/SplashScreen";
import { ThreadScreen } from "./src/screens/ThreadScreen";
import { groupProjects } from "./src/state/mobileViewModels";
import { useGraftSession } from "./src/state/useGraftSession";
import { loadInboxViewMode, saveInboxViewMode } from "./src/storage/inboxPreferences";
import { useGraftPalette } from "./src/theme/tokens";

type AppRoute =
  | { readonly name: "home" }
  | {
      readonly name: "thread";
      readonly environmentId: string;
      readonly thread: GraftThreadSummary;
      readonly initialEffort?: string;
    }
  | {
      readonly name: "new-chat";
      readonly environmentId: string;
      readonly initialProjectId?: string;
    };

function GraftApp() {
  const palette = useGraftPalette();
  const [credentials, setCredentials] = useState<readonly GraftSessionCredential[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [controllers, setControllers] = useState<Readonly<Record<string, MachineController>>>({});
  const [selectedMachineId, setSelectedMachineId] = useState<string>();
  const [pairingInput, setPairingInput] = useState<string>();
  const [showPairing, setShowPairing] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [chooseMachine, setChooseMachine] = useState(false);
  const updateMachine = useCallback(
    (credential: GraftSessionCredential, controller: MachineController) => {
      setControllers((current) => ({ ...current, [credential.environmentId]: controller }));
      if (controller.state.status === "unpaired") {
        setCredentials((current) =>
          current.filter(
            (saved) =>
              saved.sessionId !== credential.sessionId ||
              saved.environmentId !== credential.environmentId,
          ),
        );
      }
    },
    [],
  );
  const pairedMachine = useCallback((credential: GraftSessionCredential) => {
    setCredentials((current) => [
      credential,
      ...current.filter((saved) => saved.environmentId !== credential.environmentId),
    ]);
    setShowPairing(false);
    setPairingInput(undefined);
  }, []);
  const receivePairingLink = useCallback((url: string) => {
    try {
      parsePairingInput(url);
      setPairingInput(url);
      setShowPairing(true);
    } catch {
      /* Unrelated app link. */
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    void loadSessions()
      .then((saved) => {
        if (mounted) {
          setCredentials(saved);
          setLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : "Could not load computers.");
          setLoaded(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);
  const [route, setRoute] = useState<AppRoute>({ name: "home" });
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inboxViewMode, setInboxViewMode] = useState(() => loadInboxViewMode("_all_computers"));
  useEffect(() => {
    setInboxViewMode(loadInboxViewMode(selectedMachineId ?? "_all_computers"));
  }, [selectedMachineId]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(new Set());
  const activeEnvironmentId = route.name !== "home" ? route.environmentId : selectedMachineId;
  const activeCredential =
    credentials.find((item) => item.environmentId === activeEnvironmentId) ??
    (route.name === "home" ? credentials[0] : undefined);
  const candidate = activeCredential ? controllers[activeCredential.environmentId] : undefined;
  const session =
    candidate?.state.status === "paired" &&
    candidate.state.session.sessionId === activeCredential?.sessionId
      ? candidate
      : undefined;
  const paired = session?.state.status === "paired" ? session.state : null;
  const pairedSnapshot = paired?.snapshot ?? null;
  const sources = credentials.flatMap((credential) => {
    const controller = controllers[credential.environmentId];
    return controller?.state.status === "paired" &&
      controller.state.session.sessionId === credential.sessionId
      ? [{ ...controller.state, reads: controller.reads }]
      : [];
  });
  const inbox = machineInbox(sources, selectedMachineId);
  const machineFilters = credentials.map((credential) => ({
    id: credential.environmentId,
    label: credential.environmentLabel,
    connected: sources.some(
      (source) =>
        source.session.environmentId === credential.environmentId &&
        source.connectionState === "connected",
    ),
  }));

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url) receivePairingLink(url);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      receivePairingLink(url);
    });
    return () => subscription.remove();
  }, [receivePairingLink]);

  useEffect(() => {
    if (
      route.name !== "home" &&
      !credentials.some((item) => item.environmentId === route.environmentId)
    )
      setRoute({ name: "home" });
    if (selectedMachineId && !credentials.some((item) => item.environmentId === selectedMachineId))
      setSelectedMachineId(undefined);
  }, [credentials, route, selectedMachineId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Back dismisses the drawer before it pops the route, matching the
      // way iOS treats the open drawer as the topmost presentation.
      if (isDrawerOpen) {
        setIsDrawerOpen(false);
        return true;
      }
      if (route.name === "home") return false;
      session?.closeThread();
      setRoute({ name: "home" });
      return true;
    });
    return () => subscription.remove();
  }, [isDrawerOpen, route.name, session?.closeThread]);

  const projectGroups = useMemo(() => groupProjects(pairedSnapshot, ""), [pairedSnapshot]);

  function openInboxThread(id: string) {
    const resource = parseMachineResourceId(id);
    if (!resource) return;
    const owner = controllers[resource.environmentId];
    const thread =
      owner?.state.status === "paired"
        ? owner.state.snapshot?.threads.find((thread) => thread.id === resource.resourceId)
        : undefined;
    if (!thread || !owner) return;
    session?.closeThread();
    setIsDrawerOpen(false);
    setRoute({ name: "thread", environmentId: resource.environmentId, thread });
    void owner.openThread(thread.id);
  }

  function newChat(projectId?: string) {
    const resource = projectId ? parseMachineResourceId(projectId) : undefined;
    const environmentId =
      resource?.environmentId ??
      selectedMachineId ??
      (credentials.length === 1 ? credentials[0]?.environmentId : undefined);
    if (!environmentId) {
      setChooseMachine(true);
      return;
    }
    setRoute({ name: "new-chat", environmentId, initialProjectId: resource?.resourceId });
  }

  function backToHome() {
    session?.closeThread();
    setRoute({ name: "home" });
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <StatusBar style={palette.isDark ? "light" : "dark"} />
      {credentials.map((credential) => (
        <MachineRuntime
          key={JSON.stringify([credential.environmentId, credential.sessionId])}
          credential={credential}
          onUpdate={updateMachine}
          visibleThreadId={
            route.name === "thread" &&
            route.environmentId === credential.environmentId &&
            !isDrawerOpen &&
            !showSettings &&
            !showPairing
              ? route.thread.id
              : undefined
          }
        />
      ))}
      {!loaded || (credentials.length > 0 && !paired) ? <SplashScreen /> : null}
      {loaded && credentials.length === 0 ? (
        <PairMachine initialInput={pairingInput} onPaired={pairedMachine} error={loadError} />
      ) : null}
      <Modal
        visible={showPairing && credentials.length > 0}
        animationType="slide"
        onRequestClose={() => {
          if (!isPairing) setShowPairing(false);
        }}
      >
        <View style={{ flex: 1, backgroundColor: palette.background }}>
          {showPairing ? (
            <PairMachine
              initialInput={pairingInput}
              onPaired={pairedMachine}
              onCancel={() => setShowPairing(false)}
              onPairingChange={setIsPairing}
            />
          ) : null}
        </View>
      </Modal>
      <BottomSheet
        visible={chooseMachine}
        onClose={() => setChooseMachine(false)}
        title="Choose a computer"
      >
        {machineFilters.map((machine) => (
          <Pressable
            key={machine.id}
            accessibilityRole="button"
            disabled={!machine.connected}
            onPress={() => {
              setChooseMachine(false);
              setRoute({ name: "new-chat", environmentId: machine.id });
            }}
            style={{ padding: 20 }}
          >
            <Text
              style={{ color: machine.connected ? palette.foreground : palette.foregroundSubtle }}
            >
              {machine.label}
            </Text>
          </Pressable>
        ))}
      </BottomSheet>
      {paired && session ? (
        <>
          {/* The drawer wraps the routed content, so opening it slides the
              whole screen — top bar included — exactly like the iOS
              `NavDrawerLayout` wrapping its `NavigationStack`. */}
          <NavDrawerLayout
            recentThreads={recentInboxThreads(inbox.snapshot, inbox.reads)}
            computers={machineFilters.map((machine) => ({
              id: machine.id,
              label: machine.label,
              isActive: selectedMachineId === machine.id,
              isConnected: machine.connected,
            }))}
            onSelectComputer={(id) => {
              setSelectedMachineId(id);
              setIsDrawerOpen(false);
              backToHome();
            }}
            onProjects={() => {
              setIsDrawerOpen(false);
              backToHome();
            }}
            onSelectThread={(item) => openInboxThread(item.id)}
            connectionState={paired.connectionState}
            hostLabel={paired.session.environmentLabel}
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            onOpen={() => setIsDrawerOpen(true)}
            onSettings={() => {
              setIsDrawerOpen(false);
              setShowSettings(true);
            }}
          >
            {route.name === "home" ? (
              <HomeScreen
                reads={inbox.reads}
                machines={machineFilters}
                selectedMachineId={selectedMachineId}
                onSelectMachine={setSelectedMachineId}
                onAddMachine={() => setShowPairing(true)}
                connectionState={paired.connectionState}
                error={
                  sources
                    .filter(
                      (source) =>
                        !selectedMachineId || source.session.environmentId === selectedMachineId,
                    )
                    .find((source) => source.error)?.error
                }
                isRefreshing={sources.some(
                  (source) => source.isRefreshing && source.connectionState === "connected",
                )}
                onNewChat={newChat}
                onOpenMenu={() => setIsDrawerOpen(true)}
                onOpenThread={(item) => openInboxThread(item.id)}
                onRefresh={async () => {
                  await Promise.all(
                    credentials
                      .filter(
                        (item) => !selectedMachineId || item.environmentId === selectedMachineId,
                      )
                      .map((item) => controllers[item.environmentId]?.refresh()),
                  );
                }}
                onSettings={() => setShowSettings(true)}
                viewMode={inboxViewMode}
                onViewModeChange={(mode) => {
                  setInboxViewMode(mode);
                  saveInboxViewMode(mode, selectedMachineId ?? "_all_computers");
                }}
                expandedProjectIds={expandedProjectIds}
                onToggleProject={(id) =>
                  setExpandedProjectIds((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                session={paired.session}
                snapshot={inbox.snapshot}
              />
            ) : route.name === "new-chat" ? (
              <NewChatScreen
                key={JSON.stringify([route.environmentId, paired.session.sessionId])}
                composerFeatures={paired.snapshot?.environment.composerFeatures}
                error={paired.error}
                availableModels={session.modelCatalog.models}
                modelCatalog={session.modelCatalog}
                hostLabel={paired.session.environmentLabel}
                initialProjectId={route.initialProjectId}
                isConnected={paired.connectionState === "connected"}
                onBack={backToHome}
                onCreate={async (request) => {
                  const thread =
                    request.existingThread ??
                    (await session.createThread(request.projectId, {
                      approvalPolicy: request.approvalPolicy,
                      mode: request.mode,
                      model: request.model,
                    }));
                  if (!thread) return { sent: false };
                  const configuredThread = request.approvalPolicy
                    ? {
                        ...thread,
                        approvalPolicy: request.approvalPolicy,
                      }
                    : thread;
                  await session.openThread(thread.id);
                  const sent = await session.sendMessage(
                    thread.id,
                    request.text,
                    request.effort,
                    request.composer,
                  );
                  if (sent)
                    setRoute((current) =>
                      current.name === "new-chat" && current.environmentId === route.environmentId
                        ? {
                            name: "thread",
                            environmentId: route.environmentId,
                            thread: configuredThread,
                            initialEffort: request.effort,
                          }
                        : current,
                    );
                  return { sent, thread: configuredThread };
                }}
                onLoadModels={session.loadModels}
                projects={projectGroups}
              />
            ) : (
              <ThreadScreen
                key={JSON.stringify([
                  route.environmentId,
                  paired.session.sessionId,
                  route.thread.id,
                ])}
                availableModels={session.modelCatalog.models}
                modelCatalog={session.modelCatalog}
                connectionState={paired.connectionState}
                diffSummary={paired.diffs[route.thread.id]}
                error={paired.error}
                hostLabel={paired.session.environmentLabel}
                initialEffort={route.initialEffort}
                isRefreshing={paired.isRefreshing && paired.connectionState === "connected"}
                liveEvents={paired.liveEvents}
                onBack={backToHome}
                onCancel={session.cancelTurn}
                onLoadDiff={session.loadDiff}
                onLoadDiffFile={session.loadDiffFile}
                onLoadUsage={session.loadUsage}
                onLoadComposerCommands={session.loadComposerCommands}
                onLoadModels={session.loadModels}
                onRefresh={session.refresh}
                onResolveApproval={session.resolveApproval}
                onResolveQuestion={session.resolveQuestion}
                onSend={session.sendMessage}
                onSetApproval={session.setThreadApproval}
                onSetModel={session.setThreadModel}
                pendingSend={session.pendingSendThreadId === route.thread.id}
                projectName={
                  projectGroups.find((project) => project.id === route.thread.projectId)?.name ??
                  "Project"
                }
                snapshot={paired.snapshot}
                thread={route.thread}
              />
            )}
          </NavDrawerLayout>
          <SettingsScreen
            machines={machineFilters}
            onRemoveMachine={async (id) => {
              await controllers[id]?.unpair();
            }}
            onAddMachine={() => {
              setShowSettings(false);
              setShowPairing(true);
            }}
            connectionState={paired.connectionState}
            onClose={() => setShowSettings(false)}
            onUnpair={session.unpair}
            session={paired.session}
            visible={showSettings}
          />
        </>
      ) : null}
    </View>
  );
}

function PairMachine({
  initialInput,
  onPaired,
  error,
  onCancel,
  onPairingChange,
}: {
  readonly onCancel?: () => void;
  readonly onPairingChange?: (pairing: boolean) => void;
  readonly initialInput?: string;
  readonly onPaired: (credential: GraftSessionCredential) => void;
  readonly error?: string;
}) {
  const pairing = useGraftSession(null);
  useEffect(() => {
    onPairingChange?.(pairing.state.status === "pairing");
  }, [pairing.state.status, onPairingChange]);
  useEffect(() => {
    if (pairing.state.status === "paired") onPaired(pairing.state.session);
  }, [pairing.state, onPaired]);
  return (
    <PairingScreen
      initialInput={initialInput}
      onCancel={onCancel}
      error={
        pairing.state.status === "unpaired" || pairing.state.status === "pairing"
          ? (pairing.state.error ?? error)
          : error
      }
      isPairing={pairing.state.status === "pairing"}
      onPair={pairing.pair}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MenuProvider>
        <GraftApp />
      </MenuProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
