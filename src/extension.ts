import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { XaligoLanguageServer } from "./language-server";
import { createXaligoLogger, xaligoLogger } from "./logger";
import { XaligoPreviewController } from "./preview";
import type { PreviewAction } from "./preview-contract";
import { XaligoRuntimeResolver } from "./runtime-resolver";
import { XaligoUpdates } from "./updates";
import { isMarkdownFilePath } from "./xaligo-command";
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
const validateCommand = "xaligo.validate";
const showVersionCommand = "xaligo.showVersion";
const showUpdatesCommand = "xaligo.showUpdates";
const updateRuntimeCommand = "xaligo.updateRuntime";
const updateExtensionCommand = "xaligo.updateExtension";
const showOutputChannelCommand = "xaligo.showOutputChannel";
const tagNamePattern = /<\/?([a-z][a-z0-9-]*)\b/g;
const commentPattern = /<!--[\s\S]*?-->/g;

const tagColors: Record<string, string> = {
  scene: "#fb7185",
  capture: "#f97316",
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
  path: "#fcd34d",
  line: "#f43f5e",
  route: "#fb7185",
  traffic: "#38bdf8",
  label: "#fbbf24"
};

export function activate(context: vscode.ExtensionContext): void {
  const logger = createXaligoLogger();
  context.subscriptions.push(logger);
  logger.info(`activating xaligo ${context.extension.packageJSON.version} (${context.extensionMode === vscode.ExtensionMode.Development ? "development" : "production"} mode)`);

  const runtimeResolver = new XaligoRuntimeResolver(context);
  const renderer = new XaligoRenderer(runtimeResolver);
  const languageServer = new XaligoLanguageServer(runtimeResolver);
  const updates = new XaligoUpdates(context, runtimeResolver);
  const previewController = new XaligoPreviewController(
    context,
    renderer,
    () => updates.showMenu(),
    async (action, sourceUri) => {
      const document = sourceUri
        ? await vscode.workspace.openTextDocument(sourceUri)
        : vscode.window.activeTextEditor?.document;
      await runPreviewAction(renderer, document, action);
    }
  );
  const registerAsyncCommand = (
    command: string,
    action: () => Promise<unknown>
  ) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, () => (
      action().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`${command} failed: ${message}`);
        return vscode.window.showErrorMessage(`xaligo command failed: ${message}`);
      })
    )));
  };

  context.subscriptions.push(new XaligoTagColorController());
  context.subscriptions.push(languageServer);
  context.subscriptions.push(previewController);
  languageServer.start();
  registerAsyncCommand(previewCommand, () => (
    openPreviewForDocument(
      previewController,
      vscode.window.activeTextEditor?.document
    )
  ));
  registerAsyncCommand(diffPreviewCommand, () => previewController.openDiffPreview());
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
  registerAsyncCommand(exportSvgCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.svg)
  ));
  registerAsyncCommand(exportPptxCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.pptx)
  ));
  registerAsyncCommand(validateCommand, () => (
    validateDocument(renderer, vscode.window.activeTextEditor?.document)
  ));
  registerAsyncCommand(showVersionCommand, () => showRuntimeVersion(renderer));
  registerAsyncCommand(showUpdatesCommand, () => updates.showMenu());
  registerAsyncCommand(updateRuntimeCommand, () => updates.updateRuntime());
  registerAsyncCommand(updateExtensionCommand, () => updates.updateExtension());
  context.subscriptions.push(vscode.commands.registerCommand(showOutputChannelCommand, () => {
    logger.show();
  }));

}

export function deactivate(): void {}

class XaligoTagColorController implements vscode.Disposable {
  private readonly decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly updateTimers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();

