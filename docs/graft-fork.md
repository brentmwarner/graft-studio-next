# Graft fork foundation

Status: active foundation work. The Synara fork is the new Graft codebase; the
existing Graft repository remains the preserved, independently runnable v1
implementation until an explicit production cutover.

## Repository relationship

| Role | Repository or ref |
| --- | --- |
| Synara upstream | `Emanuele-web04/synara` / local remote `upstream` |
| Graft fork | `brentmwarner/graft-studio-next` / local remote `origin` |
| Preserved Graft v1 | `brentmwarner/graft-studio`, branch `legacy/graft-v1` |
| Initial local snapshot | tag `graft-v1-pre-synara-2026-09-01` |
| Latest pre-cutover snapshot | tag `graft-v1-pre-synara-cutover-2026-09-01` |

Do not merge the unrelated Graft v1 Git history into this repository. Port a
Graft capability only after identifying the corresponding Synara boundary and
implementing it through that boundary.

The preserved branch includes the completed Graft SSH remote-project work that
landed on the original repository after the initial local snapshot. Do not move
either annotated snapshot tag; fast-forward the preservation branch if approved
Graft v1 work continues before cutover.

## Ownership model

Synara's server remains the sole authority for projects, threads, provider
sessions, Git/worktrees, terminals, files, and durable orchestration. Graft
features extend those systems rather than creating a second runtime or database
beside them.

The initial mapping is:

| Graft v1 capability | Destination in this fork |
| --- | --- |
| Desktop orchestration and provider sessions | Existing `apps/server` orchestration and provider adapters |
| Electron shell and desktop UI | Existing `apps/desktop` and `apps/web` |
| Local/remote environment selection | Transport and server-launch adapters around the same server contracts |
| `graft-host` SSH runtime | Headless packaging of `apps/server`; do not port the separate host domain model |
| SSH discovery, bootstrap, tunnel, and reconnect | Graft-owned infrastructure adapters outside the orchestration core |
| Cross-provider delegation | A server-side orchestration capability using canonical provider contracts |
| Native iOS and Android clients | Clients of `packages/contracts`; the server remains authoritative |
| Account, pairing, relay, and feedback control plane | External adapter; no provider inference or project truth in the control plane |

Graft-owned additions should prefer new, focused modules and small registration
points. Avoid broad renames or duplicated copies of upstream files. Package
names and internal Synara terminology stay unchanged during the foundation
phase unless a product-facing surface requires otherwise; this keeps upstream
merges reviewable.

## Reversibility requirements

The migration is copy-first:

1. Never mutate the only copy of a Graft v1 database.
2. Import into a fresh Synara/Graft data directory and record the source schema
   and snapshot identifier.
3. Keep the original Graft application and `graft-host` install available while
   the fork is in canary use.
4. Install a Synara-based remote host beside `graft-host`, with separate paths,
   ports, process identity, and data.
5. Do not claim rollback support for data created after cutover until an export
   or reverse-migration path exists.
6. Never release the fork or remove the legacy path without explicit approval.

Rollback before cutover means closing the fork and launching Graft v1 against
its untouched database. Rollback after cutover additionally requires exporting
post-cutover work or accepting that it remains readable only in the fork.

## Upstream update procedure

Use merge commits for upstream integrations so each imported Synara update is
auditable as a unit:

```bash
git fetch upstream --prune --tags
git switch main
git merge --no-ff upstream/main
git push origin main
```

Perform product work on `codex/*` branches and merge it into the fork's `main`
through reviewed pull requests. Before merging an upstream update:

1. Read the upstream release notes and migration changes.
2. Merge upstream into a temporary `codex/upstream-*` branch based on the
   fork's `main`.
3. Run the repository's format, lint, typecheck, focused tests, and desktop
   smoke checks required by the affected surfaces.
4. Exercise Graft-owned adapters, especially SSH, delegation, mobile contracts,
   data migration, and release packaging.
5. Merge the verified integration into `main` without copying individual files
   from the upstream repository.

## Foundation sequence

1. Establish the fork, preservation refs, and upstream workflow.
2. Verify the untouched Synara baseline builds and runs in an isolated data
   directory.
3. Define the SSH machine/transport ports against the existing server contract.
4. Package the same server for local desktop and remote SSH execution.
5. Port cross-provider delegation and the control-plane boundary.
6. Add a one-way, non-destructive Graft v1 data importer.
7. Adapt both native mobile clients to the shared server contracts.
8. Run a canary period before any explicit production cutover.

The current phase is complete only when the upstream baseline and rollback
points are verified. No user data migration or release is part of this phase.
