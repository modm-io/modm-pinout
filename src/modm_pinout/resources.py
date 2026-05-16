"""Helpers for accessing packaged modm_pinout and modm_devices resources."""

from __future__ import annotations

from contextlib import contextmanager
from importlib.resources import as_file, files
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Iterator


def _join(resource: Traversable, parts: tuple[str, ...]) -> Traversable:
    current = resource
    for part in parts:
        current = current.joinpath(part)
    return current


def package_resource(*parts: str) -> Traversable:
    return _join(files("modm_pinout"), parts)


def device_resource(*parts: str) -> Traversable:
    return _join(files("modm_devices").joinpath("resources", "devices"), parts)


@contextmanager
def device_resource_file(*parts: str) -> Iterator[Path]:
    with as_file(device_resource(*parts)) as path:
        yield path