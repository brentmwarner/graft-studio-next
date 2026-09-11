import {
  GraftDesktopJsonValueSchema,
  type GraftDesktopJsonValue,
} from "@graft/shared";
import type { ClaimedBulkUpload } from "./bulkTransferStore.js";

export interface PreparedUploadedCommand {
  command: { type: string; payload?: GraftDesktopJsonValue };
  release(): void;
  retainUntilRunCompletes: boolean;
}

type ClaimUpload = (
  transferId: string,
  fileName: string,
) => ClaimedBulkUpload | null;

function payloadRecord(
  payload: GraftDesktopJsonValue | undefined,
): Record<string, GraftDesktopJsonValue> {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("An uploaded command payload is required");
  }
  return payload;
}

function parseUploadReference(reference: string): {
  transferId: string;
  fileName: string;
} {
  const match = reference.match(
    /^graft-upload:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([^/?#]+)$/iu,
  );
  if (!match?.[1] || !match[2]) {
    throw new Error("A local path cannot be used by the remote host");
  }
  let fileName: string;
  try {
    fileName = decodeURIComponent(match[2]);
  } catch {
    throw new Error("The uploaded file name is invalid");
  }
  return { transferId: match[1], fileName };
}

export function prepareUploadedCommand(
  command: { type: string; payload?: GraftDesktopJsonValue },
  claimUpload: ClaimUpload,
): PreparedUploadedCommand {
  const claims = new Map<string, ClaimedBulkUpload>();
  const resolveReference = (reference: unknown): string => {
    if (typeof reference !== "string") {
      throw new Error("An uploaded file reference is required");
    }
    const existing = claims.get(reference);
    if (existing) return existing.path;
    const parsed = parseUploadReference(reference);
    const claimed = claimUpload(parsed.transferId, parsed.fileName);
    if (!claimed) throw new Error("The uploaded file is missing or expired");
    claims.set(reference, claimed);
    return claimed.path;
  };
  const release = () => {
    for (const claim of claims.values()) claim.release();
    claims.clear();
  };

  try {
    if (command.type === "files/import") {
      const payload = payloadRecord(command.payload);
      if (
        !Array.isArray(payload.sourcePaths) ||
        payload.sourcePaths.length === 0
      ) {
        throw new Error("Imported files are required");
      }
      return {
        command: {
          ...command,
          payload: GraftDesktopJsonValueSchema.parse({
            ...payload,
            sourcePaths: payload.sourcePaths.map(resolveReference),
          }),
        },
        release,
        retainUntilRunCompletes: false,
      };
    }
    if (command.type === "turn/start") {
      const payload = payloadRecord(command.payload);
      const filePaths = payload.filePaths;
      const imagePreviews = payload.imagePreviews;
      if (filePaths !== undefined && !Array.isArray(filePaths)) {
        throw new Error("Attachment paths are invalid");
      }
      if (imagePreviews !== undefined && !Array.isArray(imagePreviews)) {
        throw new Error("Image attachments are invalid");
      }
      const resolvedImages = imagePreviews?.map((image) => {
        if (!image || Array.isArray(image) || typeof image !== "object") {
          throw new Error("An image attachment is invalid");
        }
        return { ...image, path: resolveReference(image.path) };
      });
      return {
        command: {
          ...command,
          payload: GraftDesktopJsonValueSchema.parse({
            ...payload,
            ...(filePaths
              ? { filePaths: filePaths.map(resolveReference) }
              : {}),
            ...(resolvedImages ? { imagePreviews: resolvedImages } : {}),
          }),
        },
        release,
        retainUntilRunCompletes: claims.size > 0,
      };
    }
    return {
      command,
      release,
      retainUntilRunCompletes: false,
    };
  } catch (error) {
    release();
    throw error;
  }
}
