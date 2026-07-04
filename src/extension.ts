import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

const xaligoPackageName = "@xaligo/xaligo";
const xaligoPackageSpec = `${xaligoPackageName}@^0.1.3`;
const installStateKey = "xaligo.packageInstallSpec";
const previewCommand = "xaligo.openPreview";
const previewZoomInCommand = "xaligo.preview.zoomIn";
const previewZoomOutCommand = "xaligo.preview.zoomOut";
const previewResetZoomCommand = "xaligo.preview.resetZoom";
const previewResetViewCommand = "xaligo.preview.resetView";
const previewCloseCommand = "xaligo.preview.close";
const selectFileIconThemeCommand = "xaligo.selectFileIconTheme";
const fileIconThemePromptStateKey = "xaligo.fileIconThemePromptDismissed";
const tagNamePattern = /<\/?([a-z][a-z0-9-]*)\b/g;
const commentPattern = /<!--[\s\S]*?-->/g;

const tagColors: Record<string, string> = {
  "frame": "#ff6b6b",
  "container": "#f59e0b",
  "row": "#facc15",
  "col": "#84cc16",
  "aws-account": "#ec4899",
  "aws-cloud": "#38bdf8",
  "aws-cloud-alt": "#22d3ee",
  "region": "#06b6d4",
  "availability-zone": "#14b8a6",
  "vpc": "#8b5cf6",
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
  "item": "#60a5fa",
  "spacer": "#a3e635",
  "blank": "#bef264",
  "connection": "#f43f5e"
};

