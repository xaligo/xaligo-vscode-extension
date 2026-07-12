import { execFile, type ExecFileException } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { extractPackageArchive } from "./runtime-archive";
import { verifyDigest, verifySubresourceIntegrity } from "./runtime-integrity";
import { withRuntimeLock } from "./runtime-lock";
import {
  runtimeVersionKey,
  type RuntimeIdentity
} from "./runtime-version";
import {
  type ManagedRuntimeState,
  type XaligoRuntimeResolver,
  parseManagedRuntimeState,
  readExtensionXaligoConfig,
  xaligoNativeBinaryPath
} from "./runtime-resolver";
import {
  previousRuntimeGeneration,
  runtimeGenerationIsExpired,
  shouldInstallRuntime
} from "./runtime-update-policy";
import { parseGitHubRuntimeAsset, parseNpmRuntimeRelease } from "./runtime-release";

const npmLatestUrl = "https://registry.npmjs.org/@xaligo%2Fxaligo/latest";
const githubReleaseApi = "https://api.github.com/repos/xaligo/xaligo/releases/tags/";
const maximumMetadataBytes = 2 * 1024 * 1024;
const maximumTarballBytes = 64 * 1024 * 1024;
const maximumBinaryBytes = 64 * 1024 * 1024;
// Render and diff child processes time out within 60 seconds. Keep recently
// resolved generations well beyond that window before deleting them.
const runtimeUsageGraceMilliseconds = 5 * 60 * 1_000;
const installAction = "Install Update";

interface RuntimeRelease {
  identity: RuntimeIdentity;
  tarballUrl: string;
  tarballIntegrity: string;
  binaryUrl: string;
  binaryDigest: string;
}

interface InstalledRuntimeRecord extends RuntimeIdentity {
  key: string;
  installedAt: string;
  binaryDigest: string;
}

class RuntimeUpdateCancelled extends Error {
  constructor() {
    super("The xaligo runtime update was cancelled.");
    this.name = "RuntimeUpdateCancelled";
  }
}

