import { describe, expect, it } from "vitest";
import {
  compareRuntimeIdentities,
  packageVersionForRelease,
  parseBaseSemver,
  runtimeVersionKey,
  type RuntimeIdentity
} from "../src/runtime-version";

function runtime(
  version: string,
  releaseTag: string,
  packageVersion = version,
  prerelease?: boolean
): RuntimeIdentity {
  return { version, packageVersion, releaseTag, prerelease };
}

describe("runtime base semantic versions", () => {
  it("parses normal, tagged, prerelease, and build-metadata versions", () => {
    expect(parseBaseSemver("0.1.21")).toEqual([0, 1, 21]);
    expect(parseBaseSemver("v12.34.56")).toEqual([12, 34, 56]);
    expect(parseBaseSemver("1.2.3-rc.4+build.9")).toEqual([1, 2, 3]);
    expect(parseBaseSemver("0.1.21+main.30")).toEqual([0, 1, 21]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseBaseSemver("  1.2.3  ")).toEqual([1, 2, 3]);
  });

  it.each([
    "",
    "1",
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-01",
    "1.2.3+",
    "1.2.3/../../escape",
    "9007199254740992.0.0"
  ])("rejects malformed or unsafe version %j", (version) => {
    expect(parseBaseSemver(version)).toBeUndefined();
  });
});

describe("runtime identity ordering", () => {
  it("compares major, minor, and patch numerically before release channels", () => {
    expect(compareRuntimeIdentities(
      runtime("2.0.0", "main-1", "2.0.0+main.1", true),
      runtime("1.99.99", "v1.99.99", "1.99.99", false)
    )).toBe(1);
    expect(compareRuntimeIdentities(runtime("1.10.0", "main-1"), runtime("1.9.99", "main-999"))).toBe(1);
    expect(compareRuntimeIdentities(runtime("1.2.4", "main-1"), runtime("1.2.3", "v1.2.3"))).toBe(1);
  });

  it("uses the package version when the runtime version has no semantic base", () => {
    const newer = runtime("dev", "main-31", "0.1.22+main.31", true);
    const older = runtime("unknown", "v0.1.21", "0.1.21", false);
    expect(compareRuntimeIdentities(newer, older)).toBe(1);
  });

  it("orders a valid semantic identity after an invalid identity", () => {
    expect(compareRuntimeIdentities(runtime("1.0.0", "main-1"), runtime("dev", "nightly"))).toBe(1);
    expect(compareRuntimeIdentities(runtime("dev", "nightly"), runtime("1.0.0", "main-1"))).toBe(-1);
  });

  it("prefers a stable version tag over a main build with the same base", () => {
    const stable = runtime("1.2.3", "v1.2.3", "1.2.3", false);
    const main = runtime("1.2.3", "main-500", "1.2.3+main.500", true);
    expect(compareRuntimeIdentities(stable, main)).toBe(1);
    expect(compareRuntimeIdentities(main, stable)).toBe(-1);
  });

  it("compares main build runs numerically, including values beyond safe integers", () => {
    expect(compareRuntimeIdentities(runtime("1.2.3", "main-30"), runtime("1.2.3", "main-9"))).toBe(1);
    expect(compareRuntimeIdentities(
      runtime("1.2.3", "main-90071992547409930"),
      runtime("1.2.3", "main-90071992547409929")
    )).toBe(1);
  });

  it("uses prerelease metadata for nonstandard release channels", () => {
    const stable = runtime("1.2.3", "release", "1.2.3", false);
    const candidate = runtime("1.2.3", "candidate", "1.2.3-rc.1", true);
    expect(compareRuntimeIdentities(stable, candidate)).toBe(1);
  });

  it("falls back to deterministic code-unit lexical ordering", () => {
    const alpha = runtime("dev", "nightly-a", "snapshot", true);
    const beta = runtime("dev", "nightly-b", "snapshot", true);
    expect(compareRuntimeIdentities(alpha, beta)).toBe(-1);
    expect(compareRuntimeIdentities(beta, alpha)).toBe(1);
    expect(compareRuntimeIdentities(alpha, { ...alpha })).toBe(0);
  });
});

describe("runtime version directory keys", () => {
  it("uses the exact package and release identities for ordinary releases", () => {
    expect(runtimeVersionKey(runtime("0.1.21", "main-30", "0.1.21+main.30", true))).toBe(
      "0.1.21-main.30--main-30"
    );
    expect(runtimeVersionKey(runtime("1.2.3", "v1.2.3", "1.2.3", false))).toBe(
      "1.2.3--v1.2.3"
    );
  });

  it("removes path traversal, separators, control characters, and platform punctuation", () => {
    const key = runtimeVersionKey(runtime(
      "1.2.3",
      "../../main:30\\branch\u0000",
      "../@scope/runtime:1.2.3"
    ));
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(key).not.toContain("..");
    expect(key).not.toContain("/");
    expect(key).not.toContain("\\");
    expect(key).not.toContain(":");
  });

  it("provides safe fallbacks for empty untrusted metadata", () => {
    expect(runtimeVersionKey(runtime("", "", "", true))).toBe("runtime--prerelease");
    expect(runtimeVersionKey(runtime("", "", "", false))).toBe("runtime--release");
    expect(runtimeVersionKey(runtime("1.2.3", "v1.2.3", "   ", false))).toBe(
      "1.2.3--v1.2.3"
    );
  });

  it("bounds long path components while retaining a deterministic hash", () => {
    const identity = runtime("1.0.0", `main-${"9".repeat(240)}`, `1.0.0+${"a".repeat(240)}`, true);
    const key = runtimeVersionKey(identity);
    expect(key.length).toBeLessThanOrEqual(2 * 96 + 2);
    expect(runtimeVersionKey(identity)).toBe(key);

    const different = runtimeVersionKey({ ...identity, releaseTag: `${identity.releaseTag}8` });
    expect(different).not.toBe(key);
  });
});

describe("published runtime package versions", () => {
  it("restores build metadata removed by npm registry normalization", () => {
    expect(packageVersionForRelease("0.1.21", "main-30")).toBe("0.1.21+main.30");
  });

  it("preserves stable and already-qualified package versions", () => {
    expect(packageVersionForRelease("0.1.21", "v0.1.21")).toBe("0.1.21");
    expect(packageVersionForRelease("0.1.21+main.30", "main-30")).toBe("0.1.21+main.30");
  });

  it("rejects registry versions that conflict with their release tag", () => {
    expect(() => packageVersionForRelease("0.1.21+main.29", "main-30")).toThrow(/does not match/);
    expect(() => packageVersionForRelease("0.1.20", "v0.1.21")).toThrow(/does not match/);
    expect(() => packageVersionForRelease("0.1.21-rc.1", "main-30")).toThrow(/does not match/);
    expect(() => packageVersionForRelease("invalid", "main-30")).toThrow(/Invalid/);
  });
});