  constructor() {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateEditor(editor)),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        const visible = new Set(editors);
        for (const [editor, timer] of this.updateTimers) {
          if (!visible.has(editor)) {
            clearTimeout(timer);
            this.updateTimers.delete(editor);
          }
        }
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
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer);
    }
    this.updateTimers.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const decorationType of this.decorationTypes.values()) {
      decorationType.dispose();
    }
  }

  private scheduleUpdate(editor: vscode.TextEditor): void {
    const existing = this.updateTimers.get(editor);
    if (existing) {
      clearTimeout(existing);
    }
    this.updateTimers.set(editor, setTimeout(() => {
      this.updateTimers.delete(editor);
      this.updateEditor(editor);
    }, 80));
  }

  private updateEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      return;
    }
    if (editor.document.languageId !== "xal") {
      for (const decorationType of this.decorationTypes.values()) {
        editor.setDecorations(decorationType, []);
      }
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
      cancellable: true
    },
    async (_progress, token) => {
      const abortController = new AbortController();
      const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());
      try {
        await fs.mkdir(path.dirname(outputUri.fsPath), { recursive: true });
        const result = await renderer.export(
          sourcePath,
          outputUri.fsPath,
          exportFormat,
          abortController.signal
        );
        const destination = result.outputPaths.length === 1
          ? result.outputPaths[0]
          : `${result.outputPaths.length} files in ${path.dirname(result.outputPaths[0])}: ` +
            result.outputPaths.map((outputPath) => path.basename(outputPath)).join(", ");
        xaligoLogger().info(
          `exported ${exportFormat.label}:\n${result.outputPaths.join("\n")}`
        );
        const warningSuffix = result.warnings.length > 0
          ? " Completed with warnings; see the xaligo output channel."
          : "";
        vscode.window.showInformationMessage(
          `Exported ${exportFormat.label}: ${destination}.${warningSuffix}`
        );
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to export ${exportFormat.label}: ${message}`);
      } finally {
        cancellationSubscription.dispose();
      }
    }
  );
}

async function validateDocument(
  renderer: XaligoRenderer,
  document: vscode.TextDocument | undefined
): Promise<void> {
  if (!document || document.languageId !== "xal" || document.uri.scheme !== "file") {
    vscode.window.showWarningMessage("Open a saved .xal file before validating.");
    return;
  }
  if (document.isDirty && !await document.save()) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Validating xaligo diagram" },
    async () => {
      try {
        const result = await renderer.execute(["validate", document.uri.fsPath]);
        const warningSuffix = result.warnings.length > 0
          ? " (with warnings; see the xaligo output channel)"
          : "";
        vscode.window.showInformationMessage(
          `Valid: ${path.basename(document.uri.fsPath)}${warningSuffix}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

async function openPreviewForDocument(
  previewController: XaligoPreviewController,
  document: vscode.TextDocument | undefined
): Promise<void> {
  if (isFileMarkdownDocument(document)) {
    await previewController.openMarkdownPreview(document);
    return;
  }
  await previewController.openPreview(document);
}

async function showRuntimeVersion(renderer: XaligoRenderer): Promise<void> {
  try {
    const result = await renderer.execute(["version"]);
    vscode.window.showInformationMessage(`xaligo ${result.stdout.trim()}`);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function runPreviewAction(
  renderer: XaligoRenderer,
  document: vscode.TextDocument | undefined,
  action: PreviewAction
): Promise<void> {
  switch (action) {
    case "export-svg":
      await exportDocument(renderer, document, exportFormats.svg);
      break;
    case "export-pptx":
      await exportDocument(renderer, document, exportFormats.pptx);
      break;
    case "validate":
      await validateDocument(renderer, document);
      break;
    case "render-markdown":
      await exportMarkdownDocument(renderer, document);
      break;
    case "preview-markdown":
      break;
  }
}

async function exportMarkdownDocument(
  renderer: XaligoRenderer,
  document: vscode.TextDocument | undefined
): Promise<void> {
  if (!isFileMarkdownDocument(document)) {
    vscode.window.showWarningMessage("Open a saved Markdown file before exporting it.");
    return;
  }
  if (document.isDirty && !await document.save()) {
    return;
  }

  const sourcePath = document.uri.fsPath;
  const parsedSource = path.parse(sourcePath);
  const outputUri = await vscode.window.showSaveDialog({
    title: "Export rendered Markdown",
    defaultUri: vscode.Uri.file(path.join(
      parsedSource.dir,
      `${parsedSource.name}.embedded${parsedSource.ext || ".md"}`
    )),
    filters: { Markdown: ["md", "markdown"] },
    saveLabel: "Export"
  });
  if (!outputUri) {
    return;
  }

  const outputPath = outputUri.fsPath;
  const parsedOutput = path.parse(outputPath);
  const svgDirectory = path.join(parsedOutput.dir, `${parsedOutput.name}.assets`);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Exporting rendered Markdown",
      cancellable: true
    },
    async (_progress, token) => {
      const abortController = new AbortController();
      const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());
      try {
        await fs.mkdir(svgDirectory, { recursive: true });
        const result = await renderer.renderMarkdown(
          sourcePath,
          outputPath,
          svgDirectory,
          abortController.signal
        );
        const output = await fs.stat(outputPath).catch(() => undefined);
        if (!output?.isFile()) {
          throw new Error("xaligo did not generate the rendered Markdown output.");
        }
        const warningSuffix = result.warnings.length > 0
          ? " Completed with warnings; see the xaligo output channel."
          : "";
        xaligoLogger().info(`exported rendered Markdown: ${outputPath}`);
        vscode.window.showInformationMessage(
          `Exported rendered Markdown: ${outputPath}.${warningSuffix}`
        );
      } catch (error) {
        if (abortController.signal.aborted || isAbortError(error)) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to export rendered Markdown: ${message}`);
      } finally {
        cancellationSubscription.dispose();
      }
    }
  );
}

function isFileMarkdownDocument(
  document: vscode.TextDocument | undefined
): document is vscode.TextDocument {
  return Boolean(
    document &&
    document.uri.scheme === "file" &&
    isMarkdownFilePath(document.uri.fsPath)
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "AbortError" ||
    ("code" in error && error.code === "ABORT_ERR")
  );
}
