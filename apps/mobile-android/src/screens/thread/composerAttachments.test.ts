import { describe, expect, it } from "vitest";

import {
  COMPOSER_ATTACHMENT_LIMIT,
  COMPOSER_ATTACH_SOURCES,
  attachmentNameFromUri,
  canAddAttachments,
  remainingAttachmentSlots,
} from "./composerAttachments";

describe("composerAttachments", () => {
  it("exposes the native Photos / Files attach sources", () => {
    expect(COMPOSER_ATTACH_SOURCES).toEqual(["Photos", "Camera", "Files", "Paste"]);
  });

  it("caps the pending strip at four images", () => {
    expect(COMPOSER_ATTACHMENT_LIMIT).toBe(4);
    expect(remainingAttachmentSlots(0)).toBe(4);
    expect(canAddAttachments(4)).toBe(false);
  });

  it("reads a file name from a picker URI", () => {
    expect(attachmentNameFromUri("file:///tmp/Studio%20shot.jpg", "Photo")).toBe("Studio shot.jpg");
    expect(attachmentNameFromUri("file:///", "Photo")).toBe("Photo");
  });
});
