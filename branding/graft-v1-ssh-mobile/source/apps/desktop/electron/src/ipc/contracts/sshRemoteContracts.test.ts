import { describe, expect, it } from "vitest";
import { SSH_REMOTE_CONTRACTS } from "./sshRemoteContracts";

describe("SSH remote contracts", () => {
  it("does not expose whole-window environment activation", () => {
    const contract = SSH_REMOTE_CONTRACTS.find(
      (candidate) => (candidate.type as string) === "sshEnvironment.activate",
    );
    expect(contract).toBeUndefined();
  });
});
