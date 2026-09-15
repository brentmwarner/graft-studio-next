import { describe, expect, it } from "vitest";
import {
  deriveFriendlyCommandTarget,
  deriveInlineCommandCall,
  deriveReadableCommandDisplay,
  deriveReadableToolTitle,
  deriveGraftMcpToolTitle,
  extractWebFetchUrl,
  isGraftBrowserToolCall,
  normalizeCompactToolLabel,
  resolveCommandVisualKind,
  sanitizeGraftMcpToolPreview,
} from "./toolCallLabel";

describe("extractWebFetchUrl", () => {
  it("pulls the url out of a WebFetch argument summary", () => {
    expect(
      extractWebFetchUrl({
        toolName: "WebFetch",
        detail: 'WebFetch: {"url":"https://ui.shadcn.com/docs/components","prompt":"List EVER..."}',
      }),
    ).toBe("https://ui.shadcn.com/docs/components");
  });

  it("recognizes alternate fetch tool names and the uri field", () => {
    expect(
      extractWebFetchUrl({
        toolName: "web_fetch",
        detail: '{"uri":"https://example.com/path"}',
      }),
    ).toBe("https://example.com/path");
  });

  it("falls back to a bare URL token when there is no json field", () => {
    expect(extractWebFetchUrl({ toolName: "fetch", detail: "Fetching https://example.com." })).toBe(
      "https://example.com",
    );
  });

  it("ignores non-fetch tools", () => {
    expect(
      extractWebFetchUrl({ toolName: "Read", detail: '{"url":"https://example.com"}' }),
    ).toBeNull();
  });

  it("ignores non-http(s) and missing urls", () => {
    expect(
      extractWebFetchUrl({ toolName: "WebFetch", detail: '{"url":"ftp://example.com"}' }),
    ).toBeNull();
    expect(extractWebFetchUrl({ toolName: "WebFetch", detail: '{"prompt":"hi"}' })).toBeNull();
    expect(extractWebFetchUrl({ toolName: "WebFetch", detail: undefined })).toBeNull();
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording", () => {
    expect(normalizeCompactToolLabel("Tool call completed")).toBe("Tool call");
    expect(normalizeCompactToolLabel("Ran command done")).toBe("Ran command");
    expect(normalizeCompactToolLabel("Ran command started")).toBe("Ran command");
  });

  it.each([
    ["  Tool\r\n\tCOMPLETED\n", "Tool"],
    ["completed", "completed"],
    [" completed ", ""],
    ["Toolcompleted", "Toolcompleted"],
    ["Tool completed later", "Tool completed later"],
    ["Tool\u00a0done\u2028", "Tool"],
  ])("preserves status-word boundaries in %j", (value, expected) => {
    expect(normalizeCompactToolLabel(value)).toBe(expected);
  });
});

