import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MarkdownPreviewAsset } from "./preview-contract";

const maximumEmbeddedImageBytes = 16 * 1024 * 1024;
const markdownImagePattern = /!\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const imageMediaTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

export interface RenderedMarkdownPreview {
  source: string;
  assets: MarkdownPreviewAsset[];
}

export async function readRenderedMarkdownPreview(
  markdownPath: string,
  svgDirectory: string,
  sourceMarkdownPath = markdownPath
): Promise<RenderedMarkdownPreview> {
  let source = await fs.readFile(markdownPath, "utf8");
  const entries = (await fs.readdir(svgDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".svg")
    .sort((left, right) => left.name.localeCompare(right.name));
  const assets: MarkdownPreviewAsset[] = [];

  for (const [index, entry] of entries.entries()) {
    const svgPath = path.join(svgDirectory, entry.name);
    const relativePath = path
      .relative(path.dirname(markdownPath), svgPath)
      .split(path.sep)
      .join("/");
    const pattern = buildGeneratedImageReferencePattern(relativePath);
    if (!pattern.test(source)) {
      throw new Error(
        `The rendered Markdown did not reference generated SVG ${entry.name}.`
      );
    }

    const placeholder = `xaligo-preview-svg:asset-${index + 1}`;
    source = source.replace(pattern, `![](${placeholder})`);
    const bytes = await fs.readFile(svgPath);
    assets.push({
      placeholder,
      mediaType: "image/svg+xml",
      data: bytes.toString("base64")
    });
  }

  source = await embedLocalMarkdownImages(
    source,
    path.dirname(sourceMarkdownPath),
    assets
  );
  return { source, assets };
}

async function embedLocalMarkdownImages(
  source: string,
  sourceDirectory: string,
  assets: MarkdownPreviewAsset[]
): Promise<string> {
  const matches = [...source.matchAll(markdownImagePattern)];
  if (matches.length === 0) {
    return source;
  }
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    const matchIndex = match.index ?? 0;
    result += source.slice(cursor, matchIndex);
    const destinationToken = match[2];
    const destination = unwrapDestination(destinationToken);
    const localPath = localImagePath(destination, sourceDirectory);
    if (!localPath) {
      result += match[0];
      cursor = matchIndex + match[0].length;
      continue;
    }

    const mediaType = imageMediaTypes[path.extname(localPath).toLowerCase()];
    if (!mediaType) {
      result += match[0];
      cursor = matchIndex + match[0].length;
      continue;
    }
    const info = await fs.stat(localPath).catch(() => undefined);
    if (!info?.isFile()) {
      throw new Error(`Markdown image was not found: ${localPath}`);
    }
    if (info.size > maximumEmbeddedImageBytes) {
      throw new Error(`Markdown image exceeds the 16 MiB preview limit: ${localPath}`);
    }
    const placeholder = `xaligo-preview-image:asset-${assets.length + 1}`;
    const bytes = await fs.readFile(localPath);
    assets.push({ placeholder, mediaType, data: bytes.toString("base64") });
    result += match[0].replace(destinationToken, placeholder);
    cursor = matchIndex + match[0].length;
  }
  return result + source.slice(cursor);
}

function unwrapDestination(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function localImagePath(destination: string, sourceDirectory: string): string | undefined {
  if (
    destination.startsWith("xaligo-preview-") ||
    /^(?:https?:|data:|blob:)/i.test(destination)
  ) {
    return undefined;
  }
  const withoutFragment = destination.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }
  if (/^file:/i.test(decoded)) {
    try {
      return fileURLToPath(decoded);
    } catch {
      return undefined;
    }
  }
  return path.isAbsolute(decoded)
    ? path.normalize(decoded)
    : path.resolve(sourceDirectory, decoded);
}

// The xaligo CLI's `render markdown` command always wraps the generated
// image destination in angle brackets and percent-encodes it via Go's
// `url.URL.EscapedPath`, e.g. `![](<assets/guide-1.svg>)`. Match both that
// form and a plain, unencoded destination so this stays tolerant of CLI
// output changes and of hand-authored references in test fixtures.
function buildGeneratedImageReferencePattern(relativePath: string): RegExp {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const destinations = new Set([relativePath, encoded]);
  const alternation = [...destinations].map(escapeRegExp).join("|");
  return new RegExp(`!\\[\\]\\(<?(?:${alternation})>?\\)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
