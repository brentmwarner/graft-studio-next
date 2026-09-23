import {
  AlertDialog,
  Column,
  Host,
  Text as ComposeText,
  TextButton,
  TextField,
  useNativeState,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import type { GraftThreadDetails, GraftThreadSummary } from "@graft/mobile-contract";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AnchoredMenu, MenuItem } from "../../components/AnchoredMenu";
import { useGraftPalette } from "../../theme/tokens";

interface Props {
  readonly thread: GraftThreadSummary;
  readonly projectName: string;
  readonly connected: boolean;
  readonly onLoadDetails: (threadId: string) => Promise<GraftThreadDetails>;
  readonly onRename: (threadId: string, title: string) => Promise<GraftThreadSummary>;
  readonly trigger: (open: () => void) => ReactElement;
}

function RenameThreadDialog({
  thread,
  onRename,
  onClose,
}: Pick<Props, "thread" | "onRename"> & { readonly onClose: () => void }) {
  const palette = useGraftPalette();
  const nativeTitle = useNativeState(thread.title);
  const [draft, setDraft] = useState(thread.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const savingRef = useRef(false);
  const save = async () => {
    const title = draft.trim();
    if (!title || title.length > 200 || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await onRename(thread.id, title);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't rename this thread. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Host matchContents>
      <AlertDialog
        onDismissRequest={() => {
          if (!savingRef.current) onClose();
        }}
        colors={{
          containerColor: palette.elevated,
          titleContentColor: palette.foreground,
          textContentColor: palette.foreground,
        }}
      >
        <AlertDialog.Title>
          <ComposeText>Rename thread</ComposeText>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <Column>
            <TextField
              value={nativeTitle}
              onValueChange={setDraft}
              autoFocus
              singleLine
              enabled={!saving}
              isError={draft.trim().length > 200 || Boolean(error)}
              modifiers={[fillMaxWidth()]}
              keyboardOptions={{ imeAction: "done", capitalization: "sentences" }}
              keyboardActions={{
                onDone: () => {
                  void save();
                },
              }}
            >
              <TextField.Label>
                <ComposeText>Thread name</ComposeText>
              </TextField.Label>
            </TextField>
            {error ? <ComposeText color={palette.danger}>{error}</ComposeText> : null}
            {draft.trim().length > 200 ? (
              <ComposeText color={palette.danger}>Use 200 characters or fewer.</ComposeText>
            ) : null}
          </Column>
        </AlertDialog.Text>
        <AlertDialog.DismissButton>
          <TextButton enabled={!saving} onClick={onClose}>
            <ComposeText>Cancel</ComposeText>
          </TextButton>
        </AlertDialog.DismissButton>
        <AlertDialog.ConfirmButton>
          <TextButton
            enabled={!saving && Boolean(draft.trim()) && draft.trim().length <= 200}
            onClick={() => {
              void save();
            }}
          >
            <ComposeText>{saving ? "Saving…" : "Save"}</ComposeText>
          </TextButton>
        </AlertDialog.ConfirmButton>
      </AlertDialog>
    </Host>
  );
}

export function ThreadDetailsMenu({
  thread,
  projectName,
  connected,
  onLoadDetails,
  onRename,
  trigger,
}: Props) {
  const palette = useGraftPalette();
  const [details, setDetails] = useState<GraftThreadDetails>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const load = async () => {
    const request = ++generation.current;
    setDetails(undefined);
    setLoading(true);
    setFailed(false);
    try {
      const result = await onLoadDetails(thread.id);
      if (request === generation.current) setDetails(result);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  return (
    <>
      <AnchoredMenu
        trigger={trigger}
        onOpenChange={(open) => {
          if (open) void load();
          else generation.current += 1;
        }}
      >
        {(close) => (
          <>
            <ContextRow
              icon="git-branch-outline"
              value={
                loading
                  ? "Loading branch…"
                  : (details?.branch ??
                    (details?.gitStatus === "not_repository"
                      ? "No Git branch"
                      : details?.gitStatus === "available"
                        ? "Detached HEAD"
                        : "Branch unavailable"))
              }
            />
            <ContextRow
              icon={thread.mode === "worktree" ? "copy-outline" : "folder-outline"}
              value={details?.workspaceName ?? projectName}
              detail={thread.mode === "worktree" ? "Worktree" : "Local"}
            />
            {failed && connected ? (
              <MenuItem
                icon="refresh-outline"
                label="Retry"
                onPress={() => {
                  void load();
                }}
              />
            ) : null}
            <View
              style={{
                height: 1,
                marginHorizontal: 12,
                marginVertical: 4,
                backgroundColor: palette.muted,
              }}
            />
            <MenuItem
              label="Rename thread"
              enabled={connected}
              onPress={() => {
                close();
                setRenaming(true);
              }}
            />
          </>
        )}
      </AnchoredMenu>
      {renaming ? (
        <RenameThreadDialog
          thread={thread}
          onRename={onRename}
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </>
  );
}

function ContextRow({
  icon,
  value,
  detail,
}: {
  readonly icon: "git-branch-outline" | "copy-outline" | "folder-outline";
  readonly value: string;
  readonly detail?: string;
}) {
  const palette = useGraftPalette();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={palette.foregroundMuted} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={2} style={{ color: palette.foreground, fontSize: 16 }}>
          {value}
        </Text>
        {detail ? (
          <Text style={{ color: palette.foregroundSubtle, fontSize: 12 }}>{detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
});
