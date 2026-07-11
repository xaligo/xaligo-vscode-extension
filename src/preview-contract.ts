export type PreviewMode = "preview" | "diff";

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
}

export interface PreviewPanelState {
  mode: PreviewMode;
  viewKey: string;
  preview: {
    contentRevision: number;
    sourceName?: string;
    sourcePath?: string;
    svg?: string;
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
