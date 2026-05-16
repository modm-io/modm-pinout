"""Load pin rows directly from modm_devices XML."""

from __future__ import annotations

import re
from collections import defaultdict
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Any

from modm_devices.parser import DeviceParser

from .resources import device_resource_file


GPIO_NAME_RE = re.compile(r"\bP(?P<port>[A-Z])(?P<pin>\d+)\b")


def _pin_sort_key(pin_key: object) -> tuple[int, int | str]:
    key = str(pin_key)
    if key.isdigit():
        return (0, int(key))
    return (1, key)


def _merge_functions(alt_fns: list[str], add_fns: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()

    for fn in [*alt_fns, *add_fns]:
        value = str(fn).strip()
        if not value or value == "-":
            continue
        if value in seen:
            continue
        seen.add(value)
        merged.append(value)

    return merged


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _dedupe_preserving_order(values: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


@lru_cache(maxsize=1)
def _device_parser() -> DeviceParser:
    return DeviceParser()


@lru_cache(maxsize=None)
def _devices_by_source(source_xml: str) -> dict[str, Any]:
    normalized_source_xml = str(source_xml).strip().replace("\\", "/")
    if not normalized_source_xml:
        raise ValueError("Device source XML path must not be empty.")

    resource_parts = PurePosixPath(normalized_source_xml).parts
    try:
        with device_resource_file(*resource_parts) as xml_path:
            device_file = _device_parser().parse(str(xml_path))
    except FileNotFoundError as exc:
        raise ValueError(f"Device source XML not found: '{normalized_source_xml}'.") from exc

    devices: dict[str, Any] = {}
    for device in device_file.get_devices():
        devices[str(device.identifier.string).lower()] = device

    return devices


def _resolve_device(chip_id: str, source_xml: str) -> Any:
    normalized_chip_id = chip_id.strip().lower()
    device = _devices_by_source(source_xml).get(normalized_chip_id)
    if device is None:
        raise ValueError(f"No device definition found for '{normalized_chip_id}' in '{source_xml}'.")
    return device


def _select_package(gpio_driver: dict[str, Any], chip_id: str) -> dict[str, Any]:
    packages = _as_list(gpio_driver.get("package"))
    if not packages:
        raise ValueError(f"No package definition found for '{chip_id}'.")
    if len(packages) == 1:
        return packages[0]

    return max(packages, key=lambda package: len(_as_list(package.get("pin"))))


def _extract_gpio_key(pin_name: str) -> tuple[str, str] | None:
    match = GPIO_NAME_RE.search(pin_name.upper())
    if match is None:
        return None
    return (match.group("port").lower(), match.group("pin"))


def _format_signal(signal: dict[str, Any]) -> str:
    driver = str(signal.get("driver") or "").strip().upper()
    name = str(signal.get("name") or "").strip().upper()
    instance = str(signal.get("instance") or "").strip()
    if not driver:
        return ""

    prefix = f"{driver}{instance}" if instance else driver
    return f"{prefix}_{name}" if name else prefix


def _functions_for_gpio(gpio_node: dict[str, Any]) -> list[str]:
    alt_groups: dict[int, list[str]] = defaultdict(list)
    add_fns: list[str] = []

    for signal in _as_list(gpio_node.get("signal")):
        label = _format_signal(signal)
        if not label:
            continue

        af_value = signal.get("af")
        if af_value is None:
            add_fns.append(label)
            continue

        try:
            af_key = int(str(af_value))
        except ValueError:
            af_key = 1_000_000
        alt_groups[af_key].append(label)

    alt_fns = [
        "/".join(_dedupe_preserving_order(alt_groups[af_key]))
        for af_key in sorted(alt_groups)
        if _dedupe_preserving_order(alt_groups[af_key])
    ]
    return _merge_functions(alt_fns, _dedupe_preserving_order(add_fns))


def _gpio_lookup(gpio_driver: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for gpio in _as_list(gpio_driver.get("gpio")):
        port = str(gpio.get("port") or "").strip().lower()
        pin = str(gpio.get("pin") or "").strip()
        if not port or not pin:
            continue
        lookup[(port, pin)] = gpio
    return lookup


def _rows_from_package(package: dict[str, Any], gpio_by_name: dict[tuple[str, str], dict[str, Any]]) -> list[dict[str, Any]]:
    pin_nodes = sorted(
        (
            pin_node
            for pin_node in _as_list(package.get("pin"))
            if str(pin_node.get("position") or "").strip()
        ),
        key=lambda pin_node: _pin_sort_key(str(pin_node.get("position") or "").strip()),
    )

    rows: list[dict[str, Any]] = []
    for row_id, pin_node in enumerate(pin_nodes):
        position = str(pin_node.get("position") or "").strip()
        short_name = str(pin_node.get("name") or "").strip()
        gpio_key = _extract_gpio_key(short_name)
        gpio_node = gpio_by_name.get(gpio_key) if gpio_key else None
        functions = _functions_for_gpio(gpio_node) if gpio_node else []

        rows.append(
            {
                "row_id": row_id,
                "position": position,
                "short_name": short_name,
                "pin_label": f"{position} {short_name}".strip(),
                "functions": functions,
                "package_pin_type": str(pin_node.get("type") or "io").strip().lower() or "io",
            }
        )

    return rows


def _package_pins_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped_pins: dict[str, dict[str, Any]] = {}
    package_pins: list[dict[str, Any]] = []

    for row in rows:
        position = str(row.get("position") or "").strip()
        if not position:
            continue

        row_id = row.get("row_id")
        short_name = str(row.get("short_name") or "").strip()
        pin_type = str(row.get("package_pin_type") or "io").strip().lower() or "io"

        package_pin = grouped_pins.get(position)
        if package_pin is None:
            package_pin = {
                "row_id": row_id,
                "row_ids": [row_id],
                "position": position,
                "short_name": short_name,
                "type": pin_type,
            }
            grouped_pins[position] = package_pin
            package_pins.append(package_pin)
            continue

        package_pin["row_ids"].append(row_id)
        if not package_pin["short_name"] and short_name:
            package_pin["short_name"] = short_name
        if package_pin["type"] == "io" and pin_type != "io":
            package_pin["type"] = pin_type

    return package_pins


def _rows_from_gpio_driver(gpio_driver: dict[str, Any]) -> list[dict[str, Any]]:
    prepared_rows: list[dict[str, Any]] = []

    for gpio_node in _as_list(gpio_driver.get("gpio")):
        explicit_name = str(gpio_node.get("name") or "").strip()
        port = str(gpio_node.get("port") or "").strip().upper()
        pin = str(gpio_node.get("pin") or "").strip()
        short_name = explicit_name or (f"P{port}{pin}" if port and pin else "")
        position = f"{port}{pin}" if port and pin else short_name
        if not short_name and not position:
            continue

        prepared_rows.append(
            {
                "position": position,
                "short_name": short_name or position,
                "functions": _functions_for_gpio(gpio_node),
            }
        )

    return [
        {
            "row_id": row_id,
            "position": row["position"],
            "short_name": row["short_name"],
            "pin_label": f"{row['position']} {row['short_name']}".strip(),
            "functions": row["functions"],
        }
        for row_id, row in enumerate(
            sorted(prepared_rows, key=lambda item: _pin_sort_key(item["position"]))
        )
    ]


def load_device_pin_data(chip_id: str, source_xml: str) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    device = _resolve_device(chip_id, source_xml)
    gpio_driver = device.get_driver("gpio")
    if not gpio_driver:
        return (str(device.partname), None, [])

    gpio_by_name = _gpio_lookup(gpio_driver)

    packages = _as_list(gpio_driver.get("package"))
    package = None
    rows: list[dict[str, Any]] = []
    if packages and any(_as_list(candidate.get("pin")) for candidate in packages):
        package = _select_package(gpio_driver, chip_id)
        rows = _rows_from_package(package, gpio_by_name)
    else:
        rows = _rows_from_gpio_driver(gpio_driver)

    public_rows = [
        {key: value for key, value in row.items() if key != "package_pin_type"}
        for row in rows
    ]

    if package is None:
        return (str(device.partname), None, public_rows)

    if not public_rows:
        raise ValueError(f"No package pin rows found for '{chip_id}'.")

    package_pins = _package_pins_from_rows(rows)
    package_info = {
        "name": str(package.get("name") or "").strip(),
        "pins": [
            {
                "row_id": pin["row_id"],
                "row_ids": list(pin["row_ids"]),
                "position": pin["position"],
                "short_name": pin["short_name"],
                "type": pin["type"],
            }
            for pin in package_pins
        ],
    }

    return (str(device.partname), package_info, public_rows)