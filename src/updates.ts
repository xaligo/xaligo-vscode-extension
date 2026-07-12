import * as vscode from "vscode";
import { ExtensionUpdater } from "./extension-updater";
import { XaligoRuntimeResolver } from "./runtime-resolver";
import { XaligoRuntimeUpdater } from "./runtime-updater";

type UpdateAction = "runtime" | "extension";

interface UpdateQuickPickItem extends vscode.QuickPickItem {
  action: UpdateAction;
}

export class XaligoUpdates {
  private readonly runtimeUpdater: XaligoRuntimeUpdater;
  private readonly extensionUpdater: ExtensionUpdater;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runtimeResolver: XaligoRuntimeResolver
  ) {
    this.runtimeUpdater = new XaligoRuntimeUpdater(context, runtimeResolver);
    this.extensionUpdater = new ExtensionUpdater(context);
  }

  async showMenu(): Promise<void> {
    const runtimeDescription = await this.runtimeDescription();
    const extensionVersion = typeof this.context.extension.packageJSON.version === "string"
      ? this.context.extension.packageJSON.version
      : "unknown";
    const selection = await vscode.window.showQuickPick<UpdateQuickPickItem>([
      {
        action: "runtime",
        label: "$(cloud-download) Update xaligo Runtime",
        description: runtimeDescription,
        detail: "Check, verify, and activate the latest compatible xaligo CLI."
      },
      {
        action: "extension",
        label: "$(extensions) Update xaligo Extension",
        description: `Installed extension ${extensionVersion}`,
        detail: "Use VS Code's extension update mechanism to install the latest compatible version."
      }
    ], {
      placeHolder: "Choose what to update",
      title: "xaligo Updates"
    });

    if (selection?.action === "runtime") {
      await this.updateRuntime();
    } else if (selection?.action === "extension") {
      await this.updateExtension();
    }
  }

  async updateRuntime(): Promise<void> {
    await this.runtimeUpdater.update();
  }

  async updateExtension(): Promise<void> {
    await this.extensionUpdater.update();
  }

  private async runtimeDescription(): Promise<string> {
    try {
      const runtime = await this.runtimeResolver.resolve();
      if (runtime.source === "custom") {
        return "Using configured custom executable";
      }
      const source = `${runtime.source} runtime`;
      return `Using ${runtime.identity.packageVersion} (${source})`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Runtime unavailable: ${message}`;
    }
  }
}
