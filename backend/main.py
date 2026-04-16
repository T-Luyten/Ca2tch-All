import io
import os
import uuid
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Multi-Experiment Calcium Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory sessions: file_id -> session dict
sessions: dict = {}

MAX_FILES = 50

SCALAR_METRICS = [
    "peak", "auc", "event_fwhm", "event_frequency",
    "time_to_peak", "decay_t_half", "rate_of_rise",
    "tg_peak", "tg_slope", "tg_auc",
    "addback_peak", "addback_slope", "addback_auc", "addback_latency",
]


# ── Pydantic models ────────────────────────────────────────────────────────────

class PlotMetricsRequest(BaseModel):
    groups: Dict[str, List[str]]   # condition_name -> [file_ids]


class PlotTracesRequest(BaseModel):
    groups: Dict[str, List[str]]
    trace_type: str = "delta"      # "raw" | "delta"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe_floats(values) -> list:
    """Return list of finite floats, dropping NaN / None / inf."""
    result = []
    for v in values:
        try:
            f = float(v)
            if np.isfinite(f):
                result.append(f)
        except (TypeError, ValueError):
            pass
    return result


def _read_kv_sheet(xl: pd.ExcelFile, name: str) -> dict:
    """Read a two-column key/value sheet into a dict."""
    try:
        df = pd.read_excel(xl, name, header=0)
        if len(df.columns) < 2:
            return {}
        return {str(row.iloc[0]): row.iloc[1] for _, row in df.iterrows()}
    except Exception:
        return {}


def _read_traces_sheet(xl: pd.ExcelFile, name: str) -> dict:
    """Read a time-series sheet (Time_s + ROI_* columns) into a dict."""
    try:
        df = pd.read_excel(xl, name)
        if "Time_s" not in df.columns:
            return {}
        roi_cols = [c for c in df.columns if str(c).startswith("ROI_")]
        return {
            "time_s": df["Time_s"].tolist(),
            "rois": {str(c): df[c].tolist() for c in roi_cols},
        }
    except Exception:
        return {}


def _sem(values, axis=None):
    """Return sample SEM, using ddof=1 when at least two samples are present."""
    arr = np.asarray(values, dtype=float)
    if axis is None:
        n = int(np.sum(np.isfinite(arr)))
        if n <= 1:
            return 0.0
        return float(np.nanstd(arr, ddof=1) / np.sqrt(n))

    n = np.sum(np.isfinite(arr), axis=axis)
    sem = np.zeros_like(np.nanmean(arr, axis=axis), dtype=float)
    valid = n > 1
    if np.any(valid):
        sem[valid] = np.nanstd(arr, axis=axis, ddof=1)[valid] / np.sqrt(n[valid])
    return sem


# ── API routes ─────────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    if len(sessions) >= MAX_FILES:
        raise HTTPException(400, f"Maximum of {MAX_FILES} files already loaded")
    if not (file.filename or "").lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx / .xls files are supported")

    content = await file.read()
    buf = io.BytesIO(content)

    try:
        xl = pd.ExcelFile(buf)
        sheet_names = xl.sheet_names

        # Metrics sheet
        metrics_data: dict = {}
        if "Metrics" in sheet_names:
            df = pd.read_excel(xl, "Metrics")
            if "roi_id" in df.columns:
                metrics_data["roi_ids"] = df["roi_id"].tolist()
            for col in SCALAR_METRICS:
                if col in df.columns:
                    metrics_data[col] = pd.to_numeric(df[col], errors="coerce").tolist()

        metadata = _read_kv_sheet(xl, "Metadata") if "Metadata" in sheet_names else {}
        settings = _read_kv_sheet(xl, "Settings") if "Settings" in sheet_names else {}
        traces   = _read_traces_sheet(xl, "Raw_Traces") if "Raw_Traces" in sheet_names else {}
        delta_f  = _read_traces_sheet(xl, "DeltaF")    if "DeltaF"    in sheet_names else {}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Failed to read file: {exc}") from exc

    file_id = str(uuid.uuid4())
    sessions[file_id] = {
        "file_name":  file.filename,
        "metadata":   metadata,
        "settings":   settings,
        "metrics":    metrics_data,
        "traces":     traces,
        "delta_f":    delta_f,
    }

    n_rois = len(metrics_data.get("roi_ids", []))
    analysis_mode = str(settings.get("analysis_mode", "single"))

    return {
        "file_id":           file_id,
        "file_name":         file.filename,
        "n_rois":            n_rois,
        "analysis_mode":     analysis_mode,
        "has_traces":        bool(traces),
        "has_delta_f":       bool(delta_f),
        "available_metrics": [m for m in SCALAR_METRICS if m in metrics_data],
    }


