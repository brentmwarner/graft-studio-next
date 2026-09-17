# Graft desktop production release

The current desktop replaces installed legacy Graft through the **existing public
Blob feed**, while keeping a separate data directory for recoverable migration.
The workflow builds current `brentmwarner/graft-studio-next` source. Historical
Synara bridge releases and GitHub channel aliases are not part of this rollout.

## Identity and platform coverage

| Target              | Native build runner | Production artifact                 |
| ------------------- | ------------------- | ----------------------------------- |
| macOS Apple Silicon | macos-14            | signed/notarized DMG and update ZIP |
| macOS Intel         | macos-15-intel      | signed/notarized DMG and update ZIP |
| Windows x64         | windows-2022        | signed NSIS installer               |
| Linux x64           | ubuntu-22.04        | AppImage                            |

These are the required build and upgrade verification targets. A matrix entry is
not evidence that its build or upgrade has passed. macOS requires **12.3 or
later**, including the bundled AppSnap helper. Windows requires **10 or later**.
The AppImage targets the Ubuntu 22.04 native build baseline; a local Arch Linux
smoke does not establish compatibility across Linux distributions. Windows ARM64, Linux ARM64,
32-bit systems, and additional Linux distributions require separate native
validation before being advertised. iOS/Android releases use their own mobile
pipelines; a desktop update does not publish a new mobile or Wear OS app.

Production retains `com.graft.studio`, product name `Graft`, and the legacy NSIS
registration `f67e4f48-bfd9-5024-b23c-0d23fd8d8e4a` (electron-builder UUIDv5 of the
legacy app ID). The new Electron profile remains `graft-studio-next`, so its
migration must copy and preserve the legacy `@graft/desktop` profile.

The updater uses channel `latest` at:

`https://xvce84ljzxgawnao.public.blob.vercel-storage.com/releases`

Its platform pointers remain `latest-mac.yml`, `latest.yml`, and
`latest-linux.yml`. Old installed apps already request these URLs. Promotion
therefore reaches the existing audience through its normal updater behavior;
it does not depend on users installing an intermediate bridge release.

