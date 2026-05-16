# modm-pinout

`modm-pinout` builds a static pin-mapping site from device definitions provided by `modm-devices`.

The generated output contains:

- one HTML page per device
- shared CSS and JavaScript assets
- shared JSON datasets grouped by source XML
- an index page for device lookup
- a manifest describing generated pages and datasets

The package installs a CLI named `modm_pinout`.

> Please note that this code was vibe-coded, since we're not good at web development.
> `modm-devices` is still written by humans though and it shows lol.

## Installation

```bash
python -m pip install modm-pinout
```

For local development:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

## Usage

Generate one device page:

```bash
modm_pinout stm32c011f4p6 -o build
```

Generate all supported devices:

```bash
modm_pinout --all -o build
```

## Output Layout

The generated site uses this structure:

```text
build/
  index.html
  manifest.json
  assets/
  data/
  devices/
```

## Notes

- Device metadata and XML inputs are loaded from the installed `modm-devices` package.
- Templates and frontend assets are bundled as package data inside `modm_pinout`.
- The package and CLI naming are generic so additional device families can be integrated later.