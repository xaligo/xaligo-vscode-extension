import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { formatCommandArgument, parseCommandArguments } from "./cli-input";
import { createXaligoLogger, xaligoLogger } from "./logger";
import { XaligoPreviewController } from "./preview";
import type { CliFeature } from "./preview-contract";
import { XaligoRuntimeResolver } from "./runtime-resolver";
import { XaligoUpdates } from "./updates";
import { buildGenerateXalArguments, isMarkdownFilePath } from "./xaligo-command";
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
const exportPdfCommand = "xaligo.exportPdf";
const exportExcelCommand = "xaligo.exportExcel";
const exportXyflowCommand = "xaligo.exportXyflow";
const exportIsoflowCommand = "xaligo.exportIsoflow";
const validateCommand = "xaligo.validate";
const showVersionCommand = "xaligo.showVersion";
const runCliCommand = "xaligo.runCliCommand";
const showUpdatesCommand = "xaligo.showUpdates";
const updateRuntimeCommand = "xaligo.updateRuntime";
const updateExtensionCommand = "xaligo.updateExtension";
const showOutputChannelCommand = "xaligo.showOutputChannel";
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
  const logger = createXaligoLogger();
  context.subscriptions.push(logger);
  logger.info(`activating xaligo ${context.extension.packageJSON.version} (${context.extensionMode === vscode.ExtensionMode.Development ? "development" : "production"} mode)`);

  const runtimeResolver = new XaligoRuntimeResolver(context);
  const renderer = new XaligoRenderer(runtimeResolver);
  const updates = new XaligoUpdates(context, runtimeResolver);
  const previewController = new XaligoPreviewController(
    context,
    renderer,
    () => updates.showMenu(),
    async (feature, sourceUri) => {
      const document = sourceUri
        ? await vscode.workspace.openTextDocument(sourceUri)
        : vscode.window.activeTextEditor?.document;
      await runCliFeature(renderer, document, feature);
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
  context.subscriptions.push(previewController);
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
  registerAsyncCommand(exportExcalidrawCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.excalidraw)
  ));
  registerAsyncCommand(exportPdfCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.pdf)
  ));
  registerAsyncCommand(exportExcelCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.excel)
  ));
  registerAsyncCommand(exportXyflowCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.xyflow)
  ));
  registerAsyncCommand(exportIsoflowCommand, () => (
    exportDocument(renderer, vscode.window.activeTextEditor?.document, exportFormats.isoflow)
  ));
  registerAsyncCommand(validateCommand, () => (
    validateDocument(renderer, vscode.window.activeTextEditor?.document)
  ));
  registerAsyncCommand(showVersionCommand, () => showRuntimeVersion(renderer));
  registerAsyncCommand(runCliCommand, () => {
    const document = vscode.window.activeTextEditor?.document;
    return runCliFeature(
      renderer,
      document,
      undefined,
      () => previewController.openMarkdownPreview(document)
    );
  });
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

async function runCliFeature(
  renderer: XaligoRenderer,
  document: vscode.TextDocument | undefined,
  feature?: CliFeature,
  openMarkdownPreview?: () => Promise<void>
): Promise<void> {
  const sourcePath = document?.uri.scheme === "file" ? document.uri.fsPath : "";
  const directExports: Partial<Record<CliFeature, ExportFormat>> = {
    "export-svg": exportFormats.svg,
    "export-pptx": exportFormats.pptx,
    "export-excalidraw": exportFormats.excalidraw,
    "export-pdf": exportFormats.pdf,
    "export-excel": exportFormats.excel,
    "export-xyflow": exportFormats.xyflow,
    "export-isoflow": exportFormats.isoflow
  };
  const directExport = feature ? directExports[feature] : undefined;
  if (directExport) {
    await exportDocument(renderer, document, directExport);
    return;
  }
  if (feature === "validate") {
    await validateDocument(renderer, document);
    return;
  }
  if (feature === "version") {
    await showRuntimeVersion(renderer);
    return;
  }

  const featureItems: Partial<Record<CliFeature, vscode.QuickPickItem & {
    feature: CliFeature;
    args: string[];
  }>> = {
    "preview-markdown": {
      feature: "preview-markdown",
      label: "Preview Markdown",
      description: "serve Markdown",
      args: ["serve"]
    },
    serve: {
      feature: "serve",
      label: "Serve live preview",
      description: "serve",
      args: ["serve"]
    },
    "render-markdown": {
      feature: "render-markdown",
      label: "Render Markdown",
      description: "render markdown",
      args: ["render", "markdown"]
    },
    "generate-xal": {
      feature: "generate-xal",
      label: "Generate xal source",
      description: "generate xal",
      args: ["generate", "xal"]
    },
    "add-service": {
      feature: "add-service",
      label: "Add one service to Excalidraw",
      description: "add service --name",
      args: ["add", "service"]
    },
    "add-services": {
      feature: "add-services",
      label: "Add services from CSV to Excalidraw",
      description: "add service --list",
      args: ["add", "service"]
    },
    init: {
      feature: "init",
      label: "Initialize sample project",
      description: "init",
      args: ["init"]
    },
    help: {
      feature: "help",
      label: "Show CLI help",
      description: "help",
      args: ["help"]
    },
    "completion-bash": {
      feature: "completion-bash",
      label: "Generate Bash completion",
      description: "completion bash",
      args: ["completion", "bash"]
    },
    "completion-fish": {
      feature: "completion-fish",
      label: "Generate Fish completion",
      description: "completion fish",
      args: ["completion", "fish"]
    },
    "completion-powershell": {
      feature: "completion-powershell",
      label: "Generate PowerShell completion",
      description: "completion powershell",
      args: ["completion", "powershell"]
    },
    "completion-zsh": {
      feature: "completion-zsh",
      label: "Generate Zsh completion",
      description: "completion zsh",
      args: ["completion", "zsh"]
    },
    custom: {
      feature: "custom",
      label: "Custom CLI arguments…",
      description: "Every xaligo CLI command and flag",
      args: []
    }
  };
  const items = Object.values(featureItems);
  const selected = feature
    ? featureItems[feature]
    : await vscode.window.showQuickPick(items, {
      placeHolder: "Select a xaligo CLI feature"
    });
  if (!selected) {
    return;
  }
  if (selected.feature === "preview-markdown") {
    if (openMarkdownPreview) {
      await openMarkdownPreview();
    } else {
      vscode.window.showWarningMessage(
        "Use xaligo: Open Preview to show Markdown in the xaligo preview panel."
      );
    }
    return;
  }
  if (
    (selected.feature === "serve" || selected.feature === "render-markdown") &&
    document?.uri.scheme === "file" &&
    document.isDirty &&
    !await document.save()
  ) {
    vscode.window.showWarningMessage("Save the selected document before running xaligo.");
    return;
  }
  const preparedArgs = await prepareCliFeatureArguments(
    selected.feature,
    selected.args,
    sourcePath
  );
  if (!preparedArgs) {
    return;
  }
  const input = await vscode.window.showInputBox({
    prompt: "Review or add any CLI flags, then press Enter to run in a terminal",
    placeHolder: "render diagram.xal --format svg -o diagram.svg",
    value: preparedArgs.map(formatCommandArgument).join(" ")
  });
  if (!input) {
    return;
  }
  let args: string[];
  try {
    args = parseCommandArguments(input);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return;
  }
  await launchCliTerminal(renderer, args, sourcePath);
}

