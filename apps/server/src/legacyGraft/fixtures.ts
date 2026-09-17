import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Synthetic legacy capabilities; never opens a user's real database. */
export function createLegacyFixture(directory: string) {
  const databasePath = path.join(directory, "graft-local.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (31);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, repoPath TEXT, projectKind TEXT, createdAt INTEGER);
    CREATE TABLE threads (id TEXT PRIMARY KEY, projectId TEXT REFERENCES projects(id), title TEXT, mode TEXT, worktreeId TEXT, localPath TEXT, providerHint TEXT, modelName TEXT, executionMode TEXT, cliSessionId TEXT, providerInstanceId TEXT, cliSessionProviderInstanceId TEXT, parentThreadId TEXT, agentName TEXT, archivedAt INTEGER, createdAt INTEGER, updatedAt INTEGER);
    CREATE TABLE worktrees (id TEXT PRIMARY KEY, projectId TEXT REFERENCES projects(id), path TEXT, branchName TEXT, baseBranch TEXT, status TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, threadId TEXT REFERENCES threads(id), kind TEXT, status TEXT, threadSequence INTEGER, createdAt INTEGER);
    CREATE TABLE events (id TEXT PRIMARY KEY, threadId TEXT REFERENCES threads(id), runId TEXT, type TEXT, payload TEXT, threadSequence INTEGER, createdAt INTEGER);
    CREATE TABLE run_events (id TEXT PRIMARY KEY, threadId TEXT REFERENCES threads(id), runId TEXT, sequence INTEGER, payload TEXT);
    CREATE TABLE message_parts (id TEXT PRIMARY KEY, threadId TEXT REFERENCES threads(id), runId TEXT, role TEXT, partType TEXT, partIndex INTEGER, content TEXT, metadata TEXT, threadSequence INTEGER, createdAt INTEGER, updatedAt INTEGER);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, threadId TEXT REFERENCES threads(id), filePath TEXT, mimeType TEXT, threadSequence INTEGER);
    CREATE TABLE automations (id TEXT PRIMARY KEY, projectId TEXT, enabled INTEGER, prompt TEXT);
    CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE provider_instances (id TEXT PRIMARY KEY, providerId TEXT, connectionMethod TEXT, name TEXT);
    CREATE TABLE proposed_plans (id TEXT PRIMARY KEY, threadId TEXT, planMarkdown TEXT);
    INSERT INTO projects VALUES ('project', 'Legacy project', '/tmp/legacy-project', 'repo', 1000);
    INSERT INTO worktrees VALUES ('worktree', 'project', '/tmp/legacy-worktree', 'feature/kept', 'main', 'active');
    INSERT INTO threads VALUES ('thread', 'project', 'Saved conversation', 'worktree', 'worktree', '/tmp/legacy-worktree', 'openai', 'gpt-5-codex', 'byom', 'native-session-1', 'instance-1', 'instance-1', NULL, NULL, NULL, 1000, 9000);
    INSERT INTO threads VALUES ('unsupported', 'project', 'Hosted history', 'local', NULL, '/tmp/legacy-project', 'graft', 'old-hosted', 'hosted', 'hosted-session', NULL, NULL, NULL, NULL, 8000, 1000, 9000);
    INSERT INTO runs VALUES ('run', 'thread', 'agent', 'success', 1, 5000);
    INSERT INTO runs VALUES ('run-old', 'unsupported', 'agent', 'success', 1, 5000);
    INSERT INTO events VALUES ('event', 'thread', 'run', 'turn.request', '{"text":"Original prompt"}', 1, 5000);
    INSERT INTO run_events VALUES ('raw', 'thread', 'run', 1, '{"type":"tool_use","command":"touch /must-not-execute"}');
    INSERT INTO message_parts VALUES ('user', 'thread', 'run', 'user', 'text', 0, 'Original prompt', '{}', 1, 6000, 6000);
    INSERT INTO message_parts VALUES ('tool', 'thread', 'run', 'assistant', 'tool_call', 1, '<script>touch /must-not-execute</script>', '{"toolName":"bash","args":{"command":"touch /must-not-execute"}}', 1, 2000, 2000);
    INSERT INTO message_parts VALUES ('assistant', 'thread', 'run', 'assistant', 'text', 2, 'Original response', '{}', 1, 1000, 1000);
    INSERT INTO message_parts VALUES ('hosted-text', 'unsupported', 'run-old', 'assistant', 'text', 0, 'Hosted response retained', '{}', 1, 1000, 1000);
    INSERT INTO automations VALUES ('automation', 'project', 1, 'Never schedule during migration');
    INSERT INTO preferences VALUES ('unknown-preference', 'preserve-me');
    INSERT INTO provider_instances VALUES ('instance-1', 'openai', 'oauth', 'Original account');
    INSERT INTO proposed_plans VALUES ('plan', 'thread', '# Preserved plan');
  `);
  return { database, databasePath };
}
