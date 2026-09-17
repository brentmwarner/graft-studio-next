import { Schema } from "effect";

import { LegacyGraftImportProgress } from "./legacyGraft";

export const LegacyGraftRuntimeStatus = Schema.Struct({
  phase: Schema.Literals(["checking", "importing", "complete", "no-source", "failed"]),
  progress: Schema.NullOr(LegacyGraftImportProgress),
  error: Schema.NullOr(Schema.String),
});
export type LegacyGraftRuntimeStatus = typeof LegacyGraftRuntimeStatus.Type;
