const installExtensionCommand = "workbench.extensions.installExtension";
const reloadWindowAction = "Reload Window";

export interface ExtensionUpdateWorkflowHost {
  extensionId: string;
  production: boolean;
  getCommands(): PromiseLike<readonly string[]>;
  installExtension(extensionId: string): PromiseLike<void>;
  searchExtension(extensionId: string): PromiseLike<void>;
  reloadWindow(): PromiseLike<void>;
  information(message: string, ...actions: string[]): PromiseLike<string | undefined>;
  warning(message: string): PromiseLike<unknown>;
  error(message: string): PromiseLike<unknown>;
}

export async function runExtensionUpdate(host: ExtensionUpdateWorkflowHost): Promise<void> {
  if (!host.production) {
    await host.information(
      "The xaligo extension is running from a development or test location and cannot update itself. Opening its extension details instead."
    );
    await openExtensionDetails(host);
    return;
  }

  let availableCommands: readonly string[];
  try {
    availableCommands = await host.getCommands();
  } catch (error) {
    await showUpdateFailure(host, error);
    return;
  }

  if (!availableCommands.includes(installExtensionCommand)) {
    await host.warning(
      "This VS Code build cannot update the xaligo extension directly. Opening its extension details instead."
    );
    await openExtensionDetails(host);
    return;
  }

  try {
    await host.installExtension(host.extensionId);
  } catch (error) {
    await showUpdateFailure(host, error);
    return;
  }

  const selection = await host.information(
    "The xaligo extension update check completed. If VS Code installed an update, reload the window to use it.",
    reloadWindowAction
  );
  if (selection === reloadWindowAction) {
    await host.reloadWindow();
  }
}

async function showUpdateFailure(host: ExtensionUpdateWorkflowHost, error: unknown): Promise<void> {
  await host.error(
    `Failed to update the xaligo extension: ${errorMessage(error)}. Opening its extension details instead.`
  );
  await openExtensionDetails(host);
}

async function openExtensionDetails(host: ExtensionUpdateWorkflowHost): Promise<void> {
  try {
    await host.searchExtension(host.extensionId);
  } catch (error) {
    await host.error(`Failed to open the xaligo extension details: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
