"""Module entrypoint for the modm pinout static site builder."""

from __future__ import annotations

import sys

from .builder import main


if __name__ == "__main__":
    sys.exit(main())