@app.delete("/api/file/{file_id}")
async def delete_file(file_id: str):
    sessions.pop(file_id, None)
    return {"status": "ok"}


@app.delete("/api/files")
async def delete_all_files():
    sessions.clear()
    return {"status": "ok"}


@app.post("/api/plot/metrics")
async def plot_metrics(req: PlotMetricsRequest):
    """
    For each condition return per-file per-ROI values plus per-file means,
    and the condition mean ± SEM calculated across per-file means.

    This supports superplot rendering where:
      - small dots  = individual ROI values (per file)
      - large dots  = per-file mean (one per repeat experiment)
      - crossbar    = condition mean ± SEM across experiment means
    """
    result: dict = {}
    for condition, file_ids in req.groups.items():
        cond_result: dict = {}
        for metric in SCALAR_METRICS:
            file_data = []
            for fid in file_ids:
                sess = sessions.get(fid)
                if not sess:
                    continue
                vals = _safe_floats(sess["metrics"].get(metric, []))
                if not vals:
                    continue
                file_data.append({
                    "file_id":   fid,
                    "file_name": sess["file_name"],
                    "values":    vals,
                    "mean":      float(np.mean(vals)),
                })

            file_means = [f["mean"] for f in file_data]
            n = len(file_means)
            cond_result[metric] = {
                "files":          file_data,
                "condition_mean": float(np.mean(file_means)) if n else 0.0,
                "condition_sem":  _sem(file_means),
                "n_files":        n,
            }
        result[condition] = cond_result
    return result


@app.post("/api/plot/traces")
async def plot_traces(req: PlotTracesRequest):
    """
    For each condition return:
      - per-file mean traces (each file's ROIs averaged)
      - condition mean trace (mean of file means)
      - condition SEM trace (SEM across file means at each time point)

    SEM is computed across experiment means, not across pooled ROIs, so it
    correctly reflects between-experiment variability.
    """
    result: dict = {}
    for condition, file_ids in req.groups.items():
        file_traces: list = []
        time_s: list = []

        for fid in file_ids:
            sess = sessions.get(fid)
            if not sess:
                continue
            src = sess["delta_f"] if req.trace_type == "delta" else sess["traces"]
            if not src or "rois" not in src:
                continue
            src_time = src.get("time_s", [])
            roi_vals = list(src["rois"].values())
            if not roi_vals or not src_time:
                continue
            n_frames = min(len(src_time), min(len(t) for t in roi_vals))
            if n_frames <= 0:
                continue
            if not time_s:
                time_s = src_time[:n_frames]
            arr = np.array([t[:n_frames] for t in roi_vals], dtype=float)
            file_traces.append({
                "file_name": sess["file_name"],
                "mean":      np.nanmean(arr, axis=0).tolist(),
                "n_rois":    len(roi_vals),
            })

        if not file_traces or not time_s:
            continue

        n_frames = min(len(f["mean"]) for f in file_traces)
        n_frames = min(n_frames, len(time_s))
        for f in file_traces:
            f["mean"] = f["mean"][:n_frames]

        file_arr = np.array([f["mean"] for f in file_traces], dtype=float)
        n = len(file_traces)
        cond_mean = np.nanmean(file_arr, axis=0)
        cond_sem  = _sem(file_arr, axis=0)

        result[condition] = {
            "time_s":         time_s[:n_frames],
            "files":          file_traces,
            "condition_mean": cond_mean.tolist(),
            "condition_sem":  cond_sem.tolist(),
            "n_files":        n,
        }

    return result


# ── Static frontend (mounted last so API routes take priority) ─────────────────

_frontend = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
