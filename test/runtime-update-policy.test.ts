import { describe, expect, it } from "vitest";
import {
  prereleaseForReleaseTag,
  previousRuntimeGeneration,
  runtimeGenerationIsExpired,
  shouldInstallRuntime,
  type CurrentRuntime
} from "../src/runtime-update-policy";
import type { RuntimeIdentity } from "../src/runtime-version";

const latest: RuntimeIdentity = {
  version: "0.1.22",
  packageVersion: "0.1.22+main.31",
  releaseTag: "main-31",
  prerelease: true
};

function current(
  packageVersion: string,
  source: CurrentRuntime["source"] = "bundled"
): CurrentRuntime {
  const run = packageVersion.endsWith(".31") ? "31" : "30";
  return {
    source,
    identity: {
      version: packageVersion.startsWith("0.1.22") ? "0.1.22" : "0.1.21",
      packageVersion,
      releaseTag: `main-${run}`,
      prerelease: true
    }
  };
}

describe("runtime update policy", () => {
  it("bootstraps an update when no healthy runtime can be resolved", () => {
    expect(shouldInstallRuntime(undefined, latest)).toBe(true);
  });

  it("compares the stable package assets used beside a custom executable", () => {
    expect(shouldInstallRuntime(current("0.1.21+main.30", "custom"), latest)).toBe(true);
    expect(shouldInstallRuntime(current("0.1.22+main.31", "custom"), latest)).toBe(false);
  });

  it("updates older runtimes but skips an equal or newer healthy runtime", () => {
    expect(shouldInstallRuntime(current("0.1.21+main.30"), latest)).toBe(true);
    expect(shouldInstallRuntime(current("0.1.22+main.31"), latest)).toBe(false);
  });
});

describe("release channel policy", () => {
  it("requires main builds to be GitHub prereleases", () => {
    expect(prereleaseForReleaseTag("main-31", true)).toBe(true);
    expect(() => prereleaseForReleaseTag("main-31", false)).toThrow(/inconsistent/);
  });

  it("requires version tags to be stable and metadata to be present", () => {
    expect(prereleaseForReleaseTag("v0.1.22", false)).toBe(false);
    expect(() => prereleaseForReleaseTag("v0.1.22", true)).toThrow(/inconsistent/);
    expect(() => prereleaseForReleaseTag("main-31", undefined)).toThrow(/declare/);
  });
});

describe("runtime generation rotation", () => {
  it("preserves the healthy previous fallback instead of a corrupt current pointer", () => {
    const healthyFallback = { key: "runtime-b", marker: "healthy previous" };
    expect(previousRuntimeGeneration("runtime-c", healthyFallback, healthyFallback)).toBe(
      healthyFallback
    );
  });

  it("does not retain the newly installed generation as its own fallback", () => {
    const current = { key: "runtime-c" };
    const previous = { key: "runtime-b" };
    expect(previousRuntimeGeneration("runtime-c", current, previous)).toBe(previous);
    expect(previousRuntimeGeneration("runtime-c", current, current)).toBeUndefined();
  });

  it("keeps recently used generations beyond the maximum render duration", () => {
    const now = Date.now();
    expect(runtimeGenerationIsExpired(now - 60_000, now, 300_000)).toBe(false);
    expect(runtimeGenerationIsExpired(now - 300_001, now, 300_000)).toBe(true);
  });
});
