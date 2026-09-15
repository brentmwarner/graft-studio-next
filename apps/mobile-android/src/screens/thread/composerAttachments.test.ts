import { describe, expect, it } from "vitest";

import {
  COMPOSER_ATTACHMENT_LIMIT,
  COMPOSER_ATTACHMENTS_SUPPORTED,
  COMPOSER_ATTACH_SOURCES,
  attachmentNameFromUri,
  canAddAttachments,
  imageDataUri,
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

  it("keeps the attach entry point hidden until the host accepts attachments", () => {
    expect(COMPOSER_ATTACHMENTS_SUPPORTED).toBe(false);
  });

  it("prefixes clipboard JPEG bytes so Image can preview a paste", () => {
    expect(imageDataUri("abc123")).toBe("data:image/jpeg;base64,abc123");
    expect(imageDataUri("data:image/png;base64,xyz", "image/png")).toBe(
      "data:image/png;base64,xyz",
    );
  });
});
