// Keep this entry intentionally small. The packaged macOS desktop launches it in
// Electron's utility-process host, where a dependency can otherwise stall during
// module evaluation before the parent receives any useful diagnostic. Regular CLI
// commands keep stderr clean.
if (process.env.GRAFT_DESKTOP_PACKAGED === "1") {
  process.stderr.write("[server] bootstrap started\n");
}

// This boundary is deliberately dynamic: it lets the startup marker flush before
// the full server dependency graph evaluates inside the utility process.
await import("./runtime");

export {};
