import { compareRuntimeIdentities, type RuntimeIdentity } from "./runtime-version";

export interface CurrentRuntime {
  identity: RuntimeIdentity;
  source: "custom" | "managed" | "bundled";
}

export function shouldInstallRuntime(
  current: CurrentRuntime | undefined,
  latest: RuntimeIdentity
): boolean {
  return !current || compareRuntimeIdentities(current.identity, latest) < 0;
}

export function prereleaseForReleaseTag(releaseTag: string, prerelease: unknown): boolean {
  if (typeof prerelease !== "boolean") {
    throw new Error(`Release ${releaseTag} does not declare prerelease metadata.`);
  }
  const expected = /^main-\d+$/.test(releaseTag);
  if (!expected && !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
    throw new Error(`Release ${releaseTag} has an unsupported tag.`);
  }
  if (prerelease !== expected) {
    throw new Error(`Release ${releaseTag} has inconsistent prerelease metadata.`);
  }
  return expected;
}

export function previousRuntimeGeneration<T extends { key: string }>(
  newKey: string,
  healthyManaged: T | undefined,
  existingPrevious: T | undefined
): T | undefined {
  if (healthyManaged && healthyManaged.key !== newKey) {
    return healthyManaged;
  }
  return existingPrevious?.key !== newKey ? existingPrevious : undefined;
}

export function runtimeGenerationIsExpired(
  modifiedAtMilliseconds: number,
  nowMilliseconds: number,
  graceMilliseconds: number
): boolean {
  return Number.isFinite(modifiedAtMilliseconds) &&
    nowMilliseconds - modifiedAtMilliseconds > graceMilliseconds;
}
