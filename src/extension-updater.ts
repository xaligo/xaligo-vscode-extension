import * as vscode from "vscode";
import { runExtensionUpdate } from "./extension-update-workflow";

const installExtensionCommand = "workbench.extensions.installExtension";
const searchExtensionsCommand = "workbench.extensions.search";
const reloadWindowCommand = "workbench.action.reloadWindow";

export class ExtensionUpdater {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async update(): Promise<void> {
    await runExtensionUpdate({
      extensionId: this.context.extension.id,
      production: this.context.extensionMode === vscode.ExtensionMode.Production,
      getCommands: () => vscode.commands.getCommands(true),
      installExtension: (extensionId) => vscode.commands.executeCommand<void>(
        installExtensionCommand,
        extensionId,
        { enable: true }
      ),
      searchExtension: (extensionId) => vscode.commands.executeCommand<void>(
        searchExtensionsCommand,
        `@id:${extensionId}`
      ),
      reloadWindow: () => vscode.commands.executeCommand<void>(reloadWindowCommand),
      information: (message, ...actions) => vscode.window.showInformationMessage(message, ...actions),
      warning: (message) => vscode.window.showWarningMessage(message),
      error: (message) => vscode.window.showErrorMessage(message)
    });
  }
}