export class XaligoRuntimeUpdater {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly resolver: XaligoRuntimeResolver
  ) {}

  async update(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage(
        "Trust this workspace before updating the xaligo runtime."
      );
      return;
    }

    const hasCustomExecutable = vscode.workspace.getConfiguration("xaligo")
      .get<string>("executablePath", "")
      .trim().length > 0;
    const cancellation = new AbortController();
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Updating xaligo runtime",
          cancellable: true
        },
        async (progress, token) => {
          const cancellationSubscription = token.onCancellationRequested(() => cancellation.abort());
          try {
            progress.report({ message: "Checking the latest release…" });
            const release = await this.fetchLatestRelease(cancellation.signal);
            const current = await this.resolver.resolve().catch(() => undefined);
            if (current && !shouldInstallRuntime(current, release.identity)) {
              return { status: "current" as const, current, release };
            }

            if (release.identity.prerelease) {
              const selection = await vscode.window.showWarningMessage(
                `The npm latest xaligo runtime (${release.identity.packageVersion}) maps to the ` +
                `prerelease ${release.identity.releaseTag}. Install it?`,
                { modal: true },
                installAction
              );
              if (selection !== installAction) {
                throw new RuntimeUpdateCancelled();
              }
            }

            progress.report({ message: `Downloading ${release.identity.packageVersion}…` });
            await this.installRelease(release, progress, cancellation.signal);
            return { status: "installed" as const, current, release };
          } finally {
            cancellationSubscription.dispose();
          }
        }
      );

      if (result.status === "current") {
        const customNotice = result.current.source === "custom"
          ? " The configured xaligo.executablePath remains active."
          : "";
        await vscode.window.showInformationMessage(
          `xaligo runtime assets ${result.current.identity.packageVersion} are already the latest available version.` +
          customNotice
        );
        return;
      }

      const customNotice = result.current?.source === "custom" || hasCustomExecutable
        ? " The configured xaligo.executablePath remains active until that setting is cleared."
        : "";
      await vscode.window.showInformationMessage(
        `Updated the managed xaligo runtime to ${result.release.identity.packageVersion}.` + customNotice
      );
    } catch (error) {
      if (error instanceof RuntimeUpdateCancelled || isAbortError(error)) {
        return;
      }
      await vscode.window.showErrorMessage(
        `Failed to update the xaligo runtime: ${errorMessage(error)}`
      );
    }
  }

  private async fetchLatestRelease(signal: AbortSignal): Promise<RuntimeRelease> {
    const npmMetadata = await fetchJson<unknown>(
      npmLatestUrl,
      maximumMetadataBytes,
      signal,
      ["registry.npmjs.org"]
    );
    const npmRelease = parseNpmRuntimeRelease(npmMetadata);
    const releaseTag = npmRelease.identity.releaseTag;

    const release = await fetchJson<unknown>(
      `${githubReleaseApi}${encodeURIComponent(releaseTag)}`,
      maximumMetadataBytes,
      signal,
      ["api.github.com"]
    );
    const config = await readExtensionXaligoConfig(this.context.extensionPath);
    const binaryName = xaligoNativeBinaryPath("", config);
    const expectedAssetName = path.basename(binaryName);
    const githubAsset = parseGitHubRuntimeAsset(release, releaseTag, expectedAssetName);

    return {
      identity: {
        ...npmRelease.identity,
        prerelease: githubAsset.prerelease
      },
      tarballUrl: validateDownloadUrl(npmRelease.tarballUrl, ["registry.npmjs.org"]),
      tarballIntegrity: npmRelease.tarballIntegrity,
      binaryUrl: validateDownloadUrl(githubAsset.binaryUrl, ["github.com"]),
      binaryDigest: githubAsset.binaryDigest
    };
  }

  private async installRelease(
    release: RuntimeRelease,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    signal: AbortSignal
  ): Promise<void> {
    const storagePath = fileSystemPath(this.context.globalStorageUri);
    const runtimeRoot = path.join(storagePath, "runtime");
    await fs.mkdir(runtimeRoot, { recursive: true });

    await withRuntimeLock(runtimeRoot, async () => {
      throwIfCancelled(signal);
      const stagingRoot = path.join(runtimeRoot, "staging");
      const versionsRoot = path.join(runtimeRoot, "versions");
      await Promise.all([
        fs.mkdir(stagingRoot, { recursive: true }),
        fs.mkdir(versionsRoot, { recursive: true })
      ]);

      const stagingDirectory = await fs.mkdtemp(path.join(stagingRoot, "update-"));
      try {
        const archivePath = path.join(stagingDirectory, "package.tgz");
        const packageRoot = path.join(stagingDirectory, "package");
        const [tarball, binary] = await downloadReleaseArtifacts(release, signal);
        verifySubresourceIntegrity(tarball, release.tarballIntegrity);
        verifyDigest(binary, release.binaryDigest);
        await fs.writeFile(archivePath, tarball, { mode: 0o600 });

        progress.report({ message: "Verifying and staging the runtime…" });
        await fs.mkdir(packageRoot, { recursive: true });
        await extractPackageArchive(archivePath, packageRoot, signal);
        const config = await readExtensionXaligoConfig(this.context.extensionPath);
        const binaryPath = xaligoNativeBinaryPath(packageRoot, config);
        await fs.mkdir(path.dirname(binaryPath), { recursive: true });
        await fs.writeFile(binaryPath, binary, { mode: 0o755 });
        if (process.platform !== "win32") {
          await fs.chmod(binaryPath, 0o755);
        }

        await verifyStagedPackage(packageRoot, release.identity);
        progress.report({ message: "Running xaligo smoke tests…" });
        await smokeTestRuntime(binaryPath, packageRoot, stagingDirectory, signal);
        throwIfCancelled(signal);

        const key = runtimeVersionKey(release.identity);
        const healthyManagedEntry = await this.resolver.healthyManagedEntry().catch(() => undefined);
        const previousState = await readManagedRuntimeState(runtimeRoot);
        const targetRoot = path.join(versionsRoot, key);
        await replaceDirectory(packageRoot, targetRoot);

        const current: InstalledRuntimeRecord = {
          ...release.identity,
          key,
          installedAt: new Date().toISOString(),
          binaryDigest: release.binaryDigest
        };
        const nextState: ManagedRuntimeState = {
          schemaVersion: 1,
          current,
          previous: previousRuntimeGeneration(key, healthyManagedEntry, previousState?.previous),
          pinned: false
        };
        await writeManagedRuntimeState(runtimeRoot, nextState);
        await cleanupRuntimeVersions(versionsRoot, nextState);
      } finally {
        await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }
}

async function downloadReleaseArtifacts(
  release: RuntimeRelease,
  signal: AbortSignal
): Promise<[Buffer, Buffer]> {
  const downloads = new AbortController();
  const cancelDownloads = () => downloads.abort();
  signal.addEventListener("abort", cancelDownloads, { once: true });
  if (signal.aborted) {
    downloads.abort();
  }
  try {
    return await Promise.all([
      fetchBytes(
        release.tarballUrl,
        maximumTarballBytes,
        downloads.signal,
        ["registry.npmjs.org"]
      ),
      fetchBytes(
        release.binaryUrl,
        maximumBinaryBytes,
        downloads.signal,
        ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]
      )
    ]);
  } catch (error) {
    downloads.abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelDownloads);
  }
}

async function fetchJson<T>(
  url: string,
  maximumBytes: number,
  signal: AbortSignal,
  allowedHosts: string[]
): Promise<T> {
  const bytes = await fetchBytes(url, maximumBytes, signal, allowedHosts, {
    Accept: "application/vnd.github+json, application/json"
  });
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch (error) {
    throw new Error(`The update server returned invalid JSON: ${errorMessage(error)}`);
  }
}