describe("deriveGraftMcpToolTitle", () => {
  it.each([
    ["browser_run", "Run browser actions"],
    ["browser_click", "Click browser target"],
    ["browser_wait", "Wait for browser condition"],
    ["browser_webmcp_call", "Call page WebMCP tool"],
  ])("keeps current and historical %s messages readable", (toolName, title) => {
    expect(deriveGraftMcpToolTitle({ toolName, status: "completed" })).toBe(title);
    expect(isGraftBrowserToolCall({ title })).toBe(true);
  });

  it("uses stable action-first names for Graft browser tools", () => {
    for (const status of ["running", "completed", "failed"] as const) {
      expect(
        deriveGraftMcpToolTitle({
          toolName: "mcp__graft__browser_open",
          status,
        }),
      ).toBe("Open browser tab");
    }

    expect(
      deriveGraftMcpToolTitle({
        title: "Graft: Browser Snapshot",
        status: "completed",
      }),
    ).toBe("Snapshot browser page");
  });

  it("has intentional running and completed copy for every Graft gateway action", () => {
    const cases = [
      ["graft_context", "Graft is checking its context", "Graft checked its context"],
      [
        "graft_capabilities",
        "Graft is checking available agents",
        "Graft checked available agents",
      ],
      ["graft_list_projects", "Graft is listing projects", "Graft listed projects"],
      ["graft_list_threads", "Graft is listing threads", "Graft listed threads"],
      ["graft_read_thread", "Graft is reading a thread", "Graft read a thread"],
      [
        "graft_read_thread_activity",
        "Graft is reading thread activity",
        "Graft read thread activity",
      ],
      ["graft_read_thread_events", "Graft is reading thread events", "Graft read thread events"],
      [
        "graft_read_thread_runtime_events",
        "Graft is reading thread runtime events",
        "Graft read thread runtime events",
      ],
      ["graft_diagnose_thread", "Graft is diagnosing a thread", "Graft diagnosed a thread"],
      ["graft_create_thread", "Graft is creating a thread", "Graft created a thread"],
      ["graft_create_threads", "Graft is creating threads", "Graft created threads"],
      [
        "graft_wait_for_threads",
        "Graft is waiting for threads",
        "Graft finished waiting for threads",
      ],
      ["graft_send_message", "Graft is sending a message", "Graft sent a message"],
      ["graft_interrupt_thread", "Graft is interrupting a thread", "Graft interrupted a thread"],
      ["graft_set_thread_title", "Graft is renaming a thread", "Graft renamed a thread"],
      ["graft_set_thread_archived", "Graft is updating a thread", "Graft updated a thread"],
      ["graft_create_automation", "Graft is creating an automation", "Graft created an automation"],
      ["graft_list_automations", "Graft is listing automations", "Graft listed automations"],
      ["graft_cancel_automation", "Graft is stopping an automation", "Graft stopped an automation"],
      ["graft_overview", "Graft is gathering an overview", "Graft gathered an overview"],
      [
        "graft_list_allowed_projects",
        "Graft is listing allowed projects",
        "Graft listed allowed projects",
      ],
      ["graft_create_task", "Graft is creating a task", "Graft created a task"],
      ["graft_wait_for_task", "Graft is waiting for a task", "Graft finished waiting for a task"],
      ["graft_read_task", "Graft is reading a task", "Graft read a task"],
    ] as const;

    for (const [toolName, running, completed] of cases) {
      expect(deriveGraftMcpToolTitle({ toolName, status: "running" })).toBe(running);
      expect(deriveGraftMcpToolTitle({ toolName, status: "completed" })).toBe(completed);
    }

    expect(
      deriveGraftMcpToolTitle({
        toolName: "graft_create_threads",
        status: "failed",
      }),
    ).toBe("Graft couldn't create threads");
    expect(
      deriveGraftMcpToolTitle({
        toolName: "graft_create_thread",
        status: "cancelled",
      }),
    ).toBe("Graft stopped creating a thread");
  });

  it("turns provider-specific create-thread identifiers into activity sentences", () => {
    expect(
      deriveGraftMcpToolTitle({
        toolName: "Graft__graft_create_thread",
        status: "running",
      }),
    ).toBe("Graft is creating a thread");
    expect(
      deriveGraftMcpToolTitle({
        toolName: "mcp__graft__graft_create_thread",
        status: "completed",
      }),
    ).toBe("Graft created a thread");
  });

  it("recognizes bare and already-humanized Graft tool names", () => {
    expect(deriveGraftMcpToolTitle({ toolName: "graft_send_message", status: "running" })).toBe(
      "Graft is sending a message",
    );
    expect(
      deriveGraftMcpToolTitle({ title: "Graft: Graft List Threads", status: "completed" }),
    ).toBe("Graft listed threads");
  });

  it("ignores tools from other MCP servers", () => {
    expect(
      deriveGraftMcpToolTitle({
        toolName: "mcp__codex_apps__github_fetch_pr",
        status: "running",
      }),
    ).toBeNull();
  });

  it("keeps future Graft actions branded without exposing raw identifiers", () => {
    expect(
      deriveGraftMcpToolTitle({
        toolName: "mcp__graft__graft_delete_project",
        status: "running",
      }),
    ).toBe("Graft is handling delete project");
    expect(
      deriveGraftMcpToolTitle({
        toolName: "Graft__graft_delete_project",
        status: "completed",
      }),
    ).toBe("Graft handled delete project");
    expect(
      deriveGraftMcpToolTitle({
        toolName: "graft_is_handling_delete_project",
        status: "completed",
      }),
    ).toBe("Graft handled delete project");
  });

  it("does not reinterpret free text beginning with fallback status copy", () => {
    expect(
      deriveGraftMcpToolTitle({
        title: "Graft is handling delete project after recovery",
        status: "completed",
      }),
    ).toBeNull();
    expect(
      deriveGraftMcpToolTitle({
        title: "Graft handled delete project after recovery",
        status: "running",
      }),
    ).toBeNull();
    expect(
      deriveGraftMcpToolTitle({
        title: "Graft couldn't handle delete project after recovery",
        status: "failed",
      }),
    ).toBeNull();
  });

  it("leaves free-text activity summaries starting with Graft untouched", () => {
    expect(
      deriveGraftMcpToolTitle({
        title: "Graft recovered a stale running state",
        status: "completed",
      }),
    ).toBeNull();
    expect(
      deriveGraftMcpToolTitle({
        fallbackLabel: "Graft restarted the provider session",
        status: "running",
      }),
    ).toBeNull();
  });

  it("removes transport identifiers without hiding meaningful Graft details", () => {
    expect(
      sanitizeGraftMcpToolPreview({
        preview: "Graft__graft_create_threads",
        heading: "Graft created threads",
        status: "completed",
      }),
    ).toBeNull();
    expect(
      sanitizeGraftMcpToolPreview({
        preview: 'Unexpected key "reasoningEffort" for Claude Agent',
        heading: "Graft couldn't create threads",
        status: "failed",
      }),
    ).toBe('Unexpected key "reasoningEffort" for Claude Agent');
  });
});

