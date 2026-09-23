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
not evidence that its build or upgrade has passed. macOS requires **13.5 or
later** because the bundled Node 24 runtime does; the AppSnap helper can run on
12.3 or later but does not lower the desktop app's requirement. Windows requires
**10 or later**.
The AppImage targets the Ubuntu 22.04 native build baseline; a local Arch Linux
smoke does not establish compatibility across Linux distributions. Windows ARM64, Linux ARM64,
32-bit systems, and additional Linux distributions require separate native
validation before being advertised. iOS/Android releases use their own mobile
pipelines; a desktop update does not publish a new mobile or Wear OS app.

Production retains `com.graft.studio`, product name `Graft`, and the legacy NSIS
registration `f67e4f48-bfd9-5024-b23c-0d23fd8d8e4a` (electron-builder UUIDv5 of the
legacy app ID). The new Electron profile remains `graft-studio-next`, so its
migration must copy and preserve the legacy `@graft/desktop` profile.

Legacy installed apps use channel `latest` at:

`https://xvce84ljzxgawnao.public.blob.vercel-storage.com/releases`

Its platform pointers remain `latest-mac.yml`, `latest.yml`, and
`latest-linux.yml`. Old installed apps already request these URLs. The current
desktop uses the public `graft-studio-next` GitHub release provider. After
promotion, confirm that the legacy Blob bridge updated all three manifests so
older installs can discover the new release too.

