"use strict";

(function registerModmPinoutRegex(global) {
  const api = global.ModmPinout = global.ModmPinout || {};

  api.attachRegex = function attachRegex(ctx) {
    const state = ctx.state;

    ctx.normalizeBaseFilterField = function normalizeBaseFilterField(field) {
      return ctx.BASE_REGEX_FILTER_FIELDS.includes(field) ? field : null;
    };

    ctx.resolveBaseFilterText = function resolveBaseFilterText(rowData, field) {
      if (!rowData || typeof rowData !== "object") {
        return "";
      }

      if (field === "selected_function") {
        return ctx.normalizeSelectedFunctionList(rowData.selected_function).join("\n");
      }

      return String(rowData[field] ?? "");
    };

    ctx.baseRegexHeaderFilterFunc = function baseRegexHeaderFilterFunc(headerValue, _rowValue, rowData, filterParams) {
      const pattern = String(headerValue || "").trim();
      if (!pattern) {
        return true;
      }

      const field = ctx.normalizeBaseFilterField(filterParams && filterParams.field ? String(filterParams.field) : "");
      if (!field) {
        return true;
      }

      try {
        const matcher = ctx.buildRegexMatcher(pattern);
        const text = ctx.resolveBaseFilterText(rowData, field);
        return matcher.matchFn(text);
      } catch (_error) {
        return true;
      }
    };

    ctx.getBaseFilterInputElement = function getBaseFilterInputElement(field) {
      if (!ctx.table) {
        return null;
      }

      const normalizedField = ctx.normalizeBaseFilterField(field);
      if (!normalizedField) {
        return null;
      }

      const column = ctx.table.getColumn(normalizedField);
      if (!column) {
        return null;
      }

      return column.getElement().querySelector("input");
    };

    ctx.refreshBaseFilterPatternsFromHeaders = function refreshBaseFilterPatternsFromHeaders() {
      if (!ctx.table) {
        return;
      }

      for (const field of ctx.BASE_REGEX_FILTER_FIELDS) {
        const input = ctx.getBaseFilterInputElement(field);
        if (input) {
          state.baseFilterPatterns[field] = String(input.value || "");
          continue;
        }

        const column = ctx.table.getColumn(field);
        if (column) {
          state.baseFilterPatterns[field] = String(column.getHeaderFilterValue() || "");
        }
      }
    };

    ctx.setHeaderFilterInputValidity = function setHeaderFilterInputValidity(input, isValid, errorMessage) {
      if (!input) {
        return;
      }

      input.classList.toggle("regex-invalid", !isValid);
      input.title = isValid ? "" : String(errorMessage || "Invalid regex");
    };

    ctx.validateBaseRegexHeaderFilters = function validateBaseRegexHeaderFilters() {
      let invalidCount = 0;
      let firstInvalidMessage = "";

      for (const field of ctx.BASE_REGEX_FILTER_FIELDS) {
        const pattern = String(state.baseFilterPatterns[field] || "").trim();
        const input = ctx.getBaseFilterInputElement(field);
        if (!pattern) {
          ctx.setHeaderFilterInputValidity(input, true, "");
          continue;
        }

        try {
          ctx.buildRegexMatcher(pattern);
          ctx.setHeaderFilterInputValidity(input, true, "");
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          ctx.setHeaderFilterInputValidity(input, false, message);
          invalidCount += 1;
          if (!firstInvalidMessage) {
            firstInvalidMessage = message;
          }
        }
      }

      return { invalidCount, firstInvalidMessage };
    };

    ctx.updateRegexValidationStatus = function updateRegexValidationStatus(regexValidation, baseValidation) {
      const regexInvalidCount = Number(regexValidation && regexValidation.invalidCount ? regexValidation.invalidCount : 0);
      const regexFirstMessage = String(regexValidation && regexValidation.firstInvalidMessage ? regexValidation.firstInvalidMessage : "");
      const baseInvalidCount = Number(baseValidation && baseValidation.invalidCount ? baseValidation.invalidCount : 0);
      const baseFirstMessage = String(baseValidation && baseValidation.firstInvalidMessage ? baseValidation.firstInvalidMessage : "");

      const totalInvalid = regexInvalidCount + baseInvalidCount;
      if (totalInvalid > 0) {
        const parts = [];
        if (regexInvalidCount > 0) {
          parts.push(`${regexInvalidCount} regex match column(s)`);
        }
        if (baseInvalidCount > 0) {
          parts.push(`${baseInvalidCount} base filter column(s)`);
        }

        const firstMessage = regexFirstMessage || baseFirstMessage || "Invalid regex";
        ctx.setStatus(`${parts.join(" and ")} contain invalid expressions. First error: ${firstMessage}`, true);
        return;
      }

      const statusNode = document.getElementById("save-status");
      if (statusNode.classList.contains("error")) {
        ctx.setStatus("");
      }
    };

    ctx.bindBaseFilterInputHandlers = function bindBaseFilterInputHandlers(field) {
      const input = ctx.getBaseFilterInputElement(field);
      if (!input || input.dataset.baseRegexBound === "1") {
        return;
      }

      input.dataset.baseRegexBound = "1";
      const commitPatternOnBlur = () => {
        const nextPattern = String(input.value || "");
        state.baseFilterPatterns[field] = nextPattern;
        const baseValidation = ctx.validateBaseRegexHeaderFilters();
        ctx.updateRegexValidationStatus({ invalidCount: 0, firstInvalidMessage: "" }, baseValidation);
        ctx.saveStateDebounced();
      };

      input.addEventListener("blur", commitPatternOnBlur);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    };

    ctx.getActiveRegexMatchers = function getActiveRegexMatchers() {
      ctx.refreshRegexPatternsFromHeaders();

      const matchers = [];
      for (const meta of state.regexColumns) {
        const pattern = String(meta.pattern || "").trim();
        if (!pattern) {
          continue;
        }

        try {
          const matcher = ctx.buildRegexMatcher(pattern);
          matchers.push(matcher.matchFn);
        } catch (_error) {
          // Ignore invalid regex columns for dropdown prioritization.
        }
      }

      return matchers;
    };

    ctx.prioritizeFunctionsByRegex = function prioritizeFunctionsByRegex(functions, regexMatchers) {
      const prioritized = [];
      const remaining = [];

      for (const fn of functions) {
        const isRegexMatch = regexMatchers.some((matcher) => matcher(fn));
        if (isRegexMatch) {
          prioritized.push(fn);
        } else {
          remaining.push(fn);
        }
      }

      return [...prioritized, ...remaining];
    };

    ctx.getTextMeasureCtx = function getTextMeasureCtx() {
      if (ctx.textMeasureCtx) {
        return ctx.textMeasureCtx;
      }
      const canvas = document.createElement("canvas");
      ctx.textMeasureCtx = canvas.getContext("2d");
      return ctx.textMeasureCtx;
    };

    ctx.measureTextWidthPx = function measureTextWidthPx(text) {
      const value = String(text || "");
      const measureCtx = ctx.getTextMeasureCtx();
      if (!measureCtx) {
        return value.length * 8;
      }

      measureCtx.font = "13px IBM Plex Sans, Segoe UI, sans-serif";
      return Math.ceil(measureCtx.measureText(value).width);
    };

    ctx.applyRegexColumnWidths = function applyRegexColumnWidths(maxLineWidthByField) {
      if (!ctx.table) {
        return;
      }

      for (const meta of state.regexColumns) {
        const column = ctx.table.getColumn(meta.field);
        if (!column) {
          continue;
        }

        const headerWidth = ctx.measureTextWidthPx(meta.title) + 68;
        const contentWidth = Number(maxLineWidthByField[meta.field] || 0) + 44;
        const targetWidth = Math.max(90, Math.min(900, Math.max(headerWidth, contentWidth)));
        const currentWidth = column.getElement() ? column.getElement().offsetWidth : 0;

        if (Math.abs(currentWidth - targetWidth) > 2) {
          column.setWidth(targetWidth);
        }
      }
    };

    ctx.createRegexColumnDef = function createRegexColumnDef(meta) {
      return {
        title: `<span class="regex-header-wrap"><span class="regex-title-text">${ctx.escapeHtml(meta.title)}</span><span class="regex-header-actions"><span class="regex-edit-control" title="Rename regex column" aria-label="Rename regex column" role="button" tabindex="0">✎</span><span class="regex-remove-control" title="Remove regex column" aria-label="Remove regex column" role="button" tabindex="0">×</span></span></span>`,
        field: meta.field,
        headerSort: true,
        sorter: ctx.displayedTextSorter,
        editable: false,
        movable: true,
        minWidth: 80,
        widthGrow: 0,
        formatter: "html",
        variableHeight: true,
        headerFilter: "input",
        headerFilterPlaceholder: "regex pattern",
        headerFilterLiveFilter: false,
        headerFilterFunc: () => true,
      };
    };

    ctx.createAddRegexTriggerColumnDef = function createAddRegexTriggerColumnDef() {
      return {
        title: "<span class=\"add-regex-header\" title=\"Add regex column\">+</span>",
        field: ctx.ADD_REGEX_FIELD,
        headerSort: false,
        editable: false,
        movable: false,
        minWidth: 32,
        width: 34,
        maxWidth: 40,
        resizable: false,
        hozAlign: "center",
        headerHozAlign: "center",
        formatter: () => "",
        headerClick: (_event, _column) => {
          ctx.addNewRegexColumn().catch((error) => {
            ctx.setStatus(`Could not add regex column: ${String(error)}`, true);
          });
        },
      };
    };

    ctx.removeRegexColumn = async function removeRegexColumn(field) {
      const index = state.regexColumns.findIndex((meta) => meta.field === field);
      if (index < 0) {
        return;
      }

      state.regexColumns.splice(index, 1);
      const column = ctx.table ? ctx.table.getColumn(field) : null;
      if (column) {
        const response = ctx.table.deleteColumn(field);
        await Promise.resolve(response);
      }

      ctx.recomputeRegexCells();
      ctx.saveStateDebounced();
    };

    ctx.getRegexColumnMeta = function getRegexColumnMeta(field) {
      return state.regexColumns.find((meta) => meta.field === field) || null;
    };

    ctx.renameRegexColumn = async function renameRegexColumn(field) {
      const meta = ctx.getRegexColumnMeta(field);
      if (!meta) {
        return;
      }

      const currentTitle = String(meta.title || `Regex ${meta.id}`);
      const nextRaw = window.prompt("Regex column name:", currentTitle);
      if (nextRaw === null) {
        return;
      }

      const nextTitle = nextRaw.trim() || `Regex ${meta.id}`;
      if (nextTitle === currentTitle) {
        return;
      }

      meta.title = nextTitle;
      const preservedPattern = String(meta.pattern || "");

      if (ctx.table) {
        if (typeof ctx.table.updateColumnDefinition === "function") {
          const response = ctx.table.updateColumnDefinition(field, ctx.createRegexColumnDef(meta));
          await Promise.resolve(response);
        } else {
          const column = ctx.table.getColumn(field);
          if (column && typeof column.updateDefinition === "function") {
            const response = column.updateDefinition(ctx.createRegexColumnDef(meta));
            await Promise.resolve(response);
          }
        }

        const columnAfterUpdate = ctx.table.getColumn(field);
        if (columnAfterUpdate && preservedPattern) {
          columnAfterUpdate.setHeaderFilterValue(preservedPattern);
        }

        window.requestAnimationFrame(() => {
          const updatedMeta = ctx.getRegexColumnMeta(field);
          if (!updatedMeta) {
            return;
          }
          ctx.bindRegexInputHandlers(updatedMeta);
          ctx.bindRegexColumnControls(updatedMeta);
          if (typeof ctx.bindPackageHeaderHighlight === "function") {
            ctx.bindPackageHeaderHighlight(updatedMeta.field);
          }
        });
      }

      ctx.saveStateDebounced();
      ctx.recomputeRegexCells();
    };

    ctx.getRegexInputElement = function getRegexInputElement(meta) {
      if (!ctx.table) {
        return null;
      }
      const column = ctx.table.getColumn(meta.field);
      if (!column) {
        return null;
      }
      return column.getElement().querySelector("input");
    };

    ctx.bindRegexInputHandlers = function bindRegexInputHandlers(meta) {
      const input = ctx.getRegexInputElement(meta);
      if (!input || input.dataset.regexBound === "1") {
        return;
      }

      input.dataset.regexBound = "1";
      const commitPatternOnBlur = () => {
        const nextPattern = String(input.value || "");
        if (nextPattern === String(meta.pattern || "")) {
          return;
        }

        meta.pattern = nextPattern;
        ctx.recomputeRegexCells();
        ctx.saveStateDebounced();
      };

      input.addEventListener("blur", commitPatternOnBlur);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    };

    ctx.bindRegexColumnControls = function bindRegexColumnControls(meta) {
      if (!ctx.table) {
        return;
      }
      const column = ctx.table.getColumn(meta.field);
      if (!column) {
        return;
      }

      const removeControl = column.getElement().querySelector(".regex-remove-control");
      if (!removeControl || removeControl.dataset.bound === "1") {
        // Continue because edit control may still need binding.
      } else {
        removeControl.dataset.bound = "1";
        const onRemove = (event) => {
          event.preventDefault();
          event.stopPropagation();
          ctx.removeRegexColumn(meta.field).catch((error) => {
            ctx.setStatus(`Could not remove regex column: ${String(error)}`, true);
          });
        };

        removeControl.addEventListener("click", onRemove);
        removeControl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            onRemove(event);
          }
        });
      }

      const editControl = column.getElement().querySelector(".regex-edit-control");
      if (!editControl || editControl.dataset.bound === "1") {
        return;
      }

      editControl.dataset.bound = "1";
      const onRename = (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.renameRegexColumn(meta.field).catch((error) => {
          ctx.setStatus(`Could not rename regex column: ${String(error)}`, true);
        });
      };

      editControl.addEventListener("click", onRename);
      editControl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          onRename(event);
        }
      });
    };

    ctx.refreshRegexPatternsFromHeaders = function refreshRegexPatternsFromHeaders() {
      if (!ctx.table) {
        return;
      }
      for (const meta of state.regexColumns) {
        const input = ctx.getRegexInputElement(meta);
        if (input) {
          meta.pattern = String(input.value || "");
          continue;
        }

        const column = ctx.table.getColumn(meta.field);
        if (column) {
          meta.pattern = String(column.getHeaderFilterValue() || "");
        }
      }
    };

    ctx.setRegexInputValidity = function setRegexInputValidity(meta, isValid, errorMessage) {
      const input = ctx.getRegexInputElement(meta);
      if (!input) {
        return;
      }
      const invalid = meta.pattern.trim() !== "" && !isValid;
      input.classList.toggle("regex-invalid", invalid);
      input.title = invalid ? errorMessage : "";
    };

    ctx.buildRegexMatcher = function buildRegexMatcher(pattern) {
      const errors = [];

      if (typeof XRegExp === "function") {
        try {
          const compiled = XRegExp(pattern, "i");
          return {
            engine: "XRegExp",
            matchFn: (text) => XRegExp.test(text, compiled),
          };
        } catch (error) {
          errors.push(error);
        }
      }

      try {
        const compiled = new RegExp(pattern, "i");
        return {
          engine: "RegExp",
          matchFn: (text) => compiled.test(text),
        };
      } catch (error) {
        errors.push(error);
      }

      if (errors.length > 0) {
        throw errors[0];
      }
      throw new Error("Invalid regex expression");
    };

    ctx.compileRegexColumns = function compileRegexColumns() {
      const compiled = {};
      for (const meta of state.regexColumns) {
        const pattern = meta.pattern.trim();
        if (!pattern) {
          compiled[meta.field] = { matcher: null, engine: "none", isValid: true, errorMessage: "" };
          continue;
        }

        try {
          const matcher = ctx.buildRegexMatcher(pattern);
          compiled[meta.field] = {
            matcher: matcher.matchFn,
            engine: matcher.engine,
            isValid: true,
            errorMessage: "",
          };
        } catch (error) {
          compiled[meta.field] = {
            matcher: null,
            engine: "none",
            isValid: false,
            errorMessage: String(error && error.message ? error.message : error),
          };
        }
      }
      return compiled;
    };

    ctx.recomputeRegexCells = function recomputeRegexCells() {
      if (!ctx.table) {
        return;
      }

      ctx.refreshRegexPatternsFromHeaders();
      const compiled = ctx.compileRegexColumns();
      const hasRegexColumns = state.regexColumns.length > 0;
      const updates = [];
      const maxLineWidthByField = {};

      if (hasRegexColumns) {
        for (const meta of state.regexColumns) {
          maxLineWidthByField[meta.field] = ctx.measureTextWidthPx(meta.title || "");
        }

        for (const row of ctx.table.getData()) {
          const patch = { row_id: row.row_id };
          for (const meta of state.regexColumns) {
            const result = compiled[meta.field];
            if (!result || !result.isValid || !result.matcher) {
              patch[meta.field] = "";
              continue;
            }

            const matches = [];
            for (const fn of row.functions || []) {
              if (result.matcher(fn)) {
                matches.push(fn);
                const lineWidth = ctx.measureTextWidthPx(fn);
                if (lineWidth > (maxLineWidthByField[meta.field] || 0)) {
                  maxLineWidthByField[meta.field] = lineWidth;
                }
              }
            }
            patch[meta.field] = matches.map((item) => ctx.escapeHtml(item)).join("<br>");
          }
          updates.push(patch);
        }

        if (updates.length > 0) {
          ctx.table.updateData(updates);
        }
      }

      let invalidCount = 0;
      let firstInvalidMessage = "";
      for (const meta of state.regexColumns) {
        const result = compiled[meta.field];
        const isValid = Boolean(result && result.isValid);
        ctx.setRegexInputValidity(meta, isValid, result ? result.errorMessage : "Invalid regex");
        if (!isValid && meta.pattern.trim() !== "") {
          invalidCount += 1;
          if (!firstInvalidMessage) {
            firstInvalidMessage = result ? result.errorMessage : "Invalid regex";
          }
        }
      }

      ctx.refreshBaseFilterPatternsFromHeaders();
      const baseValidation = ctx.validateBaseRegexHeaderFilters();
      ctx.updateRegexValidationStatus(
        { invalidCount, firstInvalidMessage },
        baseValidation
      );

      if (hasRegexColumns) {
        ctx.applyRegexColumnWidths(maxLineWidthByField);
      }
    };

    ctx.addRegexColumn = async function addRegexColumn(meta) {
      const response = ctx.table.addColumn(ctx.createRegexColumnDef(meta), true, ctx.ADD_REGEX_FIELD);
      await Promise.resolve(response);
      const column = ctx.table.getColumn(meta.field);
      if (column && meta.pattern) {
        column.setHeaderFilterValue(meta.pattern);
      }

      window.requestAnimationFrame(() => {
        const input = ctx.getRegexInputElement(meta);
        if (input && meta.pattern && input.value !== meta.pattern) {
          input.value = meta.pattern;
        }
        ctx.bindRegexInputHandlers(meta);
        ctx.bindRegexColumnControls(meta);
        if (typeof ctx.bindPackageHeaderHighlight === "function") {
          ctx.bindPackageHeaderHighlight(meta.field);
        }
      });
    };

    ctx.addNewRegexColumn = async function addNewRegexColumn() {
      const meta = {
        id: state.nextRegexId,
        field: `regex_${state.nextRegexId}`,
        title: `Regex ${state.regexColumns.length + 1}`,
        pattern: "",
      };
      state.nextRegexId += 1;
      state.regexColumns.push(meta);
      await ctx.addRegexColumn(meta);
      ctx.recomputeRegexCells();
      ctx.saveStateDebounced();

      const input = ctx.getRegexInputElement(meta);
      if (input) {
        input.focus();
      }
    };

    ctx.syncRegexColumnOrderFromTable = function syncRegexColumnOrderFromTable() {
      if (!ctx.table) {
        return;
      }

      const metaByField = new Map(state.regexColumns.map((meta) => [meta.field, meta]));
      const orderedFields = ctx.table
        .getColumns()
        .map((column) => column.getField())
        .filter((field) => metaByField.has(field));

      if (orderedFields.length === 0) {
        return;
      }

      const orderedMetas = orderedFields
        .map((field) => metaByField.get(field))
        .filter((meta) => meta != null);

      if (orderedMetas.length !== state.regexColumns.length) {
        for (const meta of state.regexColumns) {
          if (!orderedMetas.includes(meta)) {
            orderedMetas.push(meta);
          }
        }
      }

      const hasChanged = orderedMetas.some((meta, index) => state.regexColumns[index] !== meta);
      if (!hasChanged) {
        return;
      }

      state.regexColumns = orderedMetas;
      ctx.saveStateDebounced();
    };
  };
}(window));