describe("isGraftBrowserToolCall", () => {
  it("recognizes canonical presentation titles without a tool identifier", () => {
    expect(isGraftBrowserToolCall({ title: "Open browser tab" })).toBe(true);
    expect(isGraftBrowserToolCall({ fallbackLabel: "Snapshot browser page" })).toBe(true);
    expect(isGraftBrowserToolCall({ title: "Graft listed threads" })).toBe(false);
  });
});

describe("deriveReadableToolTitle", () => {
  it("humanizes search commands even when wrapped in shell -lc", () => {
    expect(
      deriveReadableToolTitle({
        title: "Ran command",
        fallbackLabel: "Ran command",
        itemType: "command_execution",
        requestKind: "command",
        command: `/bin/zsh -lc 'rg -n "tool call" apps/web/src'`,
      }),
    ).toBe("Searched");
  });

  it("humanizes file read commands", () => {
    expect(
      deriveReadableToolTitle({
        title: "Ran command",
        fallbackLabel: "Ran command",
        itemType: "command_execution",
        command: "sed -n '520,550p' apps/web/src/session-logic.ts",
      }),
    ).toBe("Read");
  });

  it("humanizes git status commands", () => {
    expect(
      deriveReadableToolTitle({
        title: "Ran command",
        fallbackLabel: "Ran command",
        itemType: "command_execution",
        command: "git status --short",
      }),
    ).toBe("Checked");
  });

  it("keeps explicit non-generic titles", () => {
    expect(
      deriveReadableToolTitle({
        title: "Bash",
        fallbackLabel: "Ran command",
        itemType: "command_execution",
        command: "echo hello",
      }),
    ).toBe("Bash");
  });

  it("extracts a descriptor from payload when the title is generic", () => {
    expect(
      deriveReadableToolTitle({
        title: "Tool call",
        fallbackLabel: "Tool call",
        itemType: "dynamic_tool_call",
        payload: {
          data: {
            item: {
              toolName: "mcp__xcodebuildmcp__list_sims",
            },
          },
        },
      }),
    ).toBe("Xcodebuildmcp: List Sims");
  });

  it("treats Cursor placeholder titles as generic", () => {
    expect(
      deriveReadableToolTitle({
        title: "Find",
        fallbackLabel: "Find",
        itemType: "dynamic_tool_call",
        payload: { data: { kind: "search" } },
      }),
    ).toBe("Search");

    expect(
      deriveReadableToolTitle({
        title: "Read File",
        fallbackLabel: "Read File",
        itemType: "dynamic_tool_call",
        payload: { data: { kind: "read" } },
      }),
    ).toBe("Read");
  });

  it("formats MCP identifiers into readable tool names", () => {
    expect(
      deriveReadableToolTitle({
        title: "MCP tool call",
        fallbackLabel: "MCP tool call",
        itemType: "mcp_tool_call",
        payload: {
          data: {
            toolName: "mcp__codex_apps__github_fetch_pr",
          },
        },
      }),
    ).toBe("Codex Apps: Github Fetch Pr");
  });

  it("formats structured MCP server/tool payloads into readable tool names", () => {
    expect(
      deriveReadableToolTitle({
        title: "MCP tool call",
        fallbackLabel: "MCP tool call",
        itemType: "mcp_tool_call",
        payload: {
          data: {
            item: {
              type: "mcpToolCall",
              server: "computer-use",
              tool: "get_app_state",
            },
          },
        },
      }),
    ).toBe("Computer Use: Get App State");
  });
});

