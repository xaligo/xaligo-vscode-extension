<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, type Component } from "vue";
import VueMarkdown, { type Options as MarkdownOptions } from "vue-markdown-render";
import {
  Back,
  Box,
  Close,
  Connection,
  DataAnalysis,
  Document,
  EditPen,
  Loading,
  Menu,
  Memo,
  Picture,
  Refresh,
  Right,
  Share,
  Switch,
  FullScreen,
  Grid,
  ZoomIn,
  ZoomOut
} from "@element-plus/icons-vue";
import {
  clampZoom,
  defaultMarkdownPreviewSettings,
  markdownOrientations,
  markdownPaperSizes,
  previewContentChanged,
  type CliFeature,
  type MarkdownPreviewSettings,
  type PreviewHostMessage,
  type PreviewMode,
  type PreviewPanelState,
  type PreviewWebviewMessage,
  type ViewTransform,
  zoomAtPoint
} from "../preview-contract";
import { useViewTransform } from "./composables/useViewTransform";

declare function acquireVsCodeApi<State>(): {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: PreviewWebviewMessage): void;
};

interface PersistedPreviewState {
  transforms: Record<string, ViewTransform>;
}

interface DiagramCard {
  key: string;
  title: string;
  url: string;
  description: string;
  width: number;
  height: number;
  linksTo: string[];
}

interface CardPosition {
  x: number;
  y: number;
}

