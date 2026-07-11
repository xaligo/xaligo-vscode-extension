import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type { DiffSummary } from "./preview-contract";
import {
  buildDiffArguments,
  buildRenderArguments,
  diffOutputPaths,
  parseDiffSummary,
  type XaligoRenderFormat
} from "./xaligo-command";

export {
  buildDiffArguments,
  buildRenderArguments,
  diffOutputPaths,
  parseDiffSummary,
  replaceExtension,
  type XaligoRenderFormat
} from "./xaligo-command";

export interface ExportFormat {
  renderFormat: XaligoRenderFormat;
  extension: string;
  label: string;
  title: string;
}

export interface XaligoDiffResult {
  removedSvg: string;
  addedSvg: string;
  summary?: DiffSummary;
}

export const exportFormats: Record<"svg" | "pptx" | "excalidraw", ExportFormat> = {
  svg: {
    renderFormat: "svg",
    extension: "svg",
    label: "SVG",
    title: "Export xaligo SVG"
  },
  pptx: {
    renderFormat: "pptx",
    extension: "pptx",
    label: "PowerPoint",
    title: "Export xaligo PPTX"
  },
  excalidraw: {
    renderFormat: "excalidraw",
    extension: "excalidraw",
    label: "Excalidraw",
    title: "Export xaligo Excalidraw"
  }
};

interface ExtensionPackageJson {
  xaligo?: Partial<ExtensionXaligoConfig>;
}

interface ExtensionXaligoConfig {
  packageName: string;
  packageRoot: string;
  nativeBinaryDir: string;
  nativeBinaryPlatformNames: Record<string, string>;
  nativeBinaryArchNames: Record<string, string>;
}

interface XaligoRuntime {
  binary: string;
  packageRoot: string;
}

interface XaligoProcessResult {
  stdout: string;
  stderr: string;
}

class XaligoCommandError extends Error {
  constructor(
    message: string,
    readonly cause: ExecFileException
  ) {
    super(message);
    this.name = "XaligoCommandError";
  }
}

export class XaligoRenderer {
  constructor(
    private readonly context: vscode.ExtensionContext
  ) {}

  async render(
    sourcePath: string,
    outputPath: string,
    format: XaligoRenderFormat,
    signal?: AbortSignal
  ): Promise<void> {
    const runtime = await this.resolveRuntime();
    const servicesPath = await findNearestServicesCsv(sourcePath);
    await runXaligo(
      runtime,
      buildRenderArguments(sourcePath, outputPath, format, servicesPath),
      30_000,
      signal
    );
  }

  async diff(
    beforePath: string,
    afterPath: string,
    outputPrefix: string,
    signal?: AbortSignal
  ): Promise<XaligoDiffResult> {
    const runtime = await this.resolveRuntime();
    const [removedPath, addedPath] = diffOutputPaths(outputPrefix);
    await Promise.all([
      fs.rm(removedPath, { force: true }),
      fs.rm(addedPath, { force: true })
    ]);

    try {
      const execution = await runXaligo(
        runtime,
        buildDiffArguments(beforePath, afterPath, outputPrefix),
        60_000,
        signal
      );
      const [removedSvg, addedSvg] = await Promise.all([
        fs.readFile(removedPath, "utf8"),
        fs.readFile(addedPath, "utf8")
      ]);
      return {
        removedSvg,
        addedSvg,
        summary: parseDiffSummary(`${execution.stdout}\n${execution.stderr}`)
      };
    } catch (error) {
      if (error instanceof Error && /unknown command\s+["']diff["']/i.test(error.message)) {
        throw new Error(
          "Structural diff requires xaligo 0.1.21 or newer. " +
          "Update the bundled renderer or set xaligo.executablePath to a compatible native CLI."
        );
      }
      throw error;
    } finally {
      await Promise.allSettled([
        fs.rm(removedPath, { force: true }),
        fs.rm(addedPath, { force: true })
      ]);
    }
  }

  async export(sourcePath: string, outputPath: string, exportFormat: ExportFormat): Promise<void> {
    await this.render(sourcePath, outputPath, exportFormat.renderFormat);
  }

  private async resolveRuntime(): Promise<XaligoRuntime> {
    if (!vscode.workspace.isTrusted) {
      throw new Error("Trust this workspace before running the xaligo renderer.");
    }

    const config = await readExtensionXaligoConfig(this.context.extensionPath);
    const packageRoot = path.resolve(this.context.extensionPath, config.packageRoot);
    if (!await exists(path.join(packageRoot, "package.json"))) {
      throw new Error(`${config.packageName} is missing from the extension package.`);
    }

    const configuredBinary = configuredExecutablePath();
    const binary = configuredBinary ?? xaligoNativeBinaryPath(packageRoot, config);
    if (!await exists(binary)) {
      throw new Error(`xaligo native binary was not found: ${binary}`);
    }

    return { binary, packageRoot };
  }
}

export async function findNearestServicesCsv(sourcePath: string): Promise<string | undefined> {
  const sourceDir = path.dirname(sourcePath);
  const sourceBase = path.basename(sourcePath, path.extname(sourcePath));
  const pairedServicesPath = path.join(sourceDir, `${sourceBase}.services.csv`);
  if (await exists(pairedServicesPath)) {
    return pairedServicesPath;
  }

  let currentDir = sourceDir;
  while (true) {
    const candidate = path.join(currentDir, "services.csv");
    if (await exists(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

async function readExtensionXaligoConfig(extensionPath: string): Promise<ExtensionXaligoConfig> {
  const manifestPath = path.join(extensionPath, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ExtensionPackageJson;
  const config = manifest.xaligo ?? {};
  return {
    packageName: config.packageName ?? "@xaligo/xaligo",
    packageRoot: config.packageRoot ?? path.join("node_modules", "@xaligo", "xaligo"),
    nativeBinaryDir: config.nativeBinaryDir ?? path.join("bin", "native"),
    nativeBinaryPlatformNames: config.nativeBinaryPlatformNames ?? { win32: "windows" },
    nativeBinaryArchNames: config.nativeBinaryArchNames ?? { x64: "amd64" }
  };
}

function configuredExecutablePath(): string | undefined {
  const value = vscode.workspace.getConfiguration("xaligo").get<string>("executablePath", "").trim();
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
  return expanded;
}

function xaligoNativeBinaryPath(packageRoot: string, config: ExtensionXaligoConfig): string {
  const platform = process.platform;
  const arch = config.nativeBinaryArchNames[process.arch] ?? process.arch;
  const binaryPlatform = config.nativeBinaryPlatformNames[platform] ?? platform;
  const executable = platform === "win32"
    ? `xaligo-${binaryPlatform}-${arch}.exe`
    : `xaligo-${binaryPlatform}-${arch}`;
  return path.join(packageRoot, config.nativeBinaryDir, executable);
}

function runXaligo(
  runtime: XaligoRuntime,
  args: string[],
  timeout: number,
  signal?: AbortSignal
): Promise<XaligoProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      runtime.binary,
      args,
      {
        encoding: "utf8",
        env: {
          ...process.env,
          XALIGO_HOME: runtime.packageRoot
        },
        maxBuffer: 4 * 1024 * 1024,
        signal,
        timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          const details = (stderr || stdout).trim() || error.message;
          reject(new XaligoCommandError(details, error));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
