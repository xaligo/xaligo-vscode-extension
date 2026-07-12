export interface RuntimeIdentity {
  version: string;
  packageVersion: string;
  releaseTag: string;
  prerelease?: boolean;
}

export type BaseSemver = readonly [number, number, number];

const semanticVersionPattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const stableReleaseTagPattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const mainReleaseTagPattern = /^main-(\d+)$/;
const maximumKeyPartLength = 96;

export function parseBaseSemver(version: string): BaseSemver | undefined {
  const match = semanticVersionPattern.exec(version.trim());
  if (!match) {
    return undefined;
  }

  const prereleaseIdentifiers = match[4]?.split(".") ?? [];
  if (prereleaseIdentifiers.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    return undefined;
  }

  const base = match.slice(1, 4).map((part) => Number.parseInt(part, 10));
  if (base.some((part) => !Number.isSafeInteger(part))) {
    return undefined;
  }
  return [base[0], base[1], base[2]];
}

export function compareRuntimeIdentities(a: RuntimeIdentity, b: RuntimeIdentity): number {
  const baseComparison = compareBaseSemvers(baseSemverFor(a), baseSemverFor(b));
  if (baseComparison !== 0) {
    return baseComparison;
  }

  const aMainRun = mainRunNumber(a.releaseTag);
  const bMainRun = mainRunNumber(b.releaseTag);
  if (aMainRun !== undefined && bMainRun !== undefined && aMainRun !== bMainRun) {
    return aMainRun > bMainRun ? 1 : -1;
  }

  const channelComparison = compareNumbers(releaseChannelRank(a), releaseChannelRank(b));
  if (channelComparison !== 0) {
    return channelComparison;
  }

  return compareStrings(identityFallbackKey(a), identityFallbackKey(b));
}

export function runtimeVersionKey(identity: RuntimeIdentity): string {
  const packagePart = sanitizeKeyPart(identity.packageVersion.trim() || identity.version, "runtime");
  const releasePart = sanitizeKeyPart(identity.releaseTag, identity.prerelease ? "prerelease" : "release");
  return `${packagePart}--${releasePart}`;
}

export function packageVersionForRelease(registryVersion: string, releaseTag: string): string {
  const versionMatch = semanticVersionPattern.exec(registryVersion.trim());
  if (!versionMatch || registryVersion.trim().startsWith("v")) {
    throw new Error(`Invalid npm registry version: ${registryVersion}`);
  }
  const baseVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
  const prerelease = versionMatch[4];
  const build = versionMatch[5];
  const mainMatch = /^main-(\d+)$/.exec(releaseTag);
  if (mainMatch) {
    const expectedBuild = `main.${mainMatch[1]}`;
    if (prerelease || (build !== undefined && build !== expectedBuild)) {
      throw new Error(`The npm version ${registryVersion} does not match ${releaseTag}.`);
    }
    return build ? registryVersion : `${registryVersion}+${expectedBuild}`;
  }
  if (releaseTag !== `v${baseVersion}` || prerelease || build) {
    throw new Error(`The npm version ${registryVersion} does not match ${releaseTag}.`);
  }
  return registryVersion;
}

function baseSemverFor(identity: RuntimeIdentity): BaseSemver | undefined {
  return parseBaseSemver(identity.version) ?? parseBaseSemver(identity.packageVersion);
}

function compareBaseSemvers(a: BaseSemver | undefined, b: BaseSemver | undefined): number {
  if (!a || !b) {
    if (a) {
      return 1;
    }
    if (b) {
      return -1;
    }
    return 0;
  }

  for (let index = 0; index < a.length; index += 1) {
    const comparison = compareNumbers(a[index], b[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function releaseChannelRank(identity: RuntimeIdentity): number {
  if (stableReleaseTagPattern.test(identity.releaseTag)) {
    return 3;
  }
  if (mainReleaseTagPattern.test(identity.releaseTag)) {
    return 0;
  }
  if (identity.prerelease === false) {
    return 2;
  }
  if (identity.prerelease === true) {
    return 0;
  }
  return 1;
}

function mainRunNumber(releaseTag: string): bigint | undefined {
  const match = mainReleaseTagPattern.exec(releaseTag);
  return match ? BigInt(match[1]) : undefined;
}

function identityFallbackKey(identity: RuntimeIdentity): string {
  const prerelease = identity.prerelease === undefined
    ? "unknown"
    : identity.prerelease
      ? "prerelease"
      : "stable";
  return `${identity.releaseTag}\u0000${identity.packageVersion}\u0000${identity.version}\u0000${prerelease}`;
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a > b ? 1 : -1;
}

function compareStrings(a: string, b: string): number {
  return a === b ? 0 : a > b ? 1 : -1;
}

function sanitizeKeyPart(value: string, fallback: string): string {
  const raw = value.trim();
  let sanitized = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!sanitized) {
    return fallback;
  }
  if (sanitized.length > maximumKeyPartLength) {
    const suffix = stableHash(raw);
    sanitized = `${sanitized.slice(0, maximumKeyPartLength - suffix.length - 1)}-${suffix}`;
  }
  return sanitized;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
