import { GRAFT_MOBILE_MAX_ATTACHMENTS, assertNeverMobile } from "@graft/mobile-contract";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";

import {
  validateComposerAttachments,
  type AttachmentSource,
  type ComposerAttachment,
} from "./composerAttachmentSend";

function release(attachments: readonly ComposerAttachment[]) {
  for (const attachment of attachments) {
    try {
      const file = new File(attachment.uri);
      if (file.exists) file.delete();
    } catch {
      // Cache files are also eligible for OS cleanup.
    }
  }
}

export function useComposerAttachments(threadId: string) {
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string>();
  const selected = useRef<readonly ComposerAttachment[]>([]);
  const busy = useRef(false);
  const leased = useRef(new Set<string>());
  const generation = useRef(0);

  useEffect(() => {
    busy.current = false;
    setIsPicking(false);
    setAttachments([]);
    setError(undefined);
    return () => {
      generation.current += 1;
      release(selected.current.filter((attachment) => !leased.current.has(attachment.id)));
      selected.current = [];
    };
  }, [threadId]);

  function remove(ids: readonly string[]) {
    const removed = selected.current.filter((attachment) => ids.includes(attachment.id));
    selected.current = selected.current.filter((attachment) => !ids.includes(attachment.id));
    setAttachments(selected.current);
    release(removed.filter((attachment) => !leased.current.has(attachment.id)));
    setError(undefined);
  }

  async function pick(source: AttachmentSource) {
    if (busy.current) return;
    if (selected.current.length >= GRAFT_MOBILE_MAX_ATTACHMENTS) {
      setError(`Attach up to ${GRAFT_MOBILE_MAX_ATTACHMENTS} files per message.`);
      return;
    }
    busy.current = true;
    setIsPicking(true);
    setError(undefined);
    const request = generation.current;
    const copies: ComposerAttachment[] = [];
    try {
      let assets: readonly { uri: string; name: string; mimeType?: string }[];
      switch (source) {
        case "files": {
          const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
          if (result.canceled) return;
          assets = result.assets;
          break;
        }
        case "photos":
        case "camera": {
          if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
            throw new Error("Allow camera access in Android settings to take a photo.");
          }
          const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.9 };
          const result = source === "camera"
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync({
                ...options,
                allowsMultipleSelection: true,
                selectionLimit: GRAFT_MOBILE_MAX_ATTACHMENTS - selected.current.length,
              });
          if (result.canceled) return;
          assets = result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.fileName ?? asset.uri.split("/").pop() ?? "photo.jpg",
            mimeType: asset.mimeType ?? "image/jpeg",
          }));
          break;
        }
        default:
          return assertNeverMobile(source);
      }
      if (request !== generation.current) return;
      if (assets.length + selected.current.length > GRAFT_MOBILE_MAX_ATTACHMENTS) {
        throw new Error(`Attach up to ${GRAFT_MOBILE_MAX_ATTACHMENTS} files per message.`);
      }
      for (const asset of assets) {
        const file = new File(asset.uri);
        const mimeType = asset.mimeType || file.type || "application/octet-stream";
        const id = Crypto.randomUUID();
        const attachment: ComposerAttachment = {
          id,
          type: mimeType.toLowerCase().startsWith("image/") ? "image" : "file",
          name: asset.name,
          mimeType,
          sizeBytes: file.size,
          uri: asset.uri,
        };
        validateComposerAttachments([attachment]);
        // Own only our copies, never delete originals from the photo/document provider.
        const copy = new File(Paths.cache, `graft-attachment-${id}`);
        file.copy(copy);
        copies.push({ ...attachment, uri: copy.uri });
      }
      selected.current = [...selected.current, ...copies];
      setAttachments(selected.current);
    } catch (cause) {
      release(copies);
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : "Couldn’t open the attachment picker.");
      }
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setIsPicking(false);
      }
    }
  }

  function retainForSend() {
    const retained = selected.current;
    for (const attachment of retained) leased.current.add(attachment.id);
    return () => {
      for (const attachment of retained) leased.current.delete(attachment.id);
      release(retained.filter((attachment) => !selected.current.some((item) => item.id === attachment.id)));
    };
  }

  return { attachments, isPicking, error, pick, remove, retainForSend };
}
