import type { GraftComposerCommand, GraftMessageSkill } from "@graft/mobile-contract";

/** Desktop title-cases the skill id; a host display name wins when we still have one. */
export function skillChipLabel(skill: {
  readonly name: string;
  readonly displayName?: string;
}): string {
  const displayName = skill.displayName?.trim();
  if (displayName) return displayName;
  return skill.name
    .split(/[-_]/)
    .map((segment) => (segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment))
    .join(" ");
}

/** The invocation must be the whole token: `/review` or `/review fix`, never `/reviewer`. */
export function leadingSkill<T extends { readonly name: string }>(
  text: string,
  skills: readonly T[],
): T | undefined {
  const marker = text[0];
  if (marker !== "/" && marker !== "$") return undefined;
  return skills.find((skill) => {
    if (!skill.name || /\s/.test(skill.name)) return false;
    const invocation = marker + skill.name;
    if (!text.startsWith(invocation)) return false;
    const next = text[invocation.length];
    return next === undefined || /\s/.test(next);
  });
}

export function selectedSkillToken(
  draft: string,
  command: GraftComposerCommand | undefined,
): GraftComposerCommand | undefined {
  if (!command || command.kind !== "skill") return undefined;
  return leadingSkill(draft, [command]);
}

/** Text the editor shows after the atomic skill token. The separating space stays out of the field. */
export function skillEditorText(draft: string, skill: { readonly name: string }): string {
  const invocation = `/${skill.name}`;
  if (!draft.startsWith(invocation)) return draft;
  const rest = draft.slice(invocation.length);
  return /^\s/.test(rest) ? rest.slice(1) : rest;
}

export function skillDraft(name: string, editorText: string): string {
  if (!editorText) return `/${name} `;
  return /^\s/.test(editorText) ? `/${name}${editorText}` : `/${name} ${editorText}`;
}

export function textAfterLeadingSkill(text: string, skill: { readonly name: string }): string {
  const marker = text[0] === "$" ? "$" : "/";
  const invocation = marker + skill.name;
  return text.startsWith(invocation) ? text.slice(invocation.length) : text;
}

/** Keep a locally chosen label when the host echo only repeats the skill id. */
export function mergeMessageSkills(
  incoming: readonly GraftMessageSkill[] | undefined,
  preserved: readonly GraftMessageSkill[] | undefined,
): readonly GraftMessageSkill[] | undefined {
  if (!incoming?.length) return preserved?.length ? preserved : undefined;
  return incoming.map((skill) => {
    const displayName =
      skill.displayName ?? preserved?.find((item) => item.name === skill.name)?.displayName;
    return displayName ? { name: skill.name, displayName } : { name: skill.name };
  });
}
