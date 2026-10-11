# Ca²⁺tchAll

![Ca2tchAll Logo](frontend/logo.png)

> **⚠️ Work In Progress — Use With Extreme Care**
> This software is in active development and has not been validated for production or clinical use. Results should be independently verified before being used in any scientific, clinical, or decision-making context. Use at your own risk.

Interactive viewer for calcium imaging experiment exports across multiple replicate files.

It loads Excel files produced by **Ca²⁺tch-One**, groups files by condition, and renders superplot-style charts that overlay individual data points, per-replicate distributions, and condition summaries side by side.

The current interface displays **v1.1.0**. This README describes the source and portable bundle as of **11 October 2026**.

## Recent additions and changes

- **Portable projects:** save and reopen `.ca2tchall` files containing the original workbooks and workspace settings. Source details identify each workbook with a stable ID and SHA-256 fingerprint.
- **Replicate-aware analysis:** choose mean or median summaries, SEM/SD/95% CI, same-day pooling, and replicate-level outlier filtering. Plot summaries and statistical results are calculated by the Python backend.
- **Trace controls:** independently show uncertainty bands, upper/lower boundary lines, and individual file or pooled-day traces. Pooling uses aligned time grids and gives each day equal weight in the condition summary.
- **Day grouping:** normalized day labels group entries consistently; day colors and symbols identify acquisition days across plots.
- **Plot workspace:** a collapsible formatting panel includes condition visibility, labels, typography, legends, and axis controls. Comparison, summary, and comparability results open on request and scroll within the workspace.
- **Uploads:** progress and cancellation controls, workbook validation, memory-aware file limits, and warnings when large trace sheets cannot be loaded interactively.
- **Offline graphs and desktop launchers:** Plotly and its license are included locally; macOS and Windows helpers start the server and open the browser.
- **Repository cleanup:** generated Mac apps, unused logo variants, the unused presentation component, and internal session notes are excluded from the current repository. The Mac app can be rebuilt locally.

## Features

