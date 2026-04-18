# Ca²⁺ Multi-Experiment Analyzer

Interactive viewer for calcium imaging experiment exports across multiple replicate files.

It loads Excel files produced by the Calcium Imaging Analyzer, groups files by condition, and renders:

- trace comparisons for `ΔF / F₀` and raw fluorescence
- superplot-style metric views across replicate experiments
- replicate-aware violin, strip, box, and bar plots
- condition summaries with selectable error bars
- high-resolution PNG, SVG, and print-to-PDF export

## Features

- Multi-file upload with condition grouping
- Replicate-aware visualization
- Summary statistic switch: `mean` or `median`
- Error bar switch: `SEM`, `SD`, `95% CI`, or none
- Paired replicate line mode
- Optional per-replicate distributions
- Condition ordering controls
- Log axis and manual y-range controls
- Adjustable point size, alpha, and jitter

## Project Structure

```text
backend/
  main.py
  requirements.txt
frontend/
  index.html
  style.css
  js/
start.sh
start.bat
```

## Requirements

- Python 3.12 recommended
- `python3-venv` installed on Linux

Backend dependencies are listed in [backend/requirements.txt](backend/requirements.txt).
The startup scripts create `backend/venv` automatically.

## Run Locally

### Linux / macOS

```bash
./start.sh
```

If the script is not executable on your machine:

```bash
chmod +x start.sh
./start.sh
```

Then open:

```text
http://localhost:8002
```

### Windows

```bat
start.bat
```

## Input Files

The app expects `.xlsx` or `.xls` exports containing some or all of these sheets:

- `Metrics`
- `Metadata`
- `Settings`
- `Raw_Traces`
- `DeltaF`

Typical expected columns include:

- `roi_id` in `Metrics`
- scalar metric columns such as `peak`, `auc`, `event_fwhm`, `event_frequency`
- `Time_s` plus `ROI_*` columns in trace sheets

## Workflow

1. Load one or more exported Excel files.
2. Assign a condition name to each file.
3. Switch between trace tabs and scalar metric tabs.
4. Adjust summary/error/ordering controls as needed.
5. Export the figure from the Plotly toolbar.

## Notes

- Uploaded files are stored in backend memory for the current session only.
- Reloading the page clears the in-memory backend session state.
- The backend virtual environment is expected at `backend/venv`.
- The startup scripts only reinstall dependencies when `backend/requirements.txt` changes.

## Repository

GitHub: <https://github.com/T-Luyten/Calcium-Multi-Experiment-Analyzer>
