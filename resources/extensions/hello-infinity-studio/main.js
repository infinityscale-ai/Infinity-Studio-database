/**
 * Hello Infinity Studio — example Infinity Studio extension (Worker sandbox, no imports).
 * Declares `activate(infinityStudio)`; the host injects `infinityStudio` (VS Code-like API).
 * Install via Extensions manager: paste `bundle.json`, or copy this file's
 * contents as `code` with `manifest.json` as `manifest`.
 */
async function activate(infinityStudio) {
  // 1. Commands (appear in Cmd+K under "Hello Infinity Studio").
  await infinityStudio.commands.registerCommand("hello-infinity-studio.say-hello", "Hello Infinity Studio: Say Hello", "Hello Infinity Studio");
  await infinityStudio.commands.registerCommand("hello-infinity-studio.insert-select-star", "Hello Infinity Studio: Insert SELECT *", "Hello Infinity Studio");
  await infinityStudio.commands.registerCommand("hello-infinity-studio.open-dashboard", "Hello Infinity Studio: Open Dashboard Panel", "Hello Infinity Studio");
  await infinityStudio.commands.registerCommand("hello-infinity-studio.show-schema", "Hello Infinity Studio: Show Schema Summary", "Hello Infinity Studio");

  // The Worker shim routes host->worker handler calls by name:
  // `command:<id>` for commands, `tree:<viewId>` for tree views.
  infinityStudio.__registerHandler("command:hello-infinity-studio.say-hello", async () => {
    await infinityStudio.window.showInformationMessage("Hello from Hello Infinity Studio!");
    return "greeted";
  });
  infinityStudio.__registerHandler("command:hello-infinity-studio.insert-select-star", async () => {
    const current = await infinityStudio.db.getActiveQuery();
    await infinityStudio.db.setActiveQuery(`${current}SELECT * `.trimStart());
    return "inserted";
  });
  infinityStudio.__registerHandler("command:hello-infinity-studio.open-dashboard", async () => {
    await infinityStudio.window.openWebviewPanel(
      "hello-infinity-studio.dashboard",
      "<html><body style='font-family:sans-serif;padding:16px'><h2>Hello Dashboard</h2><p>Opened at runtime.</p></body></html>",
    );
    return "opened";
  });
  infinityStudio.__registerHandler("command:hello-infinity-studio.show-schema", async () => {
    const schema = await infinityStudio.db.getSchema();
    await infinityStudio.window.showInformationMessage(
      `${schema.database || "active database"} (${schema.dbType}): ${schema.tables.length} table(s) across ${schema.schemas.length} schema(s).`
    );
    return schema;
  });

  // 2. Sidebar tree view.
  infinityStudio.__registerHandler("tree:hello-infinity-studio.connections", async (parentId) => {
    if (!parentId) {
      const connections = await infinityStudio.db.getConnections();
      return connections.map((c) => ({
        id: `conn-${c.id}`,
        label: c.name,
        description: c.dbType,
        collapsible: true,
      }));
    }
    return [{ id: `${parentId}-info`, label: "Connection details live in Infinity Studio", collapsible: false }];
  });
  await infinityStudio.window.registerTreeDataProvider("hello-infinity-studio.connections");

  // 3. Status bar (rail icon comes from the viewsContainer `icon` — one
  // activity-rail entry opening this container's sidebar; no runtime
  // createRailItem here so we never produce a duplicate second icon).
  await infinityStudio.window.createStatusBarItem("hello", "$(smiley) Hello Infinity Studio", {
    tooltip: "Hello Infinity Studio status item",
    command: "hello-infinity-studio.say-hello",
    alignment: "right",
    priority: 100,
  });

  // 4. Open the webview as an editor tab on demand via command.
  infinityStudio.__registerHandler("command:hello-infinity-studio.open-tab", async () => {
    await infinityStudio.window.openTab("hello-infinity-studio.welcome", { title: "Hello Infinity Studio" });
    return "tab-opened";
  });
  await infinityStudio.commands.registerCommand("hello-infinity-studio.open-tab", "Hello Infinity Studio: Open Webview Tab", "Hello Infinity Studio");

  // 4. Languages (SQL keyword completion).
  await infinityStudio.languages.registerCompletionItems("sql", [
    { label: "HELLO_INFINITY_STUDIO", detail: "Hello Infinity Studio keyword", insertText: "HELLO_INFINITY_STUDIO" },
  ]);

  // 5. AI tool.
  await infinityStudio.ai.registerTool({
    id: "hello-infinity-studio.explain-plan",
    label: "Explain plan",
    description: "Explains the active query plan.",
  });
}
