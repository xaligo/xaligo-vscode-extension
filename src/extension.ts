import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { XaligoPreviewController } from "./preview";
import { XaligoRuntimeResolver } from "./runtime-resolver";
import { XaligoUpdates } from "./updates";
import {
  type ExportFormat,
  exportFormats,
  replaceExtension,
  XaligoRenderer
} from "./xaligo";

const previewCommand = "xaligo.openPreview";
const diffPreviewCommand = "xaligo.openDiffPreview";
const previewZoomInCommand = "xaligo.preview.zoomIn";
const previewZoomOutCommand = "xaligo.preview.zoomOut";
const previewResetZoomCommand = "xaligo.preview.resetZoom";
const previewResetViewCommand = "xaligo.preview.resetView";
const previewCloseCommand = "xaligo.preview.close";
const exportSvgCommand = "xaligo.exportSvg";
const exportPptxCommand = "xaligo.exportPptx";
const exportExcalidrawCommand = "xaligo.exportExcalidraw";
const selectFileIconThemeCommand = "xaligo.selectFileIconTheme";
const showUpdatesCommand = "xaligo.showUpdates";
const updateRuntimeCommand = "xaligo.updateRuntime";
const updateExtensionCommand = "xaligo.updateExtension";
const fileIconThemePromptStateKey = "xaligo.fileIconThemePromptDismissed";
const tagNamePattern = /<\/?([a-z][a-z0-9-]*)\b/g;
const commentPattern = /<!--[\s\S]*?-->/g;

const tagColors: Record<string, string> = {
  frames: "#fb7185",
  frame: "#ff6b6b",
  container: "#f59e0b",
  row: "#facc15",
  col: "#84cc16",
  rectangle: "#e879f9",
  port: "#c084fc",
  "aws-account": "#ec4899",
  "aws-cloud": "#38bdf8",
  "aws-cloud-alt": "#22d3ee",
  region: "#06b6d4",
  "availability-zone": "#14b8a6",
  vpc: "#8b5cf6",
  "public-subnet": "#22c55e",
  "private-subnet": "#10b981",
  "security-group": "#ef4444",
  "auto-scaling-group": "#f97316",
  "server-contents": "#94a3b8",
  "corporate-data-center": "#64748b",
  "ec2-instance-contents": "#fb923c",
  "spot-fleet": "#fdba74",
  "aws-iot-greengrass-deployment": "#4ade80",
  "aws-iot-greengrass": "#86efac",
  "elastic-beanstalk-container": "#c084fc",
  "aws-step-functions-workflow": "#f472b6",
  "generic-group": "#a78bfa",
  item: "#60a5fa",
  spacer: "#a3e635",
  blank: "#bef264",
  connections: "#fb7185",
  connection: "#f43f5e",
  src: "#fda4af",
  dst: "#fda4af",
  bend: "#fbbf24",
  point: "#fbbf24",
  via: "#fbbf24",
  waypoint: "#fbbf24",
  bends: "#fcd34d",
  points: "#fcd34d",
  path: "#fcd34d"
};

export function activate(context: vscode.ExtensionContext): void {
  const runtimeResolver = new XaligoRuntimeResolver(context);
  const renderer = new XaligoRenderer(runtimeResolver);
  const updates = new XaligoUpdates(context, runtimeResolver);
  const previewController = new XaligoPreviewController(
    context,
    renderer,
    () => updates.showMenu()
  );

  context.subscriptions.push(new XaligoTagColorController());
  context.subscriptions.push(previewController);
  context.subscriptions.push(vscode.commands.registerCommand(previewCommand, () => {
    void previewController.openPreview(vscode.window.activeTextEditor?.document);
  }));
  context.subscriptions.push(vscode.commands.registerCommand(diffPreviewCommand, () => {
    void previewController.openDiffPreview();
  }));
  context.subscriptions.push(vscode.commands.registerCommand(previewZoomInCommand, () => {
    previewController.zoomBy(0.1);
  }));
  context.subscriptions.push(vscode.commands.registerCommand(previewZoomOutCommand, () => {
    previewController.zoomBy(-0.1);
  }));
  context.subscriptions.push(vscode.commands.registerCommand(previewResetZoomCommand, () => {
    previewController.resetZoom();
  }));
  context.subscriptions.push(vscode.commands.registerCommand(previewResetViewCommand, () => {
    previewController.resetView();
  }));
  context.subscriptions.push(vscode.commands.registerCommand(previewCloseCommand, () => {
    previewController.closePreview();
  }));
  context.subscriptions.push(vscode.commands.registerCommand(exportSvgCommand, () => {
    void exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.svg);
  }));
  context.subscriptions.push(vscode.commands.registerCommand(exportPptxCommand, () => {
    void exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.pptx);
  }));
  context.subscriptions.push(vscode.commands.registerCommand(exportExcalidrawCommand, () => {
    void exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.excalidraw);
  }));
  context.subscriptions.push(vscode.commands.registerCommand(selectFileIconThemeCommand, () => {
    void vscode.commands.executeCommand("workbench.action.selectIconTheme");
  }));
  context.subscriptions.push(vscode.commands.registerCommand(
    showUpdatesCommand,
    () => updates.showMenu()
  ));
  context.subscriptions.push(vscode.commands.registerCommand(
    updateRuntimeCommand,
    () => updates.updateRuntime()
  ));
  context.subscriptions.push(vscode.commands.registerCommand(
    updateExtensionCommand,
    () => updates.updateExtension()
  ));

  void showFileIconThemeHint(context);
}

