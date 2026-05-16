"use strict";

(function registerModmPinoutCore(global) {
  const api = global.ModmPinout = global.ModmPinout || {};

  api.createContext = function createContext(config) {
    const deviceData = config && config.deviceData ? config.deviceData : null;
    const cookieKey = config && typeof config.cookieKey === "string" ? config.cookieKey : "";

    if (!deviceData || typeof deviceData !== "object") {
      throw new Error("Missing device data.");
    }
    if (!cookieKey) {
      throw new Error("Missing cookie key.");
    }

    return {
      DEVICE_DATA: deviceData,
      COOKIE_KEY: cookieKey,
      SAVE_DAYS: 365,
      COOKIE_MAX_VALUE_BYTES: 3800,
      SHARE_URL_PARAM: "share",
      SHARE_URL_FORMAT: "modm-pinout-share",
      SHARE_URL_VERSION: 1,
      ADD_REGEX_FIELD: "__add_regex__",
      BASE_REGEX_FILTER_FIELDS: ["position", "short_name", "selected_function", "internal_name"],
      table: null,
      saveTimer: null,
      htmlDecodeNode: null,
      textMeasureCtx: null,
      state: {
        selectedByRowId: {},
        namesByRowId: {},
        baseFilterPatterns: {},
        reviewByRowId: {},
        unmappedRows: [],
        regexColumns: [],
        nextRegexId: 1,
      },
    };
  };

  api.attachCore = function attachCore(ctx) {
    const state = ctx.state;

    ctx.escapeHtml = function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    };

    ctx.setStatus = function setStatus(message, isError = false) {
      const node = document.getElementById("save-status");
      node.textContent = message;
      node.classList.toggle("error", isError);
    };

    ctx.debounce = function debounce(fn, waitMs) {
      return function debounced(...args) {
        if (ctx.saveTimer !== null) {
          window.clearTimeout(ctx.saveTimer);
        }
        ctx.saveTimer = window.setTimeout(() => fn(...args), waitMs);
      };
    };

    ctx.normalizeRegexColumn = function normalizeRegexColumn(meta) {
      if (!meta || typeof meta !== "object") {
        return null;
      }
      const id = Number(meta.id);
      if (!Number.isInteger(id) || id <= 0) {
        return null;
      }
      const title = typeof meta.title === "string" && meta.title.trim()
        ? meta.title.trim()
        : `Regex ${id}`;
      const pattern = typeof meta.pattern === "string" ? meta.pattern : "";
      return {
        id,
        field: `regex_${id}`,
        title,
        pattern,
      };
    };

    ctx.normalizeSelectedFunctionList = function normalizeSelectedFunctionList(value, availableFunctions = null) {
      const allowedSet = Array.isArray(availableFunctions) ? new Set(availableFunctions) : null;
      const rawValues = Array.isArray(value)
        ? value
        : (typeof value === "string" || typeof value === "number" ? [value] : []);

      const normalized = [];
      const seen = new Set();
      for (const entry of rawValues) {
        const item = String(entry ?? "").trim();
        if (!item || seen.has(item)) {
          continue;
        }
        if (allowedSet && !allowedSet.has(item)) {
          continue;
        }

        seen.add(item);
        normalized.push(item);
      }

      return normalized;
    };

    ctx.renderSelectedFunctionsHtml = function renderSelectedFunctionsHtml(value) {
      const selected = ctx.normalizeSelectedFunctionList(value);
      return selected.map((fn) => ctx.escapeHtml(fn)).join("<br>");
    };

    ctx.decodeHtmlText = function decodeHtmlText(value) {
      const text = String(value || "");
      if (!text || text.indexOf("&") < 0) {
        return text;
      }

      if (!ctx.htmlDecodeNode) {
        ctx.htmlDecodeNode = document.createElement("textarea");
      }
      ctx.htmlDecodeNode.innerHTML = text;
      return ctx.htmlDecodeNode.value;
    };

    ctx.valueToSortableText = function valueToSortableText(value) {
      if (Array.isArray(value)) {
        return ctx.normalizeSelectedFunctionList(value).join("\n");
      }

      if (value == null) {
        return "";
      }

      const withBreaks = String(value).replace(/<br\s*\/?>/gi, "\n");
      const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
      return ctx.decodeHtmlText(withoutTags).trim();
    };

    ctx.compareNaturalText = function compareNaturalText(left, right) {
      return String(left || "").localeCompare(String(right || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    };

    ctx.displayedTextSorter = function displayedTextSorter(a, b) {
      return ctx.compareNaturalText(ctx.valueToSortableText(a), ctx.valueToSortableText(b));
    };

    ctx.pinSorter = function pinSorter(a, b) {
      const left = String(a || "").trim();
      const right = String(b || "").trim();
      const leftIsInt = /^\d+$/.test(left);
      const rightIsInt = /^\d+$/.test(right);

      if (leftIsInt && rightIsInt) {
        return Number(left) - Number(right);
      }
      if (leftIsInt) {
        return -1;
      }
      if (rightIsInt) {
        return 1;
      }

      return ctx.compareNaturalText(left, right);
    };

    ctx.compareRowIdValues = function compareRowIdValues(left, right) {
      const leftRaw = String(left ?? "");
      const rightRaw = String(right ?? "");
      const leftNum = Number(leftRaw);
      const rightNum = Number(rightRaw);
      const leftIsNumeric = Number.isFinite(leftNum) && leftRaw.trim() !== "";
      const rightIsNumeric = Number.isFinite(rightNum) && rightRaw.trim() !== "";

      if (leftIsNumeric && rightIsNumeric) {
        return leftNum - rightNum;
      }
      if (leftIsNumeric) {
        return -1;
      }
      if (rightIsNumeric) {
        return 1;
      }

      return ctx.compareNaturalText(leftRaw, rightRaw);
    };

    ctx.normalizePinNameKey = function normalizePinNameKey(value) {
      return String(value ?? "").trim().toUpperCase();
    };

    ctx.normalizeStoredUnmappedRow = function normalizeStoredUnmappedRow(node, index) {
      if (!node || typeof node !== "object") {
        return null;
      }

      const shortName = String(node.short_name ?? node.name ?? "").trim();
      if (!shortName) {
        return null;
      }

      const idCandidate = String(node.row_id ?? "").trim();
      const rowId = idCandidate.startsWith("unmapped_") ? idCandidate : `unmapped_${index + 1}`;
      return {
        row_id: rowId,
        short_name: shortName,
        internal_name: String(node.internal_name ?? node.refName ?? node.ref_name ?? "").trim(),
      };
    };

    ctx.buildRows = function buildRows() {
      const rows = ctx.DEVICE_DATA.rows.map((row) => {
        const rowId = String(row.row_id);
        const functions = Array.isArray(row.functions) ? row.functions.slice() : [];
        const selected = state.selectedByRowId[rowId];
        const internalName = state.namesByRowId[rowId];
        const selectedFunction = ctx.normalizeSelectedFunctionList(selected, functions);
        const resolvedInternalName = typeof internalName === "string" ? internalName : "";

        return {
          row_id: row.row_id,
          position: row.position,
          short_name: row.short_name,
          pin_label: row.pin_label,
          functions,
          selected_function: selectedFunction,
          internal_name: resolvedInternalName,
          needs_review: Boolean(state.reviewByRowId[rowId]),
          is_unmapped: false,
        };
      });

      const existingRowIds = new Set(rows.map((row) => String(row.row_id)));
      const normalizedUnmappedRows = state.unmappedRows
        .map((node, index) => ctx.normalizeStoredUnmappedRow(node, index))
        .filter((node) => node !== null);

      for (const [index, row] of normalizedUnmappedRows.entries()) {
        let rowId = String(row.row_id || `unmapped_${index + 1}`);
        if (!rowId.startsWith("unmapped_")) {
          rowId = `unmapped_${index + 1}`;
        }

        if (existingRowIds.has(rowId)) {
          let suffix = 1;
          while (existingRowIds.has(`${rowId}_${suffix}`)) {
            suffix += 1;
          }
          rowId = `${rowId}_${suffix}`;
        }

        existingRowIds.add(rowId);
        const internalName = state.namesByRowId[rowId];
        rows.push({
          row_id: rowId,
          position: "",
          short_name: row.short_name,
          pin_label: row.short_name,
          functions: [],
          selected_function: [],
          internal_name: typeof internalName === "string" ? internalName : row.internal_name,
          needs_review: Boolean(state.reviewByRowId[rowId]),
          is_unmapped: true,
        });
      }

      return rows;
    };

    ctx.getRowDataById = function getRowDataById(rowId) {
      const rowKey = String(rowId);
      if (ctx.table) {
        const tableRow = ctx.table.getRow(rowId);
        if (tableRow) {
          return tableRow.getData();
        }
      }

      return ctx.buildRows().find((row) => String(row.row_id) === rowKey) || null;
    };

    ctx.updateSelectedFunctionsForRow = function updateSelectedFunctionsForRow(rowId, value) {
      const rowKey = String(rowId);
      const rowData = ctx.getRowDataById(rowKey);
      if (!rowData) {
        return [];
      }

      const availableFunctions = Array.isArray(rowData.functions) ? rowData.functions : [];
      const normalized = ctx.normalizeSelectedFunctionList(value, availableFunctions);

      if (normalized.length > 0) {
        state.selectedByRowId[rowKey] = normalized;
      } else {
        delete state.selectedByRowId[rowKey];
      }

      if (ctx.table) {
        const tableRow = ctx.table.getRow(rowId);
        if (tableRow) {
          Promise.resolve(tableRow.update({ selected_function: normalized })).then(() => {
            if (typeof tableRow.reformat === "function") {
              tableRow.reformat();
            }
          });
        }
      }

      ctx.saveStateDebounced();
      return normalized;
    };

    ctx.applyReviewRowClass = function applyReviewRowClass(row) {
      const data = row.getData();
      const rowElement = row.getElement();
      rowElement.classList.toggle("needs-review-row", Boolean(data && data.needs_review));
    };
  };
}(window));