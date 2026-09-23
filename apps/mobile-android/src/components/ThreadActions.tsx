import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { InboxThreadItem } from "../state/mobileViewModels";
import { useGraftPalette } from "../theme/tokens";
import { AnchoredMenu, MenuItem } from "./AnchoredMenu";
import { BottomSheet } from "./BottomSheet";

export type ThreadActionHandler = (
  thread: InboxThreadItem,
  action: "rename" | "archive" | "delete",
  title?: string,
) => Promise<void>;

const ACTION_WIDTH = 240;

export function ThreadActions({
  thread,
  onAction,
  onOpen,
  children,
}: {
  readonly thread: InboxThreadItem;
  readonly onAction: ThreadActionHandler;
  readonly onOpen: () => void;
  readonly children: ReactNode;
}) {
  const palette = useGraftPalette();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const pending = useRef(false);
  const offset = useSharedValue(0);
  const origin = useRef(0);
  const open = useRef(false);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !pending.current &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2 &&
          (gesture.dx < 0 || open.current),
        onPanResponderGrant: () => {
          origin.current = open.current ? -ACTION_WIDTH : 0;
          setRevealed(true);
        },
        onPanResponderMove: (_event, gesture) => {
          offset.value = Math.max(-ACTION_WIDTH, Math.min(0, origin.current + gesture.dx));
        },
        onPanResponderRelease: (_event, gesture) => {
          open.current = origin.current + gesture.dx < -ACTION_WIDTH / 2;
          offset.value = withTiming(open.current ? -ACTION_WIDTH : 0);
          setRevealed(open.current);
        },
        onPanResponderTerminate: () => {
          offset.value = withTiming(open.current ? -ACTION_WIDTH : 0);
          setRevealed(open.current);
        },
      }),
    [offset],
  );

  function closeSwipe() {
    open.current = false;
    setRevealed(false);
    offset.value = withTiming(0);
  }

  async function perform(action: "rename" | "archive" | "delete") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await onAction(thread, action, action === "rename" ? title.trim() : undefined);
      setRenaming(false);
      closeSwipe();
    } catch (error) {
      Alert.alert(
        "Could not update chat",
        error instanceof Error ? error.message : "Reconnect and try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function rename() {
    closeSwipe();
    setTitle(thread.title);
    setRenaming(true);
  }

  function confirmDelete() {
    Alert.alert("Delete chat?", `“${thread.title}” will be permanently deleted.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void perform("delete") },
    ]);
  }

  return (
    <>
      <View style={styles.container} {...pan.panHandlers}>
        {revealed ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rename chat"
              disabled={busy}
              onPress={rename}
              style={[styles.action, { backgroundColor: palette.subtle }]}
            >
              <Text style={{ color: palette.foreground }}>Rename</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Archive chat"
              disabled={busy}
              onPress={() => void perform("archive")}
              style={[styles.action, { backgroundColor: palette.foreground }]}
            >
              <Text style={{ color: palette.background }}>Archive</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete chat"
              disabled={busy}
              onPress={confirmDelete}
              style={[styles.action, { backgroundColor: palette.subtle }]}
            >
              <Text style={{ color: palette.danger }}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
        <Animated.View style={[{ backgroundColor: palette.background }, rowStyle]}>
          <AnchoredMenu
            trigger={(show) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={thread.title}
                accessibilityHint="Open chat. Long press for chat actions."
                style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                accessibilityActions={[{ name: "longpress", label: "Chat actions" }]}
                onAccessibilityAction={({ nativeEvent }) => {
                  if (nativeEvent.actionName === "longpress") show();
                }}
                disabled={busy}
                onLongPress={() => {
                  closeSwipe();
                  show();
                }}
                onPress={() => {
                  if (open.current) closeSwipe();
                  else onOpen();
                }}
              >
                {children}
              </Pressable>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon="pencil-outline"
                  label="Rename"
                  enabled={!busy}
                  onPress={() => {
                    close();
                    rename();
                  }}
                />
                <MenuItem
                  icon="archive-outline"
                  label="Archive"
                  enabled={!busy}
                  onPress={() => {
                    close();
                    void perform("archive");
                  }}
                />
                <MenuItem
                  icon="trash-outline"
                  label="Delete"
                  enabled={!busy}
                  onPress={() => {
                    close();
                    confirmDelete();
                  }}
                />
              </>
            )}
          </AnchoredMenu>
        </Animated.View>
      </View>
      <BottomSheet
        avoidKeyboard
        visible={renaming}
        title="Rename chat"
        onClose={() => {
          if (!busy) setRenaming(false);
        }}
      >
        <View style={styles.rename}>
          <TextInput
            accessibilityLabel="Chat title"
            autoFocus
            selectTextOnFocus
            maxLength={200}
            value={title}
            onChangeText={setTitle}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (title.trim()) void perform("rename");
            }}
            style={[styles.input, { backgroundColor: palette.subtle, color: palette.foreground }]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !title.trim()}
            onPress={() => void perform("rename")}
            style={[
              styles.save,
              { backgroundColor: palette.foreground, opacity: busy || !title.trim() ? 0.5 : 1 },
            ]}
          >
            <Text style={{ color: palette.background }}>{busy ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: { overflow: "hidden" },
  actions: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    flexDirection: "row",
  },
  action: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
  rename: { padding: 20, gap: 16 },
  input: { padding: 14, borderRadius: 12, fontSize: 16 },
  save: { alignItems: "center", padding: 14, borderRadius: 12 },
});
