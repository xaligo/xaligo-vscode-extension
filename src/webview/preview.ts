import {
  clampZoom,
  normalizeViewTransform,
  type PreviewHostMessage,
  type PreviewPanelState,
  type PreviewWebviewMessage,
  previewContentChanged,
  type ViewTransform,
  zoomAtPoint
} from "../preview-contract";

declare function acquireVsCodeApi<State>(): {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: PreviewWebviewMessage): void;
};

interface PersistedPreviewState {
  transforms: Record<string, ViewTransform>;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
}

const defaultTransform: ViewTransform = { zoom: 1, panX: 24, panY: 24 };

export function startPreviewWebview(): void {
  const vscode = acquireVsCodeApi<PersistedPreviewState>();
  const viewport = requiredElement<HTMLElement>("viewport");
  const stage = requiredElement<HTMLElement>("stage");
  const emptyState = requiredElement<HTMLElement>("empty-state");
  const stateTitle = requiredElement<HTMLElement>("state-title");
  const stateMessage = requiredElement<HTMLElement>("state-message");
  const stateError = requiredElement<HTMLElement>("state-error");
  const loading = requiredElement<HTMLElement>("loading");
  const zoomLabel = requiredElement<HTMLButtonElement>("zoom-label");
  const previewActions = requiredElement<HTMLElement>("preview-actions");
  const diffActions = requiredElement<HTMLElement>("diff-actions");
  const previewSource = requiredElement<HTMLElement>("preview-source");
  const beforeFile = requiredElement<HTMLElement>("before-file");
  const afterFile = requiredElement<HTMLElement>("after-file");
  const diffSummary = requiredElement<HTMLElement>("diff-summary");
  const announcement = requiredElement<HTMLElement>("announcement");
  const previewTab = requiredElement<HTMLButtonElement>("mode-preview");
  const diffTab = requiredElement<HTMLButtonElement>("mode-diff");
  const swapButton = requiredElement<HTMLButtonElement>("swap-diff");
  const compareButton = requiredElement<HTMLButtonElement>("compare-diff");

  const savedState = vscode.getState();
  const savedTransforms = savedState?.transforms;
  const persisted: PersistedPreviewState = savedTransforms &&
    typeof savedTransforms === "object" &&
    !Array.isArray(savedTransforms)
    ? { transforms: savedTransforms }
    : { transforms: {} };
  let activeViewKey = "";
  let transform = { ...defaultTransform };
  let drag: DragState | undefined;
  let fitPending = false;
  let objectUrls: string[] = [];
  let renderedMode: PreviewPanelState["mode"] | undefined;
  let renderedContentRevision = -1;
  let renderToken = 0;
  let persistTimer: number | undefined;

  function persistTransform(): void {
    if (!activeViewKey) {
      return;
    }
    persisted.transforms[activeViewKey] = { ...transform };
    const keys = Object.keys(persisted.transforms);
    for (const key of keys.slice(0, Math.max(0, keys.length - 32))) {
      if (key !== activeViewKey) {
        delete persisted.transforms[key];
      }
    }
    vscode.setState(persisted);
  }

  function schedulePersistTransform(): void {
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
    }
    persistTimer = window.setTimeout(() => {
      persistTimer = undefined;
      persistTransform();
    }, 120);
  }

  function applyTransform(next: ViewTransform, persist = true): void {
    transform = {
      zoom: clampZoom(next.zoom),
      panX: Number.isFinite(next.panX) ? next.panX : 0,
      panY: Number.isFinite(next.panY) ? next.panY : 0
    };
    stage.style.transform = `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`;
    zoomLabel.textContent = `${Math.round(transform.zoom * 100)}%`;
    if (persist) {
      persistTransform();
    }
  }

  function zoomAroundViewportCenter(nextZoom: number): void {
    fitPending = false;
    applyTransform(zoomAtPoint(
      transform,
      nextZoom,
      viewport.clientWidth / 2,
      viewport.clientHeight / 2
    ));
  }

  function fitView(): void {
    const width = stage.offsetWidth;
    const height = stage.offsetHeight;
    if (width <= 0 || height <= 0) {
      fitPending = true;
      return;
    }

    const availableWidth = Math.max(100, viewport.clientWidth - 48);
    const availableHeight = Math.max(100, viewport.clientHeight - 48);
    const zoom = clampZoom(Math.min(availableWidth / width, availableHeight / height));
    applyTransform({
      zoom,
      panX: (viewport.clientWidth - width * zoom) / 2,
      panY: (viewport.clientHeight - height * zoom) / 2
    });
    fitPending = false;
  }

  function revokeObjectUrls(): void {
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
    objectUrls = [];
  }

  function createDiagramCard(title: string, svg: string, description: string): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "diagram-card";

    const caption = document.createElement("figcaption");
    caption.textContent = title;
    figure.append(caption);

    const image = document.createElement("img");
    image.alt = description;
    image.draggable = false;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    objectUrls.push(url);
    image.src = url;
    figure.append(image);
    return figure;
  }

  function waitForImagesThenFit(token: number, viewKey: string): void {
    const images = Array.from(stage.querySelectorAll("img"));
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
      if (token === renderToken && viewKey === activeViewKey && fitPending) {
        requestAnimationFrame(() => {
          if (token === renderToken && viewKey === activeViewKey && fitPending) {
            fitView();
          }
        });
      }
    });
  }

  function setStateMessage(title: string, message: string, error?: string): void {
    stateTitle.textContent = title;
    stateMessage.textContent = message;
    stateError.textContent = error ?? "";
    stateError.hidden = !error;
    emptyState.setAttribute("role", error ? "alert" : "status");
    emptyState.hidden = false;
  }

  function updateStatus(state: PreviewPanelState, hasDiagram: boolean): void {
    const current = state.mode === "preview" ? state.preview : state.diff;
    loading.hidden = !current.loading;
    if (current.error) {
      setStateMessage(
        state.mode === "preview" ? "Preview failed" : "Structural diff failed",
        hasDiagram ? "The last successful image remains behind this message." : "Fix the error and refresh.",
        current.error
      );
      return;
    }
    if (hasDiagram) {
      emptyState.hidden = true;
      return;
    }
    if (state.mode === "preview") {
      setStateMessage(
        state.preview.sourceName ? "Rendering preview…" : "No preview source",
        state.preview.sourceName ? state.preview.sourceName : "Open a .xal file and choose Preview."
      );
      return;
    }
    const missing = [
      state.diff.beforeName ? undefined : "Before",
      state.diff.afterName ? undefined : "After"
    ].filter(Boolean).join(" and ");
    setStateMessage(
      missing ? `Select ${missing}` : "Comparing diagrams…",
      missing ? "Choose the two .xal files from the menu bar." : "Structural changes are being rendered."
    );
  }

  function renderState(state: PreviewPanelState): void {
    const keyChanged = activeViewKey !== state.viewKey;
    if (keyChanged) {
      if (activeViewKey) {
        if (persistTimer !== undefined) {
          window.clearTimeout(persistTimer);
          persistTimer = undefined;
        }
        persistTransform();
      }
      activeViewKey = state.viewKey;
      const restored = normalizeViewTransform(persisted.transforms[activeViewKey]);
      transform = restored ? { ...restored } : { ...defaultTransform };
      fitPending = !restored;
    }

    previewTab.classList.toggle("active", state.mode === "preview");
    diffTab.classList.toggle("active", state.mode === "diff");
    previewTab.setAttribute("aria-pressed", String(state.mode === "preview"));
    diffTab.setAttribute("aria-pressed", String(state.mode === "diff"));
    previewActions.hidden = state.mode !== "preview";
    diffActions.hidden = state.mode !== "diff";

    previewSource.textContent = state.preview.sourceName ?? "No source selected";
    previewSource.title = state.preview.sourcePath ?? "";
    beforeFile.textContent = state.diff.beforeName ?? "Not selected";
    beforeFile.title = state.diff.beforePath ?? "";
    afterFile.textContent = state.diff.afterName ?? "Not selected";
    afterFile.title = state.diff.afterPath ?? "";
    swapButton.disabled = !state.diff.beforeName && !state.diff.afterName;
    compareButton.disabled = !state.diff.beforeName || !state.diff.afterName || state.diff.loading;
    diffSummary.textContent = state.diff.summary
      ? `+${state.diff.summary.added} −${state.diff.summary.removed} ~${state.diff.summary.modified}`
      : "";

    const contentRevision = state.mode === "preview"
      ? state.preview.contentRevision
      : state.diff.contentRevision;
    const contentChanged = previewContentChanged(
      renderedMode,
      renderedContentRevision,
      state.mode,
      contentRevision
    );
    let contentToken = renderToken;
    if (contentChanged) {
      contentToken = ++renderToken;
      revokeObjectUrls();
      stage.replaceChildren();
      const grid = document.createElement("div");
      grid.className = state.mode === "diff" ? "diagram-grid diff-grid" : "diagram-grid";
      if (state.mode === "preview" && state.preview.svg) {
        grid.append(createDiagramCard(
          state.preview.sourceName ?? "Preview",
          state.preview.svg,
          `Preview of ${state.preview.sourceName ?? "xaligo diagram"}`
        ));
      } else if (state.mode === "diff" && state.diff.removedSvg && state.diff.addedSvg) {
        grid.append(
          createDiagramCard(
            `Removed · ${state.diff.beforeName ?? "Before"}`,
            state.diff.removedSvg,
            `Removed elements in ${state.diff.beforeName ?? "before diagram"}`
          ),
          createDiagramCard(
            `Added · ${state.diff.afterName ?? "After"}`,
            state.diff.addedSvg,
            `Added elements in ${state.diff.afterName ?? "after diagram"}`
          )
        );
      }
      if (grid.childElementCount > 0) {
        stage.append(grid);
      }
      renderedMode = state.mode;
      renderedContentRevision = contentRevision;
    }

    applyTransform(transform, false);
    const hasDiagram = stage.querySelector("img") !== null;
    updateStatus(state, hasDiagram);
    const current = state.mode === "preview" ? state.preview : state.diff;
    if (contentChanged && hasDiagram && !current.loading && !current.error) {
      announcement.textContent = state.mode === "preview"
        ? `Preview updated: ${state.preview.sourceName ?? "xaligo diagram"}. Update ${contentRevision}.`
        : `Structural diff updated: ${state.diff.beforeName ?? "before"} to ${state.diff.afterName ?? "after"}. Update ${contentRevision}.`;
    }
    if (contentChanged && hasDiagram) {
      waitForImagesThenFit(contentToken, state.viewKey);
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const commandButton = target.closest<HTMLButtonElement>("button[data-command]");
    if (commandButton && !commandButton.disabled) {
      switch (commandButton.dataset.command) {
        case "set-preview":
          vscode.postMessage({ command: "setMode", mode: "preview" });
          break;
        case "set-diff":
          vscode.postMessage({ command: "setMode", mode: "diff" });
          break;
        case "select-before":
          vscode.postMessage({ command: "selectDiffFile", side: "before" });
          break;
        case "select-after":
          vscode.postMessage({ command: "selectDiffFile", side: "after" });
          break;
        case "swap":
          vscode.postMessage({ command: "swapDiffFiles" });
          break;
        case "refresh":
          vscode.postMessage({ command: "refresh" });
          break;
        case "updates":
          vscode.postMessage({ command: "showUpdates" });
          break;
        case "close":
          vscode.postMessage({ command: "close" });
          break;
      }
      return;
    }

    const viewButton = target.closest<HTMLButtonElement>("button[data-view-command]");
    if (!viewButton) {
      return;
    }
    switch (viewButton.dataset.viewCommand) {
      case "zoom-in":
        zoomAroundViewportCenter(transform.zoom + 0.1);
        break;
      case "zoom-out":
        zoomAroundViewportCenter(transform.zoom - 0.1);
        break;
      case "reset-zoom":
        zoomAroundViewportCenter(1);
        break;
      case "fit":
        fitView();
        break;
    }
  });

  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    fitPending = false;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? viewport.clientHeight
        : 1;
    const nextZoom = transform.zoom * Math.exp(-event.deltaY * deltaScale * 0.002);
    const bounds = viewport.getBoundingClientRect();
    applyTransform(zoomAtPoint(
      transform,
      nextZoom,
      event.clientX - bounds.left,
      event.clientY - bounds.top
    ), false);
    schedulePersistTransform();
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!event.isPrimary || event.button !== 0 || (target instanceof Element && target.closest(".empty-state"))) {
      return;
    }
    fitPending = false;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: transform.panX,
      panY: transform.panY
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("dragging");
    event.preventDefault();
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    applyTransform({
      zoom: transform.zoom,
      panX: drag.panX + event.clientX - drag.startX,
      panY: drag.panY + event.clientY - drag.startY
    }, false);
  });

  function finishDrag(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    drag = undefined;
    viewport.classList.remove("dragging");
    persistTransform();
  }

  viewport.addEventListener("pointerup", finishDrag);
  viewport.addEventListener("pointercancel", finishDrag);
  viewport.addEventListener("lostpointercapture", (event) => {
    if (drag?.pointerId === event.pointerId) {
      drag = undefined;
      viewport.classList.remove("dragging");
      persistTransform();
    }
  });

  viewport.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const panStep = event.shiftKey ? 80 : 32;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        fitPending = false;
        applyTransform({ ...transform, panX: transform.panX + panStep });
        break;
      case "ArrowRight":
        fitPending = false;
        applyTransform({ ...transform, panX: transform.panX - panStep });
        break;
      case "ArrowUp":
        fitPending = false;
        applyTransform({ ...transform, panY: transform.panY + panStep });
        break;
      case "ArrowDown":
        fitPending = false;
        applyTransform({ ...transform, panY: transform.panY - panStep });
        break;
      case "+":
      case "=":
        zoomAroundViewportCenter(transform.zoom + 0.1);
        break;
      case "-":
      case "_":
        zoomAroundViewportCenter(transform.zoom - 0.1);
        break;
      case "0":
        zoomAroundViewportCenter(1);
        break;
      case "f":
      case "F":
        fitView();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  });

  window.addEventListener("message", (event: MessageEvent<PreviewHostMessage>) => {
    const message = event.data;
    if (!message || typeof message !== "object" || !("command" in message)) {
      return;
    }
    switch (message.command) {
      case "state":
        renderState(message.state);
        break;
      case "zoomBy":
        zoomAroundViewportCenter(transform.zoom + message.delta);
        break;
      case "resetZoom":
        zoomAroundViewportCenter(1);
        break;
      case "fit":
        fitView();
        break;
    }
  });

  window.addEventListener("beforeunload", () => {
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
    }
    persistTransform();
    revokeObjectUrls();
  });
  applyTransform(transform, false);
  updateStatus({
    mode: "preview",
    viewKey: "empty",
    preview: { contentRevision: 0, loading: true },
    diff: { contentRevision: 0, loading: false }
  }, false);
  vscode.postMessage({ command: "ready" });
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing preview element #${id}`);
  }
  return element as T;
}

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof acquireVsCodeApi === "function"
) {
  startPreviewWebview();
}
