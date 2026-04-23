# Ca²⁺tchAll

![Ca2tchAll Logo](frontend/logo.png)

Interactive viewer for calcium imaging experiment exports across multiple replicate files.

It loads Excel files produced by **Ca²⁺tch-One**, groups files by condition, and renders superplot-style charts that overlay individual data points, per-replicate distributions, and condition summaries side by side.

## Features

- Multi-file upload with condition grouping (up to 50 files, scales with available RAM)
- Trace plots for raw fluorescence and ΔF / F₀
- 14 scalar metric tabs: Peak, AUC, Event FWHM, Event Frequency, Time To Peak, Decay t½, Rate Of Rise, TG Peak, TG Slope, TG AUC, Add-Back Peak, Add-Back Slope, Add-Back AUC, Add-Back TTP
- Chart styles: Violin, Bar, Box, Strip, Raincloud
- Summary statistic switch: Mean or Median
- Error bar switch: SEM, SD, 95% CI, or None
- Paired replicate line mode
- Optional per-replicate distributions
- Condition ordering controls (entered order, manual drag, A–Z, by summary value)
- Log axis, manual axis range controls
- Adjustable point size, alpha, and jitter
- Condition color picker with Okabe-Ito colorblind-safe palette
- Font, font size, and axis tick angle controls
- Label overrides for plot title and axis labels
- Dark / light theme toggle
- High-resolution PNG, SVG, and print-to-PDF export via Plotly toolbar
- Persistent preferences (saved across sessions in localStorage)
- Interactive onboarding tour

## Project Structure

```text
backend/
  main.py
  requirements.txt
  smoke_test.py
  fixture_smoke_test.py
bundle/
  README.txt
  setup.bat
  launch.bat
  backend/
    main.py
    requirements.txt
  frontend/
    index.html
    style.css
    js/
frontend/
  index.html
  style.css
  js/
    api.js
    core.js
    dom.js
    main.js
    metric-renderers.js
    plot-controller.js
    plotly-config.js
    preferences.js
    state.js
    stats.js
    theme.js
    tour.js
    trace-renderers.js
    ui.js
manual/
  manual.html
  Ca2tchAll_User_Manual.pdf
example1.xlsx
example2.xlsx
start.sh
start.bat
sync_bundle.sh
```

## Requirements

- Python 3.12 recommended
- `python3-venv` installed on Linux

Backend dependencies are listed in [backend/requirements.txt](backend/requirements.txt).
Frontend uses ES modules with no build step required.
The startup scripts create `backend/venv` automatically.

## Run Locally

### Linux / macOS

```bash
./start.sh
```

If the script is not executable:

```bash
chmod +x start.sh
./start.sh
```

Then open:

```
http://localhost:8002
```

### Windows

```bat
start.bat
```

## Portable Windows Bundle

For Windows users who prefer not to install Python, a self-contained bundle is available in the `bundle/` folder.

### First Time Setup

1. Run `bundle/setup.bat` (downloads Python 3.12 and dependencies, ~60 MB, requires internet)
2. This only needs to be done once

### Running the App

1. Run `bundle/launch.bat`
2. Opens your browser at `http://localhost:8002`
3. Close the command window to stop the app

See `bundle/README.txt` for details.

## Input Files

The app expects `.xlsx` or `.xls` exports from Ca²⁺tch-One containing some or all of these sheets:

- `Metrics`
- `Metadata`
- `Settings`
- `Raw_Traces`
- `DeltaF`

Typical expected columns:

- `roi_id` in `Metrics`
- scalar metric columns such as `peak`, `auc`, `event_fwhm`, `event_frequency`
- `Time_s` plus `ROI_*` columns in trace sheets

Two example files are included: `example1.xlsx` and `example2.xlsx`.

## User Manual

A full user manual is available at [manual/Ca2tchAll_User_Manual.pdf](manual/Ca2tchAll_User_Manual.pdf).

## Workflow

1. Load one or more `.xlsx` files exported from Ca²⁺tch-One.
2. Assign a condition name to each file.
3. Switch between trace tabs and scalar metric tabs.
4. Adjust chart style, summary/error/ordering controls as needed.
5. Export the figure from the Plotly toolbar.

## Notes

- Uploaded files are stored in backend memory for the current session only.
- Reloading the page clears the in-memory backend session state.
- The backend virtual environment is expected at `backend/venv`.
- The startup scripts only reinstall dependencies when `backend/requirements.txt` changes.
- Smoke tests: `backend/smoke_test.py`, `backend/fixture_smoke_test.py`, and `frontend/smoke_test.mjs`.
- Use `sync_bundle.sh` to keep the `bundle/` directory in sync with source after changes.

## Repository

GitHub: <https://github.com/T-Luyten/Ca2tch-All>

## License

© 2026 Tomas Luyten. Licensed under the [MIT License](LICENSE).
