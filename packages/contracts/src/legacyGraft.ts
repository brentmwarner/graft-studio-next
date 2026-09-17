import { Schema } from "effect";

import { NonNegativeInt, ThreadId } from "./baseSchemas";

export const LegacyGraftThreadSummary = Schema.Struct({
  sourceThreadId: Schema.String,
  title: Schema.String,
  provider: Schema.NullOr(Schema.String),
  importedThreadId: Schema.NullOr(ThreadId),
  disposition: Schema.Literals(["reconnect-required", "archive-only"]),
  reasons: Schema.Array(Schema.String),
  archiveFile: Schema.String,
});
export type LegacyGraftThreadSummary = typeof LegacyGraftThreadSummary.Type;

export const LegacyGraftAttachmentSummary = Schema.Struct({
  sourcePath: Schema.String,
  archiveFile: Schema.NullOr(Schema.String),
  disposition: Schema.Literals([
    "copied",
    "missing",
    "outside-approved-roots",
    "unsafe",
    "too-large",
  ]),
});
export type LegacyGraftAttachmentSummary = typeof LegacyGraftAttachmentSummary.Type;

/** Owner-visible migration evidence. Credentials and source row payloads never belong here. */
export const LegacyGraftImportSummary = Schema.Struct({
  version: Schema.Literal(1),
  sourceId: Schema.String,
  sourceSchemaVersion: NonNegativeInt,
  preparedAt: Schema.String,
  sourceTableCounts: Schema.Record(Schema.String, NonNegativeInt),
  importedProjects: NonNegativeInt,
  importedThreads: NonNegativeInt,
  importedMessages: NonNegativeInt,
  archiveOnlyThreads: NonNegativeInt,
  resumedThreads: Schema.Literal(0),
  archivedAutomations: NonNegativeInt,
  threads: Schema.Array(LegacyGraftThreadSummary),
  attachments: Schema.Array(LegacyGraftAttachmentSummary),
  warnings: Schema.Array(Schema.String),
});
export type LegacyGraftImportSummary = typeof LegacyGraftImportSummary.Type;

export const LegacyGraftImportProgress = Schema.Struct({
  phase: Schema.Literals(["prepared", "importing", "complete"]),
  completedCommands: NonNegativeInt,
  totalCommands: NonNegativeInt,
  summary: LegacyGraftImportSummary,
});
export type LegacyGraftImportProgress = typeof LegacyGraftImportProgress.Type;
