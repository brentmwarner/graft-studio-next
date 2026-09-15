# Providers

Graft does not host models or sell a separate model subscription. It operates supported
coding-agent runtimes installed and authenticated on your machine, then presents them through one
consistent workspace.

## Supported providers

| Provider                                                                                                  | What Graft connects to                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [Claude Code](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/claude-code)     | Your installed Claude Code runtime and authenticated account |
| [Codex](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/codex)                 | Your installed and authenticated Codex CLI                   |
| [OpenCode](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/opencode)           | Your local OpenCode runtime and configured model providers   |
| [Cursor](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/cursor)               | Your local Cursor agent runtime and account                  |
| [Devin](https://docs.devin.ai)                                                                            | Your installed and authenticated Devin CLI                   |
| [Antigravity](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/antigravity)     | Your installed and authenticated Antigravity CLI             |
| [Grok Build](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/grok)             | Your configured Grok Build runtime and access                |
| [Pi](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/pi)                       | Pi and the model providers configured through it             |
| [Factory Droid](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers/factory-droid) | Your installed and authenticated Droid runtime               |

Provider availability can differ between the current stable release and development builds. Use the
provider settings in your installed Graft version as the authoritative list for that build.

## What Graft manages

Graft provides the shared operating surface around each provider:

- Project and task ownership
- Provider and model selection
- Conversation and tool activity
- Approvals and user-input requests
- Terminal, browser, file, and diff surfaces
- Git environments and checkpoints
- Session continuation where supported
- Provider handoffs
- Usage information where the provider exposes it

## Usage dashboard

Settings → **Usage** shows live account quotas above a dashboard of tokens recorded by tasks in
this Graft instance. Choose **Today**, **7 days**, **30 days**, or **90 days** to update the token
total, provider chart, daily metrics, and model/day breakdown. The activity heatmap always shows
the past six months. **Refresh** reloads both quotas and history.

History uses the same token accounting as Profile, including retained totals from deleted tasks.
It does not import activity from standalone provider CLIs. Day boundaries use the computer's current
UTC offset, matching Profile. Providers without token telemetry are listed beneath the dashboard;
account quotas may still be available for them. The summary shows total tokens, active days, daily
average, and peak day because input, output, and cache splits are not consistently recorded.

If a refresh fails, the page keeps the last loaded values and shows an error. Older connected
servers can still show quotas but must be updated to return date-based usage history.

## What remains provider-owned

The provider still controls:

- Installation
- Authentication
- Account and subscription limits
- Model availability
- Tool behavior
- Permission semantics
- Service availability
- Provider-specific session features

A provider working in its own terminal is an important prerequisite, but not a guarantee that every
provider feature is supported through Graft.

## Connect a provider

1. **Install the official runtime.** Use the provider's official installation instructions.
2. **Authenticate outside Graft.** Complete the provider's normal sign-in or credential setup.
   Verify the runtime from a fresh terminal.
3. **Open Graft provider settings.** Confirm that the provider is detected and enabled. When
   necessary, configure a custom path to the provider executable.
4. **Check model discovery.** Open the model picker and confirm that the expected models and options
   appear. Graft discovers many provider capabilities at runtime; the result can depend on the
   installed CLI version, account, subscription, and provider configuration.
5. **Start a small test task.** Use a harmless objective in a test repository before relying on a
   newly configured provider for important work.

## Models and effort options

Providers expose different selection models:

- A fixed catalog
- A catalog discovered from the installed runtime
- User-configured custom models
- Reasoning, effort, mode, or variant options
- Account-dependent availability

Graft normalizes these choices into the composer where possible without pretending that every
provider has identical capabilities.

Favorite models can be surfaced above larger catalogs, and supported provider executables can be
pointed at custom binary locations.

## Provider sessions

Each task owns a provider session.

The session may preserve provider-specific behavior such as:

- Plans
- Tool calls
- Approvals
- Reasoning summaries
- Context usage
- Model changes
- Resume or reconnect behavior
- Provider-native subagents or workflows

Capabilities vary. Do not assume a control available for one provider exists for all of them.

## Switching providers

A [provider handoff](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/workflows/handoffs) allows another provider to
continue the task and work in the same environment with the context Graft passes to it.

Use handoffs deliberately. Review the working tree before and after changing providers so ownership
remains clear.

## When a provider is missing

Check these in order:

1. Does the executable run from a fresh terminal?
2. Is the provider authenticated?
3. Is the expected executable on `PATH`?
4. Is a custom binary path configured incorrectly?
5. Does the installed runtime version support the required integration?
6. Does restarting Graft refresh the provider status?
7. Does the provider itself report a service or account error?

Continue with the [troubleshooting hub](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/troubleshooting) when the
runtime works independently but remains unavailable in Graft.

Use the dedicated [provider guides](https://github.com/brentmwarner/graft-studio-next/tree/main/docs/providers) for exact
installation, authentication, verification, capabilities, update paths, and provider-specific
failure checks.