describe("deriveReadableCommandDisplay", () => {
  it.each(["|", " | ", "\t\r\n|\t"])("keeps the first command before a pipe: %j", (pipe) => {
    const command = `cat src/result.ts${pipe}head -n 1`;
    expect(deriveReadableCommandDisplay(command)).toEqual({
      verb: "Read",
      target: "src/result.ts",
      fullCommand: command,
    });
  });

  it("extracts search targets without leaking the full shell wrapper inline", () => {
    expect(deriveReadableCommandDisplay(`/bin/zsh -lc 'rg -n "tool call" apps/web/src'`)).toEqual({
      verb: "Searched",
      target: "for tool call in web/src",
      fullCommand: `/bin/zsh -lc 'rg -n "tool call" apps/web/src'`,
    });
  });

  it("compacts file paths for read commands", () => {
    expect(
      deriveReadableCommandDisplay(
        "sed -n '520,550p' apps/web/src/components/chat/MessagesTimeline.tsx",
      ),
    ).toEqual({
      verb: "Read",
      target: "chat/MessagesTimeline.tsx",
      fullCommand: "sed -n '520,550p' apps/web/src/components/chat/MessagesTimeline.tsx",
    });
  });

  it("unwraps zsh shell wrappers around read commands", () => {
    expect(
      deriveReadableCommandDisplay(
        `/bin/zsh -lc "sed -n '240,520p' src/components/provider-card.tsx"`,
      ),
    ).toEqual({
      verb: "Read",
      target: "components/provider-card.tsx",
      fullCommand: `/bin/zsh -lc "sed -n '240,520p' src/components/provider-card.tsx"`,
    });
  });

  it("keeps quoted paths intact when shell wrappers include cd chaining", () => {
    expect(
      deriveReadableCommandDisplay(
        `zsh -lc "cd '/tmp/my app' && sed -n '1,260p' src/pages/overview.tsx"`,
      ),
    ).toEqual({
      verb: "Read",
      target: "pages/overview.tsx",
      fullCommand: `zsh -lc "cd '/tmp/my app' && sed -n '1,260p' src/pages/overview.tsx"`,
    });
  });

  it("does not discard real chained commands after a shell wrapper", () => {
    expect(
      deriveReadableCommandDisplay(
        `/bin/zsh -lc 'rm -f /tmp/test.log && bun run --cwd apps/server test'`,
      ),
    ).toEqual({
      verb: "Removed",
      target: "/tmp/test.log",
      fullCommand: `/bin/zsh -lc 'rm -f /tmp/test.log && bun run --cwd apps/server test'`,
    });
  });

  it("removes env and timeout wrappers from inline command summaries", () => {
    expect(
      deriveReadableCommandDisplay(
        "env -u GRAFT_AUTH_TOKEN GRAFT_PORT_OFFSET=3158 timeout 180s bun run dev",
        true,
      ),
    ).toEqual({
      verb: "Running",
      target: "bun run dev",
      fullCommand: "env -u GRAFT_AUTH_TOKEN GRAFT_PORT_OFFSET=3158 timeout 180s bun run dev",
    });
  });

  it("summarizes inline script commands without leaking the script body", () => {
    expect(
      deriveReadableCommandDisplay(`node -e "const fs = require('fs'); console.log(fs.cwd)"`, true),
    ).toEqual({
      verb: "Running",
      target: "node script",
      fullCommand: `node -e "const fs = require('fs'); console.log(fs.cwd)"`,
    });

    expect(deriveReadableCommandDisplay("python3 - <<'PY'\nprint('hi')\nPY", true)).toEqual({
      verb: "Running",
      target: "python script",
      fullCommand: "python3 - <<'PY'\nprint('hi')\nPY",
    });
  });

  it("humanizes current-directory searches without leaking placeholder dots", () => {
    expect(deriveReadableCommandDisplay(`rg -n "model(s)?" .`)).toEqual({
      verb: "Searched",
      target: "for model(s)? in current directory",
      fullCommand: `rg -n "model(s)?" .`,
    });
  });

  it("falls back to a directory summary when the search token is only punctuation", () => {
    expect(deriveReadableCommandDisplay(`rg -n . src/lib`)).toEqual({
      verb: "Searched",
      target: "in src/lib",
      fullCommand: `rg -n . src/lib`,
    });
  });
});

