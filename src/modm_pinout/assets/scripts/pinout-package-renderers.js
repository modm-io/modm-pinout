"use strict";

(function registerModmPinoutPackageRenderers(global) {
  const GRID_POSITION_RE = /^(?<row>[A-Z]+)(?<column>\d+)$/i;
  const GRID_PACKAGE_RE = /^(?:WLCSP|EWLCSP|BGA|LFBGA|TFBGA|UFBGA)/i;
  const DUAL_PACKAGE_RE = /^(?:SO|SOIC|SOP|SSOP|TSSOP|MSOP|QSOP|VSSOP|PDIP|DIP)/i;
  const api = global.ModmPinout = global.ModmPinout || {};

  if (typeof api.registerPackageRenderer !== "function") {
    throw new Error("pinout-package.js must be loaded before pinout-package-renderers.js");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function gridPackageMetrics(pins) {
    const parsedPins = pins
      .map((pin) => {
        const match = GRID_POSITION_RE.exec(String(pin.position || ""));
        if (!match || !match.groups) {
          return null;
        }
        return {
          row: String(match.groups.row).toUpperCase(),
          column: Number(match.groups.column),
        };
      })
      .filter((pin) => pin !== null);

    return {
      rowCount: new Set(parsedPins.map((pin) => pin.row)).size,
      columnCount: new Set(parsedPins.map((pin) => pin.column)).size,
    };
  }

  function packageRendererCategory(packageModel) {
    const packageName = String(packageModel && packageModel.packageName || "").trim().toUpperCase();
    const pins = Array.isArray(packageModel && packageModel.pins) ? packageModel.pins : [];

    if (pins.length > 0 && pins.every((pin) => GRID_POSITION_RE.test(String(pin.position || "")))) {
      return "grid";
    }
    if (GRID_PACKAGE_RE.test(packageName)) {
      return "grid";
    }
    if (DUAL_PACKAGE_RE.test(packageName)) {
      return "dual";
    }
    return "edge";
  }

  function registerDynamicRenderer({ id, label, category, defaultWidth, zoomConfig, render }) {
    api.registerPackageRenderer({
      id,
      label,
      category,
      matches(packageModel) {
        return packageRendererCategory(packageModel) === category;
      },
      defaultWidth,
      zoomConfig,
      render,
    });
  }

  registerDynamicRenderer({
    id: "dynamic-edge",
    label: "Edge package",
    category: "edge",
    defaultWidth(packageModel) {
      return clamp(620 + Math.max(0, packageModel.pins.length - 64) * 1.2, 620, 980);
    },
    zoomConfig() {
      return { min: 0.7, max: 2.0, step: 0.15 };
    },
    render(packageModel) {
      packageModel.ctx.renderEdgePackage(packageModel.svg, packageModel.pins, packageModel.packageName);
    },
  });

  registerDynamicRenderer({
    id: "dynamic-dual",
    label: "Two-sided package",
    category: "dual",
    defaultWidth(packageModel) {
      return clamp(440 + Math.max(0, packageModel.pins.length - 20) * 4, 440, 820);
    },
    zoomConfig() {
      return { min: 0.7, max: 2.2, step: 0.15 };
    },
    render(packageModel) {
      packageModel.ctx.renderDualPackage(packageModel.svg, packageModel.pins, packageModel.packageName);
    },
  });

  registerDynamicRenderer({
    id: "dynamic-grid",
    label: "Grid package",
    category: "grid",
    defaultWidth(packageModel) {
      const pinCount = packageModel.pins.length;
      const metrics = gridPackageMetrics(packageModel.pins);
      const span = Math.max(metrics.rowCount, metrics.columnCount, Math.ceil(Math.sqrt(pinCount)));
      return clamp(
        620 + Math.max(0, span - 8) * 40 + Math.max(0, pinCount - 64),
        620,
        1200,
      );
    },
    zoomConfig() {
      return { min: 0.6, max: 2.4, step: 0.15 };
    },
    render(packageModel) {
      packageModel.ctx.renderGridPackage(packageModel.svg, packageModel.pins, packageModel.packageName);
    },
  });
}(window));