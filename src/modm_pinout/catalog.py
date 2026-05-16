"""Catalog helpers for device pin mapping pages."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

from .resources import device_resource


@dataclass(frozen=True)
class DeviceCatalogEntry:
    chip_id: str
    source_xml: str


@lru_cache(maxsize=1)
def _load_raw_device_catalog() -> list[DeviceCatalogEntry]:
    raw_db = json.loads(device_resource("db.json").read_text(encoding="utf-8"))
    entries: list[DeviceCatalogEntry] = []

    for family, devices in sorted(raw_db.items()):
        if not isinstance(devices, dict):
            continue

        for chip_id, source_xml in sorted(devices.items()):
            normalized_chip_id = str(chip_id).strip().lower()
            normalized_source_xml = str(source_xml).strip()
            if not normalized_chip_id or not normalized_source_xml:
                continue

            entries.append(
                DeviceCatalogEntry(
                    chip_id=normalized_chip_id,
                    source_xml=normalized_source_xml,
                )
            )

    return entries

@lru_cache(maxsize=1)
def load_device_catalog() -> list[DeviceCatalogEntry]:
    return _load_raw_device_catalog()


def find_device_entry(chip_id: str) -> DeviceCatalogEntry | None:
    normalized = chip_id.strip().lower()
    for entry in load_device_catalog():
        if entry.chip_id == normalized:
            return entry
    return None