describe("deriveFriendlyCommandTarget", () => {
  it("uses a friendly shell name instead of leaking the full wrapper command", () => {
    expect(
      deriveFriendlyCommandTarget(
        '"C:\\Users\\Example\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe" -Command "powershell -NoProfile -Command \\"1..8\\""',
      ),
    ).toBe("PowerShell");
  });

  it("reads as the object of the row's sentence", () => {
    expect(deriveFriendlyCommandTarget(`/bin/zsh -lc 'rg -n "tool call" apps/web/src'`)).toBe(
      "for tool call in web/src",
    );
  });

  it("keeps long targets short enough to sit inline", () => {
    const target = deriveFriendlyCommandTarget(`echo ${"a".repeat(200)}`);
    expect(target.length).toBeLessThanOrEqual(72);
    expect(target.endsWith("…")).toBe(true);
  });
});

describe("deriveInlineCommandCall", () => {
  it("shows the actual command call without the shell wrapper", () => {
    expect(deriveInlineCommandCall(`/bin/zsh -lc 'rg -n "tool call" apps/web/src'`)).toBe(
      `rg -n "tool call" apps/web/src`,
    );
  });
});

describe("resolveCommandVisualKind", () => {
  it("detects read-only inspection commands (read/search/find/list)", () => {
    expect(resolveCommandVisualKind("cat package.json")).toBe("inspect");
    expect(resolveCommandVisualKind("sed -n 1,40p src/app.ts")).toBe("inspect");
    expect(resolveCommandVisualKind("head -n 20 README.md")).toBe("inspect");
    expect(resolveCommandVisualKind(`rg -n "tool call" apps/web/src`)).toBe("inspect");
    expect(resolveCommandVisualKind("grep -R foo .")).toBe("inspect");
    expect(resolveCommandVisualKind("find . -name '*.ts'")).toBe("inspect");
    expect(resolveCommandVisualKind("ls -la src")).toBe("inspect");
    expect(resolveCommandVisualKind(`/bin/zsh -lc 'rg -n "x" src'`)).toBe("inspect");
  });

  it("does not treat mutating or executing commands as inspections", () => {
    expect(resolveCommandVisualKind("git status")).toBe("git");
    expect(resolveCommandVisualKind("node build.js")).toBe("terminal");
    expect(resolveCommandVisualKind("rm -rf dist")).toBe("terminal");
    expect(resolveCommandVisualKind("mkdir foo")).toBe("terminal");
  });

  it("classifies git commands through shell and global-option wrappers", () => {
    expect(resolveCommandVisualKind("git status --short")).toBe("git");
    expect(resolveCommandVisualKind("git -C apps/web status --short")).toBe("git");
    expect(resolveCommandVisualKind(`/bin/zsh -lc "cd repo && git branch -vv"`)).toBe("git");
  });

  it("classifies GitHub CLI commands through env wrappers", () => {
    expect(resolveCommandVisualKind("gh pr view 274 --repo owner/repo")).toBe("github");
    expect(resolveCommandVisualKind("env -u GH_TOKEN gh pr status")).toBe("github");
    expect(resolveCommandVisualKind("hub pull-request -m test")).toBe("github");
  });

  it("keeps inspections and ordinary commands distinct", () => {
    expect(resolveCommandVisualKind(`rg -n "tool call" apps/web/src`)).toBe("inspect");
    expect(resolveCommandVisualKind("bun run build")).toBe("terminal");
  });
});
