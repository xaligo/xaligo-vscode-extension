import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import { verifyRuntimeBinary } from "./runtime-binary";
import {
  compareRuntimeIdentities,
  runtimeVersionKey,
  type RuntimeIdentity
} from "./runtime-version";

export interface ExtensionXaligoConfig {
  packageName: string;
  packageRoot: string;
  nativeBinaryDir: string;
  nativeBinaryPlatformNames: Record<string, string>;
  nativeBinaryArchNames: Record<string, string>;
}

export interface XaligoRuntimeSelection {
  binary: string;
  packageRoot: string;
  identity: RuntimeIdentity;
  source: "custom" | "managed" | "bundled";
}

export interface ManagedRuntimeEntry extends RuntimeIdentity {
  key: string;
  installedAt: string;
  binaryDigest: string;
}

export interface ManagedRuntimeState {
  schemaVersion: 1;
  current: ManagedRuntimeEntry;
  previous?: ManagedRuntimeEntry;
  pinned?: boolean;
}

interface ExtensionPackageJson {
  xaligo?: Partial<ExtensionXaligoConfig>;
}

interface RuntimePackageJson {
  name?: unknown;
  version?: unknown;
  xaligo?: {
    releaseTag?: unknown;
  };
}

interface RuntimeCandidate extends XaligoRuntimeSelection {
  source: "managed" | "bundled";
}

interface ManagedRuntimeCandidate {
  runtime?: RuntimeCandidate;
  entry?: ManagedRuntimeEntry;
  pinned: boolean;
}

const defaultPackageName = "@xaligo/xaligo";
const managedRuntimeSchemaVersion = 1;

export class XaligoRuntimeResolver {
  constructor(private readonly context: vscode.ExtensionContext) {}

  extensionConfig(): Promise<ExtensionXaligoConfig> {
    return readExtensionXaligoConfig(this.context.extensionPath);
  }

  async healthyManagedEntry(): Promise<ManagedRuntimeEntry | undefined> {
    const config = await this.extensionConfig();
    return (await this.readManagedRuntime(config)).entry;
  }

  async resolve(): Promise<XaligoRuntimeSelection> {
    const vscodeApi = await import("vscode");
    if (!vscodeApi.workspace.isTrusted) {
      throw new Error("Trust this workspace before running the xaligo renderer.");
    }

    const config = await this.extensionConfig();
    const customBinary = configuredExecutablePath(vscodeApi);
    if (customBinary && !await isRegularFile(customBinary)) {
      throw new Error(`Configured xaligo executable was not found: ${customBinary}`);
    }

    const bundledRoot = path.resolve(this.context.extensionPath, config.packageRoot);
    const [bundled, managed] = await Promise.all([
      readRuntimeCandidate(bundledRoot, config, "bundled"),
      this.readManagedRuntime(config)
    ]);
    const selectedPackage = chooseRuntimeCandidate(bundled, managed.runtime, managed.pinned);
    if (!selectedPackage) {
      throw new Error(
        `${config.packageName} has no healthy bundled or managed runtime for ` +
        `${process.platform}/${process.arch}.`
      );
    }

    if (customBinary) {
      const customPackage = bundled ?? selectedPackage;
      return {
        binary: customBinary,
        packageRoot: customPackage.packageRoot,
        identity: customPackage.identity,
        source: "custom"
      };
    }
    return selectedPackage;
  }

  private async readManagedRuntime(config: ExtensionXaligoConfig): Promise<ManagedRuntimeCandidate> {
    const statePath = path.join(this.context.globalStorageUri.fsPath, "runtime", "current.json");
    const state = await readManagedRuntimeState(statePath);
    if (!state) {
      return { pinned: false };
    }

    const entries = managedRuntimeFallbackEntries(state);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      let packageRoot: string;
      try {
        packageRoot = managedRuntimePackageRoot(this.context.globalStorageUri.fsPath, entry);
      } catch {
        continue;
      }
      const runtime = await readRuntimeCandidate(packageRoot, config, "managed", entry);
      if (runtime) {
        return {
          runtime,
          entry,
          pinned: index === 0 && Boolean(state.pinned)
        };
      }
    }
    return { pinned: false };
  }
}

