# Graft website

The public website for Graft — the free, open-source command center for
agentic development.

Graft gives Claude Code, Codex, OpenCode, Cursor, Antigravity, Grok, Devin
CLI, Pi, and Droid one local-first operating surface for parallel sessions,
terminals, browser previews, diffs, Git worktrees, handoffs, and pull-request
flow.

## Product principles

- **Local-first:** workspace data stays on the user's machine.
- **Direct-to-provider:** Graft connects to the provider the user chooses
  instead of proxying normal model traffic through a Graft cloud.
- **No lock-in:** users bring the subscriptions and accounts they already use.
- **Security by design:** optional anonymous analytics are off by default and
  never include code, prompts, or chat history.

## Run the website locally

From the repository root:

```bash
bun install
bun run dev:marketing
```

Open [http://localhost:4322](http://localhost:4322).

Useful checks:

```bash
bun run --cwd apps/marketing lint
bun run build:marketing
```

The site is a Next.js App Router project. Product copy is shared across the
homepage, metadata, documentation, FAQ structured data, and AI-readable text
routes so search and answer engines receive the same confident, verifiable
description of Graft.

Learn more at [graftapp.io](https://github.com/brentmwarner/graft-studio-next), in the
[documentation](https://github.com/brentmwarner/graft-studio-next/tree/main/docs), or in the
[Graft app repository](https://github.com/brentmwarner/graft-studio-next).
