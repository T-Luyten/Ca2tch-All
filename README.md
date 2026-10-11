# Ca²⁺tchAll

![Ca2tchAll Logo](frontend/logo.png)

> **⚠️ Work In Progress — Use With Extreme Care**
> This software is in active development and has not been validated for production or clinical use. Results should be independently verified before being used in any scientific, clinical, or decision-making context. Use at your own risk.

Interactive viewer for calcium imaging experiment exports across multiple replicate files.

It loads Excel files produced by **Ca²⁺tch-One**, groups files by condition, and renders superplot-style charts that overlay individual data points, per-replicate distributions, and condition summaries side by side.

## Features

- Self-contained `.ca2tchall` project save/open with embedded original workbooks, source identifiers, SHA-256 fingerprints, and saved workspace settings
- Multi-file upload with condition grouping (up to 50 files, scales with available RAM)
- Trace plots for raw fluorescence / R/R₀ and ΔF/F₀ / ΔR/R₀, with separate toggles for error bands, upper/lower bounds, and individual replicate traces
- 14 scalar metric tabs: Peak, AUC, Event FWHM, Event Frequency, Time To Peak, Decay t½, Rate Of Rise, TG Peak, TG Slope, TG AUC, Add-Back Peak, Add-Back Slope, Add-Back AUC, Add-Back TTP
- Chart styles: Violin, Bar, Box, Strip, Raincloud
- Summary statistic switch: Mean or Median
- Error bar switch: SEM, SD, 95% CI, or None
- Paired replicate line mode (paired by day label when available, otherwise by file order with a warning)
- Optional pooling of same-day files into one replicate for both scalar metrics and raw/delta traces, so each experimental day contributes exactly one summary point or curve
- Statistical tests follow the selected summary statistic (mean or median)
- Optional per-replicate distributions
- Data Summary panel (opens on request): per-replicate and per-condition statistics (n, mean/median, SD, SEM, 95% CI, Shapiro–Wilk normality) with CSV export
- Normality notification advising the median summary statistic when most replicates fail Shapiro–Wilk
- Effect size estimation vs. a selectable reference condition with 95% CI (Gardner–Altman style plot)
- Pairwise tests (paired or Welch's t-test), one-way and two-way ANOVA with Holm correction, and cross-day comparability analysis
- Condition ordering controls (entered order, manual drag, A–Z, by summary value)
- Log axis, manual axis range controls
- Adjustable point size, alpha, and jitter
- Condition color picker with 6 palettes: Default, Okabe-Ito, Tol Bright, Tol Muted, ColorBrewer Dark2 (all colorblind-safe), and Nature (NPG)
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
    comparability-panel.js
    core.js
    dom.js
    main.js
    metric-renderers.js
    plot-controller.js
    plotly-config.js
    preferences.js
    state.js
    stats.js
    summary-panel.js
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
Frontend uses ES modules with no build step required. Plotly 2.27.0 is bundled locally, so graphing works offline after Python dependencies are installed. Release bundles include the library and its license; no CDN fallback or automatic Plotly update is used.
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

## Save and reopen a project

Click **Save project** after loading your workbooks. In browsers with a native save picker, choose the project name and folder in the save dialog. Each save asks for a destination, so you can select the previous file to replace it or choose a new copy.

Other browsers prompt for a filename and download the `.ca2tchall` project. To choose a folder for every download, enable **Ask where to save each file** (or the equivalent setting) in your browser's download preferences. Keep the latest saved or downloaded copy when continuing later. Cancelling the save dialog leaves your current workspace intact.

Click **Open project** and select that file to restore its workbooks, condition/day assignments, active plot tab, chart style, colors, labels, axis limits, analysis controls, theme, and warning preference. The original Excel files are not needed. Opening replaces the current workspace after validating and reading every embedded workbook; save any current work first. Wait for uploads to finish before saving or opening a project.

Each project embeds the **complete original Excel workbook bytes**, including sheets not loaded into interactive plots. Expand **Source details** beside a file to see its stable source ID, original upload timestamp, byte size, and SHA-256 fingerprint. Duplicate filenames remain distinct sources. Source IDs and fingerprints remain the same when a project is reopened and saved again.

The project is a versioned ZIP archive containing `manifest.json` and workbooks under `sources/<source-id>.xlsx` (or `.xls`). The manifest maps each embedded source to its original filename, fingerprint, and assignments. SHA-256 detects workbook corruption; it is not proof of authorship. Workbook metadata and original analyzer settings are preserved inside the embedded Excel files.

Opening re-reads the embedded workbooks using the installed application's reader and resource limits, then recalculates plots and statistics. Large trace sheets may still be skipped under those limits. Projects are not autosaved: click **Save project** before closing to keep your latest work. Statistics panels stay closed until requested.

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
5. Open **Plot formatting** when you need labels, fonts, axis ranges, or legend settings.
6. Enable **Significance** to add graph annotations, then click **Comparisons** beside **Plot formatting** to inspect the tests. **Summary** and **Comparability** have matching buttons. Results stay collapsed when starting the app.
7. Scroll the plot workspace to view expanded results; wide tables scroll sideways. Graphs retain a minimum height as results grow.
8. Export the figure from the Plotly toolbar.

**Pool same-day files** applies separately to each condition in both metric and trace plots. For traces, the program aligns time grids, pools ROI measurements within each day into a daily mean curve, and gives each daily curve equal weight in the condition mean/median. SD, SEM, and 95% CI are calculated across daily curves at each time point. The replicate count reflects pooled days; files with no day label remain separate replicates. With only one replicate, between-replicate uncertainty cannot be estimated, so no error band or boundary lines are drawn. Turning pooling off restores one replicate per file.

On raw and delta trace tabs, use **Trace display** to toggle **Error band**, **Upper/lower bounds**, and **Replicate traces** independently. Turn all three off to show only condition mean/median curves. The **Error** selector chooses SEM, SD, or 95% CI; **None** disables both error bands and bounds. These visibility choices do not change the data or statistical calculations and are saved in preferences and projects.

**Plot formatting → Visible conditions** lets you hide or restore conditions across all graphs, including effect-size plots. Use **Show all** to restore every condition. This changes graphs and their exported images only: statistics, result tables, and uploaded data still include hidden conditions. Visibility is saved in project files; fresh workspaces and older projects show all conditions.

The compact top toolbar keeps its buttons on one line, with horizontal scrolling when space is limited. The file counter shows loaded files and the file limit.

The **Show warnings** toggle in the header hides warning banners and file warnings. Your choice is saved between sessions; errors and statistical results remain visible.

## Notes

- Uploaded files are stored in backend memory for the current session only.
- Reloading the page clears the in-memory backend session state.
- The backend virtual environment is expected at `backend/venv`.
- The startup scripts only reinstall dependencies when `backend/requirements.txt` changes.
- Smoke tests: `backend/smoke_test.py`, `backend/fixture_smoke_test.py`, `backend/project_smoke_test.py`, `backend/trace_pooling_test.py`, `frontend/smoke_test.mjs`, and `frontend/project_save_test.mjs`.
- Use `sync_bundle.sh` to keep the `bundle/` directory in sync with source after changes.

## Repository

GitHub: <https://github.com/T-Luyten/Ca2tch-All>

## License

© 2026 Tomas Luyten. Licensed under the [MIT License](LICENSE).
