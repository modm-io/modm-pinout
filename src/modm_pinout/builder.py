#!/usr/bin/env python3
"""Build device pin mapping pages as a static site."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    from jinja2 import Environment, StrictUndefined, select_autoescape
except ImportError as exc:  # pragma: no cover - runtime environment specific
    raise SystemExit(
        "Missing dependency: jinja2. Install it with 'pip install jinja2'."
    ) from exc

from .catalog import find_device_entry, load_device_catalog
from .device_loader import load_device_pin_data
from .resources import package_resource


DEVICE_TEMPLATE_NAME = "pin_matrix.html.j2"
INDEX_TEMPLATE_NAME = "pin_index.html.j2"
DEFAULT_SITE_DIR = Path("build")
STYLESHEET_ASSET = Path("assets/styles/pinout.css")
SCRIPT_ASSETS = (
    Path("assets/scripts/pinout-core.js"),
    Path("assets/scripts/pinout-persistence.js"),
    Path("assets/scripts/pinout-regex.js"),
    Path("assets/scripts/pinout-io.js"),
    Path("assets/scripts/pinout-table.js"),
    Path("assets/scripts/pinout-package.js"),
    Path("assets/scripts/pinout-package-renderers.js"),
    Path("assets/scripts/pinout-app.js"),
    Path("assets/scripts/pinout-loader.js"),
)
ASSET_FILES = (STYLESHEET_ASSET, *SCRIPT_ASSETS)


TEMPLATE_ENV = Environment(
    autoescape=select_autoescape(enabled_extensions=("html", "xml")),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)


def _build_payload(chip_id: str, source_xml: str | None = None) -> dict[str, Any]:
    normalized_chip_id = chip_id.strip().lower()
    if not normalized_chip_id:
        raise ValueError("Chip identifier must not be empty.")

    resolved_source_xml = str(source_xml or "").strip()
    if not resolved_source_xml:
        entry = find_device_entry(normalized_chip_id)
        if entry is None:
            raise ValueError(f"No device catalog entry found for '{normalized_chip_id}'.")
        resolved_source_xml = entry.source_xml

    partname, package, rows = load_device_pin_data(normalized_chip_id, resolved_source_xml)

    return {
        "chip_id": normalized_chip_id,
        "partname": partname,
        "package": package,
        "pin_count": len(rows),
        "rows": rows,
        "source_xml": resolved_source_xml,
    }


def _render_template(template_name: str, context: dict[str, Any]) -> str:
    template_text = package_resource("templates", template_name).read_text(encoding="utf-8")
    template = TEMPLATE_ENV.from_string(template_text)
    return template.render(**context)


def _device_page_path(site_dir: Path, chip_id: str) -> Path:
    return site_dir / "devices" / f"{chip_id}.html"


def _index_page_path(site_dir: Path) -> Path:
    return site_dir / "index.html"


def _data_file_path(site_dir: Path, source_xml: str) -> Path:
    xml_path = Path(source_xml)
    return (site_dir / "data" / xml_path).with_suffix(".json")


def _site_asset_path(site_dir: Path, relative_path: Path) -> Path:
    return site_dir / relative_path


def _relative_url(from_dir: Path, to_path: Path) -> str:
    return Path(os.path.relpath(to_path, start=from_dir)).as_posix()


def _build_bootstrap_payload(
    site_dir: Path,
    output_path: Path,
    payload: dict[str, Any],
    dataset_paths: dict[str, Path],
) -> dict[str, Any]:
    bootstrap = {
        "chipId": payload["chip_id"],
        "cookieKey": f"modm_pinout::{payload['chip_id']}",
    }

    source_xml = str(payload.get("source_xml") or "")
    data_path = dataset_paths.get(source_xml)
    if data_path is not None:
        bootstrap["dataUrl"] = _relative_url(output_path.parent, data_path)
    else:
        bootstrap["payload"] = {
            "chip_id": payload["chip_id"],
            "partname": payload["partname"],
            "package": payload["package"],
            "rows": payload["rows"],
        }

    return bootstrap


def _build_page_context(
    site_dir: Path,
    output_path: Path,
    payload: dict[str, Any],
    dataset_paths: dict[str, Path],
) -> dict[str, Any]:
    stylesheet_path = _site_asset_path(site_dir, STYLESHEET_ASSET)
    script_sources = [
        _relative_url(output_path.parent, _site_asset_path(site_dir, script_path))
        for script_path in SCRIPT_ASSETS
    ]

    return {
        "chip_id": payload["chip_id"],
        "partname": payload["partname"],
        "package_name": str((payload.get("package") or {}).get("name") or ""),
        "has_package": bool(payload.get("package")),
        "pin_count": payload["pin_count"],
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "index_href": _relative_url(output_path.parent, _index_page_path(site_dir)),
        "stylesheet_href": _relative_url(output_path.parent, stylesheet_path),
        "script_sources": script_sources,
        "bootstrap": _build_bootstrap_payload(site_dir, output_path, payload, dataset_paths),
    }


def _write_device_page(
    site_dir: Path,
    payload: dict[str, Any],
    dataset_paths: dict[str, Path],
) -> Path:
    output_path = _device_page_path(site_dir, payload["chip_id"])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    html = _render_template(DEVICE_TEMPLATE_NAME, _build_page_context(site_dir, output_path, payload, dataset_paths))
    output_path.write_text(html, encoding="utf-8")
    return output_path


def _write_device_pages(
    site_dir: Path,
    payloads: list[dict[str, Any]],
    dataset_paths: dict[str, Path],
) -> list[Path]:
    return [_write_device_page(site_dir, payload, dataset_paths) for payload in payloads]


def _build_index_context(site_dir: Path, payloads: list[dict[str, Any]]) -> dict[str, Any]:
    output_path = _index_page_path(site_dir)
    stylesheet_path = _site_asset_path(site_dir, STYLESHEET_ASSET)
    devices = []

    for payload in sorted(payloads, key=lambda item: item["chip_id"]):
        device_output_path = _device_page_path(site_dir, payload["chip_id"])
        devices.append(
            {
                "chip_id": payload["chip_id"],
                "partname": payload["partname"],
                "package_name": str((payload.get("package") or {}).get("name") or ""),
                "pin_count": payload["pin_count"],
                "source_xml": str(payload.get("source_xml") or ""),
                "page_href": _relative_url(output_path.parent, device_output_path),
            }
        )

    source_count = len({device["source_xml"] for device in devices if device["source_xml"]})

    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "device_count": len(devices),
        "source_count": source_count,
        "stylesheet_href": _relative_url(output_path.parent, stylesheet_path),
        "devices": devices,
    }


def _write_index_page(site_dir: Path, payloads: list[dict[str, Any]]) -> Path:
    output_path = _index_page_path(site_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    html = _render_template(INDEX_TEMPLATE_NAME, _build_index_context(site_dir, payloads))
    output_path.write_text(html, encoding="utf-8")
    return output_path


def _write_manifest(site_dir: Path, records: list[dict[str, str]]) -> Path:
    manifest_path = site_dir / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"devices": records}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest_path


def _dataset_payload(source_xml: str, payloads: list[dict[str, Any]]) -> dict[str, Any]:
    devices = {}
    for payload in payloads:
        devices[payload["chip_id"]] = {
            "chip_id": payload["chip_id"],
            "partname": payload["partname"],
            "package": payload["package"],
            "pin_count": payload["pin_count"],
            "rows": payload["rows"],
        }

    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "source_xml": source_xml,
        "devices": devices,
    }


def _write_source_datasets(site_dir: Path, payloads: list[dict[str, Any]]) -> dict[str, Path]:
    payloads_by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for payload in payloads:
        source_xml = str(payload.get("source_xml") or "").strip()
        if not source_xml:
            continue
        payloads_by_source[source_xml].append(payload)

    dataset_paths: dict[str, Path] = {}
    for source_xml, source_payloads in sorted(payloads_by_source.items()):
        output_path = _data_file_path(site_dir, source_xml)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(_dataset_payload(source_xml, source_payloads), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        dataset_paths[source_xml] = output_path

    return dataset_paths


def _write_assets(site_dir: Path) -> list[Path]:
    output_paths: list[Path] = []
    for relative_path in ASSET_FILES:
        output_path = _site_asset_path(site_dir, relative_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(package_resource(*relative_path.parts).read_bytes())
        output_paths.append(output_path)

    return output_paths


def _manifest_record(
    site_dir: Path,
    payload: dict[str, Any],
    output_path: Path,
    dataset_paths: dict[str, Path],
) -> dict[str, str]:
    source_xml = str(payload.get("source_xml") or "")
    data_path = dataset_paths.get(source_xml)
    return {
        "chip_id": payload["chip_id"],
        "partname": payload["partname"],
        "page": str(output_path.relative_to(site_dir)),
        "source_xml": source_xml,
        "data": str(data_path.relative_to(site_dir)) if data_path else "",
    }


def build_single_device(chip_id: str) -> dict[str, Any]:
    entry = find_device_entry(chip_id)
    payload = _build_payload(chip_id, source_xml=entry.source_xml if entry else None)
    return payload


def build_all_devices() -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []

    for entry in load_device_catalog():
        payload = _build_payload(entry.chip_id, source_xml=entry.source_xml)
        payloads.append(payload)

    return payloads


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build device pin mapping pages as a static site with one device page per output file."
        )
    )
    parser.add_argument(
        "chip",
        nargs="?",
        help="Device identifier from modm_devices (example: atmega328p)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        dest="build_all",
        help="Build pages for all devices in the modm_devices catalog that have package pin data.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=DEFAULT_SITE_DIR,
        help="Output site directory (default: site)",
    )
    return parser.parse_args(argv)


def _validate_args(args: argparse.Namespace) -> None:
    if args.build_all and args.chip:
        raise SystemExit("Use either a chip identifier or --all, not both.")
    if not args.build_all and not args.chip:
        raise SystemExit("Provide a chip identifier or use --all.")


def _build_manifest_records(
    site_dir: Path,
    payloads: list[dict[str, Any]],
    output_paths: list[Path],
    dataset_paths: dict[str, Path],
) -> list[dict[str, str]]:
    return [
        _manifest_record(site_dir, payload, output_path, dataset_paths)
        for payload, output_path in zip(payloads, output_paths, strict=True)
    ]


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    _validate_args(args)

    site_dir = args.output_dir
    site_dir.mkdir(parents=True, exist_ok=True)

    try:
        if args.build_all:
            payloads = build_all_devices()
        else:
            payloads = [build_single_device(args.chip)]
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    dataset_paths = _write_source_datasets(site_dir, payloads)
    asset_paths = _write_assets(site_dir)
    output_paths = _write_device_pages(site_dir, payloads, dataset_paths)
    index_path = _write_index_page(site_dir, payloads)
    manifest_records = _build_manifest_records(site_dir, payloads, output_paths, dataset_paths)
    manifest_path = _write_manifest(site_dir, manifest_records)

    print(f"Built {len(output_paths)} device page(s) in {site_dir}")
    print(f"Wrote {len(dataset_paths)} shared data file(s)")
    print(f"Wrote {len(asset_paths)} shared asset file(s)")
    print(f"Wrote index page: {index_path}")
    print(f"Wrote manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())