async function fetchBytes(
  url: string,
  maximumBytes: number,
  signal: AbortSignal,
  allowedHosts: string[],
  headers: Record<string, string> = {}
): Promise<Buffer> {
  validateDownloadUrl(url, allowedHosts);
  throwIfCancelled(signal);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "xaligo-vscode-extension",
      ...headers
    },
    redirect: "follow",
    signal
  });
  validateDownloadUrl(response.url, allowedHosts);
  if (!response.ok) {
    throw new Error(`Update download failed with HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("The update download exceeds the allowed size.");
  }
  if (!response.body) {
    throw new Error("The update server returned an empty response body.");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new Error("The update download exceeds the allowed size.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received);
}

function validateDownloadUrl(url: string, allowedHosts: string[]): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname)) {
    throw new Error(`Refusing an untrusted update URL: ${parsed.origin}`);
  }
  return parsed.toString();
}

async function verifyStagedPackage(packageRoot: string, identity: RuntimeIdentity): Promise<void> {
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
    xaligo?: { releaseTag?: unknown };
  };
  if (
    manifest.name !== "@xaligo/xaligo" ||
    manifest.version !== identity.packageVersion ||
    manifest.xaligo?.releaseTag !== identity.releaseTag
  ) {
    throw new Error("The staged xaligo package identity does not match its release metadata.");
  }
  const version = (await fs.readFile(path.join(packageRoot, "VERSION"), "utf8")).trim();
  if (version !== identity.version) {
    throw new Error("The staged xaligo VERSION file does not match its package version.");
  }
  await Promise.all([
    fs.access(path.join(packageRoot, "etc", "resources", "aws", "app.yaml")),
    fs.access(path.join(packageRoot, "etc", "resources", "aws", "service-catalog.csv"))
  ]);
}

async function smokeTestRuntime(
  binary: string,
  packageRoot: string,
  stagingDirectory: string,
  signal: AbortSignal
): Promise<void> {
  const inputPath = path.join(stagingDirectory, "smoke.xal");
  const outputPath = path.join(stagingDirectory, "smoke.svg");
  await fs.writeFile(
    inputPath,
    '<frame version="1" width="320" height="200"><rectangle id="smoke" title="Smoke" height="96" /></frame>\n',
    "utf8"
  );
  const environment = { ...process.env, XALIGO_HOME: packageRoot };
  await runExecutable(binary, ["diff", "--help"], environment, signal);
  await runExecutable(binary, ["validate", inputPath], environment, signal);
  await runExecutable(
    binary,
    ["render", inputPath, "--format", "svg", "-o", outputPath],
    environment,
    signal
  );
  const rendered = await fs.readFile(outputPath, "utf8");
  if (!rendered.includes("<svg")) {
    throw new Error("The updated xaligo runtime failed its SVG smoke test.");
  }
}

function runExecutable(
  binary: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: "utf8",
        env: environment,
        maxBuffer: 4 * 1024 * 1024,
        signal,
        timeout: 30_000
      },
      (error: ExecFileException | null, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        if (signal.aborted) {
          reject(new RuntimeUpdateCancelled());
          return;
        }
        reject(new Error((stderr || stdout).trim() || error.message));
      }
    );
  });
}

async function replaceDirectory(source: string, destination: string): Promise<void> {
  const backup = `${destination}.replaced-${crypto.randomUUID()}`;
  let movedExisting = false;
  try {
    await fs.rename(destination, backup);
    movedExisting = true;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (movedExisting) {
      await fs.rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }
  if (movedExisting) {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readManagedRuntimeState(runtimeRoot: string): Promise<ManagedRuntimeState | undefined> {
  try {
    return parseManagedRuntimeState(JSON.parse(
      await fs.readFile(path.join(runtimeRoot, "current.json"), "utf8")
    ) as unknown);
  } catch {
    return undefined;
  }
}

async function writeManagedRuntimeState(
  runtimeRoot: string,
  state: ManagedRuntimeState
): Promise<void> {
  const destination = path.join(runtimeRoot, "current.json");
  const temporary = path.join(runtimeRoot, `.current-${crypto.randomUUID()}.json`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function cleanupRuntimeVersions(
  versionsRoot: string,
  state: ManagedRuntimeState
): Promise<void> {
  const keep = new Set([
    state.current.key,
    state.previous?.key
  ].filter((key): key is string => Boolean(key)));
  let entries;
  try {
    entries = await fs.readdir(versionsRoot, { encoding: "utf8", withFileTypes: true });
  } catch {
    return;
  }
  await Promise.allSettled(entries
    .filter((entry) => entry.isDirectory() && !keep.has(entry.name))
    .map(async (entry) => {
      const generationPath = path.join(versionsRoot, entry.name);
      const info = await fs.stat(generationPath).catch(() => undefined);
      if (!info || !runtimeGenerationIsExpired(
        info.mtimeMs,
        Date.now(),
        runtimeUsageGraceMilliseconds
      )) {
        return;
      }
      await fs.rm(generationPath, { recursive: true, force: true });
    }));
}

function fileSystemPath(uri: vscode.Uri): string {
  if (uri.scheme !== "file") {
    throw new Error("The extension host does not provide filesystem-backed global storage.");
  }
  return uri.fsPath;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new RuntimeUpdateCancelled();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
