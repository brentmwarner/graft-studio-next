import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";

import {
  attachmentNameFromUri,
  canAddAttachments,
  imageDataUri,
  remainingAttachmentSlots,
  type ComposerAttachment,
} from "./composerAttachments";

export interface ComposerAttachmentState {
  readonly attachments: readonly ComposerAttachment[];
  readonly error?: string;
  readonly pickCamera: () => Promise<void>;
  readonly pickFiles: () => Promise<void>;
  readonly pickPhotos: () => Promise<void>;
  readonly paste: () => Promise<void>;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
}

function nextAttachment(
  uri: string,
  mimeType: string | undefined,
  name: string | undefined,
): ComposerAttachment {
  return {
    id: Crypto.randomUUID(),
    mimeType: mimeType ?? "image/jpeg",
    name: name ?? attachmentNameFromUri(uri, "Photo"),
    uri,
  };
}

export function useComposerAttachments(): ComposerAttachmentState {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [error, setError] = useState<string>();

  const append = useCallback((incoming: readonly ComposerAttachment[]) => {
    if (incoming.length === 0) return;
    setAttachments((current) => {
      const room = remainingAttachmentSlots(current.length);
      return room === 0 ? current : [...current, ...incoming.slice(0, room)];
    });
    setError(undefined);
  }, []);

  const pickPhotos = useCallback(async () => {
    if (!canAddAttachments(attachments.length)) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photos access is needed to attach from your library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      quality: 0.92,
      selectionLimit: remainingAttachmentSlots(attachments.length),
    });
    if (result.canceled) return;
    append(
      result.assets.map((asset) =>
        nextAttachment(asset.uri, asset.mimeType ?? undefined, asset.fileName ?? undefined),
      ),
    );
  }, [append, attachments.length]);

  const pickCamera = useCallback(async () => {
    if (!canAddAttachments(attachments.length)) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is needed to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.92,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    append([nextAttachment(asset.uri, asset.mimeType ?? undefined, asset.fileName ?? undefined)]);
  }, [append, attachments.length]);

  const pickFiles = useCallback(async () => {
    if (!canAddAttachments(attachments.length)) return;
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
      type: "image/*",
    });
    if (result.canceled) return;
    append(result.assets.map((asset) => nextAttachment(asset.uri, asset.mimeType, asset.name)));
  }, [append, attachments.length]);

  const paste = useCallback(async () => {
    if (!canAddAttachments(attachments.length)) return;
    const image = await Clipboard.getImageAsync({ format: "jpeg" });
    if (!image?.data) {
      setError("Nothing to paste.");
      return;
    }
    append([nextAttachment(imageDataUri(image.data), "image/jpeg", "Pasted photo")]);
  }, [append, attachments.length]);

  const remove = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setError(undefined);
  }, []);

  return {
    attachments,
    clear,
    error,
    paste,
    pickCamera,
    pickFiles,
    pickPhotos,
    remove,
  };
}
