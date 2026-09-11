import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./schema";

/**
 * Managed mobile relay environments.
 *
 * Transport/discovery only. This table stores who may open an uplink and
 * where to route a phone's traffic — never prompts, code, diffs, or any
 * other relayed content.
 */
export const relayEnvironments = sqliteTable(
  "relay_environments",
  {
    environmentId: text("environment_id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** sha256 hex of the uplink secret; the secret itself never lands here. */
    uplinkSecretDigest: text("uplink_secret_digest").notNull(),
    label: text("label"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("relay_environments_account_idx").on(table.accountId),
  ],
);