Older Macs remain on the legacy app. Both macOS update manifests carry
`minimumSystemVersion: 22.6.0`, the Darwin kernel version for macOS 13.5, and the
bundle declares `LSMinimumSystemVersion=13.5`. Windows metadata uses `10.0.0`.
The publisher rejects missing/mismatched gates. The legacy electron-updater
6.3.9 reads this field against `os.release()`, so a `13.5` value in the update
manifest would incorrectly admit incompatible older Macs. See the
[electron-builder updater field](https://www.electron.build/docs/features/auto-update/),
[Node 24's macOS requirement](https://github.com/nodejs/node/blob/v24.20.0/BUILDING.md),
[Apple's macOS 13.5 source manifest](https://raw.githubusercontent.com/apple-oss-distributions/distribution-macOS/macos-135/release.json),
and its [kernel MasterVersion](https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-8796.141.3/config/MasterVersion).
This rollout cannot promise the replacement to every historical OS version.

## Build once, verify, then promote those bytes

`.github/workflows/release.yml` is manual only. Its default operation is `build`.
Tag pushes never change the stable feed. Promotion publishes a public GitHub
release and then attempts to sync its manifests to the existing Blob updater
feed. No npm publish or version-bump commit is coupled to this workflow.

1. Commit the desired stable version in `apps/desktop/package.json` and the
   corresponding workspace changes. Add the release to `CHANGELOG.md`, the
   in-app What's New entries, and the website changelog. `release:smoke`
   checks that all three contain the release version. Push the release branch
   through Cursor Origin. The workflow requires the requested version to match
   that commit.
2. Dispatch **Graft Production Release** in `graft-studio`, operation `build`,
   with the full 40-character current-product commit SHA and stable version.
   Keep `sign_artifacts=true` for signed and notarized macOS artifacts. The
   release host currently builds Windows x64 unsigned under an explicit
   release exception; Linux AppImage has no signing scheme.
3. The source job runs formatting, lint, typecheck, identity, platform boundary,
   migration lineage, and repository tests. Four native jobs package, verify
   the applicable signing policy, record source/lockfile/artifact digests, and
   smoke the packaged app using isolated state.
4. Download and test the exact artifacts against real legacy installs. Validate
   the old updater's download/install path, account continuity, history and
   settings preservation, reconnect behavior, and rollback on every target that
   had a released predecessor. The 0.1.143 feed had no Intel Mac artifact, so
   the 0.9.0 Intel receipt uses the documented no-legacy-release status for the
   impossible update and rollback checks while still requiring all other Intel
   checks. Keep evidence tied to the exact artifact hash, source commit,
   predecessor version, and predecessor artifact. A successful clean-profile
   startup alone is insufficient.
5. After completing those tests, dispatch **Graft Production Upgrade Evidence**
   in the release-host repository with the same source/version, production build
   run ID, and the completed `upgrade-evidence.json`. The workflow downloads the
   exact artifacts, validates every receipt and hash against them, and
   uploads artifact `graft-upgrade-evidence`. Never manufacture passing receipts
   for untested platforms.
6. Dispatch operation `promote`, the same source/version, and the successful
   `build_run_id` and `evidence_run_id`. Both runs must be in the repository
   hosting this workflow. The promotion downloads the previously built bytes;
   it does not rebuild them. Build-run identity, all four signing/provenance
   records, artifact hashes, updater SHA-512 values, predecessor versions, and
   upgrade receipts are checked before the public GitHub release is published.
   The Blob bridge runs afterward with `continue-on-error`; verify all three
   live update manifests independently before declaring the release complete.

To validate collected release assets locally without any upload:

```bash
node scripts/publish-graft-release.ts \
  --assets-dir release-assets \
  --evidence release-evidence/upgrade-evidence.json
```

The live promotion uses `scripts/publish-graft-release-github.ts --publish`
after this validation. Blob updater manifests are synchronized by
`scripts/sync-graft-legacy-feed.ts` in a separate promotion step.

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

### Phone pairing and update continuity

Signed-in desktop pairing automatically connects the existing Graft managed relay
before issuing a QR code. This behavior ships in the desktop's bundled web and
server code; it does not require a new mobile protocol or a relay deployment.
Build the release from a main-branch commit containing the pairing fix, then
include these checks in the native upgrade evidence:

1. With the phone on cellular and Tailscale off, use **Connections → Add device →
   Get started**, scan the QR code, and confirm the phone can load the host.
2. Restart the desktop and confirm the existing phone pairing reconnects without
   scanning again, including when the desktop's internal server port changes.
3. Install the candidate update over the current desktop and repeat the same
   connection without deleting state, signing out, or pairing again.

Record an actual device result against the signed artifact. Mocked relay tests
and a successful public health request do not establish phone upgrade continuity.
The legacy cutover can require one new pairing; routine updates must retain it.

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
The release host currently applies a small, idempotent overlay and uses an
explicit unsigned Windows policy; inspect its workflow and overlay when source
release logic changes. Update the host copy through a workflow-only PR before
using changed release logic. Release hosting can move into `graft-studio-next`
after provisioning its secrets; first retire the old host's publisher so there
is **one authoritative production publisher**. GitHub concurrency groups do
not coordinate different repositories.

macOS requires the existing Developer ID certificate and Apple account values:

- `CSC_LINK`, `CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

The builder also retains its existing Apple API key notarization support for
local usage, but this workflow uses the legacy Apple-ID credentials. The app and
DMG are signed, notarized, stapled, and verified. Update ZIPs are finalized with
`ditto`, extracted, and verified so their hash describes the signed archive.
The same Developer ID team must match the legacy installation's upgrade trust.

The current release host publishes Windows x64 unsigned under an explicit
release exception, matching the 0.9.0 production installer. It can trigger
Windows publisher or SmartScreen warnings. A future signed Windows publication
requires Azure Trusted Signing credentials:

- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`, `AZURE_TRUSTED_SIGNING_SUBJECT_DN`

For signed builds, native provenance checks Authenticode identity and timestamp.
The runtime publisher identity is compiled into the packaged application. The
release host does not currently supply these credentials; verify actual access
before enabling signed Windows builds.

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

The publisher creates a draft release in the public `graft-studio-next`
repository for the exact source commit. It uploads the verified installers,
update ZIPs, manifests, provenance, evidence, and `release.json` index, then
checks their sizes and SHA-256 digests before publishing the release as latest.
It verifies that the published assets are publicly downloadable. Existing
matching bytes can be reused on retry; conflicting bytes fail the promotion.
Older releases remain available.

After publication, the separate legacy bridge copies the three public release
manifests to the Blob updater paths and verifies each readback. Blob has no
transaction across those pointers, and bridge failure does not undo the GitHub
release. A partial bridge sync can leave older installs on different versions
by platform; repair it using the same verified release assets and confirm all
three live manifests. If distribution must stop, restore the previous
manifests from their retained release and verify public readback. Changing an
update pointer does **not** downgrade clients already updated; those clients
need the tested rollback path or a forward fix with a higher version.

## Website download continuity

The canonical download page is `https://www.graftapp.io/install`. It resolves
Windows and Linux installers from the public GitHub release manifests, and
macOS DMGs from the same version's release index (legacy manifests list DMGs
directly). Missing platforms are shown as unavailable rather than linked to an
unrelated release. Its checked-in snapshot is only for deterministic visual
tests; the production page refreshes the live release feed on a short cache
interval.