Older Macs remain on the legacy app. Both macOS update manifests carry
`minimumSystemVersion: 21.4.0`, the Darwin kernel version for macOS 12.3, and the
bundle declares `LSMinimumSystemVersion=12.3`. Windows metadata uses `10.0.0`.
The publisher rejects missing/mismatched gates. The legacy electron-updater
6.3.9 reads this field against `os.release()`, so a `12.3` value in the update
manifest would incorrectly admit incompatible older Macs. See the
[electron-builder updater field](https://www.electron.build/docs/features/auto-update/),
[Apple's macOS 12.3 source manifest](https://raw.githubusercontent.com/apple-oss-distributions/distribution-macOS/macos-123/release.json),
and its [kernel MasterVersion](https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-8020.101.4/config/MasterVersion).
This rollout cannot promise the replacement to every historical OS version.

## Build once, verify, then promote those bytes

`.github/workflows/release.yml` is manual only. Its default operation is `build`.
Tag pushes never change the stable feed. No npm publish, version-bump commit, or
GitHub release is coupled to this desktop workflow.

1. Commit the desired stable version in `apps/desktop/package.json` and the
   corresponding workspace changes. Push the release branch through Cursor
   Origin. The workflow requires the requested version to match that commit.
2. Dispatch **Graft Production Release**, operation `build`, with the full
   40-character current-product commit SHA and stable version. Keep
   `sign_artifacts=true` for releasable artifacts. `false` produces build-only
   validation artifacts that the production publisher rejects.
3. The source job runs formatting, lint, typecheck, identity, platform boundary,
   migration lineage, and repository tests. Four native jobs package, verify
   signatures, record source/lockfile/artifact digests, and smoke the packaged
   app using isolated state.
4. Download and test the exact artifacts against real legacy installs. Validate
   the old updater's download/install path, account continuity, history and
   settings preservation, reconnect behavior, and rollback on every target.
   Keep evidence tied to the exact artifact hash, source commit, and predecessor
   version. A successful clean-profile startup alone is insufficient.
5. After completing those tests, dispatch **Graft Production Upgrade Evidence**
   in the release-host repository with the same source/version, signed build run
   ID, and the completed `upgrade-evidence.json`. The workflow downloads the
   exact signed artifacts, validates every receipt and hash against them, and
   uploads artifact `graft-upgrade-evidence`. Never manufacture passing receipts
   for untested platforms.
6. Dispatch operation `promote`, the same source/version, and the successful
   `build_run_id` and `evidence_run_id`. Both runs must be in the repository
   hosting this workflow. The promotion downloads the previously built bytes;
   it does not rebuild them. Build-run identity, all four signing/provenance
   records, artifact hashes, updater SHA-512 values, predecessor versions, and
   upgrade receipts are checked before the live feed changes.

To validate collected release assets locally without any upload:

```bash
node scripts/publish-graft-release.ts \
  --assets-dir release-assets \
  --evidence release-evidence/upgrade-evidence.json
```

Only adding `--publish` invokes the Blob writer. The workflow supplies that flag
only in the explicit `promote` operation.

## Updates after the initial cutover

Each later desktop release follows the same process: make the change and commit
a higher version, merge its reviewed PR, build signed native artifacts, verify
upgrading from the current production version, then promote those exact bytes.
Merging a PR or pushing a tag alone does not publish a desktop update through
this workflow. The release operator chooses when to run promotion.

The new desktop checks for updates shortly after startup, every four hours,
and on eligible foreground activity. An available update downloads in the
background. Installation remains user-controlled through the update action;
the app does not automatically install on quit. Active chats are handled by
the existing restart confirmation and graceful shutdown path.

The legacy history import is a one-time conversion with a durable completion
record. Future versions use the new app's existing data and versioned database
migrations. WorkOS accounts stay in the same hosted environment, with the same
account IDs; a routine app update does not require an account migration.

The website reads the same promoted platform manifests, so its downloads move
to the release when the feed is promoted. A bad release can be withdrawn from
further distribution by restoring the saved manifests. Devices that already
installed it need a higher-version fix or the documented manual recovery;
restoring the feed is not an automatic downgrade.

## Signing and publisher access

For the initial cutover, install this workflow in the legacy
`brentmwarner/graft-studio` repository as
`.github/workflows/graft-next-release.yml`, through a separate PR. Keeping the
release job there reuses its existing secrets; `graft-studio-next` remains the
source of all application code. Every checkout explicitly names that repository
and the selected full commit SHA. The workflow refuses a source commit that is
not already reachable from `graft-studio-next/main`. The setup action, lockfile, package version,
and build/publish scripts all come from that checked-out commit. Credentials
come from the repository hosting the workflow, not the checked-out source.

The sequence for the first update is:

1. Merge the app release PR in `graft-studio-next` and the workflow-only PR in
   `graft-studio`. Copy both canonical workflows from the reviewed app commit:
   `release.yml` becomes `graft-next-release.yml`, while
   `graft-next-upgrade-evidence.yml` keeps its filename.
2. In `graft-studio`, run `graft-next-release.yml` with operation `build`, the
   reviewed `graft-studio-next` commit as `source_commit`, and version `0.9.0`.
3. Complete signed native builds and upgrade validation. Dispatch
   `graft-next-upgrade-evidence.yml` to bind the completed native receipts to the
   exact build artifacts. These runs do not alter the public updater feed.
4. At cutover, disable the old `graft-studio/release.yml` workflow in GitHub
   Actions. Changing that file only on `main` would leave the old copy on the
   `production` branch able to publish. Disabling the workflow retires that
   automatic publisher across branches. Let any existing legacy release finish,
   or cancel it deliberately, before promoting the replacement.
5. Promote the verified build through `graft-next-release.yml`, with the same
   source/version and the successful build/evidence run IDs. Promotion verifies
   the build came from the same workflow ID and refuses to run while the old
   publisher is active or has an unfinished release run.

For later releases, keep dispatching that workflow with the new app's reviewed
commit/version. No application code needs to be copied into `graft-studio`.
If release workflow logic changes in `graft-studio-next`, update its host copy
through a workflow-only PR before using it. Release hosting can move into
`graft-studio-next` after provisioning its secrets; first retire the old host's
publisher so there is **one authoritative production publisher**. GitHub
concurrency groups do not coordinate different repositories.

macOS requires the existing Developer ID certificate and Apple account values:

- `CSC_LINK`, `CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

The builder also retains its existing Apple API key notarization support for
local usage, but this workflow uses the legacy Apple-ID credentials. The app and
DMG are signed, notarized, stapled, and verified. Update ZIPs are finalized with
`ditto`, extracted, and verified so their hash describes the signed archive.
The same Developer ID team must match the legacy installation's upgrade trust.

Windows signed publication requires Azure Trusted Signing credentials:

- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`, `AZURE_TRUSTED_SIGNING_SUBJECT_DN`

The native provenance step checks Authenticode identity and timestamp. The
runtime publisher identity is compiled into the packaged application. There is
no unsigned production exception in this workflow. The previous Windows
release workflow did not establish these credentials; verify actual access
before expecting a signed Windows build to pass.

Promotion requires `BLOB_READ_WRITE_TOKEN` for the existing Graft Blob store.
Credentials are neither copied into app resources nor placed in source files.
WorkOS credentials remain in the hosted account service; the desktop preserves
that service and its account mapping rather than migrating users into a new
WorkOS environment.

## Upgrade evidence format

`upgrade-evidence.json` contains:

- `schemaVersion: 2`, stable `version`, and full `sourceCommit`.
- `previousVersions`, an object containing the observed version of each of
  `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.
- `platforms`, exactly one receipt each for `mac-arm64`, `mac-x64`, `win-x64`, and
  `linux-x64`.
- Each receipt has `platform`, the versioned update `artifact` filename, its
  `sha256`, an HTTPS `evidenceUrl` linking the test record, the exact
  `previousArtifact` (or `null` when no production artifact existed), and
  `checks`.
- Every receipt's `checks` contains `legacy-update`, `account-continuity`,
  `history-preserved`, `settings-preserved`, `reconnect`, and `rollback`, each
  equal to `passed` only after the corresponding verification happened. The
  only exception is the exact 0.1.143 to 0.9.0 Intel Mac cutover: because the
  live 0.1.143 feed never published an Intel artifact, `legacy-update` and
  `rollback` must be `not-applicable-no-legacy-release`; every other Intel Mac
  check still has to pass. The validator rejects this status for any other
  platform, predecessor, version, or check.

The type and executable validation live in
`scripts/lib/graft-release-publisher.ts`. Mac receipts reference their update ZIP;
Windows references its EXE; Linux references `Graft-VERSION-x86_64.AppImage`.
The receipt artifact/hash must match a verified native build. The build and
upgrade CI logs remain part of the release record; JSON assertions do not
substitute for those tests.

## Publication and recovery

The publisher never deletes old artifacts. New installers, ZIPs, blockmaps,
provenance, evidence, and a `release.json` index are written under
`releases/VERSION/` with overwrite disabled. Existing matching immutable bytes
can be reused on retry; conflicting bytes fail the release. It then downloads
and hashes every object before touching any stable pointer.

The previous three pointer files are preserved first under
`releases/VERSION/rollback/`. Only after every new object verifies does it replace
the stable YAML files, each through a single overwrite operation. It rechecks
that the live feed has not changed during upload. Mutable pointers use a short
cache lifetime; immutable objects use a long one. Cached older pointers remain
valid because their payloads are retained.

Blob does not provide a transaction spanning all three platform pointers. A
failure during promotion can leave some platforms on the previous release and
others on the complete, verified new release. Rerunning the **same** promotion
resumes only when already-updated pointers match the candidate's exact bytes
and the original rollback snapshots are present. A different live version
fails rather than overwriting a concurrent release.

To stop further distribution, restore the three preserved pointer snapshots
through the same single-object overwrite process and confirm public readback.
Restoring a pointer does **not** downgrade already updated clients. Their
recovery requires the retained legacy installer and preserved legacy profile,
or a forward fix with a higher version. Confirm that path in the native upgrade
verification before promoting the replacement.

## Website download continuity

The canonical download page is `https://www.graftapp.io/install`. It resolves
Windows and Linux installers from their promoted manifests, and macOS DMGs
from the same version's immutable release index (legacy manifests list DMGs
directly). Missing platforms are shown as unavailable rather than linked to an
unrelated release. Each platform follows its own pointer during partial rollout.
The marketing deployment must include this resolver before production cutover.
Its checked-in snapshot is only for deterministic visual tests; the production
page refreshes the live feed on a short cache interval.
