import { Schema } from "effect";

export const GraftAccountIdentity = Schema.Struct({
  accountId: Schema.String,
  email: Schema.String,
});
export type GraftAccountIdentity = typeof GraftAccountIdentity.Type;

export const GraftAccountIssue = Schema.Literals([
  "sign-in-failed",
  "timeout",
  "session-expired",
  "service-unavailable",
  "secure-storage-unavailable",
  "storage-failed",
  "disconnect-failed",
]);
export type GraftAccountIssue = typeof GraftAccountIssue.Type;

/** Account identity only. Hosted-service tokens never cross the desktop bridge. */
export const GraftAccountState = Schema.Struct({
  status: Schema.Literals(["signed-out", "checking", "signing-in", "signed-in", "unavailable"]),
  account: Schema.NullOr(GraftAccountIdentity),
  issue: Schema.NullOr(GraftAccountIssue),
});
export type GraftAccountState = typeof GraftAccountState.Type;
