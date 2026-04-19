import asyncio
import io
import os
import sys
import time
import uuid
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Ca2+tchAll")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# In-memory sessions: file_id -> session dict
sessions: dict = {}
upload_jobs: dict = {}

MAX_FILES = 50
MIN_TOTAL_SESSION_BYTES = 512 * 1024 * 1024


def _detect_total_system_memory_bytes() -> int:
    """Best-effort physical memory detection without extra dependencies."""
    try:
        if hasattr(os, "sysconf"):
            page_size = os.sysconf("SC_PAGE_SIZE")
            phys_pages = os.sysconf("SC_PHYS_PAGES")
            if isinstance(page_size, int) and isinstance(phys_pages, int) and page_size > 0 and phys_pages > 0:
                return page_size * phys_pages
    except (OSError, ValueError, TypeError):
        pass
    return 0


def _default_total_session_bytes() -> int:
    total_memory = _detect_total_system_memory_bytes()
    if total_memory <= 0:
        return MIN_TOTAL_SESSION_BYTES
    # Default to 25% of system RAM, but never below 512 MB.
    return max(MIN_TOTAL_SESSION_BYTES, total_memory // 4)


MAX_TOTAL_SESSION_BYTES = int(os.getenv("CALCIUM_MULTI_MAX_SESSION_BYTES", str(_default_total_session_bytes())))
MAX_FILE_SESSION_BYTES = int(os.getenv(
    "CALCIUM_MULTI_MAX_FILE_BYTES",
    str(min(MAX_TOTAL_SESSION_BYTES, max(128 * 1024 * 1024, MAX_TOTAL_SESSION_BYTES // 2))),
))
MAX_ROIS_PER_FILE = int(os.getenv("CALCIUM_MULTI_MAX_ROIS_PER_FILE", "4000"))
PARSE_TIMEOUT_SECONDS = float(os.getenv("CALCIUM_MULTI_PARSE_TIMEOUT_SECONDS", "45"))
TRACE_CELL_SOFT_LIMIT = int(os.getenv("CALCIUM_MULTI_TRACE_CELL_SOFT_LIMIT", "500000"))
BROWSER_WARN_FILE_BYTES = int(os.getenv(
    "CALCIUM_MULTI_BROWSER_WARN_FILE_BYTES",
    str(min(MAX_FILE_SESSION_BYTES, 32 * 1024 * 1024)),
))
UPLOAD_JOB_TTL_SECONDS = int(os.getenv("CALCIUM_MULTI_UPLOAD_JOB_TTL_SECONDS", "900"))

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

def _job_payload(job: dict) -> dict:
    payload = {
        "job_id": job["job_id"],
        "filename": job.get("filename"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "progress": job.get("progress", 0.0),
        "message": job.get("message", ""),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }
    if job.get("result") is not None:
        payload["result"] = job["result"]
    if job.get("error") is not None:
        payload["error"] = job["error"]
    return payload


def _find_upload_task(job_id: str):
    job = upload_jobs.get(job_id)
    if not job:
        return None
    return job.get("task")


def _cleanup_upload_jobs() -> None:
    cutoff = time.time() - max(UPLOAD_JOB_TTL_SECONDS, 60)
    stale_ids = [
        job_id for job_id, job in upload_jobs.items()
        if job.get("updated_at", job.get("created_at", 0)) < cutoff
    ]
    for job_id in stale_ids:
        task = _find_upload_task(job_id)
        if task and not task.done():
            task.cancel()
        upload_jobs.pop(job_id, None)


def _set_upload_job(job_id: str, *, status: Optional[str] = None, stage: Optional[str] = None,
                    progress: Optional[float] = None, message: Optional[str] = None,
                    result=None, error=None) -> None:
    job = upload_jobs.get(job_id)
    if not job:
        return
    if status is not None:
        job["status"] = status
    if stage is not None:
        job["stage"] = stage
    if progress is not None:
        job["progress"] = max(0.0, min(float(progress), 1.0))
    if message is not None:
        job["message"] = message
    if result is not None:
        job["result"] = result
    if error is not None:
        job["error"] = error
    job["updated_at"] = time.time()

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


def _upload_error(code: str, message: str, status_code: int = 400, **extra) -> None:
    raise HTTPException(status_code, {"code": code, "message": message, **extra})


def _read_metrics_sheet(xl: pd.ExcelFile, sheet_names: list[str]) -> tuple[dict, list[str]]:
    metrics_data: dict = {}
    issues: list[str] = []
    if "Metrics" not in sheet_names:
        return metrics_data, issues

    try:
        df = pd.read_excel(xl, "Metrics")
    except Exception as exc:
        issues.append(f"Metrics sheet could not be read ({exc})")
        return metrics_data, issues

    if "roi_id" in df.columns:
        metrics_data["roi_ids"] = df["roi_id"].tolist()
    elif any(col in df.columns for col in SCALAR_METRICS):
        issues.append("Metrics sheet is missing required `roi_id` column")

    for col in SCALAR_METRICS:
        if col in df.columns:
            metrics_data[col] = pd.to_numeric(df[col], errors="coerce").tolist()

    return metrics_data, issues


def _read_trace_sheet_with_issues(xl: pd.ExcelFile, sheet_names: list[str], name: str) -> tuple[dict, list[str]]:
    issues: list[str] = []
    if name not in sheet_names:
        return {}, issues

    try:
        df = pd.read_excel(xl, name)
    except Exception as exc:
        issues.append(f"{name} sheet could not be read ({exc})")
        return {}, issues

    if "Time_s" not in df.columns:
        issues.append(f"{name} sheet is missing required `Time_s` column")
        return {}, issues

    roi_cols = [c for c in df.columns if str(c).startswith("ROI_")]
    if not roi_cols:
        issues.append(f"{name} sheet has no `ROI_*` columns")
        return {}, issues

    return {
        "time_s": df["Time_s"].tolist(),
        "rois": {str(c): df[c].tolist() for c in roi_cols},
    }, issues


def _estimate_trace_shape(xl: pd.ExcelFile, sheet_name: str) -> tuple[int, int]:
    try:
        workbook = getattr(xl, "book", None)
        if workbook is not None:
            sheet = workbook[sheet_name]
            rows = max(int(getattr(sheet, "max_row", 0)) - 1, 0)
            cols = max(int(getattr(sheet, "max_column", 0)) - 1, 0)
            return rows, cols
    except Exception:
        pass
    return 0, 0


def _read_trace_sheet_with_limits(xl: pd.ExcelFile, sheet_names: list[str], name: str) -> tuple[dict, list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    if name not in sheet_names:
        return {}, issues, warnings

    est_rows, est_roi_cols = _estimate_trace_shape(xl, name)
    if est_rows > 0 and est_roi_cols > 0 and TRACE_CELL_SOFT_LIMIT > 0 and est_rows * est_roi_cols > TRACE_CELL_SOFT_LIMIT:
        warnings.append(
            f"{name} skipped because the trace sheet is too large for interactive loading ({est_rows} frames x {est_roi_cols} ROIs)"
        )
        return {}, issues, warnings

    data, issues = _read_trace_sheet_with_issues(xl, sheet_names, name)
    if data and TRACE_CELL_SOFT_LIMIT > 0:
        frame_count = len(data.get("time_s", []))
        roi_count = len(data.get("rois", {}))
        if frame_count > 0 and roi_count > 0 and frame_count * roi_count > TRACE_CELL_SOFT_LIMIT:
            warnings.append(
                f"{name} skipped because the parsed trace sheet is too large for interactive loading ({frame_count} frames x {roi_count} ROIs)"
            )
            return {}, issues, warnings
    return data, issues, warnings


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _detect_signal_mode(settings: dict, metadata: dict) -> str:
    analysis_mode = str(settings.get("analysis_mode", "")).strip().lower()
    if "ratio" in analysis_mode:
        return "ratio"

    ratio_num = _safe_int(settings.get("ratio_ch_num"), 0)
    ratio_den = _safe_int(settings.get("ratio_ch_den"), 0)
    if ratio_num != ratio_den:
        return "ratio"

    channel_names = str(metadata.get("channel_names", "")).lower()
    if "340" in channel_names and "380" in channel_names:
        return "ratio"

    return "fluorescence"


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


def _estimate_memory_bytes(obj, seen=None) -> int:
    """Best-effort recursive size estimate for nested Python containers."""
    if seen is None:
        seen = set()

    obj_id = id(obj)
    if obj_id in seen:
        return 0
    seen.add(obj_id)

    size = sys.getsizeof(obj)

    if isinstance(obj, dict):
        size += sum(_estimate_memory_bytes(key, seen) + _estimate_memory_bytes(value, seen) for key, value in obj.items())
    elif isinstance(obj, (list, tuple, set, frozenset)):
        size += sum(_estimate_memory_bytes(item, seen) for item in obj)

    return size


def current_total_session_bytes() -> int:
    return sum(int(sess.get("memory_bytes", 0)) for sess in sessions.values())


def _parse_uploaded_workbook(filename: str, content: bytes, progress=None) -> dict:
    def update(stage: str, pct: float, message: str) -> None:
        if progress:
            progress(stage=stage, progress=pct, message=message)

    if not (filename or "").lower().endswith((".xlsx", ".xls")):
        _upload_error(
            "unsupported_file_type",
            "Upload blocked by file type: only .xlsx and .xls files are supported.",
            filename=filename,
        )

    update("open", 0.1, "Opening workbook…")
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
        sheet_names = xl.sheet_names
    except HTTPException:
        raise
    except Exception as exc:
        _upload_error(
            "bad_structure",
            f"Upload blocked by workbook structure: the file could not be opened as a valid Excel workbook ({exc}).",
            status_code=400,
            filename=filename,
        )

    update("metrics", 0.3, "Reading metrics…")
    metrics_data, metrics_issues = _read_metrics_sheet(xl, sheet_names)
    metadata = _read_kv_sheet(xl, "Metadata") if "Metadata" in sheet_names else {}
    settings = _read_kv_sheet(xl, "Settings") if "Settings" in sheet_names else {}

    update("traces", 0.55, "Reading traces…")
    traces, trace_issues, trace_warnings = _read_trace_sheet_with_limits(xl, sheet_names, "Raw_Traces")
    delta_f, delta_issues, delta_warnings = _read_trace_sheet_with_limits(xl, sheet_names, "DeltaF")
    warnings = [*trace_warnings, *delta_warnings]

    structure_issues = [*metrics_issues, *trace_issues, *delta_issues]
    has_usable_metrics = bool(metrics_data.get("roi_ids"))
    has_usable_traces = bool(traces.get("rois")) or bool(delta_f.get("rois"))
    expected_sheets = {"Metrics", "Raw_Traces", "DeltaF", "Metadata", "Settings"}
    present_expected_sheets = sorted(expected_sheets.intersection(sheet_names))
    if not has_usable_metrics and not has_usable_traces:
        if not present_expected_sheets:
            structure_issues.append("Workbook is missing all expected analyzer sheets")
        issue_summary = "; ".join(structure_issues) if structure_issues else (
            "Expected a usable Metrics sheet with `roi_id` and/or trace sheets with `Time_s` plus `ROI_*` columns"
        )
        _upload_error(
            "bad_structure",
            f"Upload blocked by workbook structure: {issue_summary}.",
            filename=filename,
            sheets=sheet_names,
        )

    session_data = {
        "file_name": filename,
        "metadata": metadata,
        "settings": settings,
        "metrics": metrics_data,
        "traces": traces,
        "delta_f": delta_f,
        "warnings": warnings,
    }
    n_rois = max(
        len(metrics_data.get("roi_ids", [])),
        len(traces.get("rois", {})),
        len(delta_f.get("rois", {})),
    )
    if MAX_ROIS_PER_FILE > 0 and n_rois > MAX_ROIS_PER_FILE:
        _upload_error(
            "too_many_rois",
            f"Upload blocked by ROI limit: this file contains {n_rois} ROIs and the per-file maximum is {MAX_ROIS_PER_FILE}.",
            n_rois=n_rois,
            max_rois=MAX_ROIS_PER_FILE,
            filename=filename,
        )

    update("memory", 0.75, "Estimating memory…")
    estimated_memory_bytes = _estimate_memory_bytes(session_data)
    if MAX_FILE_SESSION_BYTES > 0 and estimated_memory_bytes > MAX_FILE_SESSION_BYTES:
        per_file_mb = estimated_memory_bytes / (1024 * 1024)
        max_file_mb = MAX_FILE_SESSION_BYTES / (1024 * 1024)
        _upload_error(
            "per_file_ram_cap",
            f"Upload blocked by per-file RAM cap: this file would use about {per_file_mb:.1f} MB in memory and the per-file maximum is {max_file_mb:.0f} MB.",
            memory_bytes=estimated_memory_bytes,
            max_file_bytes=MAX_FILE_SESSION_BYTES,
            filename=filename,
        )

    update("finalize", 0.9, "Finalizing session data…")
    analysis_mode = str(settings.get("analysis_mode", "single"))
    signal_mode = _detect_signal_mode(settings, metadata)
    return {
        "session_data": session_data,
        "n_rois": n_rois,
        "estimated_memory_bytes": estimated_memory_bytes,
        "analysis_mode": analysis_mode,
        "signal_mode": signal_mode,
        "warnings": warnings,
        "has_traces": bool(traces),
        "has_delta_f": bool(delta_f),
        "available_metrics": [m for m in SCALAR_METRICS if m in metrics_data],
    }


async def _run_upload_job(job_id: str, filename: str, content: bytes) -> None:
    def progress(*, stage: str, progress: float, message: str) -> None:
        _set_upload_job(job_id, status="running", stage=stage, progress=progress, message=message)

    try:
        parsed = await asyncio.wait_for(
            asyncio.to_thread(_parse_uploaded_workbook, filename, content, progress),
            timeout=PARSE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        _set_upload_job(
            job_id,
            status="failed",
            stage="timeout",
            progress=1.0,
            message=f"Upload blocked by parse timeout after {PARSE_TIMEOUT_SECONDS:.0f} seconds.",
            error={
                "code": "parse_timeout",
                "message": f"Upload blocked by parse timeout: parsing took longer than {PARSE_TIMEOUT_SECONDS:.0f} seconds.",
                "filename": filename,
            },
        )
        return
    except asyncio.CancelledError:
        _set_upload_job(
            job_id,
            status="canceled",
            stage="canceled",
            progress=1.0,
            message="Upload canceled.",
            error={
                "code": "upload_canceled",
                "message": "Upload canceled.",
                "filename": filename,
            },
        )
        return
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "", "message": str(exc.detail)}
        _set_upload_job(
            job_id,
            status="failed",
            stage="error",
            progress=1.0,
            message=detail.get("message", "Upload failed."),
            error=detail,
        )
        return
    except Exception as exc:
        _set_upload_job(
            job_id,
            status="failed",
            stage="error",
            progress=1.0,
            message=f"Upload failed unexpectedly: {exc}",
            error={"code": "parse_failed", "message": f"Upload failed unexpectedly: {exc}", "filename": filename},
        )
        return

    if len(sessions) >= MAX_FILES:
        _set_upload_job(
            job_id,
            status="failed",
            stage="error",
            progress=1.0,
            message=f"Upload blocked by file-count limit: {len(sessions)} files are already loaded and the session maximum is {MAX_FILES}.",
            error={
                "code": "too_many_files",
                "message": f"Upload blocked by file-count limit: {len(sessions)} files are already loaded and the session maximum is {MAX_FILES}.",
                "loaded_files": len(sessions),
                "max_files": MAX_FILES,
                "filename": filename,
            },
        )
        return

    current_total_bytes = current_total_session_bytes()
    projected_total_bytes = current_total_bytes + parsed["estimated_memory_bytes"]
    if projected_total_bytes > MAX_TOTAL_SESSION_BYTES:
        max_mb = MAX_TOTAL_SESSION_BYTES / (1024 * 1024)
        current_mb = current_total_bytes / (1024 * 1024)
        file_mb = parsed["estimated_memory_bytes"] / (1024 * 1024)
        _set_upload_job(
            job_id,
            status="failed",
            stage="error",
            progress=1.0,
            message=f"Upload blocked by total RAM cap: session maximum is {max_mb:.0f} MB, currently loaded is {current_mb:.1f} MB, and this file would add about {file_mb:.1f} MB.",
            error={
                "code": "total_ram_cap",
                "message": f"Upload blocked by total RAM cap: session maximum is {max_mb:.0f} MB, currently loaded is {current_mb:.1f} MB, and this file would add about {file_mb:.1f} MB.",
                "current_total_bytes": current_total_bytes,
                "projected_total_bytes": projected_total_bytes,
                "max_total_bytes": MAX_TOTAL_SESSION_BYTES,
                "filename": filename,
            },
        )
        return

    file_id = str(uuid.uuid4())
    sessions[file_id] = {
        **parsed["session_data"],
        "memory_bytes": parsed["estimated_memory_bytes"],
    }
    result = {
        "file_id": file_id,
        "file_name": filename,
        "n_rois": parsed["n_rois"],
        "analysis_mode": parsed["analysis_mode"],
        "signal_mode": parsed["signal_mode"],
        "memory_bytes": parsed["estimated_memory_bytes"],
        "total_memory_bytes": projected_total_bytes,
        "max_total_session_bytes": MAX_TOTAL_SESSION_BYTES,
        "has_traces": parsed["has_traces"],
        "has_delta_f": parsed["has_delta_f"],
        "available_metrics": parsed["available_metrics"],
        "warnings": parsed["warnings"],
    }
    _set_upload_job(
        job_id,
        status="completed",
        stage="complete",
        progress=1.0,
        message="Upload complete.",
        result=result,
    )


# ── API routes ─────────────────────────────────────────────────────────────────

@app.get("/api/session")
async def get_session_meta():
    _cleanup_upload_jobs()
    return {
        "file_count": len(sessions),
        "max_files": MAX_FILES,
        "total_memory_bytes": current_total_session_bytes(),
        "max_total_session_bytes": MAX_TOTAL_SESSION_BYTES,
        "max_file_session_bytes": MAX_FILE_SESSION_BYTES,
        "max_rois_per_file": MAX_ROIS_PER_FILE,
        "parse_timeout_seconds": PARSE_TIMEOUT_SECONDS,
        "browser_warn_file_bytes": BROWSER_WARN_FILE_BYTES,
        "trace_cell_soft_limit": TRACE_CELL_SOFT_LIMIT,
    }


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    _cleanup_upload_jobs()
    if len(sessions) >= MAX_FILES:
        _upload_error(
            "too_many_files",
            f"Upload blocked by file-count limit: {len(sessions)} files are already loaded and the session maximum is {MAX_FILES}.",
            loaded_files=len(sessions),
            max_files=MAX_FILES,
        )
    content = await file.read()
    job_id = str(uuid.uuid4())
    now = time.time()
    upload_jobs[job_id] = {
        "job_id": job_id,
        "filename": file.filename,
        "status": "queued",
        "stage": "queued",
        "progress": 0.02,
        "message": "Queued for parsing…",
        "created_at": now,
        "updated_at": now,
    }
    upload_jobs[job_id]["task"] = asyncio.create_task(_run_upload_job(job_id, file.filename or "", content))
    return _job_payload(upload_jobs[job_id])


@app.get("/api/upload/{job_id}")
async def get_upload(job_id: str):
    _cleanup_upload_jobs()
    job = upload_jobs.get(job_id)
    if not job:
        raise HTTPException(404, {"code": "upload_job_missing", "message": "Upload job not found or expired."})
    return _job_payload(job)


@app.delete("/api/upload/{job_id}")
async def cancel_upload(job_id: str):
    _cleanup_upload_jobs()
    job = upload_jobs.get(job_id)
    if not job:
        raise HTTPException(404, {"code": "upload_job_missing", "message": "Upload job not found or expired."})
    if job.get("status") in {"completed", "failed", "canceled"}:
        return _job_payload(job)
    task = job.get("task")
    if task and not task.done():
        task.cancel()
    _set_upload_job(
        job_id,
        status="canceled",
        stage="canceled",
        progress=1.0,
        message="Upload canceled.",
        error={"code": "upload_canceled", "message": "Upload canceled.", "filename": job.get("filename")},
    )
    return _job_payload(upload_jobs[job_id])


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

    Files with different time axes are resampled via linear interpolation to the
    common overlapping range before aggregation, rather than being excluded.
    SEM is computed across experiment means, not across pooled ROIs.
    """
    result: dict = {}
    for condition, file_ids in req.groups.items():
        raw_traces: list = []
        warnings: list[str] = []

        # Pass 1: load each file's ROI-averaged trace and time axis.
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
            n_frames = min(len(src_time), min(len(r) for r in roi_vals))
            if n_frames <= 0:
                continue
            t_arr = np.array(src_time[:n_frames], dtype=float)
            data_arr = np.array([r[:n_frames] for r in roi_vals], dtype=float)
            raw_traces.append({
                "file_name": sess["file_name"],
                "time_s":    t_arr,
                "mean":      np.nanmean(data_arr, axis=0),
                "n_rois":    len(roi_vals),
            })

        if not raw_traces:
            continue

        # Pass 2: determine the overlapping time range across all files.
        t_start = max(float(ft["time_s"][0]) for ft in raw_traces)
        t_end   = min(float(ft["time_s"][-1]) for ft in raw_traces)

        if t_start >= t_end:
            warnings.append(f"Condition '{condition}': files have no overlapping time range; skipped")
            continue

        # Use the time axis with the most frames within the overlap as the reference.
        def _frames_in_range(t: np.ndarray) -> int:
            return int(np.sum((t >= t_start) & (t <= t_end)))

        ref_t = max(raw_traces, key=lambda ft: _frames_in_range(ft["time_s"]))["time_s"]
        ref_time = ref_t[(ref_t >= t_start) & (ref_t <= t_end)]

        # Pass 3: interpolate every file's mean trace onto ref_time.
        file_traces: list = []
        for ft in raw_traces:
            t    = ft["time_s"]
            mean = ft["mean"]
            already_aligned = (
                len(t) == len(ref_time)
                and np.allclose(t, ref_time, rtol=0.0, atol=1e-9)
            )
            if already_aligned:
                aligned_mean = mean
            else:
                aligned_mean = np.interp(ref_time, t, mean)
                warnings.append(f"{ft['file_name']}: resampled to align time axes")
            file_traces.append({
                "file_name": ft["file_name"],
                "mean":      aligned_mean.tolist(),
                "n_rois":    ft["n_rois"],
            })

        file_arr = np.array([f["mean"] for f in file_traces], dtype=float)
        n = len(file_traces)
        cond_mean = np.nanmean(file_arr, axis=0)
        cond_sem  = _sem(file_arr, axis=0)

        result[condition] = {
            "time_s":         ref_time.tolist(),
            "files":          file_traces,
            "condition_mean": cond_mean.tolist(),
            "condition_sem":  cond_sem.tolist(),
            "n_files":        n,
            "warnings":       warnings,
        }

    return result


# ── Static frontend (mounted last so API routes take priority) ─────────────────

_frontend = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
