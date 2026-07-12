import { execFile, type ExecFileException } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DiffSummary } from "./preview-contract";
import {
  XaligoRuntimeResolver,
  type XaligoRuntimeSelection
} from "./runtime-resolver";
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
    private readonly runtimeResolver: XaligoRuntimeResolver
  ) {}

  async render(
    sourcePath: string,
    outputPath: string,
    format: XaligoRenderFormat,
    signal?: AbortSignal
  ): Promise<void> {
    const runtime = await this.runtimeResolver.resolve();
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
    const runtime = await this.runtimeResolver.resolve();
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
          "Run “xaligo: Update xaligo Runtime” or set xaligo.executablePath to a compatible native CLI."
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

function runXaligo(
  runtime: XaligoRuntimeSelection,
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
