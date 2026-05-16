"use strict";

(function registerModmPinoutIo(global) {
  const api = global.ModmPinout = global.ModmPinout || {};

  api.attachImportExport = function attachImportExport(ctx) {
    const state = ctx.state;

    ctx.buildExportJsonPayload = function buildExportJsonPayload() {
      ctx.refreshRegexPatternsFromHeaders();

      const rows = (ctx.table ? ctx.table.getData() : ctx.buildRows())
        .slice()
        .sort((a, b) => ctx.compareRowIdValues(a.row_id, b.row_id))
        .map((row) => {
          const selectedFunctions = ctx.normalizeSelectedFunctionList(row.selected_function);
          return {
            pin: String(row.position || ""),
            name: String(row.short_name || ""),
            functions: selectedFunctions,
            comment: String(row.internal_name || ""),
          };
        });

      const regexColumns = state.regexColumns.map((meta) => ({
        title: String(meta.title || ""),
        pattern: String(meta.pattern || ""),
      }));

      return {
        version: 1,
        format: "modm-pinout",
        chipId: String(ctx.DEVICE_DATA.chip_id || ""),
        partname: String(ctx.DEVICE_DATA.partname || ""),
        exportedAt: new Date().toISOString(),
        rows,
        regexColumns,
      };
    };

    ctx.buildExportJsonString = function buildExportJsonString() {
      return `${JSON.stringify(ctx.buildExportJsonPayload(), null, 2)}\n`;
    };

    ctx.downloadJsonExport = function downloadJsonExport() {
      const jsonText = ctx.buildExportJsonString();
      const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(ctx.DEVICE_DATA.chip_id || "pinout")}_pinout.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      ctx.setStatus("Exported JSON file.");
    };

    ctx.parseImportJson = function parseImportJson(jsonText) {
      let parsedDoc;
      try {
        parsedDoc = JSON.parse(jsonText);
      } catch (_error) {
        throw new Error("Invalid JSON file.");
      }

      if (!parsedDoc || typeof parsedDoc !== "object" || Array.isArray(parsedDoc)) {
        throw new Error("Unsupported JSON format. Expected object root.");
      }

      const rowNodes = Array.isArray(parsedDoc.rows)
        ? parsedDoc.rows.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        : [];
      const regexNodes = Array.isArray(parsedDoc.regexColumns)
        ? parsedDoc.regexColumns.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        : [];

      return {
        sourceChipId: parsedDoc.chipId == null ? "" : String(parsedDoc.chipId),
        sourcePartname: parsedDoc.partname == null ? "" : String(parsedDoc.partname),
        rowNodes,
        regexNodes,
      };
    };

    ctx.importJsonText = async function importJsonText(jsonText) {
      const parsed = ctx.parseImportJson(jsonText);
      const tableRows = ctx.table ? ctx.table.getData() : ctx.buildRows();
      const destinationRows = tableRows
        .filter((row) => !row.is_unmapped)
        .slice()
        .sort((a, b) => ctx.compareRowIdValues(a.row_id, b.row_id));

      const rowsByPinPosition = new Map();
      for (const row of destinationRows) {
        const positionKey = String(row.position || "").trim();
        if (!positionKey || rowsByPinPosition.has(positionKey)) {
          continue;
        }
        rowsByPinPosition.set(positionKey, row);
      }

      const sourcePartname = String(parsed.sourcePartname || "");
      const targetPartname = String(ctx.DEVICE_DATA.partname || "");
      const usePinPositionMapping = sourcePartname !== "" && sourcePartname === targetPartname;
      const mappingModeLabel = usePinPositionMapping ? "pin position" : "pin name";

      const availableRowsByName = new Map();
      const destinationNameCounts = new Map();
      if (!usePinPositionMapping) {
        for (const row of destinationRows) {
          const nameKey = ctx.normalizePinNameKey(row.short_name);
          if (!nameKey) {
            continue;
          }

          if (!availableRowsByName.has(nameKey)) {
            availableRowsByName.set(nameKey, []);
          }
          availableRowsByName.get(nameKey).push(row);
          destinationNameCounts.set(nameKey, (destinationNameCounts.get(nameKey) || 0) + 1);
        }
      }

      const nextSelectedByRowId = {};
      const nextNamesByRowId = {};
      const nextReviewByRowId = {};
      const nextUnmappedRows = [];
      let importedRows = 0;
      let skippedFunctions = 0;
      let ambiguousRows = 0;
      let unmappedRows = 0;

      const createUnmappedRowId = () => `unmapped_${nextUnmappedRows.length + 1}`;

      for (const node of parsed.rowNodes) {
        const importedName = String(node.name ?? node.short_name ?? "").trim();
        const importedComment = String(
          node.comment ?? node.refName ?? node.ref_name ?? node.internal_name ?? ""
        ).trim();
        const importedPin = String(node.pin ?? node.position ?? "").trim();
        const fallbackName = importedPin;
        const displayName = importedName || fallbackName || "UNMAPPED";

        let row = null;
        let nameKey = "";
        if (usePinPositionMapping) {
          row = importedPin ? (rowsByPinPosition.get(importedPin) || null) : null;
        } else {
          nameKey = ctx.normalizePinNameKey(displayName);
          const bucket = nameKey ? availableRowsByName.get(nameKey) : null;
          row = bucket && bucket.length > 0 ? bucket.shift() : null;
        }

        if (!row) {
          const unmappedRowId = createUnmappedRowId();
          nextUnmappedRows.push({
            row_id: unmappedRowId,
            short_name: displayName,
            internal_name: importedComment,
          });
          nextReviewByRowId[unmappedRowId] = true;
          if (importedComment) {
            nextNamesByRowId[unmappedRowId] = importedComment;
          }
          unmappedRows += 1;
          continue;
        }

        importedRows += 1;
        const rowId = String(row.row_id);

        if (!usePinPositionMapping && (destinationNameCounts.get(nameKey) || 0) > 1) {
          nextReviewByRowId[rowId] = true;
          ambiguousRows += 1;
        }

        const importedCandidates = [];
        if (Array.isArray(node.functions)) {
          importedCandidates.push(...node.functions);
        }
        if (Array.isArray(node.function)) {
          importedCandidates.push(...node.function);
        } else if (node.function != null && String(node.function).trim() !== "") {
          importedCandidates.push(node.function);
        }
        if (Array.isArray(node.selected_function)) {
          importedCandidates.push(...node.selected_function);
        } else if (node.selected_function != null && String(node.selected_function).trim() !== "") {
          importedCandidates.push(node.selected_function);
        }

        const requestedFunctions = ctx.normalizeSelectedFunctionList(importedCandidates);
        if (requestedFunctions.length > 0) {
          const availableFunctions = Array.isArray(row.functions) ? row.functions : [];
          const validFunctions = ctx.normalizeSelectedFunctionList(requestedFunctions, availableFunctions);
          skippedFunctions += Math.max(0, requestedFunctions.length - validFunctions.length);
          if (validFunctions.length > 0) {
            nextSelectedByRowId[rowId] = validFunctions;
          }
        }

        if (importedComment) {
          nextNamesByRowId[rowId] = importedComment;
        }
      }

      const nextRegexColumns = parsed.regexNodes.map((node, index) => ({
        id: index + 1,
        field: `regex_${index + 1}`,
        title: String(node.title ?? "").trim() || `Regex ${index + 1}`,
        pattern: String(node.pattern ?? ""),
      }));

      state.selectedByRowId = nextSelectedByRowId;
      state.namesByRowId = nextNamesByRowId;
      state.reviewByRowId = nextReviewByRowId;
      state.unmappedRows = nextUnmappedRows;
      state.regexColumns = nextRegexColumns;
      state.nextRegexId = nextRegexColumns.length + 1;

      await ctx.applyStateToTable();
      ctx.saveStateNow();

      let statusMessage = `Imported JSON: ${importedRows} row(s), ${nextRegexColumns.length} regex column(s).`;
      statusMessage += ` Mapping strategy: ${mappingModeLabel}.`;
      if (ambiguousRows > 0) {
        statusMessage += ` ${ambiguousRows} row(s) are ambiguous and were marked bold for review.`;
      }
      if (unmappedRows > 0) {
        statusMessage += ` ${unmappedRows} row(s) could not be mapped by ${mappingModeLabel} and were appended at the bottom.`;
      }
      if (skippedFunctions > 0) {
        statusMessage += ` ${skippedFunctions} function value(s) were not valid for this device and were ignored.`;
      }
      if (
        parsed.sourceChipId &&
        String(parsed.sourceChipId).toLowerCase() !== String(ctx.DEVICE_DATA.chip_id || "").toLowerCase()
      ) {
        statusMessage += ` Source chip '${parsed.sourceChipId}' differs from current '${ctx.DEVICE_DATA.chip_id}'.`;
      }

      ctx.setStatus(statusMessage);
    };
  };
}(window));