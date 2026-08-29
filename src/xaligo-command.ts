import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type DiffSummary } from "./preview-contract";

export type XaligoRenderFormat = "svg" | "pptx";

export interface XaligoRenderOptions {
  combineFrames?: boolean;
  servicesPath?: string;
}

export interface XaligoMarkdownRenderOptions {
  servicesPath?: string;
}

export interface XaligoExecutionOutput {
  stdout: string;
  stderr: string;
}

export function isMarkdownFilePath(filePath: string): boolean {
  return [".md", ".markdown"].includes(path.extname(filePath).toLowerCase());
}

export function buildMarkdownRenderArguments(
  sourcePath: string,
  outputPath: string,
  svgDirectory: string,
  options: XaligoMarkdownRenderOptions = {}
): string[] {
  const args = [
    "render",
    "markdown",
    sourcePath,
    "--output",
    outputPath,
    "--svg-dir",
    svgDirectory
  ];
  if (options.servicesPath) {
    args.push("--services", options.servicesPath);
  }
  return args;
}

export function buildRenderArguments(
  sourcePath: string,
  outputPath: string,
  format: XaligoRenderFormat,
  options: XaligoRenderOptions | string = {}
): string[] {
  const resolvedOptions = typeof options === "string" ? { servicesPath: options } : options;
  const args = ["render", sourcePath, "--format", format, "-o", outputPath];
  if (resolvedOptions.servicesPath) {
    args.push("--services", resolvedOptions.servicesPath);
  }
  if (resolvedOptions.combineFrames) {
    args.push("--combine-frames");
  }
  return args;
}

export function buildDiffArguments(beforePath: string, afterPath: string, outputPrefix: string): string[] {
  return ["diff", beforePath, afterPath, "--output", outputPrefix];
}

export function diffOutputPaths(outputPrefix: string): [string, string] {
  const extension = path.extname(outputPrefix);
  const prefix = extension.toLowerCase() === ".svg"
    ? outputPrefix.slice(0, -extension.length)
    : outputPrefix;
  return [`${prefix}-removed.svg`, `${prefix}-added.svg`];
}

export function parseDiffSummary(output: string): DiffSummary | undefined {
  const match = /changes:\s*\+(\d+)\s+-(\d+)\s+~(\d+)/i.exec(output);
  if (!match) {
    return undefined;
  }
  return {
    added: Number.parseInt(match[1], 10),
    removed: Number.parseInt(match[2], 10),
    modified: Number.parseInt(match[3], 10)
  };
}

export function parseRenderedOutputPaths(output: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const value = JSON.parse(trimmed) as {
        code?: unknown;
        fields?: { output?: unknown };
      };
      const outputPath = value.code === "ICRRR-005" &&
        typeof value.fields?.output === "string"
        ? value.fields.output.trim()
        : "";
      if (outputPath && !seen.has(outputPath)) {
        paths.push(outputPath);
        seen.add(outputPath);
      }
    } catch {
      // Human-readable CLI output and unrelated JSON are intentionally ignored.
    }
  }
  return paths;
}

export function parseCommandWarnings(output: string): string[] {
  const warnings: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("{")) {
      try {
        const value = JSON.parse(trimmed) as {
          level?: unknown;
          code?: unknown;
          message?: unknown;
        };
        if (typeof value.level === "string" && value.level.toUpperCase() === "WARN") {
          const message = typeof value.message === "string" ? value.message : trimmed;
          const code = typeof value.code === "string" ? `${value.code}: ` : "";
          warnings.push(`${code}${message}`);
        }
        continue;
      } catch {
        // Fall through to human-readable warning detection.
      }
    }
    if (/\bWARN(?:ING)?\b/i.test(trimmed)) {
      warnings.push(trimmed);
    }
  }
  return warnings;
}

export async function renderedOutputPaths(
  requestedOutputPath: string,
  execution: XaligoExecutionOutput,
  startedAtMilliseconds: number
): Promise<string[]> {
  const requested = path.resolve(requestedOutputPath);
  const directory = path.dirname(requested);
  const extension = path.extname(requested);
  const stem = path.basename(requested, extension);
  const parsed = parseRenderedOutputPaths(`${execution.stdout}\n${execution.stderr}`)
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => isRenderOutputCandidate(candidate, directory, stem, extension));
  const parsedExisting = await existingFilesInOrder(parsed);
  if (parsedExisting.length > 0) {
    return parsedExisting;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((candidate) => isRenderOutputCandidate(candidate, directory, stem, extension));
  const fresh: Array<{ filePath: string; modified: number }> = [];
  for (const candidate of candidates) {
    const info = await fs.stat(candidate).catch(() => undefined);
    if (info && info.mtimeMs >= startedAtMilliseconds - 2_000) {
      fresh.push({ filePath: candidate, modified: info.mtimeMs });
    }
  }
  fresh.sort((left, right) => left.modified - right.modified || left.filePath.localeCompare(right.filePath));
  return fresh.map((candidate) => candidate.filePath);
}

function isRenderOutputCandidate(
  candidate: string,
  directory: string,
  stem: string,
  extension: string
): boolean {
  if (path.dirname(candidate) !== directory || path.extname(candidate).toLowerCase() !== extension.toLowerCase()) {
    return false;
  }
  const candidateStem = path.basename(candidate, path.extname(candidate));
  return candidateStem === stem || candidateStem.startsWith(`${stem}-`);
}

async function existingFilesInOrder(candidates: string[]): Promise<string[]> {
  const unique = [...new Set(candidates)];
  const checks = await Promise.all(unique.map(async (candidate) => {
    try {
      return (await fs.stat(candidate)).isFile() ? candidate : undefined;
    } catch {
      return undefined;
    }
  }));
  return checks.filter((candidate): candidate is string => candidate !== undefined);
}

export function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${extension}`);
}

export async function createTemporaryOutputDirectory(outputRoot: string, prefix: string): Promise<string> {
  await fs.mkdir(outputRoot, { recursive: true });
  return fs.mkdtemp(path.join(outputRoot, `${prefix}-`));
}
