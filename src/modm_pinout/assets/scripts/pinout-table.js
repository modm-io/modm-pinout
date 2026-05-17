"use strict";

(function registerModmPinoutTable(global) {
  const api = global.ModmPinout = global.ModmPinout || {};

  api.attachTable = function attachTable(ctx) {
    const state = ctx.state;

    ctx.manualEditorParams = function manualEditorParams(cell) {
      const row = cell.getRow().getData();
      const rowFunctions = Array.isArray(row.functions) ? row.functions.slice() : [];
      const regexMatchers = ctx.getActiveRegexMatchers();
      const orderedFunctions = regexMatchers.length > 0
        ? ctx.prioritizeFunctionsByRegex(rowFunctions, regexMatchers)
        : rowFunctions;

      const values = [];
      for (const fn of orderedFunctions) {
        values.push({ label: fn, value: fn });
      }
      return {
        values,
        autocomplete: false,
        multiselect: true,
        listOnEmpty: true,
        allowEmpty: true,
        emptyValue: [],
        clearable: true,
      };
    };

    ctx.isPackageHeaderHighlightField = function isPackageHeaderHighlightField(field) {
      const normalizedField = String(field || "");
      return ctx.BASE_REGEX_FILTER_FIELDS.includes(normalizedField)
        || /^regex_\d+$/.test(normalizedField);
    };

    ctx.rowHasPackageHighlightValue = function rowHasPackageHighlightValue(rowData, field) {
      if (!rowData || typeof rowData !== "object") {
        return false;
      }

      if (field === "selected_function") {
        return ctx.normalizeSelectedFunctionList(rowData.selected_function).length > 0;
      }

      return ctx.valueToSortableText(rowData[field]).trim() !== "";
    };

    ctx.activeTableRowsForPackageHighlight = function activeTableRowsForPackageHighlight() {
      if (!ctx.table) {
        return [];
      }

      if (typeof ctx.table.getRows === "function") {
        const activeRows = ctx.table.getRows("active");
        if (Array.isArray(activeRows)) {
          return activeRows
            .map((row) => row.getData())
            .filter((rowData) => rowData && rowData.row_id != null);
        }
      }

      const tableData = typeof ctx.table.getData === "function" ? ctx.table.getData() : [];
      return Array.isArray(tableData)
        ? tableData.filter((rowData) => rowData && rowData.row_id != null)
        : [];
    };

    ctx.updatePackageHeaderHighlight = function updatePackageHeaderHighlight(field) {
      if (!ctx.isPackageHeaderHighlightField(field) || typeof ctx.setPackageHighlightedRows !== "function") {
        return;
      }

      const rowIds = ctx.activeTableRowsForPackageHighlight()
        .filter((rowData) => ctx.rowHasPackageHighlightValue(rowData, field))
        .map((rowData) => rowData.row_id);
      ctx.setPackageHighlightedRows(rowIds, field);
    };

    ctx.bindPackageHeaderHighlight = function bindPackageHeaderHighlight(field) {
      if (!ctx.table || !ctx.isPackageHeaderHighlightField(field)) {
        return;
      }

      const column = ctx.table.getColumn(field);
      if (!column) {
        return;
      }

      const headerElement = column.getElement();
      if (!headerElement || headerElement.dataset.packageHeaderHighlightBound === "1") {
        return;
      }

      headerElement.dataset.packageHeaderHighlightBound = "1";
      headerElement.addEventListener("mouseenter", () => {
        ctx.updatePackageHeaderHighlight(field);
      });
      headerElement.addEventListener("mouseleave", () => {
        if (typeof ctx.clearPackageHighlightedRows === "function") {
          ctx.clearPackageHighlightedRows(field);
        }
      });
      headerElement.addEventListener("focusin", () => {
        ctx.updatePackageHeaderHighlight(field);
      });
      headerElement.addEventListener("focusout", (event) => {
        if (event.relatedTarget && headerElement.contains(event.relatedTarget)) {
          return;
        }
        if (typeof ctx.clearPackageHighlightedRows === "function") {
          ctx.clearPackageHighlightedRows(field);
        }
      });
    };

    ctx.bindAllPackageHeaderHighlights = function bindAllPackageHeaderHighlights() {
      for (const field of ctx.BASE_REGEX_FILTER_FIELDS) {
        ctx.bindPackageHeaderHighlight(field);
      }
      for (const meta of state.regexColumns) {
        ctx.bindPackageHeaderHighlight(meta.field);
      }
    };

    ctx.rebindTableHeaderInteractions = function rebindTableHeaderInteractions() {
      for (const meta of state.regexColumns) {
        const input = ctx.getRegexInputElement(meta);
        if (input && meta.pattern && input.value !== meta.pattern) {
          input.value = meta.pattern;
        }
        ctx.bindRegexInputHandlers(meta);
        ctx.bindRegexColumnControls(meta);
      }

      for (const field of ctx.BASE_REGEX_FILTER_FIELDS) {
        ctx.bindBaseFilterInputHandlers(field);
      }

      ctx.bindAllPackageHeaderHighlights();
    };

    ctx.waitForTableBuilt = function waitForTableBuilt(instance) {
      return new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };

        instance.on("tableBuilt", done);
        window.requestAnimationFrame(done);
      });
    };

    ctx.waitForTableRenderTick = function waitForTableRenderTick() {
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      });
    };

    ctx.applyStateToTable = async function applyStateToTable() {
      if (!ctx.table) {
        return;
      }

      const existingRegexFields = ctx.table
        .getColumns()
        .map((column) => column.getField())
        .filter((field) => typeof field === "string" && /^regex_\d+$/.test(field));

      for (const field of existingRegexFields) {
        const response = ctx.table.deleteColumn(field);
        await Promise.resolve(response);
      }

      for (const meta of state.regexColumns) {
        await ctx.addRegexColumn(meta);
      }

      const rows = ctx.buildRows();
      if (typeof ctx.table.replaceData === "function") {
        const response = ctx.table.replaceData(rows);
        await Promise.resolve(response);
      } else {
        const response = ctx.table.setData(rows);
        await Promise.resolve(response);
      }

      await ctx.waitForTableRenderTick();
      ctx.rebindTableHeaderInteractions();
      ctx.recomputeRegexCells();
    };

    ctx.initializeTable = async function initializeTable() {
      const initialStateResult = await ctx.loadInitialState();

      const baseColumns = [
        {
          title: "Pin",
          field: "position",
          headerSort: true,
          sorter: ctx.pinSorter,
          headerFilter: "input",
          headerFilterPlaceholder: "regex",
          headerFilterLiveFilter: false,
          headerFilterFunc: ctx.baseRegexHeaderFilterFunc,
          headerFilterFuncParams: { field: "position" },
          editable: false,
          movable: false,
          minWidth: 70,
          width: 80,
          hozAlign: "right",
          headerHozAlign: "right",
          formatter: (cell) => ctx.escapeHtml(cell.getValue() || ""),
          cellClick: (_event, cell) => {
            const row = cell.getRow();
            const data = row.getData();
            if (!data || !data.needs_review) {
              return;
            }

            const rowId = String(data.row_id);
            delete state.reviewByRowId[rowId];
            const response = row.update({ needs_review: false });
            Promise.resolve(response).then(() => {
              if (typeof row.reformat === "function") {
                row.reformat();
              }
            });
            ctx.saveStateDebounced();
          },
        },
        {
          title: "Name",
          field: "short_name",
          headerSort: true,
          sorter: ctx.displayedTextSorter,
          headerFilter: "input",
          headerFilterPlaceholder: "regex",
          headerFilterLiveFilter: false,
          headerFilterFunc: ctx.baseRegexHeaderFilterFunc,
          headerFilterFuncParams: { field: "short_name" },
          editable: false,
          movable: false,
          minWidth: 110,
          width: 140,
          formatter: (cell) => ctx.escapeHtml(cell.getValue() || ""),
        },
        {
          title: "Function",
          field: "selected_function",
          headerSort: true,
          sorter: ctx.displayedTextSorter,
          headerFilter: "input",
          headerFilterPlaceholder: "regex",
          headerFilterLiveFilter: false,
          headerFilterFunc: ctx.baseRegexHeaderFilterFunc,
          headerFilterFuncParams: { field: "selected_function" },
          movable: false,
          minWidth: 260,
          widthGrow: 2,
          editor: "list",
          editorParams: ctx.manualEditorParams,
          editorEmptyValue: [],
          formatter: (cell) => ctx.renderSelectedFunctionsHtml(cell.getValue()),
          formatterParams: {},
          variableHeight: true,
        },
        {
          title: "Comment",
          field: "internal_name",
          headerSort: true,
          sorter: ctx.displayedTextSorter,
          headerFilter: "input",
          headerFilterPlaceholder: "regex",
          headerFilterLiveFilter: false,
          headerFilterFunc: ctx.baseRegexHeaderFilterFunc,
          headerFilterFuncParams: { field: "internal_name" },
          movable: false,
          minWidth: 180,
          widthGrow: 1,
          editor: "input",
          formatter: (cell) => ctx.escapeHtml(cell.getValue() || ""),
        },
      ];

      const restoredRegexColumns = state.regexColumns.map(ctx.createRegexColumnDef);
      const addRegexTriggerColumn = ctx.createAddRegexTriggerColumnDef();
      const baseHeaderFilter = ctx.BASE_REGEX_FILTER_FIELDS
        .map((field) => ({ field, value: String(state.baseFilterPatterns[field] || "") }))
        .filter((entry) => entry.value.trim() !== "");
      const regexHeaderFilter = state.regexColumns
        .filter((meta) => meta.pattern && meta.pattern.trim() !== "")
        .map((meta) => ({ field: meta.field, value: meta.pattern }));
      const initialHeaderFilter = [...baseHeaderFilter, ...regexHeaderFilter];

      ctx.table = new Tabulator("#pin-matrix", {
        data: ctx.buildRows(),
        layout: "fitData",
        renderVertical: "basic",
        movableColumns: true,
        index: "row_id",
        rowFormatter: ctx.applyReviewRowClass,
        placeholder: "No pin data available",
        columns: [...baseColumns, ...restoredRegexColumns, addRegexTriggerColumn],
        initialHeaderFilter,
        initialSort: [{ column: "position", dir: "asc" }],
      });

      await ctx.waitForTableBuilt(ctx.table);
      await ctx.waitForTableRenderTick();

      ctx.table.on("cellEdited", (cell) => {
        const row = cell.getRow().getData();
        const rowId = String(row.row_id);
        const field = cell.getField();

        if (field === "selected_function") {
          const selectedValues = ctx.normalizeSelectedFunctionList(cell.getValue());
          if (selectedValues.length > 0) {
            state.selectedByRowId[rowId] = selectedValues;
          } else {
            delete state.selectedByRowId[rowId];
          }
          ctx.saveStateDebounced();
          return;
        }

        if (field === "internal_name") {
          const value = String(cell.getValue() || "").trim();
          if (value) {
            state.namesByRowId[rowId] = value;
          } else {
            delete state.namesByRowId[rowId];
          }
          ctx.saveStateDebounced();
        }
      });

      ctx.table.on("columnMoved", () => {
        ctx.syncRegexColumnOrderFromTable();
        window.requestAnimationFrame(() => {
          ctx.rebindTableHeaderInteractions();
        });
      });

      ctx.table.on("rowMouseEnter", (_event, row) => {
        const data = row.getData();
        if (!data) {
          return;
        }
        ctx.setHoveredPackageRow(data.row_id);
      });

      ctx.table.on("rowMouseLeave", (_event, row) => {
        const data = row.getData();
        if (!data) {
          return;
        }
        ctx.clearHoveredPackageRow(data.row_id);
      });

      ctx.rebindTableHeaderInteractions();

      ctx.recomputeRegexCells();
      window.requestAnimationFrame(() => {
        ctx.rebindTableHeaderInteractions();
      });

      if (
        state.regexColumns.length === 0 &&
        Object.keys(state.selectedByRowId).length === 0 &&
        Object.keys(state.namesByRowId).length === 0 &&
        Object.keys(state.baseFilterPatterns).length === 0 &&
        Object.keys(state.reviewByRowId).length === 0 &&
        state.unmappedRows.length === 0 &&
        !initialStateResult.messageShown
      ) {
        ctx.setStatus("Ready. Add regex columns and start mapping.");
      }
    };

    ctx.resetUiStateForRetry = function resetUiStateForRetry() {
      state.selectedByRowId = {};
      state.namesByRowId = {};
      state.baseFilterPatterns = {};
      state.reviewByRowId = {};
      state.unmappedRows = [];
      state.regexColumns = [];
      state.nextRegexId = 1;
      ctx.table = null;
      const container = document.getElementById("pin-matrix");
      container.innerHTML = "";
    };

    ctx.initializeWithRecovery = async function initializeWithRecovery() {
      try {
        await ctx.initializeTable();
        return;
      } catch (error) {
        const message = String(error && error.message ? error.message : error);
        const isHeaderInitFailure =
          message.includes("headersElement") ||
          message.includes("appendChild");

        if (!isHeaderInitFailure) {
          throw error;
        }

        ctx.clearPersistedState(ctx.COOKIE_KEY);
        ctx.resetUiStateForRetry();
        ctx.setStatus("Recovered from invalid saved state. Reinitializing...", true);
      }

      await ctx.initializeTable();
      ctx.setStatus("Recovered by resetting saved cookie state.");
    };

    ctx.bindPageEventHandlers = function bindPageEventHandlers() {
      document.getElementById("copy-share-url").addEventListener("click", async () => {
        try {
          await ctx.copyShareUrl();
        } catch (error) {
          ctx.setStatus(`Share failed: ${String(error)}`, true);
        }
      });

      document.getElementById("export-json").addEventListener("click", () => {
        try {
          ctx.downloadJsonExport();
        } catch (error) {
          ctx.setStatus(`Export failed: ${String(error)}`, true);
        }
      });

      const importInput = document.getElementById("import-json-input");
      document.getElementById("import-json").addEventListener("click", () => {
        importInput.click();
      });

      importInput.addEventListener("change", async (event) => {
        const inputElement = event.target;
        const file = inputElement.files && inputElement.files[0] ? inputElement.files[0] : null;
        if (!file) {
          return;
        }

        try {
          const jsonText = await file.text();
          await ctx.importJsonText(jsonText);
        } catch (error) {
          ctx.setStatus(`Import failed: ${String(error)}`, true);
        } finally {
          inputElement.value = "";
        }
      });

      window.addEventListener("pagehide", ctx.persistStateBeforeUnload);
      window.addEventListener("beforeunload", ctx.persistStateBeforeUnload);
    };
  };
}(window));