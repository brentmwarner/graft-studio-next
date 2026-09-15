import type { SshRemoteConnection } from "./sshRemoteTypes";
import { SshRemoteError } from "./sshRemoteTypes";

export async function sshProjectRequest(
  connection: SshRemoteConnection | null,
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!connection)
    throw new SshRemoteError(
      "connection_closed",
      "Connect to this computer before opening its projects.",
      false,
    );
  if (!connection.session.grants.includes("projects"))
    throw new SshRemoteError(
      "ssh_access_denied",
      "This connection does not allow access to projects.",
      false,
    );
  let response: Response;
  try {
    response = await fetch(`${connection.routes.httpBaseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${connection.bearer}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SshRemoteError(
      "network_unreachable",
      "The remote computer stopped responding. Reconnect and try again.",
      true,
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404)
      throw new SshRemoteError(
        "incompatible_host",
        "Reconnect to update the remote host before adding projects.",
        false,
      );
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "The remote project request failed. Reconnect and try again.";
    throw new SshRemoteError("project_request_failed", message, response.status >= 500);
  }
  return payload;
}
