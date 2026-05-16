"use strict";

(function registerModmPinoutPackage(global) {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const GRID_POSITION_RE = /^(?<row>[A-Z]+)(?<column>\d+)$/i;
  const DEFAULT_PACKAGE_DETAIL = "Hover a pin for details. Click to choose functions.";
  const api = global.ModmPinout = global.ModmPinout || {};

  // Custom renderers override the built-ins with this interface:
  // { id, matches(model), render(model), label?, category?, defaultWidth?, zoomConfig? }
  api.packageRenderers = Array.isArray(api.packageRenderers) ? api.packageRenderers : [];

  api.registerPackageRenderer = function registerPackageRenderer(renderer) {
    if (!renderer || typeof renderer !== "object") {
      throw new TypeError("Package renderer must be an object.");
    }

    const rendererId = String(renderer.id || "").trim();
    if (!rendererId) {
      throw new TypeError("Package renderer id must not be empty.");
    }
    if (typeof renderer.matches !== "function") {
      throw new TypeError(`Package renderer '${rendererId}' must define matches(model).`);
    }
    if (typeof renderer.render !== "function") {
      throw new TypeError(`Package renderer '${rendererId}' must define render(model).`);
    }

    const normalizedRenderer = { ...renderer, id: rendererId };
    api.packageRenderers = api.packageRenderers
      .filter((candidate) => candidate && candidate.id !== rendererId)
      .concat(normalizedRenderer);
    return normalizedRenderer;
  };

  function svgNode(name, attributes = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, String(value));
    }
    return node;
  }

  function titleText(pin) {
    const pinType = String(pin.type || "io");
    return `${pin.position} ${pin.short_name}${pinType !== "io" ? ` (${pinType})` : ""}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function touchDistance(touchA, touchB) {
    return Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY);
  }

  function touchMidpoint(touchA, touchB) {
    return {
      x: (touchA.clientX + touchB.clientX) / 2,
      y: (touchA.clientY + touchB.clientY) / 2,
    };
  }

  function compactPinNameLabel(pinName) {
    let label = String(pinName || "").trim();
    if (!label) {
      return "";
    }

    label = label.replace(/\s*\[[^\]]*\]\s*/g, "").trim();
    label = label.replace(/\s*\([^)]*\)\s*/g, "").trim();

    const gpioMatch = /\bP[A-Z]\d+\b/.exec(label);
    if (gpioMatch) {
      return gpioMatch[0];
    }
    if (label.includes("/")) {
      return label.split("/")[0].trim();
    }
    if (label.includes(" ")) {
      return label.split(" ")[0].trim();
    }

    return label;
  }

  function gridPackageMetrics(pins) {
    const parsedPins = pins
      .map((pin) => {
        const match = GRID_POSITION_RE.exec(pin.position);
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

  function dedupeStrings(values) {
    const deduped = [];
    const seen = new Set();
    for (const value of values || []) {
      const normalized = String(value || "").trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduped.push(normalized);
    }
    return deduped;
  }

  api.attachPackage = function attachPackage(ctx) {
    ctx.packagePinRowIds = function packagePinRowIds(pin) {
      if (Array.isArray(pin && pin.row_ids) && pin.row_ids.length > 0) {
        return pin.row_ids.filter((rowId) => rowId != null && String(rowId).trim() !== "");
      }
      return pin && pin.row_id != null ? [pin.row_id] : [];
    };

    ctx.packagePinRows = function packagePinRows(pin) {
      if (typeof ctx.getRowDataById !== "function") {
        return [];
      }
      return ctx.packagePinRowIds(pin)
        .map((rowId) => ctx.getRowDataById(rowId))
        .filter((rowData) => rowData && typeof rowData === "object");
    };

    ctx.packagePinRowStates = function packagePinRowStates(pin) {
      const rowEntries = ctx.packagePinRows(pin);
      if (rowEntries.length === 0) {
        const availableFunctions = Array.isArray(pin && pin.functions) ? pin.functions.slice() : [];
        return [{
          rowId: pin && pin.row_id != null ? pin.row_id : null,
          rowData: null,
          shortName: String(pin && pin.short_name || "").trim(),
          availableFunctions,
          selectedFunctions: [],
          displayFunctions: availableFunctions,
          comment: "",
        }];
      }

      return rowEntries.map((entry) => {
        const availableFunctions = Array.isArray(entry.functions) ? entry.functions.slice() : [];
        const selectedFunctions = Array.isArray(entry.selected_function)
          ? ctx.normalizeSelectedFunctionList(entry.selected_function, availableFunctions)
          : [];

        return {
          rowId: entry.row_id,
          rowData: entry,
          shortName: String(entry.short_name || "").trim(),
          availableFunctions,
          selectedFunctions,
          displayFunctions: selectedFunctions.length > 0 ? selectedFunctions : availableFunctions,
          comment: typeof entry.internal_name === "string" ? entry.internal_name.trim() : "",
        };
      });
    };

    ctx.packagePinState = function packagePinState(pin) {
      const rowStates = ctx.packagePinRowStates(pin);
      const rowEntries = rowStates
        .map((state) => state.rowData)
        .filter((rowData) => rowData && typeof rowData === "object");
      const rowData = rowEntries[0] || (typeof ctx.getRowDataById === "function" ? ctx.getRowDataById(pin.row_id) : null);
      const rowFunctions = rowStates.flatMap((state) => state.availableFunctions);
      const availableFunctions = dedupeStrings(
        rowFunctions.length > 0 ? rowFunctions : (Array.isArray(pin.functions) ? pin.functions.slice() : []),
      );
      const selectedFunctions = dedupeStrings(rowStates.flatMap((state) => state.selectedFunctions));
      const displayFunctions = selectedFunctions.length > 0 ? selectedFunctions : availableFunctions;
      const comments = dedupeStrings(rowStates.map((state) => state.comment));
      const names = rowStates
        .map((state) => String(state.shortName || "").trim())
        .filter((name) => name !== "");

      return {
        rowData,
        rowEntries,
        rowStates,
        rowIds: ctx.packagePinRowIds(pin),
        availableFunctions,
        selectedFunctions,
        displayFunctions,
        comments,
        comment: comments.join("; "),
        names,
      };
    };

    ctx.describePackagePin = function describePackagePin(pin) {
      const details = ctx.packagePinState(pin);
      const pinType = String(pin.type || "io");
      const functions = details.displayFunctions;
      const functionLabel = functions.length === 1 ? "Function" : "Functions";
      const typeSuffix = pinType !== "io" ? ` | ${pinType}` : "";
      const entrySuffix = details.rowStates.length > 1 ? ` | Connected entries: ${details.rowStates.length}` : "";
      const namesSuffix = details.rowStates.length > 1 && details.names.length > 1
        ? ` | Names: ${details.names.join(" ")}`
        : "";
      const functionSuffix = functions.length > 0 ? ` | ${functionLabel}: ${functions.join(", ")}` : "";
      const commentSuffix = details.comment ? ` | Comment: ${details.comment}` : "";
      return `${pin.position} ${pin.short_name}${typeSuffix}${entrySuffix}${namesSuffix}${functionSuffix}${commentSuffix}`;
    };

    ctx.packageTooltipFields = function packageTooltipFields(pin) {
      const details = ctx.packagePinState(pin);
      const fields = [
        { label: "Pin", value: String(pin.position || "-") },
        {
          label: details.rowStates.length > 1 ? "Names" : "Name",
          value: details.names.length > 0 ? details.names.join(" ") : String(pin.short_name || "-"),
        },
      ];

      if (details.rowStates.length > 1) {
        fields.push({
          label: "Table entries",
          value: details.rowEntries
            .map((entry) => `${entry.position} ${entry.short_name}`.trim())
            .join(" | "),
        });
      }

      if (details.rowStates.length > 1) {
        details.rowStates.forEach((rowState, index) => {
          fields.push({
            label: rowState.shortName || `Entry ${index + 1}`,
            value: rowState.displayFunctions.length > 0 ? rowState.displayFunctions.join(", ") : "-",
          });
        });
      } else {
        fields.push({
          label: details.displayFunctions.length === 1 ? "Function" : "Functions",
          value: details.displayFunctions.length > 0 ? details.displayFunctions.join(", ") : "-",
        });
      }

      fields.push({
        label: details.comments.length > 1 ? "Comments" : "Comment",
        value: details.comments.length > 0 ? details.comments.join(" | ") : "-",
      });
      return fields;
    };

    ctx.packagePins = function packagePins() {
      const packageData = ctx.DEVICE_DATA && ctx.DEVICE_DATA.package ? ctx.DEVICE_DATA.package : null;
      const rows = Array.isArray(ctx.DEVICE_DATA && ctx.DEVICE_DATA.rows) ? ctx.DEVICE_DATA.rows : [];
      const rowsById = new Map(rows.map((row) => [String(row.row_id), row]));
      const packagePins = packageData && Array.isArray(packageData.pins) ? packageData.pins : [];
      return packagePins.map((pin) => {
        const rowIds = Array.isArray(pin.row_ids) && pin.row_ids.length > 0
          ? pin.row_ids.filter((rowId) => rowId != null && String(rowId).trim() !== "")
          : (pin.row_id != null ? [pin.row_id] : []);
        const row = rowIds.length > 0 ? (rowsById.get(String(rowIds[0])) || null) : null;
        return {
          row_id: rowIds.length > 0 ? rowIds[0] : pin.row_id,
          row_ids: rowIds,
          position: String(pin.position || ""),
          short_name: String(pin.short_name || (row ? row.short_name : "")),
          type: String(pin.type || "io"),
          functions: row && Array.isArray(row.functions) ? row.functions.slice() : [],
        };
      });
    };

    ctx.packageTypeClass = function packageTypeClass(pinType) {
      const normalizedType = String(pinType || "io").toLowerCase();
      if (normalizedType === "power") {
        return "package-pin-power";
      }
      if (normalizedType === "nc") {
        return "package-pin-nc";
      }
      if (normalizedType === "monoio") {
        return "package-pin-monoio";
      }
      return "package-pin-io";
    };

    ctx.registerPackagePinNode = function registerPackagePinNode(pin, node) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.pinNodesByRowId) {
        return;
      }

      for (const rowId of ctx.packagePinRowIds(pin)) {
        const rowKey = String(rowId);
        const nodes = packageUi.pinNodesByRowId.get(rowKey) || [];
        nodes.push(node);
        packageUi.pinNodesByRowId.set(rowKey, nodes);
      }
    };

    ctx.packageRowIsHighlighted = function packageRowIsHighlighted(rowId) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi) {
        return false;
      }

      const rowKey = String(rowId);
      return packageUi.hoveredRowIds.has(rowKey) || packageUi.highlightedRowIds.has(rowKey);
    };

    ctx.syncPackagePinHighlight = function syncPackagePinHighlight(rowId) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.pinNodesByRowId) {
        return;
      }

      const rowKey = String(rowId);
      const pinNodes = packageUi.pinNodesByRowId.get(rowKey) || [];
      const isHighlighted = ctx.packageRowIsHighlighted(rowKey);
      for (const pinNode of pinNodes) {
        pinNode.classList.toggle("package-pin-linked", isHighlighted);
      }
    };

    ctx.clearPackageHighlightedRows = function clearPackageHighlightedRows(field = null) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi) {
        return;
      }

      const activeField = packageUi.highlightedField;
      if (field !== null && activeField !== String(field)) {
        return;
      }

      if (packageUi.highlightedRowIds.size === 0) {
        packageUi.highlightedField = null;
        return;
      }

      const rowIds = Array.from(packageUi.highlightedRowIds);
      packageUi.highlightedRowIds.clear();
      packageUi.highlightedField = null;
      for (const rowId of rowIds) {
        ctx.syncPackagePinHighlight(rowId);
      }
    };

    ctx.setPackageHighlightedRows = function setPackageHighlightedRows(rowIds, field = null) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi) {
        return;
      }

      const nextRowIds = new Set(
        Array.from(rowIds || [], (rowId) => String(rowId)).filter((rowId) => rowId !== ""),
      );
      const changedRowIds = new Set([...packageUi.highlightedRowIds, ...nextRowIds]);

      packageUi.highlightedRowIds = nextRowIds;
      packageUi.highlightedField = typeof field === "string" && field ? field : null;
      for (const rowId of changedRowIds) {
        ctx.syncPackagePinHighlight(rowId);
      }
    };

    ctx.clearHoveredPackageRows = function clearHoveredPackageRows(rowIds = null) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.hoveredRowIds || packageUi.hoveredRowIds.size === 0) {
        return;
      }

      const targetRowKeys = rowIds == null
        ? null
        : new Set(Array.from(rowIds, (rowId) => String(rowId)).filter((rowKey) => rowKey !== ""));
      if (targetRowKeys && !Array.from(targetRowKeys).some((rowKey) => packageUi.hoveredRowIds.has(rowKey))) {
        return;
      }

      const activeRowIds = Array.from(packageUi.hoveredRowIds);
      packageUi.hoveredRowIds.clear();
      for (const activeRowId of activeRowIds) {
        ctx.syncPackagePinHighlight(activeRowId);

        if (ctx.table) {
          const row = ctx.table.getRow(activeRowId);
          if (row) {
            const element = row.getElement();
            if (element) {
              element.classList.remove("package-hover-row");
            }
          }
        }
      }
    };

    ctx.setHoveredPackageRows = function setHoveredPackageRows(rowIds) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi) {
        return;
      }

      const nextRowIds = new Set(
        Array.from(rowIds || [], (rowId) => String(rowId)).filter((rowKey) => rowKey !== ""),
      );
      const changedRowIds = new Set([...packageUi.hoveredRowIds, ...nextRowIds]);
      packageUi.hoveredRowIds = nextRowIds;

      for (const rowId of changedRowIds) {
        ctx.syncPackagePinHighlight(rowId);

        if (!ctx.table) {
          continue;
        }

        const row = ctx.table.getRow(rowId);
        if (!row) {
          continue;
        }

        const element = row.getElement();
        if (element) {
          element.classList.toggle("package-hover-row", nextRowIds.has(String(rowId)));
        }
      }
    };

    ctx.clearHoveredPackageRow = function clearHoveredPackageRow(rowId = null) {
      if (rowId == null) {
        ctx.clearHoveredPackageRows();
        return;
      }
      ctx.clearHoveredPackageRows([rowId]);
    };

    ctx.setHoveredPackageRow = function setHoveredPackageRow(rowId) {
      if (rowId == null) {
        ctx.clearHoveredPackageRows();
        return;
      }
      ctx.setHoveredPackageRows([rowId]);
    };

    ctx.packagePinLabel = function packagePinLabel(pin) {
      const names = ctx.packagePinState(pin).names;
      const compactNames = names
        .map((name) => compactPinNameLabel(name))
        .filter((name) => name !== "");
      if (compactNames.length > 0) {
        return compactNames.join(" ");
      }
      return compactPinNameLabel(pin.short_name);
    };

    ctx.renderOutsidePinName = function renderOutsidePinName(svg, pin, options) {
      const label = ctx.packagePinLabel(pin);
      if (!label) {
        return;
      }

      const textNode = svgNode("text", {
        x: options.x,
        y: options.y,
        class: "package-pin-name package-pin-name-side",
        "text-anchor": options.anchor,
      });
      textNode.textContent = label;
      svg.append(textNode);
    };

    ctx.renderGridPinName = function renderGridPinName(svg, pin, x, y, radius) {
      const label = ctx.packagePinLabel(pin);
      if (!label) {
        return;
      }

      const fontSize = clamp((radius * 1.7) / Math.max(label.length * 0.58, 1), 4.5, 9);
      const textNode = svgNode("text", {
        x,
        y: y + 0.5,
        class: "package-pin-name package-pin-name-grid",
        "font-size": fontSize,
      });
      textNode.textContent = label;
      svg.append(textNode);
    };

    ctx.fitPackageBaseWidthToViewport = function fitPackageBaseWidthToViewport(fallbackWidth) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.mountNode || !packageUi.svg) {
        return fallbackWidth;
      }

      const viewBox = packageUi.svg.viewBox && packageUi.svg.viewBox.baseVal
        ? packageUi.svg.viewBox.baseVal
        : null;
      const viewWidth = Number(viewBox && viewBox.width ? viewBox.width : 0);
      const viewHeight = Number(viewBox && viewBox.height ? viewBox.height : 0);
      const viewportWidth = Math.max(1, packageUi.mountNode.clientWidth - 16);
      const viewportHeight = Math.max(1, packageUi.mountNode.clientHeight - 16);

      if (!(viewWidth > 0) || !(viewHeight > 0)) {
        return fallbackWidth;
      }

      return Math.min(viewportWidth, viewportHeight * (viewWidth / viewHeight));
    };

    ctx.applyPackageZoom = function applyPackageZoom() {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.svg) {
        return;
      }

      const zoom = clamp(packageUi.zoom, packageUi.zoomConfig.min, packageUi.zoomConfig.max);
      packageUi.zoom = zoom;
      packageUi.svg.style.width = `${Math.round(packageUi.baseWidth * zoom)}px`;
      packageUi.svg.style.height = "auto";
      packageUi.svg.style.maxWidth = "none";

      if (packageUi.zoomLabel) {
        packageUi.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      }
      if (packageUi.zoomOutButton) {
        packageUi.zoomOutButton.disabled = zoom <= packageUi.zoomConfig.min + 0.001;
      }
      if (packageUi.zoomInButton) {
        packageUi.zoomInButton.disabled = zoom >= packageUi.zoomConfig.max - 0.001;
      }
    };

    ctx.setPackageZoom = function setPackageZoom(nextZoom, anchorPoint = null) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi) {
        return;
      }

      const stageNode = packageUi.stage || null;
      let anchorRatioX = null;
      let anchorRatioY = null;

      if (anchorPoint && stageNode) {
        const stageRect = stageNode.getBoundingClientRect();
        if (stageRect.width > 0 && stageRect.height > 0) {
          anchorRatioX = clamp((anchorPoint.x - stageRect.left) / stageRect.width, 0, 1);
          anchorRatioY = clamp((anchorPoint.y - stageRect.top) / stageRect.height, 0, 1);
        }
      }

      ctx.hidePackageTooltip();
      ctx.closePackageFunctionPicker();
      packageUi.zoom = nextZoom;
      ctx.applyPackageZoom();
    };

    ctx.renderPackageZoomControls = function renderPackageZoomControls() {
      const controlsNode = document.getElementById("package-view-controls");
      if (!controlsNode) {
        return null;
      }

      controlsNode.replaceChildren();

      const zoomOutButton = document.createElement("button");
      zoomOutButton.type = "button";
      zoomOutButton.className = "package-zoom-button";
      zoomOutButton.textContent = "-";
      zoomOutButton.setAttribute("aria-label", "Zoom out package diagram");

      const zoomLabel = document.createElement("div");
      zoomLabel.className = "package-zoom-label";
      zoomLabel.setAttribute("aria-hidden", "true");

      const zoomInButton = document.createElement("button");
      zoomInButton.type = "button";
      zoomInButton.className = "package-zoom-button";
      zoomInButton.textContent = "+";
      zoomInButton.setAttribute("aria-label", "Zoom in package diagram");

      controlsNode.append(zoomOutButton, zoomLabel, zoomInButton);
      return { zoomOutButton, zoomInButton, zoomLabel };
    };

    ctx.packageViewportHeightBounds = function packageViewportHeightBounds() {
      return {
        min: 360,
        max: Math.max(720, Math.round(window.innerHeight * 0.9)),
      };
    };

    ctx.setPackageViewportHeight = function setPackageViewportHeight(nextHeight) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.mountNode) {
        return;
      }

      const bounds = ctx.packageViewportHeightBounds();
      const height = clamp(nextHeight, bounds.min, bounds.max);
      packageUi.viewportHeight = height;
      packageUi.mountNode.style.height = `${Math.round(height)}px`;
    };

    ctx.bindPackageZoomControls = function bindPackageZoomControls() {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.zoomOutButton || !packageUi.zoomInButton) {
        return;
      }

      packageUi.zoomOutButton.addEventListener("click", () => {
        ctx.setPackageZoom(packageUi.zoom - packageUi.zoomConfig.step);
      });
      packageUi.zoomInButton.addEventListener("click", () => {
        ctx.setPackageZoom(packageUi.zoom + packageUi.zoomConfig.step);
      });
    };

    ctx.shouldSuppressPackageClick = function shouldSuppressPackageClick() {
      const packageUi = ctx.packageUi || null;
      return Boolean(packageUi && packageUi.suppressClickUntil > performance.now());
    };

    ctx.updatePackageDetail = function updatePackageDetail(message) {
      const detailNode = document.getElementById("package-detail");
      if (detailNode) {
        detailNode.textContent = message;
      }
    };

    ctx.resetPackageDetail = function resetPackageDetail() {
      const packageUi = ctx.packageUi || null;
      if (packageUi && packageUi.activePin) {
        ctx.updatePackageDetail(ctx.describePackagePin(packageUi.activePin));
        return;
      }

      ctx.updatePackageDetail(DEFAULT_PACKAGE_DETAIL);
    };

    ctx.focusTableRowForPackagePin = function focusTableRowForPackagePin(pin) {
      const rowIds = ctx.packagePinRowIds(pin);
      if (!ctx.table || pin == null || rowIds.length === 0) {
        return;
      }
      const row = ctx.table.getRow(rowIds[0]);
      if (!row) {
        return;
      }

      const element = row.getElement();
      if (!element) {
        return;
      }

      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      for (const rowId of rowIds) {
        const tableRow = ctx.table.getRow(rowId);
        if (!tableRow) {
          continue;
        }
        const rowElement = tableRow.getElement();
        if (!rowElement) {
          continue;
        }
        rowElement.classList.add("package-linked-row");
        window.setTimeout(() => rowElement.classList.remove("package-linked-row"), 1100);
      }
    };

    ctx.updateSelectedFunctionsForPackagePin = function updateSelectedFunctionsForPackagePin(pin, value) {
      const normalizedSelections = [];
      for (const rowId of ctx.packagePinRowIds(pin)) {
        normalizedSelections.push(ctx.updateSelectedFunctionsForRow(rowId, value));
      }
      return normalizedSelections[0] || [];
    };

    ctx.bindPackageGlobalHandlers = function bindPackageGlobalHandlers() {
      if (ctx.packageGlobalHandlersBound) {
        return;
      }

      document.addEventListener("pointerdown", (event) => {
        const packageUi = ctx.packageUi || null;
        if (!packageUi || !packageUi.picker || packageUi.picker.hidden) {
          return;
        }

        const target = event.target;
        if (
          packageUi.picker.contains(target) ||
          (packageUi.activePinNode && packageUi.activePinNode.contains(target))
        ) {
          return;
        }

        ctx.closePackageFunctionPicker();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          ctx.closePackageFunctionPicker();
        }
      });

      ctx.packageGlobalHandlersBound = true;
    };

    ctx.positionPackageOverlay = function positionPackageOverlay(overlayNode, targetNode) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !overlayNode || !targetNode) {
        return;
      }

      overlayNode.hidden = false;
      overlayNode.style.left = "8px";
      overlayNode.style.top = "8px";

      const stageRect = packageUi.stage.getBoundingClientRect();
      const targetRect = targetNode.getBoundingClientRect();
      const overlayRect = overlayNode.getBoundingClientRect();
      const maxLeft = Math.max(8, packageUi.stage.clientWidth - overlayRect.width - 8);
      let left = targetRect.left - stageRect.left + targetRect.width / 2 - overlayRect.width / 2;
      left = clamp(left, 8, maxLeft);

      let top = targetRect.top - stageRect.top - overlayRect.height - 12;
      if (top < 8) {
        top = targetRect.bottom - stageRect.top + 12;
      }

      overlayNode.style.left = `${Math.round(left)}px`;
      overlayNode.style.top = `${Math.round(top)}px`;
    };

    ctx.hidePackageTooltip = function hidePackageTooltip() {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.tooltip) {
        return;
      }

      packageUi.tooltip.hidden = true;
      packageUi.tooltip.replaceChildren();
      ctx.resetPackageDetail();
    };

    ctx.showPackageTooltip = function showPackageTooltip(targetNode, pin) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.tooltip) {
        return;
      }

      const tooltip = packageUi.tooltip;
      tooltip.replaceChildren();
      for (const field of ctx.packageTooltipFields(pin)) {
        const rowNode = document.createElement("div");
        rowNode.className = "package-tooltip-row";

        const labelNode = document.createElement("div");
        labelNode.className = "package-tooltip-label";
        labelNode.textContent = field.label;
        rowNode.append(labelNode);

        const valueNode = document.createElement("div");
        valueNode.className = "package-tooltip-value";
        valueNode.textContent = field.value;
        rowNode.append(valueNode);

        tooltip.append(rowNode);
      }

      ctx.updatePackageDetail(ctx.describePackagePin(pin));
      ctx.positionPackageOverlay(tooltip, targetNode);
    };

    ctx.closePackageFunctionPicker = function closePackageFunctionPicker() {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.picker) {
        return;
      }

      if (packageUi.activePinNode) {
        packageUi.activePinNode.setAttribute("aria-expanded", "false");
      }

      packageUi.activePin = null;
      packageUi.activePinNode = null;
      packageUi.picker.hidden = true;
      packageUi.picker.replaceChildren();
      ctx.resetPackageDetail();
    };

    ctx.openPackageFunctionPicker = function openPackageFunctionPicker(targetNode, pin) {
      const packageUi = ctx.packageUi || null;
      if (!packageUi || !packageUi.picker) {
        return;
      }

      const details = ctx.packagePinState(pin);
      const regexMatchers = typeof ctx.getActiveRegexMatchers === "function" ? ctx.getActiveRegexMatchers() : [];

      packageUi.activePin = pin;
      packageUi.activePinNode = targetNode;
      targetNode.setAttribute("aria-expanded", "true");

      const picker = packageUi.picker;
      picker.replaceChildren();

      const header = document.createElement("div");
      header.className = "package-picker-header";

      const title = document.createElement("div");
      title.className = "package-picker-title";
        title.textContent = `${pin.position} ${details.names.length > 0 ? details.names.join(" ") : pin.short_name}`.trim();
      header.append(title);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "package-picker-close";
      closeButton.textContent = "Close";
      closeButton.addEventListener("click", () => ctx.closePackageFunctionPicker());
      header.append(closeButton);

      picker.append(header);

      const summary = document.createElement("div");
      summary.className = "package-picker-summary";
      if (details.rowStates.length > 1) {
        const commentPrefix = details.comment ? ` Comment: ${details.comment}` : "";
        summary.textContent = `This package pin maps to ${details.rowStates.length} table entries. Configure each entry separately.${commentPrefix}`;
      } else {
        summary.textContent = details.comment
          ? `Comment: ${details.comment}`
          : "Select the active functions for this pin.";
      }
      picker.append(summary);

      if (details.rowStates.every((rowState) => rowState.availableFunctions.length === 0)) {
        const empty = document.createElement("div");
        empty.className = "package-picker-empty";
        empty.textContent = "No selectable functions are available for this pin.";
        picker.append(empty);
      } else {
        const sections = document.createElement("div");
        sections.className = "package-picker-sections";

        details.rowStates.forEach((rowState, index) => {
          const section = document.createElement("section");
          section.className = "package-picker-section";

          const sectionHeader = document.createElement("div");
          sectionHeader.className = "package-picker-section-header";

          const sectionTitle = document.createElement("div");
          sectionTitle.className = "package-picker-section-title";
          sectionTitle.textContent = rowState.shortName || `Entry ${index + 1}`;
          sectionHeader.append(sectionTitle);

          if (rowState.comment) {
            const sectionMeta = document.createElement("div");
            sectionMeta.className = "package-picker-section-meta";
            sectionMeta.textContent = rowState.comment;
            sectionHeader.append(sectionMeta);
          }

          section.append(sectionHeader);

          const orderedFunctions = regexMatchers.length > 0 && typeof ctx.prioritizeFunctionsByRegex === "function"
            ? ctx.prioritizeFunctionsByRegex(rowState.availableFunctions, regexMatchers)
            : rowState.availableFunctions;

          if (orderedFunctions.length === 0) {
            const sectionEmpty = document.createElement("div");
            sectionEmpty.className = "package-picker-section-empty";
            sectionEmpty.textContent = "No selectable functions are available for this entry.";
            section.append(sectionEmpty);
          } else {
            const options = document.createElement("div");
            options.className = "package-picker-options";

            for (const fn of orderedFunctions) {
              const optionLabel = document.createElement("label");
              optionLabel.className = "package-picker-option";

              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.value = fn;
              checkbox.checked = rowState.selectedFunctions.includes(fn);
              checkbox.addEventListener("change", () => {
                const selectedValues = Array.from(
                  options.querySelectorAll('input[type="checkbox"]:checked'),
                  (node) => node.value,
                );
                ctx.updateSelectedFunctionsForRow(rowState.rowId, selectedValues);
                ctx.updatePackageDetail(ctx.describePackagePin(pin));
              });
              optionLabel.append(checkbox);

              const textNode = document.createElement("span");
              textNode.textContent = fn;
              optionLabel.append(textNode);
              options.append(optionLabel);
            }

            section.append(options);
          }

          sections.append(section);
        });

        picker.append(sections);
      }

      const actions = document.createElement("div");
      actions.className = "package-picker-actions";

      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "package-picker-clear";
      clearButton.textContent = details.rowStates.length > 1 ? "Clear all selections" : "Clear selection";
      clearButton.addEventListener("click", () => {
        for (const checkbox of picker.querySelectorAll('input[type="checkbox"]')) {
          checkbox.checked = false;
        }
        ctx.updateSelectedFunctionsForPackagePin(pin, []);
        ctx.updatePackageDetail(ctx.describePackagePin(pin));
      });
      actions.append(clearButton);

      const rowButton = document.createElement("button");
      rowButton.type = "button";
      rowButton.className = "package-picker-row-link";
      rowButton.textContent = details.rowStates.length > 1 ? "Locate rows" : "Locate row";
      rowButton.addEventListener("click", () => ctx.focusTableRowForPackagePin(pin));
      actions.append(rowButton);

      picker.append(actions);
      ctx.updatePackageDetail(ctx.describePackagePin(pin));
      ctx.positionPackageOverlay(picker, targetNode);

      const firstFocusable = picker.querySelector('input[type="checkbox"], button');
      if (firstFocusable) {
        firstFocusable.focus();
      }
    };

    ctx.togglePackageFunctionPicker = function togglePackageFunctionPicker(targetNode, pin) {
      const packageUi = ctx.packageUi || null;
      if (
        packageUi &&
        packageUi.activePin &&
        packageUi.activePinNode === targetNode &&
        String(packageUi.activePin.row_id) === String(pin.row_id) &&
        !packageUi.picker.hidden
      ) {
        ctx.closePackageFunctionPicker();
        return;
      }

      ctx.openPackageFunctionPicker(targetNode, pin);
    };

    ctx.bindPackagePinInteractions = function bindPackagePinInteractions(node, pin) {
      const rowIds = ctx.packagePinRowIds(pin);
      const show = () => {
        ctx.setHoveredPackageRows(rowIds);
        ctx.showPackageTooltip(node, pin);
      };
      const reset = () => {
        ctx.hidePackageTooltip();
        ctx.clearHoveredPackageRows(rowIds);
      };
      ctx.registerPackagePinNode(pin, node);
      node.addEventListener("mouseenter", show);
      node.addEventListener("focus", show);
      node.addEventListener("mouseleave", reset);
      node.addEventListener("blur", reset);
      node.addEventListener("click", (event) => {
        if (ctx.shouldSuppressPackageClick()) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        ctx.togglePackageFunctionPicker(node, pin);
      });
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        ctx.togglePackageFunctionPicker(node, pin);
      });
    };

    ctx.renderDualPackage = function renderDualPackage(svg, pins, packageName) {
      const viewWidth = 460;
      const pinsPerSide = Math.max(1, Math.ceil(pins.length / 2));
      const bodyHeight = Math.max(220, pinsPerSide * 30 + 54);
      const viewHeight = bodyHeight + 120;
      const bodyWidth = 176;
      const bodyX = (viewWidth - bodyWidth) / 2;
      const bodyY = 60;
      const pinLength = 34;
      const pinThickness = Math.max(10, Math.min(18, (bodyHeight - 36) / pinsPerSide * 0.48));
      const leftPins = pins.slice(0, pinsPerSide);
      const rightPins = pins.slice(pinsPerSide).reverse();
      const pitch = leftPins.length > 1 ? (bodyHeight - 36) / (leftPins.length - 1) : 0;

      svg.append(svgNode("rect", {
        x: bodyX,
        y: bodyY,
        width: bodyWidth,
        height: bodyHeight,
        rx: 18,
        ry: 18,
        class: "package-body",
      }));

      const renderSide = (sidePins, side) => {
        sidePins.forEach((pin, index) => {
          const y = bodyY + 18 + (pitch || 0) * index - pinThickness / 2;
          const x = side === "left" ? bodyX - pinLength : bodyX + bodyWidth;
          const pinNode = svgNode("rect", {
            x,
            y,
            width: pinLength,
            height: pinThickness,
            rx: 4,
            ry: 4,
            tabindex: 0,
            role: "button",
            "aria-haspopup": "dialog",
            "aria-expanded": "false",
            class: `package-pin ${ctx.packageTypeClass(pin.type)}`,
          });
          const titleNode = svgNode("title");
          titleNode.textContent = titleText(pin);
          pinNode.append(titleNode);
          svg.append(pinNode);
          ctx.bindPackagePinInteractions(pinNode, pin);

          const textNode = svgNode("text", {
            x: side === "left" ? x - 10 : x + pinLength + 10,
            y: y + pinThickness / 2 + 4,
            class: "package-pin-position",
            "text-anchor": side === "left" ? "end" : "start",
          });
          textNode.textContent = pin.position;
          svg.append(textNode);

          ctx.renderOutsidePinName(svg, pin, {
            x: side === "left" ? bodyX + 8 : bodyX + bodyWidth - 8,
            y: y + pinThickness / 2 + 4,
            anchor: side === "left" ? "start" : "end",
          });
        });
      };

      renderSide(leftPins, "left");
      renderSide(rightPins, "right");
      svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
    };

    ctx.renderEdgePackage = function renderEdgePackage(svg, pins, packageName) {
      const viewSize = 520;
      const bodyX = 120;
      const bodyY = 120;
      const bodySize = 280;
      const pinDepth = 24;
      const baseCount = Math.floor(pins.length / 4);
      const remainder = pins.length % 4;
      const counts = [
        baseCount + (remainder > 0 ? 1 : 0),
        baseCount + (remainder > 1 ? 1 : 0),
        baseCount + (remainder > 2 ? 1 : 0),
        baseCount,
      ];
      const groups = [];
      let cursor = 0;
      for (const count of counts) {
        groups.push(pins.slice(cursor, cursor + count));
        cursor += count;
      }

      svg.append(svgNode("rect", {
        x: bodyX,
        y: bodyY,
        width: bodySize,
        height: bodySize,
        rx: 18,
        ry: 18,
        class: "package-body",
      }));

      const edgeConfigs = [
        { side: "top", count: counts[0] },
        { side: "right", count: counts[1] },
        { side: "bottom", count: counts[2] },
        { side: "left", count: counts[3] },
      ];
      const pinsBySide = {
        top: groups[0],
        right: groups[1],
        bottom: groups[2],
        left: groups[3],
      };

      for (const edge of edgeConfigs) {
        const edgePins = pinsBySide[edge.side] || [];
        if (edgePins.length === 0) {
          continue;
        }

        const pitch = bodySize / edgePins.length;
        const pinSpan = Math.max(10, Math.min(28, pitch * 0.72));
        const showLabel = pitch >= 20;
        const showName = pitch >= 26;

        edgePins.forEach((pin, index) => {
          let x = bodyX;
          let y = bodyY;
          let width = pinSpan;
          let height = pinDepth;
          let textX = 0;
          let textY = 0;
          let nameX = 0;
          let nameY = 0;
          let nameAnchor = "middle";

          if (edge.side === "top") {
            x = bodyX + pitch * index + (pitch - pinSpan) / 2;
            y = bodyY - pinDepth;
            textX = x + width / 2;
            textY = y - 6;
            nameX = x + width / 2;
            nameY = bodyY + 14;
          } else if (edge.side === "right") {
            x = bodyX + bodySize;
            y = bodyY + pitch * index + (pitch - pinSpan) / 2;
            width = pinDepth;
            height = pinSpan;
            textX = x + width + 10;
            textY = y + height / 2 + 4;
            nameX = bodyX + bodySize - 8;
            nameY = y + height / 2 + 4;
            nameAnchor = "end";
          } else if (edge.side === "bottom") {
            x = bodyX + bodySize - pitch * (index + 1) + (pitch - pinSpan) / 2;
            y = bodyY + bodySize;
            textX = x + width / 2;
            textY = y + height + 14;
            nameX = x + width / 2;
            nameY = bodyY + bodySize - 8;
          } else {
            x = bodyX - pinDepth;
            y = bodyY + bodySize - pitch * (index + 1) + (pitch - pinSpan) / 2;
            width = pinDepth;
            height = pinSpan;
            textX = x - 10;
            textY = y + height / 2 + 4;
            nameX = bodyX + 8;
            nameY = y + height / 2 + 4;
            nameAnchor = "start";
          }

          const pinNode = svgNode("rect", {
            x,
            y,
            width,
            height,
            rx: 4,
            ry: 4,
            tabindex: 0,
            role: "button",
            "aria-haspopup": "dialog",
            "aria-expanded": "false",
            class: `package-pin ${ctx.packageTypeClass(pin.type)}`,
          });
          const titleNode = svgNode("title");
          titleNode.textContent = titleText(pin);
          pinNode.append(titleNode);
          svg.append(pinNode);
          ctx.bindPackagePinInteractions(pinNode, pin);

          if (showLabel) {
            const textNode = svgNode("text", {
              x: textX,
              y: textY,
              class: "package-pin-position",
              "text-anchor": edge.side === "left" ? "end" : edge.side === "right" ? "start" : "middle",
            });
            textNode.textContent = pin.position;
            svg.append(textNode);
          }

          if (showName) {
            ctx.renderOutsidePinName(svg, pin, {
              x: nameX,
              y: nameY,
              anchor: nameAnchor,
            });
          }
        });
      }

      svg.setAttribute("viewBox", `0 0 ${viewSize} ${viewSize}`);
    };

    ctx.renderGridPackage = function renderGridPackage(svg, pins, packageName) {
      const parsedPins = pins
        .map((pin) => {
          const match = GRID_POSITION_RE.exec(pin.position);
          if (!match || !match.groups) {
            return null;
          }
          return {
            ...pin,
            row: String(match.groups.row).toUpperCase(),
            column: Number(match.groups.column),
          };
        })
        .filter((pin) => pin !== null);
      if (parsedPins.length === 0) {
        return;
      }

      const rows = Array.from(new Set(parsedPins.map((pin) => pin.row)));
      const columns = Array.from(new Set(parsedPins.map((pin) => pin.column))).sort((left, right) => left - right);
      const viewSize = 560;
      const margin = 90;
      const bodyX = margin;
      const bodyY = margin;
      const bodySize = viewSize - margin * 2;
      const cellWidth = columns.length > 1 ? bodySize / (columns.length - 1) : 0;
      const cellHeight = rows.length > 1 ? bodySize / (rows.length - 1) : 0;
      const dotRadius = Math.max(6, Math.min(13, Math.min(cellWidth || 26, cellHeight || 26) * 0.28));
      const rowIndex = new Map(rows.map((row, index) => [row, index]));
      const columnIndex = new Map(columns.map((column, index) => [column, index]));

      svg.append(svgNode("rect", {
        x: bodyX - 22,
        y: bodyY - 22,
        width: bodySize + 44,
        height: bodySize + 44,
        rx: 26,
        ry: 26,
        class: "package-body",
      }));

      if (columns.length <= 24) {
        for (const column of columns) {
          const x = bodyX + columnIndex.get(column) * (cellWidth || 0);
          const topLabel = svgNode("text", {
            x,
            y: bodyY - 36,
            class: "package-axis-label",
            "text-anchor": "middle",
          });
          topLabel.textContent = String(column);
          svg.append(topLabel);
        }
      }

      if (rows.length <= 24) {
        for (const row of rows) {
          const y = bodyY + rowIndex.get(row) * (cellHeight || 0) + 4;
          const leftLabel = svgNode("text", {
            x: bodyX - 36,
            y,
            class: "package-axis-label",
            "text-anchor": "middle",
          });
          leftLabel.textContent = row;
          svg.append(leftLabel);
        }
      }

      for (const pin of parsedPins) {
        const x = bodyX + columnIndex.get(pin.column) * (cellWidth || 0);
        const y = bodyY + rowIndex.get(pin.row) * (cellHeight || 0);
        const pinNode = svgNode("circle", {
          cx: x,
          cy: y,
          r: dotRadius,
          tabindex: 0,
          role: "button",
          "aria-haspopup": "dialog",
          "aria-expanded": "false",
          class: `package-pin ${ctx.packageTypeClass(pin.type)}`,
        });
        const titleNode = svgNode("title");
        titleNode.textContent = titleText(pin);
        pinNode.append(titleNode);
        svg.append(pinNode);
        ctx.bindPackagePinInteractions(pinNode, pin);
        ctx.renderGridPinName(svg, pin, x, y, dotRadius);
      }

      svg.setAttribute("viewBox", `0 0 ${viewSize} ${viewSize}`);
    };

    const fallbackPackageRenderer = {
      id: "fallback-edge",
      label: "Edge package",
      category: "edge",
      defaultWidth(packageModel) {
        return clamp(620 + Math.max(0, packageModel.pins.length - 64) * 1.2, 620, 980);
      },
      zoomConfig() {
        return { min: 0.7, max: 2.0, step: 0.15 };
      },
      render(packageModel) {
        ctx.renderEdgePackage(packageModel.svg, packageModel.pins, packageModel.packageName);
      },
    };

    ctx.resolvePackageRenderer = function resolvePackageRenderer(packageModel) {
      const registeredRenderers = Array.isArray(api.packageRenderers) ? api.packageRenderers : [];
      for (let index = registeredRenderers.length - 1; index >= 0; index -= 1) {
        const renderer = registeredRenderers[index];
        if (!renderer || typeof renderer.matches !== "function" || typeof renderer.render !== "function") {
          continue;
        }
        if (renderer.matches(packageModel)) {
          return renderer;
        }
      }
      return fallbackPackageRenderer;
    };

    ctx.packageRenderModel = function packageRenderModel() {
      const packageData = ctx.DEVICE_DATA && ctx.DEVICE_DATA.package ? ctx.DEVICE_DATA.package : null;
      const packageModel = {
        ctx,
        svg: null,
        packageName: packageData && typeof packageData.name === "string" ? packageData.name : "",
        pins: ctx.packagePins(),
      };
      packageModel.renderer = ctx.resolvePackageRenderer(packageModel);
      packageModel.category = packageModel.renderer && packageModel.renderer.category
        ? String(packageModel.renderer.category)
        : "edge";
      return packageModel;
    };

    ctx.packageRendererLabel = function packageRendererLabel(packageModel) {
      const renderer = packageModel.renderer || fallbackPackageRenderer;
      const label = renderer
        ? (typeof renderer.label === "function" ? renderer.label(packageModel) : renderer.label)
        : "";
      return label ? String(label) : "Package";
    };

    ctx.packageRendererDefaultWidth = function packageRendererDefaultWidth(packageModel) {
      const renderer = packageModel.renderer || fallbackPackageRenderer;
      if (renderer && typeof renderer.defaultWidth === "function") {
        return renderer.defaultWidth(packageModel);
      }
      return fallbackPackageRenderer.defaultWidth(packageModel);
    };

    ctx.packageRendererZoomConfig = function packageRendererZoomConfig(packageModel) {
      const renderer = packageModel.renderer || fallbackPackageRenderer;
      if (renderer && typeof renderer.zoomConfig === "function") {
        return renderer.zoomConfig(packageModel);
      }
      return fallbackPackageRenderer.zoomConfig(packageModel);
    };

    ctx.renderPackageDiagram = function renderPackageDiagram() {
      const mountNode = document.getElementById("package-diagram");
      const controlsNode = document.getElementById("package-view-controls");
      const subtitleNode = document.getElementById("package-subtitle");
      if (!mountNode) {
        return;
      }

      mountNode.replaceChildren();
      if (controlsNode) {
        controlsNode.replaceChildren();
      }
      const packageModel = ctx.packageRenderModel();
      const pins = packageModel.pins;
      const kind = packageModel.category;
      const packageName = packageModel.packageName;
      const renderer = packageModel.renderer;

      if (subtitleNode) {
        const kindLabel = ctx.packageRendererLabel(packageModel);
        subtitleNode.textContent = packageName ? `${packageName} | ${kindLabel}` : kindLabel;
      }

      if (pins.length === 0) {
        ctx.updatePackageDetail("No package information available.");
        return;
      }

      ctx.bindPackageGlobalHandlers();
      const stage = document.createElement("div");
      stage.className = "package-stage";
      const svg = svgNode("svg", {
        class: `package-svg package-svg-${kind}`,
        "data-package-kind": kind,
        "data-package-renderer": renderer && renderer.id ? String(renderer.id) : kind,
        "aria-hidden": "true",
      });
      packageModel.svg = svg;

      const tooltip = document.createElement("div");
      tooltip.className = "package-tooltip";
      tooltip.hidden = true;

      const picker = document.createElement("div");
      picker.className = "package-function-picker";
      picker.hidden = true;

      const zoomControls = ctx.renderPackageZoomControls();

      ctx.packageUi = {
        mountNode,
        stage,
        svg,
        tooltip,
        picker,
        activePin: null,
        activePinNode: null,
        pinNodesByRowId: new Map(),
        hoveredRowIds: new Set(),
        highlightedRowIds: new Set(),
        highlightedField: null,
        baseWidth: ctx.packageRendererDefaultWidth(packageModel),
        zoom: 1,
        zoomConfig: ctx.packageRendererZoomConfig(packageModel),
        zoomOutButton: zoomControls ? zoomControls.zoomOutButton : null,
        zoomInButton: zoomControls ? zoomControls.zoomInButton : null,
        zoomLabel: zoomControls ? zoomControls.zoomLabel : null,
        viewportHeight: mountNode.getBoundingClientRect().height || 640,
        mouseDrag: null,
        touchGesture: null,
        suppressClickUntil: 0,
        rendererId: renderer && renderer.id ? String(renderer.id) : kind,
      };

      renderer.render(packageModel);

      stage.append(svg, tooltip, picker);
      mountNode.append(stage);
      ctx.setPackageViewportHeight(ctx.packageUi.viewportHeight);
      ctx.packageUi.baseWidth = ctx.fitPackageBaseWidthToViewport(ctx.packageUi.baseWidth);
      ctx.bindPackageZoomControls();
      ctx.applyPackageZoom();
      ctx.resetPackageDetail();
    };
  };
}(window));