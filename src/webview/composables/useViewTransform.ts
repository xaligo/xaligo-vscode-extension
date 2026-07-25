import { reactive, type Ref } from "vue";
import {
  clampZoom,
  normalizeViewTransform,
  type ViewTransform,
  zoomAtPoint
} from "../../preview-contract";

const defaultTransform: ViewTransform = { zoom: 1, panX: 24, panY: 24 };

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
}

interface PersistedPreviewState {
  transforms: Record<string, ViewTransform>;
}

interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): void;
}

export function useViewTransform(
  vscode: VsCodeApi<PersistedPreviewState>,
  viewportRef: Ref<HTMLElement | undefined>
) {
  const savedState = vscode.getState();
  const savedTransforms = savedState?.transforms;
  const persisted: PersistedPreviewState = savedTransforms &&
    typeof savedTransforms === "object" &&
    !Array.isArray(savedTransforms)
    ? { transforms: savedTransforms }
    : { transforms: {} };

  const transform = reactive<ViewTransform>({ ...defaultTransform });
  let activeViewKey = "";
  let drag: DragState | undefined;
  let fitPending = false;
  let persistTimer: number | undefined;

  function persistTransform(): void {
    if (!activeViewKey) {
      return;
    }
    persisted.transforms[activeViewKey] = { zoom: transform.zoom, panX: transform.panX, panY: transform.panY };
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
    transform.zoom = clampZoom(next.zoom);
    transform.panX = Number.isFinite(next.panX) ? next.panX : 0;
    transform.panY = Number.isFinite(next.panY) ? next.panY : 0;
    if (persist) {
      persistTransform();
    }
  }

  function zoomAroundViewportCenter(nextZoom: number): void {
    const viewport = viewportRef.value;
    fitPending = false;
    if (!viewport) {
      applyTransform({ ...transform, zoom: nextZoom });
      return;
    }
    applyTransform(zoomAtPoint(transform, nextZoom, viewport.clientWidth / 2, viewport.clientHeight / 2));
  }

  function fitView(stage: HTMLElement | undefined): void {
    const viewport = viewportRef.value;
    if (!viewport || !stage) {
      return;
    }
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

  function fitBounds(x: number, y: number, width: number, height: number): void {
    const viewport = viewportRef.value;
    if (!viewport || width <= 0 || height <= 0) {
      return;
    }
    const inset = 48;
    const availableWidth = Math.max(100, viewport.clientWidth - inset * 2);
    const availableHeight = Math.max(100, viewport.clientHeight - inset * 2);
    const zoom = clampZoom(Math.min(availableWidth / width, availableHeight / height));
    applyTransform({
      zoom,
      panX: (viewport.clientWidth - width * zoom) / 2 - x * zoom,
      panY: (viewport.clientHeight - height * zoom) / 2 - y * zoom
    });
    fitPending = false;
  }

  function restoreForViewKey(viewKey: string): boolean {
    if (activeViewKey === viewKey) {
      return false;
    }
    if (activeViewKey) {
      if (persistTimer !== undefined) {
        window.clearTimeout(persistTimer);
        persistTimer = undefined;
      }
      persistTransform();
    }
    activeViewKey = viewKey;
    const restored = normalizeViewTransform(persisted.transforms[activeViewKey]);
    applyTransform(restored ? { ...restored } : { ...defaultTransform }, false);
    fitPending = !restored;
    return true;
  }

  function isFitPending(): boolean {
    return fitPending;
  }

  function setFitPending(value: boolean): void {
    fitPending = value;
  }

  function handleWheel(event: WheelEvent): void {
    const viewport = viewportRef.value;
    if (!viewport || (!event.ctrlKey && !event.metaKey)) {
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
    applyTransform(zoomAtPoint(transform, nextZoom, event.clientX - bounds.left, event.clientY - bounds.top), false);
    schedulePersistTransform();
  }

  function handlePointerDown(event: PointerEvent): void {
    const viewport = viewportRef.value;
    const target = event.target;
    if (!viewport || !event.isPrimary || event.button !== 0 || (target instanceof Element && target.closest(".empty-state"))) {
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
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    applyTransform({
      zoom: transform.zoom,
      panX: drag.panX + event.clientX - drag.startX,
      panY: drag.panY + event.clientY - drag.startY
    }, false);
  }

  function finishDrag(event: PointerEvent): void {
    const viewport = viewportRef.value;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    drag = undefined;
    viewport?.classList.remove("dragging");
    persistTransform();
  }

  function handleKeydown(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    const panStep = event.shiftKey ? 80 : 32;
    switch (event.key) {
      case "ArrowLeft":
        fitPending = false;
        applyTransform({ ...transform, panX: transform.panX + panStep });
        return true;
      case "ArrowRight":
        fitPending = false;
        applyTransform({ ...transform, panX: transform.panX - panStep });
        return true;
      case "ArrowUp":
        fitPending = false;
        applyTransform({ ...transform, panY: transform.panY + panStep });
        return true;
      case "ArrowDown":
        fitPending = false;
        applyTransform({ ...transform, panY: transform.panY - panStep });
        return true;
      case "+":
      case "=":
        zoomAroundViewportCenter(transform.zoom + 0.1);
        return true;
      case "-":
      case "_":
        zoomAroundViewportCenter(transform.zoom - 0.1);
        return true;
      case "0":
        zoomAroundViewportCenter(1);
        return true;
      case "f":
      case "F":
        return false;
      default:
        return false;
    }
  }

  function flushBeforeUnload(): void {
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
    }
    persistTransform();
  }

  return {
    transform,
    applyTransform,
    zoomAroundViewportCenter,
    fitView,
    fitBounds,
    restoreForViewKey,
    isFitPending,
    setFitPending,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    finishDrag,
    handleKeydown,
    flushBeforeUnload
  };
}