- Self-contained `.ca2tchall` project save/open with embedded original workbooks, source identifiers, SHA-256 fingerprints, and saved workspace settings
- Multi-file upload and drag-and-drop with condition/day assignments, upload progress, cancellation, and a file limit derived from available RAM
- Trace plots for raw fluorescence / R/R₀ and ΔF/F₀ / ΔR/R₀, with separate toggles for error bands, upper/lower bounds, and individual replicate traces
- 14 scalar metric tabs: Peak, AUC, Event FWHM, Event Frequency, Time To Peak, Decay t½, Rate Of Rise, TG Peak, TG Slope, TG AUC, Add-Back Peak, Add-Back Slope, Add-Back AUC, Add-Back TTP
- Chart styles: Violin, Bar, Box, Strip, Raincloud
- Summary statistic switch: Mean or Median
- Error bar switch: SEM, SD, 95% CI, or None
- Paired replicate lines and paired effect-size estimates; effect-size pairing uses day labels when available and reports a warning when falling back to file order
- Optional pooling of same-day files into one replicate for both scalar metrics and raw/delta traces, so each experimental day contributes exactly one summary point or curve
- Statistical tests follow the selected summary statistic (mean or median)
- Optional exclusion of replicate-summary outliers using 1.5× IQR or modified Z-score (threshold 3.5) on scalar metric tabs
- Optional per-replicate distributions
- Data Summary panel (opens on request): per-replicate and per-condition statistics (n, mean/median, SD, SEM, 95% CI, Shapiro–Wilk normality) with CSV export
- Normality notification advising the median summary statistic when most replicates fail Shapiro–Wilk
- Effect size estimation vs. a selectable reference condition with 95% CI (Gardner–Altman style plot)
- Pairwise tests (paired or Welch's t-test) with Holm correction, one-way ANOVA, and condition × day two-way ANOVA when estimable
- Cross-day comparability analysis with baseline checks, ICC before/after normalization, normality tests, and a mixed-effects model using file-level summaries
- Condition ordering controls (entered order, manual drag, A–Z, by summary value)
- Log axis, manual axis range controls
- Adjustable point size, alpha, and jitter
- Condition color picker with 6 palettes: Default, Okabe-Ito, Tol Bright, Tol Muted, ColorBrewer Dark2, and Nature (NPG); the interface identifies the colorblind-safe choices
- Color by day, horizontal metric plots, grid and legend toggles, and per-condition graph visibility
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
  project_archive.py
  requirements.txt
  smoke_test.py
  fixture_smoke_test.py
  project_smoke_test.py
  trace_pooling_test.py
  bundled_assets_test.py
bundle/
  README.txt
  setup.bat
  launch.bat
  backend/
    main.py
    project_archive.py
    requirements.txt
  frontend/
    index.html
    style.css
    js/
    vendor/             # Plotly and its license
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
    project.js
    project-save.js
    project-state.js
    format-events.js
    state.js
    stats.js
    summary-panel.js
    theme.js
    tour.js
    trace-renderers.js
    ui.js
  vendor/               # Plotly and its license
  package.json          # ES module configuration for Node tests
  smoke_test.mjs
  project_save_test.mjs
manual/
  manual.html
  Ca2tchAll_User_Manual.pdf
example1.xlsx
example2.xlsx
start.sh
start.bat
start-mac.command
build-macos-app.sh
Create-Shortcut.ps1
Ca2tchAll.ico
wait-and-open.ps1
sync_bundle.sh
```

## Requirements

- Python 3.12 recommended
- `python3-venv` installed on Linux
- A modern browser; Node.js is only needed for the frontend smoke tests

Backend dependencies are listed in [backend/requirements.txt](backend/requirements.txt).
Frontend uses ES modules with no build step required. Plotly 2.27.0 is bundled locally, so graphing works offline after Python dependencies are installed. Release bundles include the library and its license; no CDN fallback or automatic Plotly update is used.
The startup scripts create `backend/venv` automatically.
The first dependency installation needs internet access. Subsequent graphing and project use work locally without a CDN.

## Run Locally

### Linux / macOS terminal

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

### macOS double-click launcher

Double-click `start-mac.command` to start the server in Terminal and open the browser when it is ready. For a Dock or Spotlight launcher, run:

```bash
bash build-macos-app.sh
```

This generates `Ca2tchAll.app` in the project folder and copies it to `~/Applications`. Rebuild it after moving the project folder. The generated app is ignored by Git and is not included in the source repository.

### Windows

```bat
start.bat
```

The Windows launcher opens the browser when the server responds. To create a desktop shortcut with the app icon, right-click `Create-Shortcut.ps1` and select **Run with PowerShell**; rerun it after moving the project folder.

Keep the server terminal open while using the app. Stop it with **Ctrl+C** before closing the terminal.

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

A workbook must contain usable metrics or traces; metadata/settings alone are not enough. Missing or oversized trace sheets can leave scalar metrics available. Tabs reflect the metrics present in the loaded files. Prefer `.xlsx`: legacy `.xls` reading requires the optional `xlrd` dependency, which is not included in the default requirements.

Two example files are included: `example1.xlsx` and `example2.xlsx`.

## User Manual

A full user manual is available at [manual/Ca2tchAll_User_Manual.pdf](manual/Ca2tchAll_User_Manual.pdf).

## Workflow

1. Upload or drag in `.xlsx` files exported from Ca²⁺tch-One, or use **Open project** to continue saved work.
2. Assign a condition name and, where relevant, an acquisition day to each file. Check upload warnings and **Source details**.
3. Switch between trace tabs and scalar metric tabs.
4. Adjust chart style, summary/error/ordering controls as needed.
5. Open **Plot formatting** when you need labels, fonts, axis ranges, or legend settings.
6. Enable **Significance** to add graph annotations, then click **Comparisons** beside **Plot formatting** to inspect the tests. **Summary** and **Comparability** have matching buttons. Results stay collapsed when starting the app.
7. Scroll the plot workspace to view expanded results; wide tables scroll sideways. Graphs retain a minimum height as results grow.
8. Export the figure from the Plotly toolbar.
9. Click **Save project** to preserve the workbooks and workspace for later.

**Color by day** uses normalized day labels: leading/trailing spaces and repeated whitespace are removed, and grouping is case-insensitive. Day colors and symbols are assigned in natural order (for example, Day 2 before Day 10).

**Exclude outliers** flags replicate summaries within each condition for the current scalar metric. Exclusions feed condition summaries, comparisons, and the data summary/effect-size panel; original workbooks are retained. This control does not filter raw or delta trace plots.

The mean/median selector changes the replicate summaries used by the tests; it does not switch t-tests or ANOVA to nonparametric tests. Paired pairwise t-tests use the replicate order when both groups have equal sizes and at least two replicates; otherwise the app uses Welch's test or reports insufficient data. Day-based matching and the ordinal fallback warning in the summary panel apply to effect-size estimates. Verify replicate ordering before interpreting paired comparisons.

**Pool same-day files** applies separately to each condition in both metric and trace plots. For traces, the program aligns time grids, pools ROI measurements within each day into a daily mean curve, and gives each daily curve equal weight in the condition mean/median. SD, SEM, and 95% CI are calculated across daily curves at each time point. The replicate count reflects pooled days; files with no day label remain separate replicates. With only one replicate, between-replicate uncertainty cannot be estimated, so no error band or boundary lines are drawn. Turning pooling off restores one replicate per file.

On raw and delta trace tabs, use **Trace display** to toggle **Error band**, **Upper/lower bounds**, and **Replicate traces** independently. Turn all three off to show only condition mean/median curves. The **Error** selector chooses SEM, SD, or 95% CI; **None** disables both error bands and bounds. These visibility choices do not change the data or statistical calculations and are saved in preferences and projects.

**Plot formatting → Visible conditions** lets you hide or restore conditions across all graphs, including effect-size plots. Use **Show all** to restore every condition. This changes graphs and their exported images only: statistics, result tables, and uploaded data still include hidden conditions. Visibility is saved in project files; fresh workspaces and older projects show all conditions.

The compact top toolbar keeps its buttons on one line, with horizontal scrolling when space is limited. The file counter shows loaded files and the file limit.

The **Show warnings** toggle in the header hides warning banners and file warnings. Your choice is saved between sessions; errors and statistical results remain visible.

## Notes

- Uploaded files are stored in backend memory for the current session only.
- Reloading the page clears the in-memory backend session state.
- The backend session is shared by browser tabs connected to the same server; use one active workspace per running server.
- The backend virtual environment is expected at `backend/venv`.
- The startup scripts only reinstall dependencies when `backend/requirements.txt` changes.
- Use `sync_bundle.sh` to keep the `bundle/` directory in sync with source after changes.

## Resource limits

The file counter is updated from the server's configured limit; 50 is the initial interface placeholder, not a fixed maximum. By default, the backend budgets 25% of detected physical RAM (at least 512 MiB), then derives a limit of 10–500 files using an assumed 10 MiB per file. Parsed session memory can reach its cap before the file-count limit.

Environment variables can override the limits before starting the server:

| Variable | Default / purpose |
| --- | --- |
| `CALCIUM_MULTI_MAX_SESSION_BYTES` | Total session memory budget in bytes; 25% of detected RAM, minimum 512 MiB |
| `CALCIUM_MULTI_MAX_FILES` | File-count limit derived from the session budget |
| `CALCIUM_MULTI_MAX_FILE_BYTES` | Per-file parsed-memory cap; smaller of the session budget and the larger of 128 MiB or half the session budget |
| `CALCIUM_MULTI_MAX_ROIS_PER_FILE` | 4,000 ROIs |
| `CALCIUM_MULTI_PARSE_TIMEOUT_SECONDS` | 45 seconds per workbook |
| `CALCIUM_MULTI_TRACE_CELL_SOFT_LIMIT` | 500,000 frame × ROI cells per trace sheet; larger sheets are skipped |
| `CALCIUM_MULTI_BROWSER_WARN_FILE_BYTES` | Large-file warning threshold; smaller of the per-file cap and 32 MiB |

Project reopening applies the current limits, even if the project was saved on another machine with more memory.

## Development checks

After installing the backend dependencies, install `httpx` in the same environment for the API smoke tests:

```bash
backend/venv/bin/python -m pip install httpx
backend/venv/bin/python backend/smoke_test.py
backend/venv/bin/python backend/fixture_smoke_test.py
backend/venv/bin/python backend/project_smoke_test.py
backend/venv/bin/python backend/trace_pooling_test.py
backend/venv/bin/python backend/bundled_assets_test.py
node frontend/smoke_test.mjs
node frontend/project_save_test.mjs
```

On Windows, replace `backend/venv/bin/python` with `backend\venv\Scripts\python.exe`. The checks cover workbook parsing, real example fixtures, project round trips and validation, trace pooling, offline browser assets, and frontend state/save behavior. The bundled-assets check also uses Bash to exercise `sync_bundle.sh`.

## Repository

GitHub: <https://github.com/T-Luyten/Ca2tch-All>

## License

© 2026 Tomas Luyten. Licensed under the [MIT License](LICENSE).

Third-party dependencies retain their own licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the dependency inventory,
Plotly's bundled notices, and requirements when redistributing an installed
Python runtime or dependency binaries. The portable bundle includes the project
license and notice document.