export async function readExtensionXaligoConfig(extensionPath: string): Promise<ExtensionXaligoConfig> {
  const manifestPath = path.join(extensionPath, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ExtensionPackageJson;
  const config = manifest.xaligo ?? {};
  return {
    packageName: nonEmptyString(config.packageName) ?? defaultPackageName,
    packageRoot: nonEmptyString(config.packageRoot) ?? path.join("node_modules", "@xaligo", "xaligo"),
    nativeBinaryDir: nonEmptyString(config.nativeBinaryDir) ?? path.join("bin", "native"),
    nativeBinaryPlatformNames: stringRecord(config.nativeBinaryPlatformNames, { win32: "windows" }),
    nativeBinaryArchNames: stringRecord(config.nativeBinaryArchNames, { x64: "amd64" })
  };
}

export function xaligoNativeBinaryPath(
  packageRoot: string,
  config: ExtensionXaligoConfig,
  platform = process.platform,
  architecture = process.arch
): string {
  const arch = config.nativeBinaryArchNames[architecture] ?? architecture;
  const binaryPlatform = config.nativeBinaryPlatformNames[platform] ?? platform;
  const suffix = platform === "win32" ? ".exe" : "";
  return path.join(packageRoot, config.nativeBinaryDir, `xaligo-${binaryPlatform}-${arch}${suffix}`);
}

export function parseManagedRuntimeState(value: unknown): ManagedRuntimeState | undefined {
  if (!isRecord(value) || value.schemaVersion !== managedRuntimeSchemaVersion) {
    return undefined;
  }
  const current = parseManagedRuntimeEntry(value.current);
  if (!current) {
    return undefined;
  }
  const previous = value.previous === undefined
    ? undefined
    : parseManagedRuntimeEntry(value.previous);
  if (value.pinned !== undefined && typeof value.pinned !== "boolean") {
    return undefined;
  }
  return {
    schemaVersion: 1,
    current,
    ...(previous ? { previous } : {}),
    ...(typeof value.pinned === "boolean" ? { pinned: value.pinned } : {})
  };
}

export function managedRuntimePackageRoot(
  globalStoragePath: string,
  current: ManagedRuntimeEntry
): string {
  const derivedKey = runtimeVersionKey(current);
  if (derivedKey !== current.key || !isSafeRuntimeKey(derivedKey)) {
    throw new Error("Managed xaligo runtime state has an invalid version key.");
  }
  const versionsRoot = path.resolve(globalStoragePath, "runtime", "versions");
  const versionRoot = path.resolve(versionsRoot, derivedKey);
  if (path.dirname(versionRoot) !== versionsRoot) {
    throw new Error("Managed xaligo runtime version escaped the runtime directory.");
  }
  return versionRoot;
}

export function managedRuntimeFallbackEntries(state: ManagedRuntimeState): ManagedRuntimeEntry[] {
  return state.previous ? [state.current, state.previous] : [state.current];
}

export function chooseRuntimeCandidate<T extends { identity: RuntimeIdentity }>(
  bundled: T | undefined,
  managed: T | undefined,
  pinned: boolean
): T | undefined {
  if (!managed) {
    return bundled;
  }
  if (!bundled || pinned) {
    return managed;
  }
  return compareRuntimeIdentities(managed.identity, bundled.identity) > 0 ? managed : bundled;
}

async function readManagedRuntimeState(statePath: string): Promise<ManagedRuntimeState | undefined> {
  try {
    return parseManagedRuntimeState(JSON.parse(await fs.readFile(statePath, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

async function readRuntimeCandidate(
  packageRoot: string,
  config: ExtensionXaligoConfig,
  source: RuntimeCandidate["source"],
  expected?: ManagedRuntimeEntry
): Promise<RuntimeCandidate | undefined> {
  try {
    const manifestPath = path.join(packageRoot, "package.json");
    const versionPath = path.join(packageRoot, "VERSION");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as RuntimePackageJson;
    if (manifest.name !== config.packageName || typeof manifest.version !== "string") {
      return undefined;
    }
    const packageVersion = manifest.version.trim();
    const fallbackVersion = packageVersion.split("+")[0];
    const releaseTag = typeof manifest.xaligo?.releaseTag === "string" && manifest.xaligo.releaseTag.trim()
      ? manifest.xaligo.releaseTag.trim()
      : `v${fallbackVersion}`;
    if (!packageVersion || !fallbackVersion) {
      return undefined;
    }
    const storedVersion = await readOptionalTextFile(versionPath);
    if (expected && !storedVersion) {
      return undefined;
    }
    const version = storedVersion ?? fallbackVersion;
    if (!version) {
      return undefined;
    }
    const identity: RuntimeIdentity = {
      version,
      packageVersion,
      releaseTag,
      prerelease: inferPrerelease(packageVersion, releaseTag)
    };
    runtimeVersionKey(identity);
    if (expected && !sameRuntimeIdentity(identity, expected)) {
      return undefined;
    }

    const binary = xaligoNativeBinaryPath(packageRoot, config);
    const requiredFiles = [
      path.join(packageRoot, "etc", "resources", "aws", "app.yaml"),
      path.join(packageRoot, "etc", "resources", "aws", "service-catalog.csv")
    ];
    const binaryHealthy = await verifyRuntimeBinary(binary, process.platform, expected?.binaryDigest);
    if (!binaryHealthy || !(await Promise.all(requiredFiles.map(isRegularFile))).every(Boolean)) {
      return undefined;
    }
    if (source === "managed") {
      const now = new Date();
      await fs.utimes(packageRoot, now, now).catch(() => undefined);
    }
    return { binary, packageRoot, identity, source };
  } catch {
    return undefined;
  }
}

function parseManagedRuntimeEntry(value: unknown): ManagedRuntimeEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const version = nonEmptyString(value.version);
  const packageVersion = nonEmptyString(value.packageVersion);
  const releaseTag = nonEmptyString(value.releaseTag);
  const key = nonEmptyString(value.key);
  const installedAt = nonEmptyString(value.installedAt);
  const binaryDigest = nonEmptyString(value.binaryDigest);
  if (
    !version ||
    !packageVersion ||
    !releaseTag ||
    !key ||
    !installedAt ||
    !binaryDigest ||
    !/^sha256:[a-f0-9]{64}$/i.test(binaryDigest)
  ) {
    return undefined;
  }
  if (value.prerelease !== undefined && typeof value.prerelease !== "boolean") {
    return undefined;
  }
  const entry: ManagedRuntimeEntry = {
    version,
    packageVersion,
    releaseTag,
    key,
    installedAt,
    binaryDigest,
    prerelease: typeof value.prerelease === "boolean"
      ? value.prerelease
      : inferPrerelease(packageVersion, releaseTag)
  };
  try {
    if (runtimeVersionKey(entry) !== key || !isSafeRuntimeKey(key)) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return entry;
}

function sameRuntimeIdentity(left: RuntimeIdentity, right: RuntimeIdentity): boolean {
  return left.version === right.version &&
    left.packageVersion === right.packageVersion &&
    left.releaseTag === right.releaseTag &&
    Boolean(left.prerelease) === Boolean(right.prerelease);
}

function isSafeRuntimeKey(value: string): boolean {
  return value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("..") &&
    /^[A-Za-z0-9._-]+$/.test(value);
}

function configuredExecutablePath(vscodeApi: typeof import("vscode")): string | undefined {
  const value = vscodeApi.workspace.getConfiguration("xaligo").get<string>("executablePath", "").trim();
  if (!value) {
    return undefined;
  }
  const expanded = value === "~"
    ? os.homedir()
    : value.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), value.slice(2))
      : value;
  if (!path.isAbsolute(expanded)) {
    throw new Error("xaligo.executablePath must be an absolute path.");
  }
  return path.normalize(expanded);
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return nonEmptyString(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function inferPrerelease(packageVersion: string, releaseTag: string): boolean {
  if (/^main-\d+$/i.test(releaseTag)) {
    return true;
  }
  if (/^v\d+\.\d+\.\d+$/i.test(releaseTag)) {
    return false;
  }
  const withoutBuild = packageVersion.split("+")[0];
  return /^\d+\.\d+\.\d+-/.test(withoutBuild);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringRecord(
  value: unknown,
  fallback: Record<string, string>
): Record<string, string> {
  if (!isRecord(value)) {
    return fallback;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry) {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
