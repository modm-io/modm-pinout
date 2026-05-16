"use strict";

(async function initializeModmPinoutPage() {
  const statusNode = document.getElementById("save-status");

  function setBootstrapError(message) {
    if (!statusNode) {
      throw new Error(message);
    }

    statusNode.textContent = message;
    statusNode.classList.add("error");
  }

  function readBootstrapConfig() {
    const node = document.getElementById("modm-pinout-bootstrap");
    if (!node) {
      throw new Error("Missing page bootstrap configuration.");
    }

    try {
      return JSON.parse(node.textContent || "{}");
    } catch (error) {
      throw new Error(`Invalid page bootstrap configuration: ${String(error)}`);
    }
  }

  async function loadDeviceData(bootstrap) {
    if (bootstrap && bootstrap.dataUrl) {
      const response = await fetch(String(bootstrap.dataUrl));
      if (!response.ok) {
        throw new Error(`Failed to load shared device data: ${response.status} ${response.statusText}`);
      }

      const dataset = await response.json();
      const chipId = String(bootstrap.chipId || "").toLowerCase();
      const deviceData = dataset && dataset.devices ? dataset.devices[chipId] : null;
      if (!deviceData) {
        throw new Error(`Shared device data does not contain '${chipId}'.`);
      }

      return deviceData;
    }

    if (bootstrap && bootstrap.payload && typeof bootstrap.payload === "object") {
      return bootstrap.payload;
    }

    throw new Error("No device data source is configured for this page.");
  }

  try {
    const bootstrap = readBootstrapConfig();
    const deviceData = await loadDeviceData(bootstrap);
    if (typeof window.initializeModmPinoutApp !== "function") {
      throw new Error("Pin matrix app script did not load.");
    }

    window.initializeModmPinoutApp({
      cookieKey: String(bootstrap.cookieKey || ""),
      deviceData,
    });
  } catch (error) {
    setBootstrapError(`Failed to initialize page: ${String(error && error.message ? error.message : error)}`);
  }
}());