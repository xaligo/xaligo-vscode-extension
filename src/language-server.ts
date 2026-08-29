import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions
} from "vscode-languageclient/node";
import {
  languageServerExecutable,
  languageServerWorkingDirectory
} from "./language-server-options";
import {
  missingXalTagNames,
  withoutOpeningBracket,
  xalTagCompletionContext
} from "./language-server-completion";
import { xaligoLogger } from "./logger";
import type { XaligoRuntimeResolver } from "./runtime-resolver";

export class XaligoLanguageServer implements vscode.Disposable {
  private client: LanguageClient | undefined;
  private startPromise: Promise<void> | undefined;
  private disposed = false;
  private readonly trustSubscription: vscode.Disposable;

  constructor(private readonly runtimeResolver: XaligoRuntimeResolver) {
    this.trustSubscription = vscode.workspace.onDidGrantWorkspaceTrust(() => this.start());
  }

  start(): void {
    if (this.disposed || this.client || this.startPromise || !vscode.workspace.isTrusted) {
      return;
    }
    this.startPromise = this.startClient()
      .catch((error) => {
        this.client = undefined;
        xaligoLogger().error(
          `xaligo language server failed to start: ${errorMessage(error)}`
        );
      })
      .finally(() => {
        this.startPromise = undefined;
      });
  }

  dispose(): void {
    this.disposed = true;
    this.trustSubscription.dispose();
    const client = this.client;
    this.client = undefined;
    if (client) {
      void client.stop().catch((error) => {
        xaligoLogger().error(
          `xaligo language server failed to stop cleanly: ${errorMessage(error)}`
        );
      });
    }
  }

  private async startClient(): Promise<void> {
    const runtime = await this.runtimeResolver.resolve();
    if (this.disposed) {
      return;
    }

    const cwd = languageServerWorkingDirectory(vscode.workspace.workspaceFolders);
    const serverOptions: ServerOptions = languageServerExecutable(runtime, cwd);
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "xal" },
        { scheme: "untitled", language: "xal" }
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher("**/*.xal")
      },
      middleware: {
        provideCompletionItem: async (document, position, context, token, next) => {
          const result = await next(document, position, context, token);
          return supplementTagCompletions(document, position, result);
        }
      },
      outputChannel: xaligoLogger()
    };
    const client = new LanguageClient(
      "xaligo",
      "xaligo Language Server",
      serverOptions,
      clientOptions
    );
    this.client = client;
    await client.start();
    xaligoLogger().info(`xaligo language server started (${runtime.binary})`);
  }
}

function supplementTagCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
  result: vscode.CompletionItem[] | vscode.CompletionList | null | undefined
): vscode.CompletionItem[] | vscode.CompletionList | undefined {
  const tagContext = xalTagCompletionContext(
    document.lineAt(position.line).text,
    position.character
  );
  if (!tagContext) {
    return result ?? undefined;
  }

  const nativeItems = result instanceof vscode.CompletionList
    ? result.items
    : result ?? [];
  const wordRange = new vscode.Range(
    position.line,
    tagContext.wordStartCharacter,
    position.line,
    tagContext.cursorCharacter
  );

  for (const item of nativeItems) {
    if (item.range) {
      continue;
    }
    if (tagContext.closing) {
      item.insertText = completionLabel(item);
      item.range = wordRange;
      continue;
    }

    const startsWithBracket = completionStartsWithOpeningBracket(item);
    if (item.insertText instanceof vscode.SnippetString) {
      item.insertText = new vscode.SnippetString(
        withoutOpeningBracket(item.insertText.value)
      );
    } else if (typeof item.insertText === "string") {
      item.insertText = withoutOpeningBracket(item.insertText);
    }
    item.range = startsWithBracket && tagContext.hasAutoClosingBracket
      ? new vscode.Range(
        position.line,
        tagContext.wordStartCharacter,
        position.line,
        tagContext.cursorCharacter + 1
      )
      : wordRange;
  }

  const supplementalItems = missingXalTagNames(
    nativeItems.map((item) => completionLabel(item))
  ).map((tagName) => {
    const item = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Class);
    item.detail = "xaligo tag";
    item.insertText = tagName;
    item.range = wordRange;
    item.sortText = `z-${tagName}`;
    return item;
  });
  const items = [...nativeItems, ...supplementalItems];
  return result instanceof vscode.CompletionList
    ? new vscode.CompletionList(items, result.isIncomplete)
    : items;
}

function completionLabel(item: vscode.CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

function completionStartsWithOpeningBracket(item: vscode.CompletionItem): boolean {
  if (item.insertText instanceof vscode.SnippetString) {
    return item.insertText.value.startsWith("<");
  }
  return typeof item.insertText === "string" && item.insertText.startsWith("<");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
