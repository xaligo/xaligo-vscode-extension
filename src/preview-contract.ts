export type PreviewMode = "preview" | "markdown" | "diff";

export type CliFeature =
  | "validate"
  | "export-svg"
  | "export-pptx"
  | "export-excalidraw"
  | "export-pdf"
  | "export-excel"
  | "export-xyflow"
  | "export-isoflow"
  | "preview-markdown"
  | "serve"
  | "render-markdown"
  | "generate-xal"
  | "add-service"
  | "add-services"
  | "init"
  | "version"
  | "help"
  | "completion-bash"
  | "completion-fish"
  | "completion-powershell"
  | "completion-zsh"
  | "custom";

export const cliFeatures: readonly CliFeature[] = [
  "validate",
  "export-svg",
  "export-pptx",
  "export-excalidraw",
  "export-pdf",
  "export-excel",
  "export-xyflow",
  "export-isoflow",
  "preview-markdown",
  "serve",
  "render-markdown",
  "generate-xal",
  "add-service",
  "add-services",
  "init",
  "version",
  "help",
  "completion-bash",
  "completion-fish",
  "completion-powershell",
  "completion-zsh",
  "custom"
];

export const markdownPaperSizes = [
  "auto",
  "A5",
  "A4",
  "A3",
  "A2",
  "A1",
  "Letter",
  "Legal",
  "Tabloid"
] as const;

export const markdownOrientations = [
  "auto",
  "portrait",
  "landscape"
] as const;

export type MarkdownPaperSize = typeof markdownPaperSizes[number];
export type MarkdownOrientation = typeof markdownOrientations[number];

export interface MarkdownPreviewSettings {
  paper: MarkdownPaperSize;
  orientation: MarkdownOrientation;
}

export const defaultMarkdownPreviewSettings: Readonly<MarkdownPreviewSettings> = {
  paper: "A4",
  orientation: "portrait"
};

const markdownPaperDimensions = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8]
} as const;

export function markdownPageDimensionsMm(
  settings: MarkdownPreviewSettings
): { width: number; height: number } | undefined {
  if (settings.paper === "auto") {
    return undefined;
  }
  const [portraitWidth, portraitHeight] = markdownPaperDimensions[settings.paper];
  return settings.orientation === "landscape"
    ? { width: portraitHeight, height: portraitWidth }
    : { width: portraitWidth, height: portraitHeight };
}

export function parseMarkdownPreviewSettings(value: unknown): MarkdownPreviewSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<MarkdownPreviewSettings>;
  if (
    !markdownPaperSizes.includes(candidate.paper as MarkdownPaperSize) ||
    !markdownOrientations.includes(candidate.orientation as MarkdownOrientation)
  ) {
    return undefined;
  }
  return {
    paper: candidate.paper as MarkdownPaperSize,
    orientation: candidate.orientation as MarkdownOrientation
  };
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
}

export interface PreviewArtifact {
  id: string;
  title: string;
  svg: string;
  linksTo: string[];
}

export interface MarkdownPreviewAsset {
  placeholder: string;
  mediaType: string;
  data: string;
}

export interface PreviewPanelState {
  mode: PreviewMode;
  viewKey: string;
  preview: {
    contentRevision: number;
    sourceName?: string;
    sourcePath?: string;
    svg?: string;
    artifacts?: PreviewArtifact[];
    loading: boolean;
    error?: string;
  };
  markdown: {
    contentRevision: number;
    sourceName?: string;
    sourcePath?: string;
    source?: string;
    assets?: MarkdownPreviewAsset[];
    settings: MarkdownPreviewSettings;
    loading: boolean;
    error?: string;
  };
  diff: {
    contentRevision: number;
    beforeName?: string;
    beforePath?: string;
    afterName?: string;
    afterPath?: string;
    removedSvg?: string;
    addedSvg?: string;
    loading: boolean;
    error?: string;
    summary?: DiffSummary;
  };
}

export type PreviewHostMessage =
  | { command: "state"; state: PreviewPanelState }
  | { command: "zoomBy"; delta: number }
  | { command: "resetZoom" }
  | { command: "fit" };

export type PreviewWebviewMessage =
  | { command: "ready" }
  | { command: "close" }
  | { command: "setMode"; mode: PreviewMode }
  | { command: "selectDiffFile"; side: "before" | "after" }
  | { command: "swapDiffFiles" }
  | { command: "showUpdates" }
  | { command: "setMarkdownSettings"; settings: MarkdownPreviewSettings }
  | {
    command: "runCliFeature";
    feature: CliFeature;
    markdown?: MarkdownPreviewSettings;
  }
  | { command: "openLink"; href: string }
  | { command: "refresh" };

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export const minimumPreviewZoom = 0.05;
export const maximumPreviewZoom = 8;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.max(minimumPreviewZoom, Math.min(maximumPreviewZoom, zoom));
}

export function normalizeViewTransform(value: unknown): ViewTransform | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<ViewTransform>;
  if (
    typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom) ||
    typeof candidate.panX !== "number" || !Number.isFinite(candidate.panX) ||
    typeof candidate.panY !== "number" || !Number.isFinite(candidate.panY)
  ) {
    return undefined;
  }
  return {
    zoom: clampZoom(candidate.zoom),
    panX: candidate.panX,
    panY: candidate.panY
  };
}

export function zoomAtPoint(
  transform: ViewTransform,
  nextZoom: number,
  pointX: number,
  pointY: number
): ViewTransform {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / transform.zoom;
  return {
    zoom,
    panX: pointX - (pointX - transform.panX) * ratio,
    panY: pointY - (pointY - transform.panY) * ratio
  };
}

export function previewContentChanged(
  renderedMode: PreviewMode | undefined,
  renderedRevision: number,
  nextMode: PreviewMode,
  nextRevision: number
): boolean {
  return renderedMode !== nextMode || renderedRevision !== nextRevision;
}
