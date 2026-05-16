"use strict";

window.initializeModmPinoutApp = function initializeModmPinoutApp(config) {
  const api = window.ModmPinout || {};
  if (typeof api.createContext !== "function") {
    throw new Error("Pin matrix core module did not load.");
  }

  const ctx = api.createContext(config);
  api.attachCore(ctx);
  api.attachPersistence(ctx);
  api.attachRegex(ctx);
  api.attachImportExport(ctx);
  api.attachTable(ctx);
  api.attachPackage(ctx);

  ctx.bindPageEventHandlers();
  ctx.renderPackageDiagram();
  ctx.initializeWithRecovery().catch((error) => {
    ctx.setStatus(`Failed to initialize table: ${String(error)}`, true);
  });
};