interface CardDrag {
  key: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

interface SvgOnlyDrag {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
}

interface CliMenuAction {
  feature: CliFeature;
  label: string;
  icon: Component;
}

type MenuTab = "view" | "output";

const vscode = acquireVsCodeApi<PersistedPreviewState>();

const state = ref<PreviewPanelState>({
  mode: "preview",
  viewKey: "empty",
  preview: { contentRevision: 0, loading: true },
  markdown: {
    contentRevision: 0,
    settings: { ...defaultMarkdownPreviewSettings },
    loading: false
  },
  diff: { contentRevision: 0, loading: false }
});

const viewportRef = ref<HTMLElement>();
const stageRef = ref<HTMLElement>();
const svgOnlyViewRef = ref<HTMLElement>();
const menuPanelRef = ref<HTMLElement>();
const menuOpen = ref(false);
const menuTab = ref<MenuTab>("view");
const markdownPaper = ref<MarkdownPreviewSettings["paper"]>(
  defaultMarkdownPreviewSettings.paper
);
const markdownOrientation = ref<MarkdownPreviewSettings["orientation"]>(
  defaultMarkdownPreviewSettings.orientation
);
const markdownSource = ref("");
const markdownOptions: MarkdownOptions = {
  html: false,
  linkify: true
};
const menuTooltip = reactive({
  label: "",
  left: 0,
  top: 0
});
const announcement = ref("");
const diagramCards = ref<DiagramCard[]>([]);
const svgOnlyCardKey = ref<string>();
const cardPositions = reactive<Record<string, CardPosition>>({});
const svgOnlyTransform = reactive<ViewTransform>({ zoom: 1, panX: 0, panY: 0 });

const stateTitle = ref("Rendering…");
const stateMessage = ref("");
const stateError = ref<string | undefined>(undefined);
const emptyStateHidden = ref(true);
const emptyStateRole = ref<"status" | "alert">("status");

let objectUrls: string[] = [];
let renderedMode: PreviewMode | undefined;
let renderedContentRevision = -1;
let renderToken = 0;
let positionViewKey = "";
let cardDrag: CardDrag | undefined;
let svgOnlyDrag: SvgOnlyDrag | undefined;

const cardGap = 48;
const cardHeaderHeight = 36;
const stageInset = 40;

const viewTransform = useViewTransform(vscode, viewportRef);
const { transform } = viewTransform;

const cardBounds = computed(() => {
  if (diagramCards.value.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...diagramCards.value.map((card) => cardPositions[card.key]?.x ?? 0));
  const minY = Math.min(...diagramCards.value.map((card) => cardPositions[card.key]?.y ?? 0));
  const maxX = Math.max(...diagramCards.value.map((card) => (
    (cardPositions[card.key]?.x ?? 0) + card.width
  )));
  const maxY = Math.max(...diagramCards.value.map((card) => (
    (cardPositions[card.key]?.y ?? 0) + card.height + cardHeaderHeight
  )));
  return {
    x: minX - stageInset,
    y: minY - stageInset,
    width: maxX - minX + stageInset * 2,
    height: maxY - minY + stageInset * 2
  };
});
const stageWidth = computed(() => Math.max(
  1,
  ...diagramCards.value.map((card) => (cardPositions[card.key]?.x ?? 0) + card.width + stageInset)
));
const stageHeight = computed(() => Math.max(
  1,
  ...diagramCards.value.map((card) => (
    (cardPositions[card.key]?.y ?? 0) + card.height + cardHeaderHeight + stageInset
  ))
));
const stageStyle = computed(() => ({
  width: `${stageWidth.value}px`,
  height: `${stageHeight.value}px`,
  transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`
}));
const zoomPercent = computed(() => Math.round(transform.zoom * 100));
const svgOnlyCard = computed(() => (
  diagramCards.value.find((card) => card.key === svgOnlyCardKey.value)
));
const svgOnlyZoomPercent = computed(() => Math.round(svgOnlyTransform.zoom * 100));
const svgOnlyStageStyle = computed(() => ({
  width: `${svgOnlyCard.value?.width ?? 1}px`,
  height: `${svgOnlyCard.value?.height ?? 1}px`,
  transform: `translate(${svgOnlyTransform.panX}px, ${svgOnlyTransform.panY}px) scale(${svgOnlyTransform.zoom})`
}));
const cardConnections = computed(() => {
  const cardsByKey = new Map(diagramCards.value.map((card) => [card.key, card]));
  return diagramCards.value.flatMap((source) => source.linksTo.flatMap((targetKey) => {
    const target = cardsByKey.get(safeArtifactId(targetKey));
    const sourcePosition = cardPositions[source.key];
    const targetPosition = target ? cardPositions[target.key] : undefined;
    if (!target || !sourcePosition || !targetPosition) {
      return [];
    }
    const sourceCenterX = sourcePosition.x + source.width / 2;
    const targetCenterX = targetPosition.x + target.width / 2;
    const targetIsRight = targetCenterX >= sourceCenterX;
    const x1 = targetIsRight ? sourcePosition.x + source.width : sourcePosition.x;
    const x2 = targetIsRight ? targetPosition.x : targetPosition.x + target.width;
    const y1 = sourcePosition.y + (source.height + cardHeaderHeight) / 2;
    const y2 = targetPosition.y + (target.height + cardHeaderHeight) / 2;
    const bend = Math.max(48, Math.abs(x2 - x1) / 2);
    return [{
      key: `${source.key}:${target.key}`,
      path: `M ${x1} ${y1} C ${x1 + (targetIsRight ? bend : -bend)} ${y1}, ${x2 + (targetIsRight ? -bend : bend)} ${y2}, ${x2} ${y2}`
    }];
  }));
});

function safeArtifactId(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

const exportActions: CliMenuAction[] = [
  { feature: "render-markdown", label: "Markdown 出力", icon: Memo },
  { feature: "export-svg", label: "SVG 出力", icon: Picture },
  { feature: "export-pptx", label: "PowerPoint 出力", icon: DataAnalysis },
  { feature: "export-excalidraw", label: "Excalidraw 出力", icon: EditPen },
  { feature: "export-pdf", label: "PDF 出力", icon: Document },
  { feature: "export-excel", label: "Excel 出力", icon: Grid },
  { feature: "export-xyflow", label: "XYFlow 出力", icon: Share },
  { feature: "export-isoflow", label: "Isoflow 出力", icon: Box }
];

const loading = computed(() => {
  switch (state.value.mode) {
    case "preview":
      return state.value.preview.loading;
    case "markdown":
      return state.value.markdown.loading;
    case "diff":
      return state.value.diff.loading;
  }
});
const swapDisabled = computed(() => !state.value.diff.beforeName && !state.value.diff.afterName);
const compareDisabled = computed(() => (
  !state.value.diff.beforeName || !state.value.diff.afterName || state.value.diff.loading
));
const diffSummaryText = computed(() => {
  const summary = state.value.diff.summary;
  return summary ? `+${summary.added} −${summary.removed} ~${summary.modified}` : "";
});
const markdownPaperDisplay = computed(() => (
  markdownPaper.value === "auto" ? "自動" : markdownPaper.value
));
const markdownOrientationDisplay = computed(() => {
  switch (markdownOrientation.value) {
    case "portrait":
      return "縦";
    case "landscape":
      return "横";
    default:
      return "自動";
  }
});
const markdownPaperTooltip = computed(() => `Markdown 用紙サイズ: ${markdownPaperDisplay.value}`);
const markdownOrientationTooltip = computed(() => (
  `Markdown 用紙の向き: ${markdownOrientationDisplay.value}`
));
function revokeObjectUrls(): void {
  for (const url of objectUrls) {
    URL.revokeObjectURL(url);
  }
  objectUrls = [];
}

function svgToUrl(svg: string): string {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  objectUrls.push(url);
  return url;
}

function resolveMarkdownAssets(
  source: string,
  assets: NonNullable<PreviewPanelState["markdown"]["assets"]>
): string {
  let resolved = source;
  for (const asset of assets) {
    resolved = resolved.replaceAll(asset.placeholder, svgToUrl(asset.svg));
  }
  return resolved;
}

function svgDimensions(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const width = Number.parseFloat(/\bwidth=["']([0-9.]+)/i.exec(root)?.[1] ?? "");
  const height = Number.parseFloat(/\bheight=["']([0-9.]+)/i.exec(root)?.[1] ?? "");
  return {
    width: Number.isFinite(width) && width > 0 ? width : 640,
    height: Number.isFinite(height) && height > 0 ? height : 480
  };
}

function createDiagramCard(
  key: string,
  title: string,
  svg: string,
  description: string,
  linksTo: string[] = []
): DiagramCard {
  const dimensions = svgDimensions(svg);
  return {
    key,
    title,
    url: svgToUrl(svg),
    description,
    width: dimensions.width,
    height: dimensions.height,
    linksTo
  };
}

function layoutCards(cards: DiagramCard[], viewKey: string): void {
  if (positionViewKey !== viewKey) {
    for (const key of Object.keys(cardPositions)) {
      delete cardPositions[key];
    }
    positionViewKey = viewKey;
  }
  const activeKeys = new Set(cards.map((card) => card.key));
  for (const key of Object.keys(cardPositions)) {
    if (!activeKeys.has(key)) {
      delete cardPositions[key];
    }
  }
  let nextX = stageInset;
  for (const card of cards) {
    if (!cardPositions[card.key]) {
      cardPositions[card.key] = { x: nextX, y: stageInset };
    }
    nextX = Math.max(nextX, cardPositions[card.key].x + card.width + cardGap);
  }
}

function cardStyle(card: DiagramCard): Record<string, string> {
  const position = cardPositions[card.key] ?? { x: stageInset, y: stageInset };
  return {
    left: `${position.x}px`,
    top: `${position.y}px`,
    width: `${card.width}px`
  };
}

function startCardDrag(card: DiagramCard, event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0) {
    return;
  }
  const position = cardPositions[card.key];
  const target = event.currentTarget;
  if (!position || !(target instanceof HTMLElement)) {
    return;
  }
  cardDrag = {
    key: card.key,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: position.x,
    startY: position.y
  };
  target.setPointerCapture(event.pointerId);
  target.closest(".diagram-card")?.classList.add("card-dragging");
  event.preventDefault();
}

function moveCard(event: PointerEvent): void {
  if (!cardDrag || event.pointerId !== cardDrag.pointerId) {
    return;
  }
  const position = cardPositions[cardDrag.key];
  if (!position) {
    return;
  }
  position.x = cardDrag.startX + (event.clientX - cardDrag.startClientX) / transform.zoom;
  position.y = cardDrag.startY + (event.clientY - cardDrag.startClientY) / transform.zoom;
}

function finishCardDrag(event: PointerEvent): void {
  if (!cardDrag || event.pointerId !== cardDrag.pointerId) {
    return;
  }
  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    target.closest(".diagram-card")?.classList.remove("card-dragging");
  }
  cardDrag = undefined;
}

function fitCard(card: DiagramCard): void {
  const position = cardPositions[card.key];
  if (!position) {
    return;
  }
  viewTransform.fitBounds(position.x, position.y, card.width, card.height + cardHeaderHeight);
}

function fitAllCards(): void {
  const bounds = cardBounds.value;
  viewTransform.fitBounds(bounds.x, bounds.y, bounds.width, bounds.height);
}

function showSvgOnly(card: DiagramCard): void {
  svgOnlyCardKey.value = card.key;
  void nextTick(() => {
    svgOnlyViewRef.value?.focus();
    fitSvgOnly();
  });
}

function closeSvgOnly(): void {
  svgOnlyCardKey.value = undefined;
  svgOnlyDrag = undefined;
}

function applySvgOnlyTransform(next: ViewTransform): void {
  svgOnlyTransform.zoom = clampZoom(next.zoom);
  svgOnlyTransform.panX = Number.isFinite(next.panX) ? next.panX : 0;
  svgOnlyTransform.panY = Number.isFinite(next.panY) ? next.panY : 0;
}

function fitSvgOnly(): void {
  const viewport = svgOnlyViewRef.value;
  const card = svgOnlyCard.value;
  if (!viewport || !card) {
    return;
  }
  const inset = 48;
  const zoom = clampZoom(Math.min(
    Math.max(100, viewport.clientWidth - inset * 2) / card.width,
    Math.max(100, viewport.clientHeight - inset * 2) / card.height
  ));
  applySvgOnlyTransform({
    zoom,
    panX: (viewport.clientWidth - card.width * zoom) / 2,
    panY: (viewport.clientHeight - card.height * zoom) / 2
  });
}

function zoomSvgOnly(nextZoom: number, pointX?: number, pointY?: number): void {
  const viewport = svgOnlyViewRef.value;
  if (!viewport) {
    return;
  }
  applySvgOnlyTransform(zoomAtPoint(
    svgOnlyTransform,
    nextZoom,
    pointX ?? viewport.clientWidth / 2,
    pointY ?? viewport.clientHeight / 2
  ));
}

function onSvgOnlyWheel(event: WheelEvent): void {
  const viewport = svgOnlyViewRef.value;
  if (!viewport || (!event.ctrlKey && !event.metaKey)) {
    return;
  }
  event.preventDefault();
  const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? viewport.clientHeight
      : 1;
  const bounds = viewport.getBoundingClientRect();
  zoomSvgOnly(
    svgOnlyTransform.zoom * Math.exp(-event.deltaY * deltaScale * 0.002),
    event.clientX - bounds.left,
    event.clientY - bounds.top
  );
}

function startSvgOnlyDrag(event: PointerEvent): void {
  const viewport = svgOnlyViewRef.value;
  if (!viewport || !event.isPrimary || event.button !== 0) {
    return;
  }
  svgOnlyDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: svgOnlyTransform.panX,
    startPanY: svgOnlyTransform.panY
  };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("dragging");
  event.preventDefault();
}

function moveSvgOnly(event: PointerEvent): void {
  if (!svgOnlyDrag || event.pointerId !== svgOnlyDrag.pointerId) {
    return;
  }
  svgOnlyTransform.panX = svgOnlyDrag.startPanX + event.clientX - svgOnlyDrag.startClientX;
  svgOnlyTransform.panY = svgOnlyDrag.startPanY + event.clientY - svgOnlyDrag.startClientY;
}

function finishSvgOnlyDrag(event: PointerEvent): void {
  const viewport = svgOnlyViewRef.value;
  if (!viewport || !svgOnlyDrag || event.pointerId !== svgOnlyDrag.pointerId) {
    return;
  }
  if (viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
  viewport.classList.remove("dragging");
  svgOnlyDrag = undefined;
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && svgOnlyCardKey.value) {
    closeSvgOnly();
    event.preventDefault();
  }
}

function setStateMessage(title: string, message: string, error?: string): void {
  stateTitle.value = title;
  stateMessage.value = message;
  stateError.value = error;
  emptyStateRole.value = error ? "alert" : "status";
  emptyStateHidden.value = false;
}

function updateStatus(next: PreviewPanelState, hasContent: boolean): void {
  const current = next.mode === "preview"
    ? next.preview
    : next.mode === "markdown"
      ? next.markdown
      : next.diff;
  if (current.error) {
    setStateMessage(
      next.mode === "diff"
        ? "Structural diff failed"
        : next.mode === "markdown"
          ? "Markdown preview failed"
          : "Preview failed",
      hasContent
        ? "The last successful preview remains behind this message."
        : "Fix the error and refresh.",
      current.error
    );
    return;
  }
  if (hasContent) {
    emptyStateHidden.value = true;
    return;
  }
  if (next.mode === "preview") {
    setStateMessage(
      next.preview.sourceName ? "Rendering preview…" : "No preview source",
      next.preview.sourceName ? next.preview.sourceName : "Open a .xal file and choose Preview."
    );
    return;
  }
  if (next.mode === "markdown") {
    setStateMessage(
      next.markdown.sourceName ? "Rendering Markdown…" : "No Markdown source",
      next.markdown.sourceName
        ? next.markdown.sourceName
        : "Open a .md or .markdown file and choose Preview."
    );
    return;
  }
  const missing = [
    next.diff.beforeName ? undefined : "Before",
    next.diff.afterName ? undefined : "After"
  ].filter(Boolean).join(" and ");
  setStateMessage(
    missing ? `Select ${missing}` : "Comparing diagrams…",
    missing ? "Choose the two .xal files from the menu." : "Structural changes are being rendered."
  );
}

function waitForImagesThenFit(token: number, viewKey: string): void {
  void nextTick(() => {
    const images = Array.from(stageRef.value?.querySelectorAll("img") ?? []);
    if (images.length === 0) {
      return;
    }
    const pending = images.map((image) => new Promise<void>((resolve) => {
      if (image.complete) {
        resolve();
        return;
      }
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    }));
    void Promise.all(pending).then(() => {
      if (token === renderToken && viewKey === state.value.viewKey && viewTransform.isFitPending()) {
        requestAnimationFrame(() => {
          if (token === renderToken && viewKey === state.value.viewKey && viewTransform.isFitPending()) {
            fitAllCards();
          }
        });
      }
    });
  });
}

function applyState(next: PreviewPanelState): void {
  if (next.mode !== "markdown") {
    viewTransform.restoreForViewKey(next.viewKey);
  }

  const contentRevision = next.mode === "preview"
    ? next.preview.contentRevision
    : next.mode === "markdown"
      ? next.markdown.contentRevision
      : next.diff.contentRevision;
  const contentChanged = previewContentChanged(renderedMode, renderedContentRevision, next.mode, contentRevision);
  if (next.mode === "markdown") {
    markdownPaper.value = next.markdown.settings.paper;
    markdownOrientation.value = next.markdown.settings.orientation;
  }
  state.value = next;

  let contentToken = renderToken;
  if (contentChanged) {
    contentToken = ++renderToken;
    revokeObjectUrls();
    const cards: DiagramCard[] = [];
    if (next.mode === "markdown") {
      markdownSource.value = resolveMarkdownAssets(
        next.markdown.source ?? "",
        next.markdown.assets ?? []
      );
    } else if (next.mode === "preview" && next.preview.artifacts?.length) {
      for (const artifact of next.preview.artifacts) {
        cards.push(createDiagramCard(
          artifact.id,
          artifact.title === "Preview"
            ? (next.preview.sourceName ?? artifact.title)
            : artifact.title,
          artifact.svg,
          `Preview of ${artifact.title}`,
          artifact.linksTo
        ));
      }
    } else if (next.mode === "preview" && next.preview.svg) {
      cards.push(createDiagramCard(
        "preview",
        next.preview.sourceName ?? "Preview",
        next.preview.svg,
        `Preview of ${next.preview.sourceName ?? "xaligo diagram"}`
      ));
    } else if (next.mode === "diff" && next.diff.removedSvg && next.diff.addedSvg) {
      cards.push(
        createDiagramCard(
          "removed",
          `Removed · ${next.diff.beforeName ?? "Before"}`,
          next.diff.removedSvg,
          `Removed elements in ${next.diff.beforeName ?? "before diagram"}`
        ),
        createDiagramCard(
          "added",
          `Added · ${next.diff.afterName ?? "After"}`,
          next.diff.addedSvg,
          `Added elements in ${next.diff.afterName ?? "after diagram"}`
        )
      );
    }
    layoutCards(cards, next.viewKey);
    diagramCards.value = cards;
    if (svgOnlyCardKey.value && !cards.some((card) => card.key === svgOnlyCardKey.value)) {
      closeSvgOnly();
    }
    renderedMode = next.mode;
    renderedContentRevision = contentRevision;
  }

  const hasContent = next.mode === "markdown"
    ? markdownSource.value.length > 0
    : diagramCards.value.length > 0;
  updateStatus(next, hasContent);

  const current = next.mode === "preview"
    ? next.preview
    : next.mode === "markdown"
      ? next.markdown
      : next.diff;
  if (contentChanged && hasContent && !current.loading && !current.error) {
    announcement.value = next.mode === "preview"
      ? `Preview updated: ${next.preview.sourceName ?? "xaligo diagram"}. Update ${contentRevision}.`
      : next.mode === "markdown"
        ? `Markdown preview updated: ${next.markdown.sourceName ?? "Markdown"}. Update ${contentRevision}.`
        : `Structural diff updated: ${next.diff.beforeName ?? "before"} to ${next.diff.afterName ?? "after"}. Update ${contentRevision}.`;
  }
  if (contentChanged && diagramCards.value.length > 0) {
    waitForImagesThenFit(contentToken, next.viewKey);
  }
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
  hideMenuTooltip();
}

function selectMenuTab(tab: MenuTab): void {
  menuTab.value = tab;
  hideMenuTooltip();
  void nextTick(() => {
    if (menuPanelRef.value) {
      menuPanelRef.value.scrollTop = 0;
    }
  });
}

function focusMenuTab(tab: MenuTab): void {
  selectMenuTab(tab);
  void nextTick(() => {
    document.getElementById(`menu-tab-${tab}`)?.focus();
  });
}

function showMenuTooltip(label: string, event: MouseEvent | FocusEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const bounds = target.getBoundingClientRect();
  menuTooltip.label = label;
  menuTooltip.left = bounds.right + 8;
  menuTooltip.top = bounds.top + bounds.height / 2;
}

function hideMenuTooltip(): void {
  menuTooltip.label = "";
}

function refresh(): void {
  vscode.postMessage({ command: "refresh" });
}

function setMode(mode: PreviewMode): void {
  if (mode !== state.value.mode) {
    vscode.postMessage({ command: "setMode", mode });
  }
}

function selectDiffFile(side: "before" | "after"): void {
  vscode.postMessage({ command: "selectDiffFile", side });
}

function swapDiffFiles(): void {
  vscode.postMessage({ command: "swapDiffFiles" });
}

function runCliFeature(feature: CliFeature): void {
  vscode.postMessage({ command: "runCliFeature", feature });
}

function previewMarkdown(): void {
  vscode.postMessage({
    command: "runCliFeature",
    feature: "preview-markdown",
    markdown: {
      paper: markdownPaper.value,
      orientation: markdownOrientation.value
    }
  });
}

function selectMarkdownPaper(paper: MarkdownPreviewSettings["paper"]): void {
  markdownPaper.value = paper;
  vscode.postMessage({
    command: "setMarkdownSettings",
    settings: {
      paper,
      orientation: markdownOrientation.value
    }
  });
  hideMenuTooltip();
}

function selectMarkdownOrientation(
  orientation: MarkdownPreviewSettings["orientation"]
): void {
  markdownOrientation.value = orientation;
  vscode.postMessage({
    command: "setMarkdownSettings",
    settings: {
      paper: markdownPaper.value,
      orientation
    }
  });
  hideMenuTooltip();
}

function markdownPaperOptionLabel(paper: MarkdownPreviewSettings["paper"]): string {
  return paper === "auto" ? "自動調整" : paper;
}

function markdownOrientationOptionLabel(
  orientation: MarkdownPreviewSettings["orientation"]
): string {
  switch (orientation) {
    case "portrait":
      return "縦向き";
    case "landscape":
      return "横向き";
    default:
      return "自動";
  }
}

function onViewportKeydown(event: KeyboardEvent): void {
  if (state.value.mode === "markdown") {
    return;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "f" || event.key === "F")) {
    fitAllCards();
    event.preventDefault();
    return;
  }
  if (viewTransform.handleKeydown(event)) {
    event.preventDefault();
  }
}

function onMessage(event: MessageEvent<PreviewHostMessage>): void {
  const message = event.data;
  if (!message || typeof message !== "object" || !("command" in message)) {
    return;
  }
  switch (message.command) {
    case "state":
      applyState(message.state);
      break;
    case "zoomBy":
      if (state.value.mode === "markdown") {
        break;
      }
      viewTransform.zoomAroundViewportCenter(transform.zoom + message.delta);
      break;
    case "resetZoom":
      if (state.value.mode === "markdown") {
        break;
      }
      viewTransform.zoomAroundViewportCenter(1);
      break;
    case "fit":
      if (state.value.mode === "markdown") {
        break;
      }
      fitAllCards();
      break;
  }
}

function onBeforeUnload(): void {
  viewTransform.flushBeforeUnload();
  revokeObjectUrls();
}

onMounted(() => {
  window.addEventListener("message", onMessage);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("keydown", onWindowKeydown);
  vscode.postMessage({ command: "ready" });
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("keydown", onWindowKeydown);
  revokeObjectUrls();
});
</script>

<template>
  <div class="app-root">
    <div class="canvas-menu">
      <el-button
        class="menu-trigger"
        aria-controls="menu-panel"
        aria-haspopup="true"
        :aria-expanded="menuOpen"
        aria-label="Toggle menu"
        title="Menu"
        @click="toggleMenu"
      >
        <el-icon><component :is="menuOpen ? Close : Menu" /></el-icon>
      </el-button>
      <section
        v-if="menuOpen"
        ref="menuPanelRef"
        id="menu-panel"
        class="menu-panel"
        aria-label="xaligo preview menu"
        @scroll="hideMenuTooltip"
      >
        <div class="menu-tabs" role="tablist" aria-label="メニュー種別" aria-orientation="vertical">
          <el-button
            id="menu-tab-view"
            class="menu-tab-button"
            :class="{ active: menuTab === 'view' }"
            role="tab"
            :aria-selected="menuTab === 'view'"
            :tabindex="menuTab === 'view' ? 0 : -1"
            aria-controls="menu-panel-view"
            title="表示"
            @click="selectMenuTab('view')"
            @keydown.down.prevent="focusMenuTab('output')"
            @keydown.end.prevent="focusMenuTab('output')"
          >
            表示
          </el-button>
          <el-button
            id="menu-tab-output"
            class="menu-tab-button"
            :class="{ active: menuTab === 'output' }"
            role="tab"
            :aria-selected="menuTab === 'output'"
            :tabindex="menuTab === 'output' ? 0 : -1"
            aria-controls="menu-panel-output"
            title="出力"
            @click="selectMenuTab('output')"
            @keydown.up.prevent="focusMenuTab('view')"
            @keydown.home.prevent="focusMenuTab('view')"
          >
            出力
          </el-button>
        </div>

        <section
          v-if="menuTab === 'view'"
          id="menu-panel-view"
          class="menu-tab-panel"
          role="tabpanel"
          aria-labelledby="menu-tab-view"
        >
          <div class="menu-stack-group" aria-label="表示操作">
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip('プレビュー表示', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip('プレビュー表示', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                :class="{ active: state.mode === 'preview' }"
                aria-label="Preview mode"
                :aria-pressed="state.mode === 'preview'"
                @click="setMode('preview')"
              >
                <el-icon><Picture /></el-icon>
              </el-button>
            </span>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip('構造差分を表示', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip('構造差分を表示', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                :class="{ active: state.mode === 'diff' }"
                aria-label="Structural diff mode"
                :aria-pressed="state.mode === 'diff'"
                @click="setMode('diff')"
              >
                <el-icon><Connection /></el-icon>
              </el-button>
            </span>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip('Markdown を表示', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip('Markdown を表示', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                :class="{ active: state.mode === 'markdown' }"
                aria-label="Preview Markdown"
                :aria-pressed="state.mode === 'markdown'"
                @click="previewMarkdown"
              >
                <el-icon><Memo /></el-icon>
              </el-button>
            </span>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip('再描画', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip('再描画', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button class="icon-menu-button" aria-label="Refresh" @click="refresh">
                <el-icon><Refresh /></el-icon>
              </el-button>
            </span>
            <span
              v-if="state.mode !== 'markdown'"
              class="menu-tooltip"
              @mouseenter="showMenuTooltip('全フレームを表示範囲に合わせる', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip('全フレームを表示範囲に合わせる', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                aria-label="Fit all frames"
                @click="fitAllCards"
              >
                <el-icon><FullScreen /></el-icon>
              </el-button>
            </span>
          </div>

          <div class="menu-stack-group" aria-label="Markdown 表示設定">
            <h2 class="menu-stack-label">Markdown</h2>
            <el-dropdown
              class="markdown-setting-dropdown"
              placement="right-start"
              trigger="click"
              :teleported="true"
              popper-class="markdown-settings-popper"
              @command="selectMarkdownPaper"
              @visible-change="hideMenuTooltip"
            >
              <span
                class="menu-tooltip"
                @mouseenter="showMenuTooltip(markdownPaperTooltip, $event)"
                @mouseleave="hideMenuTooltip"
                @focusin="showMenuTooltip(markdownPaperTooltip, $event)"
                @focusout="hideMenuTooltip"
              >
                <el-button
                  class="icon-menu-button markdown-setting-button"
                  :aria-label="markdownPaperTooltip"
                >
                  {{ markdownPaperDisplay }}
                </el-button>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="paper in markdownPaperSizes"
                    :key="paper"
                    :command="paper"
                    :class="{ 'is-selected': paper === markdownPaper }"
                  >
                    {{ markdownPaperOptionLabel(paper) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-dropdown
              class="markdown-setting-dropdown"
              placement="right-start"
              trigger="click"
              :teleported="true"
              popper-class="markdown-settings-popper"
              @command="selectMarkdownOrientation"
              @visible-change="hideMenuTooltip"
            >
              <span
                class="menu-tooltip"
                @mouseenter="showMenuTooltip(markdownOrientationTooltip, $event)"
                @mouseleave="hideMenuTooltip"
                @focusin="showMenuTooltip(markdownOrientationTooltip, $event)"
                @focusout="hideMenuTooltip"
              >
                <el-button
                  class="icon-menu-button markdown-setting-button"
                  :aria-label="markdownOrientationTooltip"
                >
                  {{ markdownOrientationDisplay }}
                </el-button>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="orientation in markdownOrientations"
                    :key="orientation"
                    :command="orientation"
                    :class="{ 'is-selected': orientation === markdownOrientation }"
                  >
                    {{ markdownOrientationOptionLabel(orientation) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <div v-if="state.mode === 'diff'" class="menu-stack-group" aria-label="差分操作">
            <h2 class="menu-stack-label">差分</h2>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip(`変更前: ${state.diff.beforeName ?? '未選択'}`, $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip(`変更前: ${state.diff.beforeName ?? '未選択'}`, $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                aria-label="Select before diagram"
                @click="selectDiffFile('before')"
              >
                <el-icon><Back /></el-icon>
              </el-button>
            </span>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip(`変更後: ${state.diff.afterName ?? '未選択'}`, $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip(`変更後: ${state.diff.afterName ?? '未選択'}`, $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                aria-label="Select after diagram"
                @click="selectDiffFile('after')"
              >
                <el-icon><Right /></el-icon>
              </el-button>
            </span>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip('変更前と変更後を入れ替える', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip('変更前と変更後を入れ替える', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                aria-label="Swap before and after"
                :disabled="swapDisabled"
                @click="swapDiffFiles"
              >
                <el-icon><Switch /></el-icon>
              </el-button>
            </span>
            <span
              class="menu-tooltip"
              @mouseenter="showMenuTooltip(diffSummaryText ? `差分を比較 (${diffSummaryText})` : '差分を比較', $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip(diffSummaryText ? `差分を比較 (${diffSummaryText})` : '差分を比較', $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                type="primary"
                aria-label="Compare diagrams"
                :disabled="compareDisabled"
                @click="refresh"
              >
                <el-icon><Refresh /></el-icon>
              </el-button>
            </span>
          </div>

        </section>

        <section
          v-else
          id="menu-panel-output"
          class="menu-tab-panel"
          role="tabpanel"
          aria-labelledby="menu-tab-output"
        >
          <div class="menu-stack-group" aria-label="出力操作">
            <span
              v-for="action in exportActions"
              :key="action.feature"
              class="menu-tooltip"
              @mouseenter="showMenuTooltip(action.label, $event)"
              @mouseleave="hideMenuTooltip"
              @focusin="showMenuTooltip(action.label, $event)"
              @focusout="hideMenuTooltip"
            >
              <el-button
                class="icon-menu-button"
                :aria-label="action.label"
                @click="runCliFeature(action.feature)"
              >
                <el-icon><component :is="action.icon" /></el-icon>
              </el-button>
            </span>
          </div>
        </section>
      </section>
      <div
        v-if="menuTooltip.label"
        class="floating-menu-tooltip"
        role="tooltip"
        :style="{ left: `${menuTooltip.left}px`, top: `${menuTooltip.top}px` }"
      >
        {{ menuTooltip.label }}
      </div>
    </div>

    <main
      ref="viewportRef"
      class="viewport"
      :class="{ 'markdown-viewport': state.mode === 'markdown' }"
      :tabindex="state.mode === 'markdown' ? -1 : 0"
      :aria-label="state.mode === 'markdown' ? 'Markdown preview' : 'Diagram viewport'"
      @wheel="state.mode !== 'markdown' && viewTransform.handleWheel($event)"
      @pointerdown="state.mode !== 'markdown' && viewTransform.handlePointerDown($event)"
      @pointermove="state.mode !== 'markdown' && viewTransform.handlePointerMove($event)"
      @pointerup="state.mode !== 'markdown' && viewTransform.finishDrag($event)"
      @pointercancel="state.mode !== 'markdown' && viewTransform.finishDrag($event)"
      @lostpointercapture="state.mode !== 'markdown' && viewTransform.finishDrag($event)"
      @keydown="onViewportKeydown"
    >
      <section
        v-if="state.mode === 'markdown'"
        class="markdown-fullscreen-view"
        :data-paper="markdownPaper"
        :data-orientation="markdownOrientation"
      >
        <article
          v-if="markdownSource"
          class="markdown-page-sheet markdown-document"
          :aria-label="`Markdown preview: ${state.markdown.sourceName ?? 'Markdown'}`"
        >
          <VueMarkdown :source="markdownSource" :options="markdownOptions" />
        </article>
      </section>
      <section v-else ref="stageRef" class="stage" :style="stageStyle">
        <svg
          v-if="cardConnections.length > 0"
          class="card-connections"
          :width="stageWidth"
          :height="stageHeight"
          :viewBox="`0 0 ${stageWidth} ${stageHeight}`"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="card-connection-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <path
            v-for="connection in cardConnections"
            :key="connection.key"
            class="card-connection"
            :d="connection.path"
            marker-end="url(#card-connection-arrow)"
          />
        </svg>
        <div
          v-if="diagramCards.length > 0"
          class="diagram-grid"
          :style="{ width: `${stageWidth}px`, height: `${stageHeight}px` }"
        >
          <figure
            v-for="card in diagramCards"
            :key="card.key"
            class="diagram-card"
            :style="cardStyle(card)"
            @pointerdown.stop="startCardDrag(card, $event)"
            @pointermove.stop="moveCard"
            @pointerup.stop="finishCardDrag"
            @pointercancel.stop="finishCardDrag"
            @lostpointercapture.stop="finishCardDrag"
          >
            <figcaption>
              <span>{{ card.title }}</span>
              <span class="card-actions">
                <el-button
                  class="card-action"
                  text
                  circle
                  aria-label="Show only this SVG"
                  title="Show only this SVG"
                  @pointerdown.stop
                  @click.stop="showSvgOnly(card)"
                >
                  <el-icon><Picture /></el-icon>
                </el-button>
                <el-button
                  class="card-action"
                  text
                  circle
                  aria-label="Fit this frame to the window"
                  title="Fit this frame to the window"
                  @pointerdown.stop
                  @click.stop="fitCard(card)"
                >
                  <el-icon><FullScreen /></el-icon>
                </el-button>
              </span>
            </figcaption>
            <img :src="card.url" :alt="card.description" draggable="false">
          </figure>
        </div>
      </section>
      <section v-if="!emptyStateHidden" class="empty-state" :role="emptyStateRole" aria-live="polite">
        <h1>{{ stateTitle }}</h1>
        <p>{{ stateMessage }}</p>
        <pre v-if="stateError">{{ stateError }}</pre>
      </section>
      <div v-if="loading" class="loading" role="status" aria-live="polite">
        <el-icon class="loading-spinner is-loading"><Loading /></el-icon>
        Rendering…
      </div>
    </main>

    <div v-if="state.mode !== 'markdown'" class="zoom-controls" role="toolbar" aria-label="Zoom controls">
      <el-button text aria-label="Zoom out" title="Zoom out" @click="viewTransform.zoomAroundViewportCenter(transform.zoom - 0.1)">
        <el-icon><ZoomOut /></el-icon>
      </el-button>
      <el-button text aria-label="Reset zoom" title="Reset zoom" @click="viewTransform.zoomAroundViewportCenter(1)">
        {{ zoomPercent }}%
      </el-button>
      <el-button text aria-label="Zoom in" title="Zoom in" @click="viewTransform.zoomAroundViewportCenter(transform.zoom + 0.1)">
        <el-icon><ZoomIn /></el-icon>
      </el-button>
    </div>

    <div v-if="state.mode !== 'markdown'" class="gesture-hint">
      Ctrl/Cmd + wheel to zoom · drag or arrow keys to move
    </div>
    <div class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</div>

    <section
      v-if="svgOnlyCard"
      ref="svgOnlyViewRef"
      class="svg-only-view"
      role="dialog"
      aria-modal="true"
      :aria-label="`${svgOnlyCard.title} SVG-only view`"
      tabindex="-1"
      @wheel="onSvgOnlyWheel"
      @pointerdown="startSvgOnlyDrag"
      @pointermove="moveSvgOnly"
      @pointerup="finishSvgOnlyDrag"
      @pointercancel="finishSvgOnlyDrag"
      @lostpointercapture="finishSvgOnlyDrag"
    >
      <div class="svg-only-stage" :style="svgOnlyStageStyle">
        <img :src="svgOnlyCard.url" :alt="svgOnlyCard.description" draggable="false">
      </div>
      <el-button
        class="svg-only-close"
        circle
        aria-label="Return to card view"
        title="Return to card view (Esc)"
        @pointerdown.stop
        @click="closeSvgOnly"
      >
        <el-icon><Close /></el-icon>
      </el-button>
      <div class="svg-only-controls" role="toolbar" aria-label="SVG zoom controls" @pointerdown.stop>
        <el-button text aria-label="Zoom out" title="Zoom out" @click="zoomSvgOnly(svgOnlyTransform.zoom - 0.1)">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
        <el-button text aria-label="Reset zoom" title="Reset zoom" @click="zoomSvgOnly(1)">
          {{ svgOnlyZoomPercent }}%
        </el-button>
        <el-button text aria-label="Zoom in" title="Zoom in" @click="zoomSvgOnly(svgOnlyTransform.zoom + 0.1)">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
        <el-button text aria-label="Fit SVG" title="Fit SVG" @click="fitSvgOnly">
          <el-icon><FullScreen /></el-icon>
        </el-button>
      </div>
    </section>
  </div>
</template>
