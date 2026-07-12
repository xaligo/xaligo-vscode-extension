import { describe, expect, it } from "vitest";
import { parseGitHubRuntimeAsset, parseNpmRuntimeRelease } from "../src/runtime-release";

const digest = `sha256:${"a".repeat(64)}`;

describe("runtime release metadata", () => {
  it("reconciles npm-normalized and tar package versions for main builds", () => {
    const release = parseNpmRuntimeRelease({
      name: "@xaligo/xaligo",
      version: "0.1.21",
      xaligo: { releaseTag: "main-30" },
      dist: {
        integrity: "sha512-example",
        tarball: "https://registry.npmjs.org/@xaligo/xaligo/-/xaligo-0.1.21.tgz"
      }
    });
    expect(release.identity).toEqual({
      version: "0.1.21",
      packageVersion: "0.1.21+main.30",
      releaseTag: "main-30"
    });
  });

  it("selects exactly one matching digested platform asset", () => {
    const asset = parseGitHubRuntimeAsset({
      tag_name: "main-30",
      prerelease: true,
      assets: [{
        name: "xaligo-darwin-arm64",
        digest,
        browser_download_url: "https://github.com/xaligo/xaligo/releases/download/main-30/xaligo-darwin-arm64"
      }]
    }, "main-30", "xaligo-darwin-arm64");
    expect(asset).toEqual({
      binaryUrl: "https://github.com/xaligo/xaligo/releases/download/main-30/xaligo-darwin-arm64",
      binaryDigest: digest,
      prerelease: true
    });
  });

  it("rejects mismatched release channels and ambiguous assets", () => {
    expect(() => parseGitHubRuntimeAsset({
      tag_name: "main-30",
      prerelease: false,
      assets: []
    }, "main-30", "xaligo-linux-amd64")).toThrow(/inconsistent/);
    expect(() => parseGitHubRuntimeAsset({
      tag_name: "v0.1.21",
      prerelease: false,
      assets: [
        { name: "xaligo-linux-amd64", digest, browser_download_url: "https://github.com/a" },
        { name: "xaligo-linux-amd64", digest, browser_download_url: "https://github.com/b" }
      ]
    }, "v0.1.21", "xaligo-linux-amd64")).toThrow(/exactly one/);
  });
});
