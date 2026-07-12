import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withRuntimeLock } from "../src/runtime-lock";

describe("runtime update lock", () => {
  it("rejects a concurrent updater while preserving the owner's lock", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-runtime-lock-"));
    let releaseOwner!: () => void;
    let markOwnerEntered!: () => void;
    const ownerBlocked = new Promise<void>((resolve) => { releaseOwner = resolve; });
    const ownerEntered = new Promise<void>((resolve) => { markOwnerEntered = resolve; });
    try {
      const owner = withRuntimeLock(root, async () => {
        markOwnerEntered();
        await ownerBlocked;
      }, {
        heartbeatMilliseconds: 5,
        staleMilliseconds: 20,
        electionMilliseconds: 2
      });
      const leasesRoot = path.join(root, "update-locks");
      await ownerEntered;
      await expect(withRuntimeLock(root, async () => undefined, {
        heartbeatMilliseconds: 5,
        staleMilliseconds: 20,
        electionMilliseconds: 2
      })).rejects.toThrow(/already in progress/);
      releaseOwner();
      await owner;
      expect(await fs.readdir(leasesRoot)).toEqual([]);
    } finally {
      releaseOwner?.();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a stale lock whose process no longer exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-runtime-stale-lock-"));
    const leasesRoot = path.join(root, "update-locks");
    const lockPath = path.join(leasesRoot, "stale-token.lock");
    try {
      await fs.mkdir(leasesRoot, { recursive: true });
      await fs.writeFile(lockPath, "stale-token\n999999\nold\nwaiting\n1\n");
      const old = new Date(Date.now() - 10_000);
      await fs.utimes(lockPath, old, old);
      await expect(withRuntimeLock(root, async () => "recovered", {
        heartbeatMilliseconds: 5,
        staleMilliseconds: 1,
        electionMilliseconds: 2
      })).resolves.toBe("recovered");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("elects one winner when two updaters start simultaneously", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-runtime-election-"));
    let releaseWinner!: () => void;
    const winnerBlocked = new Promise<void>((resolve) => { releaseWinner = resolve; });
    let entered = 0;
    const update = () => withRuntimeLock(root, async () => {
      entered += 1;
      await winnerBlocked;
    }, { electionMilliseconds: 10, heartbeatMilliseconds: 5 });
    try {
      const updates = [update(), update()];
      const settled = Promise.allSettled(updates);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(entered).toBe(1);
      releaseWinner();
      const results = await settled;
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    } finally {
      releaseWinner?.();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
