import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseRuntimeCandidate,
  managedRuntimeFallbackEntries,
  managedRuntimePackageRoot,
  parseManagedRuntimeState,
  readExtensionXaligoConfig,
  xaligoNativeBinaryPath,
  type ManagedRuntimeState
} from "../src/runtime-resolver";
import { runtimeVersionKey, type RuntimeIdentity } from "../src/runtime-version";

const identity: RuntimeIdentity = {
  version: "0.1.21",
  packageVersion: "0.1.21+main.30",
  releaseTag: "main-30",
  prerelease: true
};
const binaryDigest = `sha256:${"a".repeat(64)}`;

describe("extension runtime configuration", () => {
  it("loads manifest overrides and platform mappings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-resolver-config-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
        xaligo: {
          packageName: "@example/xaligo",
          packageRoot: "vendor/xaligo",
          nativeBinaryDir: "native",
          nativeBinaryPlatformNames: { win32: "windows-test" },
          nativeBinaryArchNames: { x64: "x86_64-test" }
        }
      }));
      const config = await readExtensionXaligoConfig(root);
      expect(config).toEqual({
        packageName: "@example/xaligo",
        packageRoot: "vendor/xaligo",
        nativeBinaryDir: "native",
        nativeBinaryPlatformNames: { win32: "windows-test" },
        nativeBinaryArchNames: { x64: "x86_64-test" }
      });
      expect(xaligoNativeBinaryPath("/runtime", config, "win32", "x64")).toBe(
        path.join("/runtime", "native", "xaligo-windows-test-x86_64-test.exe")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses safe defaults when optional manifest configuration is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-resolver-defaults-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), "{}\n");
      const config = await readExtensionXaligoConfig(root);
      expect(config.packageName).toBe("@xaligo/xaligo");
      expect(config.packageRoot).toBe(path.join("node_modules", "@xaligo", "xaligo"));
      expect(xaligoNativeBinaryPath("/runtime", config, "linux", "arm64")).toBe(
        path.join("/runtime", "bin", "native", "xaligo-linux-arm64")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("managed runtime state", () => {
  it("derives the package root only from the verified identity key", () => {
    const key = runtimeVersionKey(identity);
    const state = parseManagedRuntimeState({
      schemaVersion: 1,
      current: {
        ...identity,
        key,
        installedAt: "2026-07-12T00:00:00.000Z",
        binaryDigest,
        path: "/tmp/untrusted-runtime"
      },
      pinned: true,
      path: "/tmp/untrusted-state"
    });
    expect(state).toBeDefined();
    expect(managedRuntimePackageRoot("/global", state!.current)).toBe(
      path.join("/global", "runtime", "versions", key)
    );
  });

  it("rejects a stored key that does not match the canonical identity", () => {
    expect(parseManagedRuntimeState({
      schemaVersion: 1,
      current: {
        ...identity,
        key: "../../outside",
        installedAt: "2026-07-12T00:00:00.000Z",
        binaryDigest
      }
    })).toBeUndefined();
  });

  it("ignores a corrupt previous generation without hiding a healthy current generation", () => {
    const key = runtimeVersionKey(identity);
    const state = parseManagedRuntimeState({
      schemaVersion: 1,
      current: { ...identity, key, installedAt: "2026-07-12T00:00:00.000Z", binaryDigest },
      previous: { key: "../../outside" }
    });
    expect(state?.current.key).toBe(key);
    expect(state?.previous).toBeUndefined();
  });

  it("round-trips the updater state contract", () => {
    const key = runtimeVersionKey(identity);
    const state: ManagedRuntimeState = {
      schemaVersion: 1,
      current: {
        ...identity,
        key,
        installedAt: "2026-07-12T00:00:00.000Z",
        binaryDigest
      },
      pinned: false
    };
    expect(parseManagedRuntimeState(state)).toEqual(state);
  });

  it("tries the previous generation after an unhealthy current generation", () => {
    const currentKey = runtimeVersionKey(identity);
    const previousIdentity = {
      ...identity,
      packageVersion: "0.1.20+main.29",
      releaseTag: "main-29"
    };
    const previousKey = runtimeVersionKey(previousIdentity);
    const state: ManagedRuntimeState = {
      schemaVersion: 1,
      current: { ...identity, key: currentKey, installedAt: "2026-07-12T01:00:00.000Z", binaryDigest },
      previous: { ...previousIdentity, key: previousKey, installedAt: "2026-07-11T01:00:00.000Z", binaryDigest }
    };
    expect(managedRuntimeFallbackEntries(state)).toEqual([state.current, state.previous]);
  });
});

describe("runtime candidate selection", () => {
  const bundled = { name: "bundled", identity: { ...identity, releaseTag: "main-30" } };
  const managed = {
    name: "managed",
    identity: {
      version: "0.1.22",
      packageVersion: "0.1.22+main.31",
      releaseTag: "main-31",
      prerelease: true
    }
  };

  it("uses the newer managed runtime when it is not pinned", () => {
    expect(chooseRuntimeCandidate(bundled, managed, false)).toBe(managed);
  });

  it("honors a pinned healthy managed runtime even when bundled is newer", () => {
    expect(chooseRuntimeCandidate(managed, bundled, true)).toBe(bundled);
  });

  it("falls back to the healthy bundled runtime", () => {
    expect(chooseRuntimeCandidate(bundled, undefined, false)).toBe(bundled);
  });
});
