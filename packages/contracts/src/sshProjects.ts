import { Schema } from "effect";

import { CommandId, ProjectId } from "./baseSchemas";

export const SSH_HOST_PROJECTS_PATH = "/desktop/v1/projects";
export const SSH_HOST_DIRECTORY_PATH = "/desktop/v1/projects/directory";

export const SshProject = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
});
export type SshProject = typeof SshProject.Type;

export const SshProjectList = Schema.Struct({ projects: Schema.Array(SshProject) });
export type SshProjectList = typeof SshProjectList.Type;

export const SshProjectAddInput = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
});
export type SshProjectAddInput = typeof SshProjectAddInput.Type;

export const SshProjectAddResult = Schema.Struct({ project: SshProject });
export type SshProjectAddResult = typeof SshProjectAddResult.Type;
