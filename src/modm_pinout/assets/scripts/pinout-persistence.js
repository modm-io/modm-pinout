"use strict";

(function registerModmPinoutPersistence(global) {
  const api = global.ModmPinout = global.ModmPinout || {};

  api.attachPersistence = function attachPersistence(ctx) {
    const state = ctx.state;
    let latestShareUrlSyncId = 0;

    ctx.safeDecodeURIComponent = function safeDecodeURIComponent(value) {
      try {
        return decodeURIComponent(String(value || ""));
      } catch (_error) {
        return String(value || "");
      }
    };

    ctx.readCookie = function readCookie(name) {
      const encodedName = encodeURIComponent(name) + "=";
      const entries = document.cookie ? document.cookie.split(";") : [];
      for (const entryRaw of entries) {
        const entry = entryRaw.trim();
        if (entry.startsWith(encodedName)) {
          return ctx.safeDecodeURIComponent(entry.slice(encodedName.length));
        }
      }
      return null;
    };

    ctx.writeCookie = function writeCookie(name, value, days) {
      const expires = new Date(Date.now() + days * 86400 * 1000).toUTCString();
      document.cookie = [
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        `expires=${expires}`,
        "path=/",
        "SameSite=Lax",
      ].join("; ");

      return ctx.readCookie(name) === value;
    };

    ctx.clearCookie = function clearCookie(name) {
      document.cookie = [
        `${encodeURIComponent(name)}=`,
        "expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "path=/",
        "SameSite=Lax",
      ].join("; ");
    };

    ctx.readLocalStorage = function readLocalStorage(name) {
      try {
        return window.localStorage.getItem(name);
      } catch (_error) {
        return null;
      }
    };

    ctx.writeLocalStorage = function writeLocalStorage(name, value) {
      try {
        window.localStorage.setItem(name, value);
        return true;
      } catch (_error) {
        return false;
      }
    };

    ctx.clearLocalStorage = function clearLocalStorage(name) {
      try {
        window.localStorage.removeItem(name);
      } catch (_error) {
        // Ignore localStorage removal failures.
      }
    };

    ctx.clearPersistedState = function clearPersistedState(name) {
      ctx.clearCookie(name);
      ctx.clearLocalStorage(name);
    };

    ctx.readPersistedStateCandidates = function readPersistedStateCandidates(name) {
      const candidates = [];

      const localRaw = ctx.readLocalStorage(name);
      if (typeof localRaw === "string" && localRaw !== "") {
        candidates.push({ source: "localStorage", raw: localRaw });
      }

      const cookieRaw = ctx.readCookie(name);
      if (
        typeof cookieRaw === "string" &&
        cookieRaw !== "" &&
        !candidates.some((candidate) => candidate.raw === cookieRaw)
      ) {
        candidates.push({ source: "cookie", raw: cookieRaw });
      }

      return candidates;
    };

    ctx.readShareStateCandidate = function readShareStateCandidate() {
      const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
      const hashValue = String(hashParams.get(ctx.SHARE_URL_PARAM) || "").trim();
      if (hashValue) {
        return { location: "fragment", token: hashValue };
      }

      const queryParams = new URLSearchParams(String(window.location.search || ""));
      const queryValue = String(queryParams.get(ctx.SHARE_URL_PARAM) || "").trim();
      if (queryValue) {
        return { location: "query", token: queryValue };
      }

      return null;
    };

    ctx.bytesToBase64Url = function bytesToBase64Url(bytes) {
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
      }

      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    };

    ctx.base64UrlToBytes = function base64UrlToBytes(value) {
      const normalized = String(value || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const padding = normalized.length % 4;
      const padded = padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    };

    ctx.compressShareText = async function compressShareText(text) {
      const textBytes = new TextEncoder().encode(text);
      if (typeof CompressionStream !== "function") {
        return { codec: "u", bytes: textBytes };
      }

      const stream = new Blob([textBytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const compressedBytes = new Uint8Array(await new Response(stream).arrayBuffer());
      return { codec: "d", bytes: compressedBytes };
    };

    ctx.decompressShareText = async function decompressShareText(codec, bytes) {
      if (codec === "u") {
        return new TextDecoder().decode(bytes);
      }
      if (codec !== "d") {
        throw new Error("Unsupported shared URL encoding.");
      }
      if (typeof DecompressionStream !== "function") {
        throw new Error("This browser cannot read compressed shared URLs.");
      }

      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    };

    ctx.parseCompactStateDocument = function parseCompactStateDocument(raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_error) {
        throw new Error("Invalid JSON state.");
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("State root is not an object.");
      }

      return parsed;
    };

    ctx.applyCompactState = function applyCompactState(parsed) {
      const nextSelectedByRowId = {};
      if (parsed && typeof parsed.selectedByRowId === "object" && parsed.selectedByRowId !== null) {
        for (const [rowId, selected] of Object.entries(parsed.selectedByRowId)) {
          const normalized = ctx.normalizeSelectedFunctionList(selected);
          if (normalized.length > 0) {
            nextSelectedByRowId[String(rowId)] = normalized;
          }
        }
      }

      const nextNamesByRowId = {};
      if (parsed && typeof parsed.namesByRowId === "object" && parsed.namesByRowId !== null) {
        for (const [rowId, value] of Object.entries(parsed.namesByRowId)) {
          const normalized = String(value || "").trim();
          if (normalized) {
            nextNamesByRowId[String(rowId)] = normalized;
          }
        }
      }

      const nextBaseFilterPatterns = {};
      if (parsed && typeof parsed.baseFilterPatterns === "object" && parsed.baseFilterPatterns !== null) {
        for (const [field, pattern] of Object.entries(parsed.baseFilterPatterns)) {
          const normalizedField = ctx.normalizeBaseFilterField(String(field));
          if (!normalizedField) {
            continue;
          }
          const normalizedPattern = String(pattern || "");
          if (normalizedPattern.trim() !== "") {
            nextBaseFilterPatterns[normalizedField] = normalizedPattern;
          }
        }
      }

      const nextReviewByRowId = {};
      if (parsed && typeof parsed.reviewByRowId === "object" && parsed.reviewByRowId !== null) {
        for (const [rowId, value] of Object.entries(parsed.reviewByRowId)) {
          if (Boolean(value)) {
            nextReviewByRowId[String(rowId)] = true;
          }
        }
      }

      const nextUnmappedRows = [];
      if (Array.isArray(parsed && parsed.unmappedRows)) {
        const seenUnmappedRowIds = new Set();
        for (const [index, node] of parsed.unmappedRows.entries()) {
          const normalized = ctx.normalizeStoredUnmappedRow(node, index);
          if (!normalized || seenUnmappedRowIds.has(normalized.row_id)) {
            continue;
          }
          seenUnmappedRowIds.add(normalized.row_id);
          nextUnmappedRows.push(normalized);
        }
      }

      let nextRegexColumns = [];
      if (Array.isArray(parsed && parsed.regexColumns)) {
        const normalized = parsed.regexColumns
          .map(ctx.normalizeRegexColumn)
          .filter((entry) => entry !== null);

        const deduped = [];
        const seenFields = new Set();
        for (const entry of normalized) {
          if (seenFields.has(entry.field)) {
            continue;
          }
          seenFields.add(entry.field);
          deduped.push(entry);
        }

        nextRegexColumns = deduped;
      }

      state.selectedByRowId = nextSelectedByRowId;
      state.namesByRowId = nextNamesByRowId;
      state.baseFilterPatterns = nextBaseFilterPatterns;
      state.reviewByRowId = nextReviewByRowId;
      state.unmappedRows = nextUnmappedRows;
      state.regexColumns = nextRegexColumns;
      state.nextRegexId = nextRegexColumns.reduce((acc, item) => Math.max(acc, item.id), 0) + 1;

      return (
        Object.keys(nextSelectedByRowId).length > 0
        || Object.keys(nextNamesByRowId).length > 0
        || Object.keys(nextBaseFilterPatterns).length > 0
        || Object.keys(nextReviewByRowId).length > 0
        || nextUnmappedRows.length > 0
        || nextRegexColumns.length > 0
      );
    };

    ctx.buildShareStatePayload = function buildShareStatePayload() {
      return {
        version: ctx.SHARE_URL_VERSION,
        format: ctx.SHARE_URL_FORMAT,
        chipId: String(ctx.DEVICE_DATA.chip_id || ""),
        state: ctx.compactState(),
      };
    };

    ctx.encodeShareStateToken = async function encodeShareStateToken() {
      const payloadText = JSON.stringify(ctx.buildShareStatePayload());
      const encoded = await ctx.compressShareText(payloadText);
      return `v${ctx.SHARE_URL_VERSION}${encoded.codec}.${ctx.bytesToBase64Url(encoded.bytes)}`;
    };

    ctx.decodeShareStateToken = async function decodeShareStateToken(token) {
      const match = /^v(?<version>\d+)(?<codec>[a-z])\.(?<payload>[A-Za-z0-9_-]+)$/.exec(String(token || "").trim());
      if (!match || !match.groups) {
        throw new Error("Unsupported shared URL format.");
      }

      const version = Number(match.groups.version);
      if (version !== ctx.SHARE_URL_VERSION) {
        throw new Error(`Unsupported shared URL version '${match.groups.version}'.`);
      }

      const text = await ctx.decompressShareText(
        match.groups.codec,
        ctx.base64UrlToBytes(match.groups.payload),
      );
      return ctx.parseCompactStateDocument(text);
    };

    ctx.buildShareUrl = async function buildShareUrl() {
      if (typeof ctx.refreshRegexPatternsFromHeaders === "function") {
        ctx.refreshRegexPatternsFromHeaders();
      }
      if (typeof ctx.refreshBaseFilterPatternsFromHeaders === "function") {
        ctx.refreshBaseFilterPatternsFromHeaders();
      }

      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.delete(ctx.SHARE_URL_PARAM);

      const hashParams = new URLSearchParams(String(shareUrl.hash || "").replace(/^#/, ""));
      hashParams.set(ctx.SHARE_URL_PARAM, await ctx.encodeShareStateToken());
      shareUrl.hash = hashParams.toString();
      return shareUrl.toString();
    };

    ctx.syncShareUrlToState = function syncShareUrlToState() {
      const syncId = latestShareUrlSyncId + 1;
      latestShareUrlSyncId = syncId;

      Promise.resolve()
        .then(() => ctx.buildShareUrl())
        .then((shareUrl) => {
          if (syncId !== latestShareUrlSyncId) {
            return;
          }
          ctx.applyShareUrlToLocation(shareUrl);
        })
        .catch(() => {
          // Keep save behavior independent from URL sync failures.
        });
    };

    ctx.applyShareUrlToLocation = function applyShareUrlToLocation(shareUrl) {
      try {
        const url = new URL(shareUrl);
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      } catch (_error) {
        // Ignore history updates if the browser rejects this URL form.
      }
    };

    ctx.copyTextToClipboard = async function copyTextToClipboard(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "readonly");
      input.style.position = "fixed";
      input.style.opacity = "0";
      input.style.pointerEvents = "none";
      document.body.appendChild(input);
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);

      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        input.remove();
      }

      if (!copied) {
        throw new Error("Clipboard access is unavailable.");
      }
    };

    ctx.copyShareUrl = async function copyShareUrl() {
      const shareUrl = await ctx.buildShareUrl();
      ctx.applyShareUrlToLocation(shareUrl);

      try {
        await ctx.copyTextToClipboard(shareUrl);
        ctx.setStatus("Copied share URL.");
      } catch (_error) {
        ctx.setStatus("Share URL is ready in the address bar.");
      }
    };

    ctx.loadStateFromShareUrl = async function loadStateFromShareUrl() {
      const candidate = ctx.readShareStateCandidate();
      if (!candidate) {
        return { found: false, loaded: false, messageShown: false };
      }

      try {
        const parsed = await ctx.decodeShareStateToken(candidate.token);
        if (parsed.format && String(parsed.format) !== ctx.SHARE_URL_FORMAT) {
          throw new Error("Shared URL payload format is not supported.");
        }

        const sourceChipId = String(parsed.chipId || "").trim().toLowerCase();
        const currentChipId = String(ctx.DEVICE_DATA.chip_id || "").trim().toLowerCase();
        if (sourceChipId && currentChipId && sourceChipId !== currentChipId) {
          throw new Error(`Shared URL is for '${sourceChipId}', not '${currentChipId}'.`);
        }

        const shareState = parsed && parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state)
          ? parsed.state
          : parsed;
        const hasState = ctx.applyCompactState(shareState);
        ctx.setStatus(hasState ? "Loaded shared state from URL." : "Loaded empty shared state from URL.");
        return { found: true, loaded: true, messageShown: true };
      } catch (error) {
        ctx.setStatus(`Shared URL could not be parsed: ${String(error && error.message ? error.message : error)}`, true);
        return { found: true, loaded: false, messageShown: true };
      }
    };

    ctx.loadInitialState = async function loadInitialState() {
      const shareResult = await ctx.loadStateFromShareUrl();
      if (shareResult.found) {
        return shareResult;
      }

      return ctx.loadStateFromStorage();
    };

    ctx.loadStateFromStorage = function loadStateFromStorage() {
      const candidates = ctx.readPersistedStateCandidates(ctx.COOKIE_KEY);
      if (candidates.length === 0) {
        return { found: false, loaded: false, messageShown: false };
      }

      for (const candidate of candidates) {
        try {
          const parsed = ctx.parseCompactStateDocument(candidate.raw);
          const hasState = ctx.applyCompactState(parsed);
          if (hasState) {
            const storageLabel = candidate.source === "localStorage" ? "localStorage" : "cookie";
            ctx.setStatus(`Loaded saved state from ${storageLabel}.`);
            return { found: true, loaded: true, messageShown: true };
          }

          return { found: true, loaded: true, messageShown: false };
        } catch (_error) {
          if (candidate.source === "localStorage") {
            ctx.clearLocalStorage(ctx.COOKIE_KEY);
          } else if (candidate.source === "cookie") {
            ctx.clearCookie(ctx.COOKIE_KEY);
          }
        }
      }

      if (candidates.length > 0) {
        ctx.setStatus("Saved state could not be parsed. Starting fresh.", true);
        return { found: true, loaded: false, messageShown: true };
      }

      return { found: false, loaded: false, messageShown: false };
    };

    ctx.compactState = function compactState() {
      const selectedByRowId = {};
      for (const [rowId, selected] of Object.entries(state.selectedByRowId)) {
        const normalized = ctx.normalizeSelectedFunctionList(selected);
        if (normalized.length > 0) {
          selectedByRowId[rowId] = normalized;
        }
      }

      const reviewByRowId = {};
      for (const [rowId, flagged] of Object.entries(state.reviewByRowId)) {
        if (Boolean(flagged)) {
          reviewByRowId[rowId] = true;
        }
      }

      const baseFilterPatterns = {};
      for (const field of ctx.BASE_REGEX_FILTER_FIELDS) {
        const pattern = String(state.baseFilterPatterns[field] || "");
        if (pattern.trim() !== "") {
          baseFilterPatterns[field] = pattern;
        }
      }

      const unmappedRows = state.unmappedRows
        .map((node, index) => ctx.normalizeStoredUnmappedRow(node, index))
        .filter((node) => node !== null);

      return {
        version: 1,
        selectedByRowId,
        namesByRowId: state.namesByRowId,
        baseFilterPatterns,
        reviewByRowId,
        unmappedRows,
        regexColumns: state.regexColumns.map((column) => ({
          id: column.id,
          title: column.title,
          pattern: column.pattern,
        })),
      };
    };

    ctx.saveStateNow = function saveStateNow() {
      try {
        const payload = JSON.stringify(ctx.compactState());
        const localStorageSaved = ctx.writeLocalStorage(ctx.COOKIE_KEY, payload);

        const cookiePayloadSize = encodeURIComponent(payload).length;
        let cookieSaved = false;
        if (cookiePayloadSize <= ctx.COOKIE_MAX_VALUE_BYTES) {
          cookieSaved = ctx.writeCookie(ctx.COOKIE_KEY, payload, ctx.SAVE_DAYS);
        } else {
          ctx.clearCookie(ctx.COOKIE_KEY);
        }

        if (localStorageSaved && cookieSaved) {
          ctx.syncShareUrlToState();
          ctx.setStatus("State saved.");
          return;
        }
        if (localStorageSaved) {
          ctx.syncShareUrlToState();
          ctx.setStatus("State saved to localStorage.");
          return;
        }
        if (cookieSaved) {
          ctx.syncShareUrlToState();
          ctx.setStatus("State saved to cookie.");
          return;
        }

        ctx.setStatus("Failed to save state: storage is unavailable.", true);
      } catch (error) {
        ctx.setStatus(`Failed to save state: ${String(error)}`, true);
      }
    };

    ctx.saveStateDebounced = ctx.debounce(ctx.saveStateNow, 250);

    ctx.persistStateBeforeUnload = function persistStateBeforeUnload() {
      try {
        ctx.refreshRegexPatternsFromHeaders();
        ctx.refreshBaseFilterPatternsFromHeaders();
        ctx.saveStateNow();
      } catch (_error) {
        // Avoid blocking unload due transient UI state issues.
      }
    };
  };
}(window));