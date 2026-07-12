import { packageVersionForRelease, parseBaseSemver, type RuntimeIdentity } from "./runtime-version";
import { prereleaseForReleaseTag } from "./runtime-update-policy";

export interface NpmRuntimeRelease {
  identity: RuntimeIdentity;
  tarballUrl: string;
  tarballIntegrity: string;
}

export interface GitHubRuntimeAsset {
  binaryUrl: string;
  binaryDigest: string;
  prerelease: boolean;
}

export function parseNpmRuntimeRelease(value: unknown): NpmRuntimeRelease {
  if (!isRecord(value) || value.name !== "@xaligo/xaligo") {
    throw new Error("The npm registry returned an unexpected package.");
  }
  if (typeof value.version !== "string" || !parseBaseSemver(value.version)) {
    throw new Error("The npm registry returned an invalid xaligo version.");
  }
  if (!isRecord(value.dist) ||
    typeof value.dist.tarball !== "string" ||
    typeof value.dist.integrity !== "string") {
    throw new Error("The npm registry response does not include a verifiable tarball.");
  }

  const baseVersion = value.version.split("+")[0];
  const releaseTag = isRecord(value.xaligo) && typeof value.xaligo.releaseTag === "string"
    ? value.xaligo.releaseTag
    : `v${baseVersion}`;
  if (!/^(?:v\d+\.\d+\.\d+|main-\d+)$/.test(releaseTag)) {
    throw new Error(`The npm package contains an unsupported release tag: ${releaseTag}`);
  }
  return {
    identity: {
      version: baseVersion,
      packageVersion: packageVersionForRelease(value.version, releaseTag),
      releaseTag
    },
    tarballUrl: value.dist.tarball,
    tarballIntegrity: value.dist.integrity
  };
}

export function parseGitHubRuntimeAsset(
  value: unknown,
  releaseTag: string,
  expectedAssetName: string
): GitHubRuntimeAsset {
  if (!isRecord(value) || value.tag_name !== releaseTag || !Array.isArray(value.assets)) {
    throw new Error(`GitHub returned invalid metadata for xaligo release ${releaseTag}.`);
  }
  const prerelease = prereleaseForReleaseTag(releaseTag, value.prerelease);
  const assets = value.assets.filter((asset) => isRecord(asset) && asset.name === expectedAssetName);
  if (assets.length !== 1) {
    throw new Error(`Release ${releaseTag} does not contain exactly one ${expectedAssetName} asset.`);
  }
  const asset = assets[0];
  if (
    typeof asset.browser_download_url !== "string" ||
    typeof asset.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)
  ) {
    throw new Error(`Release asset ${expectedAssetName} does not provide a SHA-256 digest.`);
  }
  return {
    binaryUrl: asset.browser_download_url,
    binaryDigest: asset.digest,
    prerelease
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