async function launchCliTerminal(
  renderer: XaligoRenderer,
  args: string[],
  sourcePath: string
): Promise<vscode.Terminal> {
  const launch = await renderer.terminalLaunch(args);
  const terminal = vscode.window.createTerminal({
    name: `xaligo ${args[0] ?? ""}`.trim(),
    shellPath: launch.binary,
    shellArgs: launch.args,
    env: launch.env,
    cwd: sourcePath ? path.dirname(sourcePath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  });
  terminal.show();
  return terminal;
}

async function prepareCliFeatureArguments(
  feature: CliFeature,
  baseArgs: string[],
  sourcePath: string
): Promise<string[] | undefined> {
  const defaultUri = vscode.Uri.file(cliWorkingDirectory(sourcePath));
  if (feature === "serve") {
    const extension = path.extname(sourcePath).toLowerCase();
    const serveSource = [".xal", ".md", ".markdown"].includes(extension)
      ? sourcePath
      : await selectCliFile(
        "Select a .xal or Markdown file to serve",
        { "xaligo or Markdown": ["xal", "md", "markdown"] },
        defaultUri
      );
    return serveSource ? [...baseArgs, serveSource] : undefined;
  }
  if (feature === "render-markdown") {
    const markdownPath = isMarkdownFilePath(sourcePath)
      ? sourcePath
      : await selectCliFile(
        "Select Markdown to render",
        { Markdown: ["md", "markdown"] },
        defaultUri
      );
    if (!markdownPath) {
      return undefined;
    }
    const parsed = path.parse(markdownPath);
    const outputUri = await vscode.window.showSaveDialog({
      title: "Export rendered Markdown",
      defaultUri: vscode.Uri.file(path.join(
        parsed.dir,
        `${parsed.name}.embedded${parsed.ext || ".md"}`
      )),
      filters: { Markdown: ["md", "markdown"] },
      saveLabel: "Export"
    });
    return outputUri
      ? [...baseArgs, markdownPath, "--output", outputUri.fsPath]
      : undefined;
  }
  if (feature === "generate-xal") {
    const outputUri = await vscode.window.showSaveDialog({
      title: "Generate xal source",
      defaultUri: vscode.Uri.file(path.join(cliWorkingDirectory(sourcePath), "architecture.xal")),
      filters: { xaligo: ["xal"] },
      saveLabel: "Generate"
    });
    return outputUri ? buildGenerateXalArguments(outputUri.fsPath) : undefined;
  }
  if (feature === "add-service" || feature === "add-services") {
    const targetPath = await selectCliFile(
      "Select the Excalidraw file to update",
      { Excalidraw: ["excalidraw"] },
      defaultUri
    );
    if (!targetPath) {
      return undefined;
    }
    if (feature === "add-service") {
      const serviceName = await vscode.window.showInputBox({
        title: "Add service to Excalidraw",
        prompt: "Enter an AWS service name",
        placeHolder: "Amazon EC2",
        ignoreFocusOut: true
      });
      return serviceName?.trim()
        ? [...baseArgs, "--name", serviceName.trim(), "--file", targetPath]
        : undefined;
    }
    const listPath = await selectCliFile(
      "Select the service list",
      { CSV: ["csv"] },
      vscode.Uri.file(path.dirname(targetPath))
    );
    return listPath
      ? [...baseArgs, "--list", listPath, "--file", targetPath]
      : undefined;
  }
  if (feature === "init") {
    const selectedFolders = await vscode.window.showOpenDialog({
      title: "Select the folder to initialize",
      defaultUri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Initialize here"
    });
    return selectedFolders?.[0]
      ? [...baseArgs, "--output", selectedFolders[0].fsPath]
      : undefined;
  }
  return [...baseArgs];
}

async function selectCliFile(
  title: string,
  filters: Record<string, string[]>,
  defaultUri: vscode.Uri
): Promise<string | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title,
    defaultUri,
    filters,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Select"
  });
  return selected?.[0]?.fsPath;
}

function cliWorkingDirectory(sourcePath: string): string {
  if (sourcePath) {
    return path.dirname(sourcePath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
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
