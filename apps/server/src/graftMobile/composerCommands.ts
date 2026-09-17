import type { GraftComposerCommand } from "@graft/mobile-contract";
import type {
  ProviderNativeCommandDescriptor,
  ProviderSkillDescriptor,
  ProviderSkillReference,
} from "@graft/contracts";

export function mobileComposerCommands(
  commands: readonly ProviderNativeCommandDescriptor[],
  skills: readonly ProviderSkillDescriptor[],
  supportsTaskCommand = true,
): GraftComposerCommand[] {
  const result: GraftComposerCommand[] = [
    { name: "model", description: "Choose a model and reasoning effort", kind: "model" },
  ];
  if (supportsTaskCommand) {
    result.push({ name: "tasks", description: "Create a tracked task list", kind: "tasks" });
  }
  const names = new Set(result.map((command) => command.name));
  for (const command of commands) {
    const name = command.name.replace(/^\//, "").trim();
    if (!name || /\s/.test(name) || names.has(name)) continue;
    names.add(name);
    result.push({ name, description: command.description ?? "Provider command", kind: "native" });
  }
  for (const skill of skills) {
    if (!skill.enabled || names.has(skill.name)) continue;
    names.add(skill.name);
    result.push({
      name: skill.name,
      description: skill.interface?.shortDescription ?? skill.description ?? "Skill",
      kind: "skill",
      ...(skill.interface?.displayName ? { displayName: skill.interface.displayName } : {}),
    });
  }
  return result;
}

export function prepareMobileSlashMessage(
  text: string,
  commands: readonly GraftComposerCommand[],
  skills: readonly ProviderSkillDescriptor[],
): { text: string; skills?: ProviderSkillReference[] } {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return { text };
  const command = commands.find((entry) => entry.name === match[1]);
  if (!command) throw new Error(`Unknown command /${match[1]}. Choose a command from the / menu.`);
  switch (command.kind) {
    case "model":
      throw new Error("Choose /model from the command menu to open the model picker.");
    case "tasks":
      // The Codex host instructions define /tasks. Preserve authored text so
      // the optimistic mobile message and its durable echo remain identical.
      return { text };
    case "native":
      return { text };
    case "skill": {
      const skill = skills.find((entry) => entry.enabled && entry.name === command.name);
      if (!skill) throw new Error("This skill is no longer available. Reopen the / menu.");
      return {
        text,
        skills: [{ name: skill.name, path: skill.path }],
      };
    }
    default: {
      const exhaustive: never = command.kind;
      throw new Error(`Unsupported command kind: ${exhaustive}`);
    }
  }
}
