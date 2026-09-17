import { StatusBar } from "expo-status-bar";
import type { GraftThreadSummary } from "@graft/mobile-contract";
import { useEffect, useMemo, useState } from "react";
import { BackHandler, Linking, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MenuProvider } from "./src/components/MenuProvider";
import { NavDrawerLayout } from "./src/components/NavDrawer";
import { HomeScreen } from "./src/screens/HomeScreen";
import { NewChatScreen } from "./src/screens/NewChatScreen";
import { PairingScreen } from "./src/screens/PairingScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { SplashScreen } from "./src/screens/SplashScreen";
import { ThreadScreen } from "./src/screens/ThreadScreen";
import { groupProjects } from "./src/state/mobileViewModels";
import { useGraftSession } from "./src/state/useGraftSession";
import { useGraftPalette } from "./src/theme/tokens";

type AppRoute =
  | { readonly name: "home" }
  | {
      readonly name: "thread";
      readonly thread: GraftThreadSummary;
      readonly initialEffort?: string;
    }
  | { readonly name: "new-chat"; readonly initialProjectId?: string };

function GraftApp() {
  const palette = useGraftPalette();
  const session = useGraftSession();
  const [route, setRoute] = useState<AppRoute>({ name: "home" });
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const paired = session.state.status === "paired" ? session.state : null;
  const pairedSnapshot = paired?.snapshot ?? null;

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url) session.receivePairingLink(url);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      session.receivePairingLink(url);
    });
    return () => subscription.remove();
  }, [session.receivePairingLink]);

  useEffect(() => {
    if (session.state.status !== "paired") {
      setRoute({ name: "home" });
      setIsDrawerOpen(false);
      setShowSettings(false);
    }
  }, [session.state.status]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Back dismisses the drawer before it pops the route, matching the
      // way iOS treats the open drawer as the topmost presentation.
      if (isDrawerOpen) {
        setIsDrawerOpen(false);
        return true;
      }
      if (route.name === "home") return false;
      session.closeThread();
      setRoute({ name: "home" });
      return true;
    });
    return () => subscription.remove();
  }, [isDrawerOpen, route.name, session.closeThread]);

  const projectGroups = useMemo(() => groupProjects(pairedSnapshot, ""), [pairedSnapshot]);

  function openThread(thread: GraftThreadSummary) {
    setIsDrawerOpen(false);
    setRoute({ name: "thread", thread });
    void session.openThread(thread.id);
  }

  function backToHome() {
    session.closeThread();
    setRoute({ name: "home" });
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <StatusBar style={palette.isDark ? "light" : "dark"} />
      {session.state.status === "loading" ? <SplashScreen /> : null}
      {session.state.status === "unpaired" || session.state.status === "pairing" ? (
        <PairingScreen
          error={session.state.error}
          initialInput={session.state.pendingInput}
          isPairing={session.state.status === "pairing"}
          onPair={session.pair}
        />
      ) : null}
      {paired ? (
        <>
          {/* The drawer wraps the routed content, so opening it slides the
              whole screen — top bar included — exactly like the iOS
              `NavDrawerLayout` wrapping its `NavigationStack`. */}
          <NavDrawerLayout
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
                connectionState={paired.connectionState}
                error={paired.error}
                isRefreshing={paired.isRefreshing}
                onNewChat={(initialProjectId) => setRoute({ name: "new-chat", initialProjectId })}
                onOpenMenu={() => setIsDrawerOpen(true)}
                onOpenThread={(item) => {
                  const thread = pairedSnapshot?.threads.find(
                    (candidate) => candidate.id === item.id,
                  );
                  if (thread) openThread(thread);
                }}
                onRefresh={session.refresh}
                onUnpair={session.unpair}
                session={paired.session}
                snapshot={paired.snapshot}
              />
            ) : route.name === "new-chat" ? (
              <NewChatScreen
                composerFeatures={paired.snapshot?.environment.composerFeatures}
                error={paired.error}
                availableModels={paired.availableModels}
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
                      current.name === "new-chat"
                        ? {
                            name: "thread",
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
                key={route.thread.id}
                availableModels={paired.availableModels}
                connectionState={paired.connectionState}
                diffSummary={paired.diffs[route.thread.id]}
                error={paired.error}
                hostLabel={paired.session.environmentLabel}
                initialEffort={route.initialEffort}
                isRefreshing={paired.isRefreshing}
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