export function deactivate(): void {}

class XaligoTagColorController implements vscode.Disposable {
  private readonly decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private updateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateEditor(editor)),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.updateEditor(editor);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === event.document) {
            this.scheduleUpdate(editor);
          }
        }
      })
    );

    for (const editor of vscode.window.visibleTextEditors) {
      this.updateEditor(editor);
    }
  }

  dispose(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const decorationType of this.decorationTypes.values()) {
      decorationType.dispose();
    }
  }

  private scheduleUpdate(editor: vscode.TextEditor): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => this.updateEditor(editor), 80);
  }

  private updateEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== "xal") {
      return;
    }

    const text = editor.document.getText();
    const commentRanges = getCommentRanges(text);
    const rangesByTag = new Map<string, vscode.Range[]>();
    for (const match of text.matchAll(tagNamePattern)) {
      const matchIndex = match.index ?? 0;
      if (isInsideRanges(matchIndex, commentRanges)) {
        continue;
      }

      const tagName = match[1];
      const tagNameStart = matchIndex + (match[0].startsWith("</") ? 2 : 1);
      const ranges = rangesByTag.get(tagName) ?? [];
      ranges.push(new vscode.Range(
        editor.document.positionAt(tagNameStart),
        editor.document.positionAt(tagNameStart + tagName.length)
      ));
      rangesByTag.set(tagName, ranges);
    }

    for (const [tagName, ranges] of rangesByTag) {
      editor.setDecorations(this.getDecorationType(tagName), ranges);
    }
    for (const [tagName, decorationType] of this.decorationTypes) {
      if (!rangesByTag.has(tagName)) {
        editor.setDecorations(decorationType, []);
      }
    }
  }

  private getDecorationType(tagName: string): vscode.TextEditorDecorationType {
    const existing = this.decorationTypes.get(tagName);
    if (existing) {
      return existing;
    }

    const decorationType = vscode.window.createTextEditorDecorationType({
      color: tagColors[tagName] ?? colorForUnknownTag(tagName),
      fontWeight: "700",
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    this.decorationTypes.set(tagName, decorationType);
    return decorationType;
  }
}

async function exportDocument(
  renderer: XaligoRenderer,
  document: vscode.TextDocument | undefined,
  exportFormat: ExportFormat
): Promise<void> {
  if (!document || document.languageId !== "xal") {
    vscode.window.showWarningMessage(`Open a .xal file before exporting ${exportFormat.label}.`);
    return;
  }
  if (document.uri.scheme !== "file") {
    vscode.window.showWarningMessage(`Save the .xal file to disk before exporting ${exportFormat.label}.`);
    return;
  }
  if (document.isDirty && !await document.save()) {
    vscode.window.showWarningMessage(`Save the .xal file before exporting ${exportFormat.label}.`);
    return;
  }

  const sourcePath = document.uri.fsPath;
  const outputUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(replaceExtension(sourcePath, exportFormat.extension)),
    filters: { [exportFormat.label]: [exportFormat.extension] },
    saveLabel: "Export",
    title: exportFormat.title
  });
  if (!outputUri) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${exportFormat.label}`,
      cancellable: false
    },
    async () => {
      try {
        await fs.mkdir(path.dirname(outputUri.fsPath), { recursive: true });
        await renderer.export(sourcePath, outputUri.fsPath, exportFormat);
        vscode.window.showInformationMessage(`Exported ${exportFormat.label}: ${outputUri.fsPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to export ${exportFormat.label}: ${message}`);
      }
    }
  );
}

function getCommentRanges(text: string): Array<[number, number]> {
  return Array.from(text.matchAll(commentPattern), (match) => {
    const start = match.index ?? 0;
    return [start, start + match[0].length];
  });
}

function isInsideRanges(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function colorForUnknownTag(tagName: string): string {
  const hue = stableHash(tagName) % 360;
  return `hsl(${hue}, 78%, 64%)`;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

async function showFileIconThemeHint(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(fileIconThemePromptStateKey)) {
    return;
  }

  const activeIconTheme = vscode.workspace.getConfiguration("workbench").get<string>("iconTheme");
  if (activeIconTheme === "xaligo-icons") {
    await context.globalState.update(fileIconThemePromptStateKey, true);
    return;
  }

  const selection = await vscode.window.showInformationMessage(
    "xaligo includes a .xal file icon. Some file icon themes override language icons, so select the bundled xaligo theme if the icon does not appear.",
    "Select Theme",
    "Not Now"
  );
  if (selection === "Select Theme") {
    await vscode.commands.executeCommand("workbench.action.selectIconTheme");
  }
  await context.globalState.update(fileIconThemePromptStateKey, true);
}