export function activate(context: vscode.ExtensionContext): void {
  const installPromise = ensureXaligoPackageInstalled(context);
  const previewController = new XaligoPreviewController(context, installPromise);

  context.subscriptions.push(new XaligoTagColorController());
  context.subscriptions.push(previewController);
  context.subscriptions.push(vscode.commands.registerCommand(previewCommand, () => {
    void previewController.openPreview(vscode.window.activeTextEditor?.document);
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
  context.subscriptions.push(vscode.commands.registerCommand(selectFileIconThemeCommand, () => {
    void vscode.commands.executeCommand("workbench.action.selectIconTheme");
  }));

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
      const tagNameEnd = tagNameStart + tagName.length;
      const ranges = rangesByTag.get(tagName) ?? [];
      ranges.push(new vscode.Range(
        editor.document.positionAt(tagNameStart),
        editor.document.positionAt(tagNameEnd)
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

class XaligoPreviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private sourceUri: vscode.Uri | undefined;
  private lastContent: string | undefined;
  private lastError: string | undefined;
  private zoom = 1;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly installPromise: Promise<void>
  ) {
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
      if (this.sourceUri?.toString() === document.uri.toString()) {
        void this.render(document);
      }
    }));
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.panel?.dispose();
  }

  zoomBy(delta: number): void {
    if (!this.panel) {
      return;
    }

    this.zoom = clampZoom(this.zoom + delta);
    this.updatePanelHtml();
  }

  resetZoom(): void {
    if (!this.panel) {
      return;
    }

    this.zoom = 1;
    this.updatePanelHtml();
  }

  resetView(): void {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage({ command: "fitWidth" });
  }

  closePreview(): void {
    this.panel?.dispose();
  }

  async openPreview(document: vscode.TextDocument | undefined): Promise<void> {
    if (!document || document.languageId !== "xal") {
      vscode.window.showWarningMessage("Open a .xal file before starting preview.");
      return;
    }

    if (document.uri.scheme !== "file") {
      vscode.window.showWarningMessage("Save the .xal file to disk before starting preview.");
      return;
    }

    this.sourceUri = document.uri;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "xaligoPreview",
        `Preview: ${path.basename(document.uri.fsPath)}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.panel.webview.onDidReceiveMessage((message: PreviewMessage) => {
        if (message.command === "close") {
          this.closePreview();
          return;
        }

        if (message.command === "zoom" && typeof message.zoom === "number") {
          this.zoom = clampZoom(message.zoom);
          this.updatePanelHtml();
        }
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.sourceUri = undefined;
        this.lastContent = undefined;
        this.lastError = undefined;
      });
    } else {
      this.panel.title = `Preview: ${path.basename(document.uri.fsPath)}`;
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.lastContent = undefined;
    this.lastError = undefined;
    this.updatePanelHtml();
    await this.render(document);
  }

  private async render(document: vscode.TextDocument): Promise<void> {
    if (!this.panel || document.uri.scheme !== "file") {
      return;
    }

    try {
      await this.installPromise;
      const packageRoot = await this.findXaligoPackageRoot();
      const binary = xaligoNativeBinaryPath(packageRoot);
      if (!await exists(binary)) {
        throw new Error(`xaligo native binary was not found: ${binary}`);
      }

      const outputPath = await this.previewOutputPath(document.uri);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const servicesPath = await findNearestServicesCsv(document.uri.fsPath);
      await runXaligoRender(binary, packageRoot, document.uri.fsPath, outputPath, servicesPath);
      this.lastContent = await fs.readFile(outputPath, "utf8");
      this.lastError = undefined;
      this.updatePanelHtml();
    } catch (error) {
      this.lastContent = undefined;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.updatePanelHtml();
    }
  }

  private updatePanelHtml(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.html = previewHtml({
      content: this.lastContent,
      error: this.lastError,
      zoom: this.zoom
    });
  }

  private async findXaligoPackageRoot(): Promise<string> {
    const installedRoot = path.join(
      this.context.globalStorageUri.fsPath,
      "npm",
      "node_modules",
      "@xaligo",
      "xaligo"
    );
    if (await exists(path.join(installedRoot, "package.json"))) {
      return installedRoot;
    }

    const developmentRoot = path.join(this.context.extensionPath, "node_modules", "@xaligo", "xaligo");
    if (await exists(path.join(developmentRoot, "package.json"))) {
      return developmentRoot;
    }

    throw new Error(`${xaligoPackageName} is not installed yet.`);
  }

  private async previewOutputPath(uri: vscode.Uri): Promise<string> {
    const digest = crypto.createHash("sha256").update(uri.toString()).digest("hex").slice(0, 16);
    const outputDir = path.join(this.context.globalStorageUri.fsPath, "preview");
    return path.join(outputDir, `${digest}.svg`);
  }
}

interface PreviewMessage {
  command?: string;
  zoom?: number;
}

function xaligoNativeBinaryPath(packageRoot: string): string {
  const platform = process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  const executable = platform === "win32" ? `xaligo-${platform}-${arch}.exe` : `xaligo-${platform}-${arch}`;
  return path.join(packageRoot, "bin", "native", executable);
}

function runXaligoRender(
  binary: string,
  packageRoot: string,
  sourcePath: string,
  outputPath: string,
  servicesPath?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["render", sourcePath, "--format", "svg", "-o", outputPath];
    if (servicesPath) {
      args.push("--services", servicesPath);
    }

    execFile(
      binary,
      args,
      {
        env: {
          ...process.env,
          XALIGO_HOME: packageRoot
        },
        timeout: 30_000
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout).trim() || error.message));
          return;
        }

        resolve();
      }
    );
  });
}

async function findNearestServicesCsv(sourcePath: string): Promise<string | undefined> {
  const sourceDir = path.dirname(sourcePath);
  const sourceBase = path.basename(sourcePath, path.extname(sourcePath));
  const pairedServicesPath = path.join(sourceDir, `${sourceBase}.services.csv`);
  if (await exists(pairedServicesPath)) {
    return pairedServicesPath;
  }

  let currentDir = path.dirname(sourcePath);
  while (true) {
    const candidate = path.join(currentDir, "services.csv");
    if (await exists(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

interface PreviewHtmlOptions {
  content?: string;
  error?: string;
  zoom: number;
}

function previewHtml(options: PreviewHtmlOptions): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const zoom = clampZoom(options.zoom);
  const body = options.error
    ? `<main class="state error"><h1>Preview failed</h1><pre>${escapeHtml(options.error)}</pre></main>`
    : `<div class="canvas">${options.content ?? `<main class="state"><h1>Rendering...</h1></main>`}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html,
    body {
      margin: 0;
      min-height: 100%;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
    body {
      box-sizing: border-box;
      padding: 16px;
      min-height: 100vh;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      padding-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .toolbar button {
      min-width: 30px;
      height: 28px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font: 600 12px var(--vscode-font-family);
      cursor: pointer;
    }
    .toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .zoom-label {
      min-width: 48px;
    }
    .viewport {
      overflow: auto;
      min-height: calc(100vh - 54px);
    }
    .canvas {
      display: inline-block;
      zoom: var(--xaligo-preview-zoom);
    }
    svg {
      display: block;
      width: auto;
      max-width: none;
      height: auto;
      background: #ffffff;
      border: 1px solid var(--vscode-panel-border);
      box-sizing: border-box;
    }
    .state {
      display: grid;
      min-height: 220px;
      align-content: center;
      gap: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .state h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .state pre {
      margin: 0;
      white-space: pre-wrap;
      color: var(--vscode-errorForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
  </style>
</head>
<body style="--xaligo-preview-zoom: ${zoom};">
  <nav class="toolbar" aria-label="Preview controls">
    <button type="button" data-action="zoom-out" title="Zoom out">-</button>
    <button type="button" class="zoom-label" data-action="reset" title="Reset zoom">${Math.round(zoom * 100)}%</button>
    <button type="button" data-action="zoom-in" title="Zoom in">+</button>
    <button type="button" data-action="reset-view" title="Reset view">home</button>
    <button type="button" data-action="close" title="Close preview">x</button>
  </nav>
  <section class="viewport">
    ${body}
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let zoom = ${zoom};
    const body = document.body;
    const label = document.querySelector(".zoom-label");
    const viewport = document.querySelector(".viewport");

    function clamp(value) {
      return Math.max(0.05, Math.min(8, value));
    }

    function applyZoom(nextZoom) {
      zoom = clamp(nextZoom);
      body.style.setProperty("--xaligo-preview-zoom", String(zoom));
      label.textContent = Math.round(zoom * 100) + "%";
      vscode.postMessage({ command: "zoom", zoom });
    }

    function fitWidth() {
      const svg = document.querySelector("svg");
      if (!svg || !viewport) {
        return;
      }

      const widthAttr = Number.parseFloat(svg.getAttribute("width") || "");
      const viewBox = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width;
      const baseWidth = widthAttr || viewBox || svg.getBoundingClientRect().width / zoom;
      if (!baseWidth || !Number.isFinite(baseWidth)) {
        return;
      }

      const availableWidth = Math.max(120, viewport.clientWidth - 2);
      applyZoom(availableWidth / baseWidth);
      viewport.scrollTo(0, 0);
      window.scrollTo(0, 0);
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      const action = button.dataset.action;
      if (action === "zoom-in") {
        applyZoom(zoom + 0.1);
      } else if (action === "zoom-out") {
        applyZoom(zoom - 0.1);
      } else if (action === "reset") {
        applyZoom(1);
      } else if (action === "reset-view") {
        fitWidth();
      } else if (action === "close") {
        vscode.postMessage({ command: "close" });
      }
    });

    window.addEventListener("message", (event) => {
      if (event.data && event.data.command === "fitWidth") {
        fitWidth();
      }
    });
  </script>
</body>
</html>`;
}

function clampZoom(zoom: number): number {
  return Math.max(0.05, Math.min(8, zoom));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function ensureXaligoPackageInstalled(context: vscode.ExtensionContext): Promise<void> {
  const installRoot = path.join(context.globalStorageUri.fsPath, "npm");
  const markerPath = path.join(installRoot, "node_modules", "@xaligo", "xaligo", "package.json");
  const installedSpec = context.globalState.get<string>(installStateKey);

  if (installedSpec === xaligoPackageSpec && await exists(markerPath)) {
    return;
  }

  await fs.mkdir(installRoot, { recursive: true });
  await fs.writeFile(
    path.join(installRoot, "package.json"),
    `${JSON.stringify({
      private: true,
      dependencies: {
        [xaligoPackageName]: "^0.1.3"
      }
    }, null, 2)}\n`,
    "utf8"
  );

  try {
    await runNpmInstall(installRoot);
    await context.globalState.update(installStateKey, xaligoPackageSpec);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`Failed to install ${xaligoPackageName}: ${message}`);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runNpmInstall(cwd: string): Promise<void> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolve, reject) => {
    execFile(
      npmCommand,
      ["install", "--omit=dev", "--no-audit", "--no-fund"],
      { cwd, timeout: 120_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve();
      }
    );
  });
}
