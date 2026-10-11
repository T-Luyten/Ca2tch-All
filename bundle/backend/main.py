import asyncio
import io
import hashlib
import logging
import os
import sys
import time
import uuid
from typing import Dict, List, Optional, Tuple

from project_archive import build_archive, read_archive, utc_now

logger = logging.getLogger(__name__)

import numpy as np
import pandas as pd
from scipy import stats
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Ca2+tchAll")

_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def add_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'"
    )
    return response

# In-memory sessions: file_id -> session dict
sessions: dict = {}
upload_jobs: dict = {}
project_busy = False

MIN_TOTAL_SESSION_BYTES = 512 * 1024 * 1024
# Assume ~10 MB average session footprint per file when deriving the file-count cap.
_ASSUMED_BYTES_PER_FILE = 10 * 1024 * 1024


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
MAX_FILES = int(os.getenv("CALCIUM_MULTI_MAX_FILES", str(max(10, min(500, MAX_TOTAL_SESSION_BYTES // _ASSUMED_BYTES_PER_FILE)))))
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

def _sanitize_condition_name(name: str) -> str:
    # Strip null bytes and ASCII control characters, then trim whitespace.
    cleaned = "".join(ch for ch in name if ord(ch) >= 32 or ch in "\t").strip()
    return cleaned[:200] or "Unknown"

def _sanitize_groups(groups: Dict[str, List[str]]) -> Dict[str, List[str]]:
    return {_sanitize_condition_name(k): v for k, v in groups.items()}


_VALID_SUMMARY_STATS = {"mean", "median"}
_VALID_ERROR_MODES = {"sem", "sd", "ci", "none"}
_VALID_OUTLIER_MODES = {"iqr", "zscore"}


def _validate_plot_options(summary_stat: str, error_mode: str,
                           outlier_mode: Optional[str] = None) -> None:
    if summary_stat not in _VALID_SUMMARY_STATS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid summary_stat '{summary_stat}' (expected one of {sorted(_VALID_SUMMARY_STATS)})",
        )
    if error_mode not in _VALID_ERROR_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid error_mode '{error_mode}' (expected one of {sorted(_VALID_ERROR_MODES)})",
        )
    if outlier_mode is not None and outlier_mode not in _VALID_OUTLIER_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid outlier_mode '{outlier_mode}' (expected one of {sorted(_VALID_OUTLIER_MODES)})",
        )


class PlotMetricsRequest(BaseModel):
    groups: Dict[str, List[str]]   # condition_name -> [file_ids]
    summary_stat: str = "mean"     # "mean" | "median"
    error_mode: str = "sem"        # "sem" | "sd" | "ci" | "none"
    outlier_mode: Optional[str] = None  # None | "iqr" | "zscore"
    file_days: Optional[Dict[str, str]] = None
    pool_by_day: bool = False      # merge same-(condition, day) files into one replicate

    def model_post_init(self, __context) -> None:
        self.groups = _sanitize_groups(self.groups)


class PlotTracesRequest(BaseModel):
    groups: Dict[str, List[str]]
    trace_type: str = "delta"      # "raw" | "delta"
    summary_stat: str = "mean"     # "mean" | "median"
    error_mode: str = "sem"        # "sem" | "sd" | "ci" | "none"

    file_days: Optional[Dict[str, str]] = None
    pool_by_day: bool = False

    def model_post_init(self, __context) -> None:
        self.groups = _sanitize_groups(self.groups)


class ReplicateData(BaseModel):
    """Single replicate with day, condition, baseline, and response."""
    file_id: str
    day: str
    condition: str
    baseline: float
    response: float
    indicator_type: str = "single-wavelength"


class ComparabilityRequest(BaseModel):
    """Request body for cross-day comparability analysis."""
    replicates: List[ReplicateData]
    baseline_threshold_cv: float = 15.0
    icc_threshold: float = 0.1


class BaselineStats(BaseModel):
    """Per-day baseline statistics."""
    day: str
    mean: float
    std: float
    cv_percent: float
    n_replicates: int


class ANOVAResult(BaseModel):
    """One-way ANOVA output."""
    f_statistic: float
    p_value: float
    df_between: int
    df_within: int
    significant: bool


class ICCResult(BaseModel):
    """Intraclass correlation coefficient result."""
    icc_value: Optional[float] = None
    ms_between: float
    ms_within: float
    interpretation: str
    comparable: bool
    computable: bool = True


class NormalityResult(BaseModel):
    """Shapiro-Wilk normality test per condition."""
    condition: str
    w_statistic: float
    p_value: float
    is_normal: bool
    n_samples: int


class VarianceComponents(BaseModel):
    """Variance decomposition from mixed model."""
    between_day_variance: float
    within_day_variance: float
    icc_from_model: float


class ConditionEffect(BaseModel):
    """Fixed effect estimate per condition from LMM."""
    condition: str
    estimate: float
    std_error: float
    z_score: float
    p_value: float
    significant: bool


class ComparabilityResponse(BaseModel):
    """Full comparability assessment response."""
    overall_verdict: str
    baseline_anova: ANOVAResult
    baseline_stats: List[BaselineStats]
    baseline_icc: ICCResult
    response_icc: ICCResult
    normality_by_condition: List[NormalityResult]
    variance_components: VarianceComponents
    condition_effects: List[ConditionEffect]
    warnings: List[str]


class PairwiseRequest(BaseModel):
    """Request pairwise condition comparisons for a single metric."""
    metric: str
    groups: Dict[str, List[str]]
    paired: bool = False
    summary_stat: str = "mean"     # "mean" | "median"
    pool_by_day: bool = False      # merge same-(condition, day) files into one replicate
    file_days: Optional[Dict[str, str]] = None
    excluded_file_ids: Optional[List[str]] = None

    def model_post_init(self, __context) -> None:
        self.groups = _sanitize_groups(self.groups)


class PairwiseComparison(BaseModel):
    """Single pairwise comparison result."""
    condition_a: str
    condition_b: str
    p_value: float
    p_corrected: float
    significant: bool
    stars: str
    test_used: str


class TwoWayFactor(BaseModel):
    """Single factor from a two-way ANOVA table."""
    source: str
    ss: float
    df: float
    ms: float
    f_statistic: float
    p_value: float
    significant: bool


class PairwiseResponse(BaseModel):
    """Pairwise comparison results with overall ANOVA and optional two-way ANOVA."""
    metric: str
    anova_f: float
    anova_p: float
    anova_significant: bool
    comparisons: List[PairwiseComparison]
    twoway_anova: Optional[List[TwoWayFactor]] = None


class SummaryStatsRequest(BaseModel):
    """Request per-replicate/condition summary statistics and effect sizes."""
    metric: str
    groups: Dict[str, List[str]]
    summary_stat: str = "mean"     # "mean" | "median"
    paired: bool = False
    pool_by_day: bool = False      # merge same-(condition, day) files into one replicate
    reference_condition: Optional[str] = None
    file_days: Optional[Dict[str, str]] = None
    excluded_file_ids: Optional[List[str]] = None

    def model_post_init(self, __context) -> None:
        self.groups = _sanitize_groups(self.groups)


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
        logger.warning("Metrics sheet could not be read: %s", exc, exc_info=True)
        issues.append("Metrics sheet could not be read")
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
        logger.warning("%s sheet could not be read: %s", name, exc, exc_info=True)
        issues.append(f"{name} sheet could not be read")
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


def _compute_file_baseline(traces_data: dict, settings: dict) -> float:
    """Compute mean baseline across all ROIs during the baseline window."""
    if not traces_data or "rois" not in traces_data or not traces_data["rois"]:
        return 0.0
    baseline_start = float(settings.get("baseline_start", 0))
    baseline_end = float(settings.get("baseline_end", 0))
    if baseline_end <= baseline_start:
        return 0.0
    time_s = traces_data.get("time_s", [])
    if not time_s:
        return 0.0
    baseline_values = []
    for roi_trace in traces_data["rois"].values():
        for t, val in zip(time_s, roi_trace):
            if baseline_start <= t <= baseline_end:
                try:
                    f = float(val)
                    if np.isfinite(f):
                        baseline_values.append(f)
                except (TypeError, ValueError):
                    pass
    return float(np.mean(baseline_values)) if baseline_values else 0.0


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


def _summary(values, stat: str = "mean"):
    """Return the nan-safe mean or median of the finite values."""
    arr = np.asarray(values, dtype=float)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return 0.0
    if stat == "median":
        return float(np.median(arr))
    return float(np.mean(arr))


def _error(values, mode: str = "sem", axis=None):
    """Error magnitude for a set of values: SEM, sample SD (ddof=1),
    95% CI via the t-distribution, or 0 for 'none'. Mirrors _sem's axis support."""
    arr = np.asarray(values, dtype=float)
    if axis is None:
        n = int(np.sum(np.isfinite(arr)))
        if n <= 1 or mode == "none":
            return 0.0
        sd = np.nanstd(arr, ddof=1)
        if mode == "sd":
            return float(sd)
        sem = sd / np.sqrt(n)
        if mode == "ci":
            return float(stats.t.ppf(0.975, n - 1) * sem)
        return float(sem)

    n = np.sum(np.isfinite(arr), axis=axis)
    err = np.zeros_like(np.nanmean(arr, axis=axis), dtype=float)
    valid = n > 1
    if mode == "none" or not np.any(valid):
        return err
    sd = np.nanstd(arr, axis=axis, ddof=1)
    if mode == "sd":
        err[valid] = sd[valid]
    elif mode == "ci":
        err[valid] = stats.t.ppf(0.975, n[valid] - 1) * sd[valid] / np.sqrt(n[valid])
    else:
        err[valid] = sd[valid] / np.sqrt(n[valid])
    return err


def _outlier_flags(values, mode: str) -> list:
    """Return one boolean per value; True marks an outlier under the given mode."""
    arr = np.asarray(values, dtype=float)
    finite = arr[np.isfinite(arr)]
    if finite.size < 2:
        return [False] * len(arr)
    if mode == "iqr":
        q1, q3 = np.percentile(finite, [25, 75])
        iqr = q3 - q1
        low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        return [bool(np.isfinite(v) and (v < low or v > high)) for v in arr]
    if mode == "zscore":
        med = np.median(finite)
        mad = np.median(np.abs(finite - med))
        if mad == 0:
            return [False] * len(arr)
        return [bool(np.isfinite(v) and abs(0.6745 * (v - med) / mad) > 3.5) for v in arr]
    return [False] * len(arr)


def _resolve_replicate_units(
    groups: Dict[str, List[str]],
    file_days: Optional[Dict[str, str]] = None,
    pool_by_day: bool = False,
    excluded: Optional[set] = None,
) -> Dict[str, List[dict]]:
    """Resolve each condition's files into replicate units (one superplot point each).

    Default: one unit per file. With pool_by_day and day labels, files sharing
    a (condition, day) merge into a single unit whose ROI values are pooled,
    matching the superplot convention that one experimental run (day)
    contributes exactly one summary point. Files without a day label stay
    singleton units. Ids in `excluded` drop member files before pooling, and
    also drop a whole pooled unit when they match its unit id or day label.
    Returns {condition: [{"unit_id", "day", "file_ids"}]} with pooled units
    ordered by day label so ordinal pairing aligns matching days.
    """
    excluded = excluded or set()
    file_days = file_days or {}
    resolved: Dict[str, List[dict]] = {}
    for condition, file_ids in groups.items():
        members = [fid for fid in file_ids if fid not in excluded]
        if not pool_by_day or not file_days:
            resolved[condition] = [
                {
                    "unit_id": fid,
                    "day": str(file_days[fid]).strip() or None if file_days.get(fid) else None,
                    "file_ids": [fid],
                }
                for fid in members
            ]
            continue
        by_day: Dict[str, List[str]] = {}
        singles: List[str] = []
        for fid in members:
            day = str(file_days.get(fid) or "").strip()
            if day:
                by_day.setdefault(day, []).append(fid)
            else:
                singles.append(fid)
        units = [
            {"unit_id": f"day:{condition}:{day}", "day": day, "file_ids": fids}
            for day, fids in sorted(by_day.items())
        ]
        units += [{"unit_id": fid, "day": None, "file_ids": [fid]} for fid in singles]
        units = [
            u for u in units
            if u["unit_id"] not in excluded and (u["day"] or "") not in excluded
        ]
        resolved[condition] = units
    return resolved


def _unit_metric_values(unit: dict, metric: str) -> list:
    """Concatenate the finite ROI values of all member files for one metric."""
    vals: list = []
    for fid in unit["file_ids"]:
        sess = sessions.get(fid)
        if not sess:
            continue
        vals.extend(_safe_floats(sess["metrics"].get(metric, [])))
    return vals


def _unit_display_name(unit: dict) -> str:
    """Display name: 'Day N (k files)' for pooled units, else the file name."""
    if unit["day"] and len(unit["file_ids"]) > 1:
        return f'{unit["day"]} ({len(unit["file_ids"])} files)'
    sess = sessions.get(unit["file_ids"][0]) if unit["file_ids"] else None
    return sess["file_name"] if sess else unit["unit_id"]


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

    lower_name = (filename or "").lower()
    if not lower_name.endswith((".xlsx", ".xls")):
        _upload_error(
            "unsupported_file_type",
            "Upload blocked by file type: only .xlsx and .xls files are supported.",
            filename=filename,
        )

    # Validate magic bytes to prevent extension-spoofed uploads.
    if lower_name.endswith(".xlsx") and not content[:2] == b"PK":
        _upload_error(
            "unsupported_file_type",
            "Upload blocked: file does not appear to be a valid .xlsx workbook.",
            filename=filename,
        )
    if lower_name.endswith(".xls") and not content[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        _upload_error(
            "unsupported_file_type",
            "Upload blocked: file does not appear to be a valid .xls workbook.",
            filename=filename,
        )

    update("open", 0.1, "Opening workbook…")
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
        sheet_names = xl.sheet_names
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Workbook could not be opened (%s): %s", filename, exc, exc_info=True)
        _upload_error(
            "bad_structure",
            "Upload blocked by workbook structure: the file could not be opened as a valid Excel workbook.",
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
        "source_workbook": content,
        "provenance": {
            "source_id": str(uuid.uuid4()),
            "uploaded_at": utc_now(),
            "sha256": hashlib.sha256(content).hexdigest(),
            "size_bytes": len(content),
        },
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
    baseline = _compute_file_baseline(traces, settings)
    return {
        "session_data": session_data,
        "n_rois": n_rois,
        "estimated_memory_bytes": estimated_memory_bytes,
        "analysis_mode": analysis_mode,
        "signal_mode": signal_mode,
        "baseline": baseline,
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
        logger.error("Unexpected upload failure (%s): %s", filename, exc, exc_info=True)
        _set_upload_job(
            job_id,
            status="failed",
            stage="error",
            progress=1.0,
            message="Upload failed unexpectedly.",
            error={"code": "parse_failed", "message": "Upload failed unexpectedly.", "filename": filename},
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

    file_id = parsed["session_data"]["provenance"]["source_id"]
    sessions[file_id] = {
        **parsed["session_data"],
        "memory_bytes": parsed["estimated_memory_bytes"],
    }
    logger.info("Upload completed: file_id=%s filename=%r rois=%d memory_bytes=%d",
                file_id, filename, parsed["n_rois"], parsed["estimated_memory_bytes"])
    result = {
        "file_id": file_id,
        "provenance": parsed["session_data"]["provenance"],
        "file_name": filename,
        "n_rois": parsed["n_rois"],
        "analysis_mode": parsed["analysis_mode"],
        "signal_mode": parsed["signal_mode"],
        "baseline": parsed["baseline"],
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
    if project_busy:
        _upload_error("project_busy", "A project is being opened. Please wait.", status_code=409)
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
    logger.info("Upload queued: job=%s filename=%r size=%d", job_id, file.filename, len(content))
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
    logger.info("Upload canceled: job=%s filename=%r", job_id, job.get("filename"))
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
    if project_busy:
        _upload_error("project_busy", "A project is being opened. Please wait.", status_code=409)
    sessions.pop(file_id, None)
    logger.info("File deleted: file_id=%s", file_id)
    return {"status": "ok"}


@app.delete("/api/files")
async def delete_all_files():
    if project_busy:
        _upload_error("project_busy", "A project is being opened. Please wait.", status_code=409)
    count = len(sessions)
    sessions.clear()
    logger.info("All files cleared: %d sessions removed", count)
    return {"status": "ok"}


@app.post("/api/plot/metrics")
async def plot_metrics(req: PlotMetricsRequest):
    """
    For each condition return per-replicate ROI values plus per-replicate means,
    and the condition mean ± SEM calculated across per-replicate means.

    This supports superplot rendering where:
      - small dots  = individual ROI values (per replicate)
      - large dots  = per-replicate mean (one per repeat experiment; with
        pool_by_day, all files sharing a (condition, day) merge into a single
        replicate, so one experimental run contributes exactly one point)
      - crossbar    = condition mean ± SEM across replicate means

    Additionally, per-replicate `summary` (mean or median of the replicate's
    ROI values, per `summary_stat`), `is_outlier` flags across the replicate
    summaries when `outlier_mode` is set, and `condition_summary` /
    `condition_error` computed across the non-outlier replicate summaries.
    """
    _validate_plot_options(req.summary_stat, req.error_mode, req.outlier_mode)
    units_by_condition = _resolve_replicate_units(req.groups, req.file_days, req.pool_by_day)
    result: dict = {}
    for condition, units in units_by_condition.items():
        cond_result: dict = {}
        for metric in SCALAR_METRICS:
            file_data = []
            for unit in units:
                vals = _unit_metric_values(unit, metric)
                if not vals:
                    continue
                file_data.append({
                    "file_id":   unit["unit_id"],
                    "file_name": _unit_display_name(unit),
                    "file_ids":  unit["file_ids"],
                    "day":       unit["day"],
                    "values":    vals,
                    "mean":      float(np.mean(vals)),
                    "summary":   _summary(vals, req.summary_stat),
                })

            file_means = [f["mean"] for f in file_data]
            file_summaries = [f["summary"] for f in file_data]
            n = len(file_means)
            if req.outlier_mode:
                flags = _outlier_flags(file_summaries, req.outlier_mode)
            else:
                flags = [False] * n
            for f, flag in zip(file_data, flags):
                f["is_outlier"] = flag
            kept_summaries = [s for s, flag in zip(file_summaries, flags) if not flag]
            cond_result[metric] = {
                "files":             file_data,
                "condition_summary": _summary(kept_summaries, req.summary_stat),
                "condition_error":   _error(kept_summaries, req.error_mode),
                "condition_mean":    float(np.mean(file_means)) if n else 0.0,
                "condition_sem":     _sem(file_means),
                "n_files":           n,
            }
        result[condition] = cond_result
    return result


@app.post("/api/plot/traces")
async def plot_traces(req: PlotTracesRequest):
    """Return condition traces and uncertainty across independent replicate curves.

    Without pooling, each file contributes its ROI-averaged curve. With pooling,
    the ROIs from files sharing (condition, day) contribute one daily mean curve,
    consistent with metric pooling. Unlabelled files remain separate replicates.
    Every replicate has equal weight in the condition mean/median and SD/SEM/CI.
    Align source traces to the overlapping time grid before pooling.
    """
    _validate_plot_options(req.summary_stat, req.error_mode)
    units_by_condition = _resolve_replicate_units(req.groups, req.file_days, req.pool_by_day)
    result: dict = {}
    for condition, file_ids in req.groups.items():
        pooled_member_ids = {
            fid for unit in units_by_condition[condition] if len(unit["file_ids"]) > 1
            for fid in unit["file_ids"]
        }
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
                "file_id": fid,
                "file_name": sess["file_name"],
                "time_s":    t_arr,
                "mean":      np.nanmean(data_arr, axis=0),
                "n_rois":    len(roi_vals),
                "rois": data_arr if fid in pooled_member_ids else None,
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
        aligned_files: dict = {}
        pooled_stats: dict = {}
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
            aligned_files[ft["file_id"]] = {
                "file_id": ft["file_id"],
                "file_name": ft["file_name"],
                "mean":      aligned_mean.tolist(),
                "n_rois":    ft["n_rois"],
            }
            if ft["rois"] is not None:
                # Pool finite ROI values rather than weighting files equally.
                # Resample ROIs individually so missing values retain their weight.
                roi_arr = ft["rois"] if already_aligned else np.array([
                    np.interp(ref_time, t, roi) for roi in ft["rois"]
                ])
                valid = np.isfinite(roi_arr)
                pooled_stats[ft["file_id"]] = (
                    np.sum(np.where(valid, roi_arr, 0.0), axis=0),
                    np.sum(valid, axis=0),
                )

        file_traces: list = []
        for unit in units_by_condition[condition]:
            members = [fid for fid in unit["file_ids"] if fid in aligned_files]
            if not members:
                continue
            if len(members) == 1:
                unit_mean = aligned_files[members[0]]["mean"]
            else:
                roi_sum = np.sum([pooled_stats[fid][0] for fid in members], axis=0)
                roi_count = np.sum([pooled_stats[fid][1] for fid in members], axis=0)
                unit_mean = np.divide(roi_sum, roi_count,
                    out=np.full(len(ref_time), np.nan), where=roi_count > 0).tolist()
            file_traces.append({
                "file_id": unit["unit_id"],
                "file_ids": members,
                "day": unit["day"],
                "file_name": _unit_display_name({**unit, "file_ids": members}),
                "mean": unit_mean,
                "n_rois": sum(aligned_files[fid]["n_rois"] for fid in members),
            })

        file_arr = np.array([f["mean"] for f in file_traces], dtype=float)
        n = len(file_traces)
        cond_mean = np.nanmean(file_arr, axis=0)
        cond_sem  = _sem(file_arr, axis=0)
        if req.summary_stat == "median":
            cond_summary = np.nanmedian(file_arr, axis=0)
        else:
            cond_summary = cond_mean
        cond_error = _error(file_arr, req.error_mode, axis=0)

        result[condition] = {
            "time_s":            ref_time.tolist(),
            "files":             file_traces,
            "condition_mean":    cond_mean.tolist(),
            "condition_sem":     cond_sem.tolist(),
            "condition_summary": cond_summary.tolist(),
            "condition_error":   cond_error.tolist(),
            "n_files":           n,
            "n_source_files": len(aligned_files),
            "pool_by_day": req.pool_by_day,
            "warnings":          warnings,
        }

    return result


from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.tools.sm_exceptions import ConvergenceWarning
import warnings

warnings.filterwarnings("ignore", category=ConvergenceWarning)


@app.post("/stats/comparability", response_model=ComparabilityResponse)
async def analyze_comparability(req: ComparabilityRequest):
    """
    Run full cross-day comparability analysis on uploaded replicates.

    Computes: baseline ANOVA, ICC before/after normalization,
    normality tests per condition, and linear mixed-effects model
    with Day as a random effect.
    """
    df = pd.DataFrame([
        {
            "file_id": r.file_id,
            "day": r.day,
            "condition": r.condition,
            "baseline": r.baseline,
            "response": r.response,
            "indicator_type": r.indicator_type,
        }
        for r in req.replicates
    ])

    warnings_list = []

    # Aggregate to one row per file for baseline analysis
    # (each dish has one baseline; ROIs share the same baseline)
    df_file = df.groupby(["file_id", "day", "condition"]).agg({
        "baseline": "mean",
        "response": "mean",
        "indicator_type": "first",
    }).reset_index()

    # ---- 1. Baseline statistics per day (file-level) ----
    baseline_stats = []
    for day, group in df_file.groupby("day"):
        mean_val = group["baseline"].mean()
        std_val = group["baseline"].std()
        cv = (std_val / mean_val * 100) if mean_val != 0 else 0
        n = len(group)
        # pandas std with 1 sample returns NaN; replace with 0
        if n <= 1:
            std_val = 0.0
            cv = 0.0
        baseline_stats.append(BaselineStats(
            day=day, mean=float(mean_val), std=float(std_val),
            cv_percent=float(cv), n_replicates=n
        ))
        if cv > req.baseline_threshold_cv:
            warnings_list.append(
                f"Day '{day}' baseline CV = {cv:.1f}% exceeds {req.baseline_threshold_cv}% threshold"
            )

    # ---- 2. ANOVA on baseline across days (file-level) ----
    day_groups = [g["baseline"].values for _, g in df_file.groupby("day")]
    if len(day_groups) >= 2 and all(len(g) > 0 for g in day_groups):
        try:
            f_stat, p_val = stats.f_oneway(*day_groups)
            baseline_anova = ANOVAResult(
                f_statistic=float(f_stat),
                p_value=float(p_val),
                df_between=len(day_groups) - 1,
                df_within=len(df_file) - len(day_groups),
                significant=p_val < 0.05
            )
        except Exception:
            baseline_anova = ANOVAResult(
                f_statistic=0.0, p_value=1.0,
                df_between=len(day_groups) - 1,
                df_within=len(df_file) - len(day_groups),
                significant=False
            )
    else:
        baseline_anova = ANOVAResult(
            f_statistic=0.0, p_value=1.0,
            df_between=0, df_within=len(df_file) - 1, significant=False
        )
        warnings_list.append("Insufficient days for baseline ANOVA (need >= 2)")

    # ---- 3. ICC computation helper ----
    def compute_icc(data_vec, group_vec):
        groups = np.unique(group_vec)
        group_data = [data_vec[group_vec == g] for g in groups]
        group_means = [np.mean(g) for g in group_data]
        group_sizes = [len(g) for g in group_data]
        grand_mean = np.mean(data_vec)
        N = len(data_vec)
        k = len(groups)
        if k < 2:
            return None, 0.0, 0.0, "insufficient_days"
        if N <= k:
            return None, 0.0, 0.0, "insufficient_observations"
        ms_between = sum(n_j * (m_j - grand_mean)**2
                        for n_j, m_j in zip(group_sizes, group_means)) / (k - 1)
        ms_within = sum(np.sum((g - m_j)**2)
                       for g, m_j in zip(group_data, group_means)) / (N - k)
        n0 = (N - sum(n_j**2 for n_j in group_sizes) / N) / (k - 1)
        denom = ms_between + (n0 - 1) * ms_within
        icc = (ms_between - ms_within) / denom if denom != 0 else 0.0
        # Keep the signed value: a negative ICC means within-day variance
        # exceeds between-day variance, i.e. there is no detectable day effect.
        return float(icc), float(ms_between), float(ms_within), "ok"

    # Baseline ICC at file level (one baseline per dish)
    baseline_icc_val, msb_b, msw_b, baseline_icc_reason = compute_icc(
        df_file["baseline"].values, df_file["day"].values
    )
    # Response ICC at file level (one response mean per dish)
    response_icc_val, msb_r, msw_r, response_icc_reason = compute_icc(
        df_file["response"].values, df_file["day"].values
    )

    if baseline_icc_reason == "insufficient_days":
        baseline_icc_interp = "Cannot compute — need files from ≥2 days"
        baseline_icc_comp = True  # Not comparable in a detectable way, but not flagged as bad
    elif baseline_icc_reason == "insufficient_observations":
        baseline_icc_interp = "Cannot compute — need ≥2 files per day"
        baseline_icc_comp = True
    elif baseline_icc_val is not None and baseline_icc_val > 0.5:
        baseline_icc_interp = "High day-to-day variation (normalization needed)"
        baseline_icc_comp = False
    elif baseline_icc_val is not None and baseline_icc_val < 0:
        baseline_icc_interp = "Low day-to-day variation (no detectable day effect)"
        baseline_icc_comp = True
    else:
        baseline_icc_interp = "Low day-to-day variation"
        baseline_icc_comp = True

    if response_icc_reason == "insufficient_days":
        response_icc_interp = "Cannot compute — need files from ≥2 days"
        response_icc_comp = True
    elif response_icc_reason == "insufficient_observations":
        response_icc_interp = "Cannot compute — need ≥2 files per day"
        response_icc_comp = True
    elif response_icc_val is not None and response_icc_val < req.icc_threshold:
        if response_icc_val < 0:
            response_icc_interp = "Comparable across days (no detectable day effect)"
        else:
            response_icc_interp = "Comparable across days"
        response_icc_comp = True
    else:
        response_icc_interp = "Moderate residual day effect"
        response_icc_comp = False

    baseline_icc = ICCResult(
        icc_value=baseline_icc_val,
        ms_between=msb_b,
        ms_within=msw_b,
        interpretation=baseline_icc_interp,
        comparable=baseline_icc_comp,
        computable=baseline_icc_reason == "ok"
    )

    response_icc = ICCResult(
        icc_value=response_icc_val,
        ms_between=msb_r,
        ms_within=msw_r,
        interpretation=response_icc_interp,
        comparable=response_icc_comp,
        computable=response_icc_reason == "ok"
    )

    if response_icc_val is not None and response_icc_val > 0.5:
        warnings_list.append(
            f"Response ICC = {response_icc_val:.3f} > 0.5 — "
            "persistent day effect after normalization. Investigate technical sources."
        )

    # ---- 4. Normality tests per condition (file-level response means) ----
    normality_results = []
    for cond, group in df_file.groupby("condition"):
        values = group["response"].dropna().values
        if len(values) >= 3:
            try:
                w_stat, p_val = stats.shapiro(values)
                normality_results.append(NormalityResult(
                    condition=cond,
                    w_statistic=float(w_stat),
                    p_value=float(p_val),
                    is_normal=p_val > 0.05,
                    n_samples=len(values)
                ))
            except Exception:
                # Constant input or other numerical issue
                normality_results.append(NormalityResult(
                    condition=cond, w_statistic=1.0, p_value=1.0,
                    is_normal=True, n_samples=len(values)
                ))
        else:
            normality_results.append(NormalityResult(
                condition=cond, w_statistic=0.0, p_value=1.0,
                is_normal=True, n_samples=len(values)
            ))

    # ---- 5. Linear mixed-effects model ----
    variance_components = VarianceComponents(
        between_day_variance=0.0, within_day_variance=0.0, icc_from_model=0.0
    )
    condition_effects = []

    try:
        if df_file["day"].nunique() >= 2 and df_file["condition"].nunique() >= 2:
            conditions = df_file["condition"].unique()
            df_file["condition_coded"] = df_file["condition"].astype("category")

            # Fit on file-level means: the file (experiment) is the
            # statistical unit, so pooling ROIs would be pseudoreplication.
            model = smf.mixedlm(
                "response ~ C(condition_coded)",
                data=df_file,
                groups=df_file["day"],
                re_formula="~1"
            ).fit(reml=True)

            between_var = float(model.cov_re.iloc[0, 0]) if hasattr(model.cov_re, 'iloc') else 0.0
            within_var = float(model.scale)
            icc_model = between_var / (between_var + within_var) if (between_var + within_var) > 0 else 0.0

            variance_components = VarianceComponents(
                between_day_variance=between_var,
                within_day_variance=within_var,
                icc_from_model=icc_model
            )

            # Extract condition effects
            for cond in conditions[1:]:  # Skip reference (intercept)
                param_name = f"C(condition_coded)[T.{cond}]"
                if param_name in model.params.index:
                    condition_effects.append(ConditionEffect(
                        condition=cond,
                        estimate=float(model.params[param_name]),
                        std_error=float(model.bse[param_name]),
                        z_score=float(model.tvalues[param_name]),
                        p_value=float(model.pvalues[param_name]),
                        significant=float(model.pvalues[param_name]) < 0.05
                    ))

            # Add reference condition with its real intercept statistics
            intercept_p = float(model.pvalues["Intercept"])
            condition_effects.insert(0, ConditionEffect(
                condition=conditions[0],
                estimate=float(model.params["Intercept"]),
                std_error=float(model.bse["Intercept"]),
                z_score=float(model.tvalues["Intercept"]),
                p_value=intercept_p,
                significant=intercept_p < 0.05
            ))
    except Exception as e:
        warnings_list.append(f"Mixed model failed: {str(e)}")

    # ---- 6. Overall verdict ----
    if response_icc.comparable and all(n.is_normal for n in normality_results):
        verdict = "Comparable"
    elif response_icc_val is not None and response_icc_val < 0.5:
        verdict = "Caution"
    else:
        verdict = "Not Comparable"

    return ComparabilityResponse(
        overall_verdict=verdict,
        baseline_anova=baseline_anova,
        baseline_stats=baseline_stats,
        baseline_icc=baseline_icc,
        response_icc=response_icc,
        normality_by_condition=normality_results,
        variance_components=variance_components,
        condition_effects=condition_effects,
        warnings=warnings_list
    )


def _holm_bonferroni(pvalues):
    """Holm-Bonferroni step-down correction for multiple comparisons."""
    arr = np.asarray(pvalues, dtype=float)
    n = len(arr)
    if n == 0:
        return arr.copy()
    order = np.argsort(arr)
    sorted_p = arr[order]
    adjusted_sorted = np.empty(n)
    for i in range(n):
        raw = sorted_p[i] * (n - i)
        adj = min(raw, 1.0)
        if i > 0:
            adj = max(adj, adjusted_sorted[i - 1])
        adjusted_sorted[i] = adj
    adjusted = np.empty(n)
    adjusted[order] = adjusted_sorted
    return adjusted


@app.post("/api/stats/pairwise", response_model=PairwiseResponse)
async def stats_pairwise(req: PairwiseRequest):
    """
    Pairwise statistical comparisons between conditions for a single metric.

    Uses replicate-level summaries (superplot unit of analysis), mean or
    median per `summary_stat`, for:
      - One-way ANOVA across all conditions
      - Pairwise t-tests: paired t-test when paired=True and group sizes match,
        otherwise Welch's t-test (independent, unequal variances)
      - Holm-Bonferroni correction for multiple comparisons

    With pool_by_day, files sharing a (condition, day) are merged into a
    single replicate before testing, so one experimental run contributes
    exactly one value.
    """
    if req.metric not in SCALAR_METRICS:
        raise HTTPException(400, {"code": "bad_metric", "message": f"Unknown metric: {req.metric}"})
    if req.summary_stat not in _VALID_SUMMARY_STATS:
        raise HTTPException(400, {
            "code": "bad_summary_stat",
            "message": f"Invalid summary_stat '{req.summary_stat}' (expected one of {sorted(_VALID_SUMMARY_STATS)})",
        })

    excluded = set(req.excluded_file_ids or [])

    units_by_condition = _resolve_replicate_units(req.groups, req.file_days, req.pool_by_day, excluded)
    condition_means: dict[str, list[float]] = {}
    for cond, units in units_by_condition.items():
        summaries = []
        for unit in units:
            vals = _unit_metric_values(unit, req.metric)
            if vals:
                summaries.append(_summary(vals, req.summary_stat))
        if summaries:
            condition_means[cond] = summaries

    conditions = list(condition_means.keys())
    n_conds = len(conditions)

    if n_conds < 2:
        return PairwiseResponse(
            metric=req.metric,
            anova_f=0.0, anova_p=1.0, anova_significant=False,
            comparisons=[]
        )

    # One-way ANOVA on file-level means
    groups = [condition_means[c] for c in conditions]
    try:
        f_stat, p_anova = stats.f_oneway(*groups)
        if not np.isfinite(f_stat):
            f_stat = 0.0
        if not np.isfinite(p_anova):
            p_anova = 1.0
    except Exception:
        f_stat, p_anova = 0.0, 1.0

    # Pairwise tests: paired t-test when paired=True and sizes match,
    # otherwise Welch's t-test (independent, unequal variances).
    raw_pvalues = []
    pairs: list[tuple[str, str]] = []
    test_used = []
    for i in range(n_conds):
        for j in range(i + 1, n_conds):
            g1 = condition_means[conditions[i]]
            g2 = condition_means[conditions[j]]
            use_paired = req.paired and len(g1) == len(g2) and len(g1) >= 2
            if use_paired:
                try:
                    _, p_val = stats.ttest_rel(g1, g2)
                    if not np.isfinite(p_val):
                        p_val = 1.0
                    test_used.append('paired t-test')
                except Exception:
                    p_val = 1.0
                    test_used.append('paired t-test (failed)')
            elif len(g1) >= 2 and len(g2) >= 2:
                try:
                    _, p_val = stats.ttest_ind(g1, g2, equal_var=False)
                    if not np.isfinite(p_val):
                        p_val = 1.0
                    test_used.append("Welch's t-test")
                except Exception:
                    p_val = 1.0
                    test_used.append("Welch's t-test (failed)")
            else:
                p_val = 1.0
                test_used.append('insufficient data')
            raw_pvalues.append(p_val)
            pairs.append((conditions[i], conditions[j]))

    # Holm-Bonferroni correction
    p_corr = _holm_bonferroni(raw_pvalues) if raw_pvalues else []

    comparisons = []
    for (c1, c2), p_raw, p_c, test in zip(pairs, raw_pvalues, p_corr, test_used):
        stars = '***' if p_c < 0.001 else '**' if p_c < 0.01 else '*' if p_c < 0.05 else 'ns'
        comparisons.append(PairwiseComparison(
            condition_a=c1,
            condition_b=c2,
            p_value=float(p_raw),
            p_corrected=float(p_c),
            significant=p_c < 0.05,
            stars=stars,
            test_used=test
        ))

    # Two-way ANOVA (Condition × Day) when day metadata is provided
    twoway_anova = None
    if req.file_days and len(set(req.file_days.values())) >= 2:
        try:
            rows = []
            for cond, units in units_by_condition.items():
                for unit in units:
                    if not unit["day"]:
                        continue
                    vals = _unit_metric_values(unit, req.metric)
                    if vals:
                        rows.append({
                            "value": _summary(vals, req.summary_stat),
                            "condition": cond,
                            "day": unit["day"],
                        })
            if len(rows) >= 4:
                df_anova = pd.DataFrame(rows)
                # Try full factorial first; fall back to additive if interaction can't be estimated
                try:
                    model = smf.ols("value ~ C(condition) + C(day) + C(condition):C(day)", data=df_anova).fit()
                    table = sm.stats.anova_lm(model, typ=2)
                except Exception:
                    model = smf.ols("value ~ C(condition) + C(day)", data=df_anova).fit()
                    table = sm.stats.anova_lm(model, typ=2)

                twoway_factors = []
                for idx, row in table.iterrows():
                    source = str(idx)
                    ss = float(row.get("sum_sq", 0))
                    df_val = float(row.get("df", 0))
                    ms = float(row.get("mean_sq", 0))
                    f_val = float(row.get("F", 0)) if pd.notna(row.get("F")) else 0.0
                    p_val = float(row.get("PR(>F)", 1)) if pd.notna(row.get("PR(>F)")) else 1.0
                    twoway_factors.append(TwoWayFactor(
                        source=source,
                        ss=ss,
                        df=df_val,
                        ms=ms,
                        f_statistic=f_val,
                        p_value=p_val,
                        significant=p_val < 0.05
                    ))
                twoway_anova = twoway_factors
        except Exception:
            pass

    return PairwiseResponse(
        metric=req.metric,
        anova_f=float(f_stat),
        anova_p=float(p_anova),
        anova_significant=float(p_anova) < 0.05,
        comparisons=comparisons,
        twoway_anova=twoway_anova
    )


def _shapiro(values: list) -> Tuple[Optional[float], Optional[float]]:
    """Shapiro-Wilk normality test; (None, None) when n < 3 or the test fails."""
    if len(values) < 3:
        return None, None
    try:
        w_stat, p_val = stats.shapiro(values)
        if not (np.isfinite(w_stat) and np.isfinite(p_val)):
            return None, None
        return float(w_stat), float(p_val)
    except Exception:
        # Constant input or other numerical issue
        return None, None


def _resolve_pairing(cond_names: list, condition_files: Dict[str, List[str]],
                     file_days: Optional[Dict[str, str]]) -> Tuple[Optional[str], Optional[str], list]:
    """Resolve matched pairs across conditions for a paired analysis.

    Returns (pairing_mode, pairing_warning, pairs) where each pair is
    {"key": <day label or ordinal index>, "files": {condition: file_id}}.
    Pairs are matched by day label when every condition has exactly one file
    per distinct day and the day sets match across conditions; otherwise files
    are paired by ordinal index within each condition.
    """
    days_ok = bool(file_days)
    day_sets: Dict[str, List[str]] = {}
    if days_ok:
        for cond in cond_names:
            days = [str(file_days.get(fid) or "").strip() for fid in condition_files[cond]]
            if any(not d for d in days) or len(days) != len(set(days)):
                days_ok = False
                break
            day_sets[cond] = days
        if days_ok:
            shared = sorted(day_sets[cond_names[0]])
            if any(sorted(day_sets[cond]) != shared for cond in cond_names[1:]):
                days_ok = False
    if days_ok:
        pairs = [
            {
                "key": day,
                "files": {cond: condition_files[cond][day_sets[cond].index(day)] for cond in cond_names},
            }
            for day in sorted(day_sets[cond_names[0]])
        ]
        return "day", None, pairs

    sizes = {len(condition_files[cond]) for cond in cond_names}
    m = min(sizes)
    warning = (
        "Day labels were missing or ambiguous, so files were paired by order "
        "within each condition. Provide file_days with one matching day label "
        "per file across conditions to pair by experimental day."
    )
    if len(sizes) > 1:
        warning += f" Conditions have unequal replicate counts; only the first {m} files of each condition were paired."
    pairs = [
        {"key": str(i), "files": {cond: condition_files[cond][i] for cond in cond_names}}
        for i in range(m)
    ]
    return "ordinal", warning, pairs


@app.post("/api/stats/summary")
async def stats_summary(req: SummaryStatsRequest):
    """
    Per-replicate and per-condition summary statistics plus estimation
    statistics (effect sizes) for a single metric.

    The replicate is the unit of analysis, consistent with plot_metrics:
    per-replicate summaries (mean or median of the replicate's ROI values,
    per `summary_stat`) feed the condition-level statistics and the effect
    sizes. A replicate is one file, or — with pool_by_day — all files sharing
    a (condition, day) merged into a single unit. Returns:
      - replicates: per-replicate n, mean/median/sd/sem/ci95 over ROI values
        and a Shapiro-Wilk normality test (n >= 3)
      - conditions: summary/sd/sem/ci95 computed across the per-replicate
        summaries
      - effect_sizes: per non-reference condition, the difference against the
        reference with a 95% CI (paired: CI of per-pair differences; unpaired:
        Welch-Satterthwaite CI on the difference)
      - pairing_mode/pairing_warning: how replicates were matched when
        paired=True ("day" via day labels, else "ordinal" with a warning)
    """
    if req.metric not in SCALAR_METRICS:
        raise HTTPException(400, {"code": "bad_metric", "message": f"Unknown metric: {req.metric}"})
    if req.summary_stat not in _VALID_SUMMARY_STATS:
        raise HTTPException(400, {
            "code": "bad_summary_stat",
            "message": f"Invalid summary_stat '{req.summary_stat}' (expected one of {sorted(_VALID_SUMMARY_STATS)})",
        })
    if not req.groups or not any(req.groups.values()):
        raise HTTPException(400, {"code": "empty_groups", "message": "groups must contain at least one condition with at least one file_id"})

    excluded = set(req.excluded_file_ids or [])

    units_by_condition = _resolve_replicate_units(req.groups, req.file_days, req.pool_by_day, excluded)
    for units in units_by_condition.values():
        for unit in units:
            for fid in unit["file_ids"]:
                if fid not in sessions:
                    raise HTTPException(404, {"code": "unknown_file", "message": f"Unknown file_id: {fid}"})

    replicates: list = []
    condition_summaries: Dict[str, List[float]] = {}
    condition_files: Dict[str, List[str]] = {}
    unit_days: Dict[str, str] = {}
    rep_summary_by_file: Dict[str, float] = {}
    for condition, units in units_by_condition.items():
        for unit in units:
            vals = _unit_metric_values(unit, req.metric)
            if not vals:
                continue
            n = len(vals)
            sd = float(np.std(vals, ddof=1)) if n >= 2 else None
            sem = float(sd / np.sqrt(n)) if sd is not None else None
            ci95 = float(stats.t.ppf(0.975, n - 1) * sem) if sem is not None else None
            shapiro_stat, shapiro_p = _shapiro(vals)
            replicates.append({
                "file_id": unit["unit_id"],
                "file_name": _unit_display_name(unit),
                "file_ids": unit["file_ids"],
                "condition": condition,
                "day": unit["day"],
                "n": n,
                "mean": float(np.mean(vals)),
                "median": float(np.median(vals)),
                "sd": sd,
                "sem": sem,
                "ci95": ci95,
                "shapiro_stat": shapiro_stat,
                "shapiro_p": shapiro_p,
            })
            rep_summary = _summary(vals, req.summary_stat)
            rep_summary_by_file[unit["unit_id"]] = rep_summary
            condition_summaries.setdefault(condition, []).append(rep_summary)
            condition_files.setdefault(condition, []).append(unit["unit_id"])
            if unit["day"]:
                unit_days[unit["unit_id"]] = unit["day"]

    if not replicates:
        raise HTTPException(400, {"code": "no_data", "message": f"No replicate data for metric '{req.metric}' after applying exclusions"})

    cond_names = list(condition_summaries.keys())
    conditions = []
    for cond in cond_names:
        sums = condition_summaries[cond]
        n_rep = len(sums)
        sd = float(np.std(sums, ddof=1)) if n_rep >= 2 else None
        sem = float(sd / np.sqrt(n_rep)) if sd is not None else None
        ci95 = float(stats.t.ppf(0.975, n_rep - 1) * sem) if sem is not None else None
        conditions.append({
            "condition": cond,
            "n_replicates": n_rep,
            "summary": _summary(sums, req.summary_stat),
            "sd": sd,
            "sem": sem,
            "ci95": ci95,
        })

    if req.reference_condition is not None and req.reference_condition not in condition_summaries:
        raise HTTPException(400, {
            "code": "unknown_reference",
            "message": f"reference_condition '{req.reference_condition}' has no replicate data (known conditions: {cond_names})",
        })
    reference = req.reference_condition or (cond_names[0] if cond_names else None)

    pairing_mode: Optional[str] = None
    pairing_warning: Optional[str] = None
    pairs: list = []
    if req.paired and len(cond_names) >= 2:
        pairing_mode, pairing_warning, pairs = _resolve_pairing(cond_names, condition_files, unit_days)

    effect_sizes: list = []
    if reference is not None and len(cond_names) >= 2:
        ref_sums = condition_summaries[reference]
        for cond in cond_names:
            if cond == reference:
                continue
            cond_sums = condition_summaries[cond]
            if req.paired:
                diffs = []
                for pair in pairs:
                    cf = pair["files"].get(cond)
                    rf = pair["files"].get(reference)
                    if cf and rf:
                        diffs.append(rep_summary_by_file[cf] - rep_summary_by_file[rf])
                m = len(diffs)
                if m < 2:
                    note = (f"Paired effect size for '{cond}' vs '{reference}' was skipped: "
                            f"need >= 2 matched pairs, got {m}.")
                    pairing_warning = f"{pairing_warning} {note}" if pairing_warning else note
                    continue
                difference = float(np.mean(diffs))
                half = float(stats.t.ppf(0.975, m - 1) * np.std(diffs, ddof=1) / np.sqrt(m))
                ci_low: Optional[float] = difference - half
                ci_high: Optional[float] = difference + half
            else:
                difference = _summary(cond_sums, req.summary_stat) - _summary(ref_sums, req.summary_stat)
                n1, n2 = len(cond_sums), len(ref_sums)
                if n1 >= 2 and n2 >= 2:
                    v1 = float(np.var(cond_sums, ddof=1)) / n1
                    v2 = float(np.var(ref_sums, ddof=1)) / n2
                    se = float(np.sqrt(v1 + v2))
                    if se > 0:
                        df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1))
                        half = float(stats.t.ppf(0.975, df) * se)
                        ci_low, ci_high = difference - half, difference + half
                    else:
                        ci_low = ci_high = difference
                else:
                    ci_low = ci_high = None
            effect_sizes.append({
                "condition": cond,
                "reference": reference,
                "difference": difference,
                "ci_low": ci_low,
                "ci_high": ci_high,
                "excludes_zero": bool(ci_low is not None and (ci_low > 0 or ci_high < 0)),
                "paired": bool(req.paired),
            })

    return {
        "replicates": replicates,
        "conditions": conditions,
        "effect_sizes": effect_sizes,
        "pairing_mode": pairing_mode,
        "pairing_warning": pairing_warning,
        "pairs": pairs,
    }


# ── Self-contained project save/open ──────────────────────────────────────────

class ProjectSaveRequest(BaseModel):
    project_id: str
    assignments: Dict[str, dict]
    workspace: dict


def _check_project_operation():
    if project_busy or any(job.get("status") in ("queued", "running") for job in upload_jobs.values()):
        _upload_error("project_busy", "Wait for current uploads or project operations to finish.", status_code=409)


@app.post("/api/project/save")
async def save_project(req: ProjectSaveRequest):
    _check_project_operation()
    try:
        archive = await asyncio.to_thread(build_archive, dict(sessions), req.assignments, req.workspace, req.project_id, MAX_FILES)
    except (ValueError, TypeError, RecursionError) as exc:
        _upload_error("invalid_project", str(exc))
    return Response(archive, media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="project.ca2tchall"',
    })


@app.post("/api/project/open")
async def open_project(file: UploadFile = File(...)):
    global project_busy
    _check_project_operation()
    project_busy = True
    try:
        # Limit upload bytes as well as the archive's uncompressed size.
        content = await file.read(MAX_TOTAL_SESSION_BYTES + 4 * 1024 * 1024 + 1)
        if len(content) > MAX_TOTAL_SESSION_BYTES + 4 * 1024 * 1024:
            raise ValueError("Project exceeds the configured memory limit.")
        manifest, workbooks = await asyncio.to_thread(read_archive, content, MAX_FILES, MAX_TOTAL_SESSION_BYTES)
        restored = {}
        results = []
        total_bytes = 0
        for source, workbook in workbooks:
            parsed = await asyncio.wait_for(
                asyncio.to_thread(_parse_uploaded_workbook, source["file_name"], workbook),
                timeout=PARSE_TIMEOUT_SECONDS,
            )
            session = parsed["session_data"]
            session["provenance"] = {key: source[key] for key in ("source_id", "uploaded_at", "sha256", "size_bytes")}
            session["memory_bytes"] = _estimate_memory_bytes(session)
            total_bytes += session["memory_bytes"]
            if total_bytes > MAX_TOTAL_SESSION_BYTES:
                raise ValueError("Project data exceeds the configured memory limit.")
            restored[source["source_id"]] = session
            results.append({
                "file_id": source["source_id"], "file_name": source["file_name"],
                "condition": source["condition"], "day": source["day"],
                "provenance": session["provenance"],
                "memory_bytes": session["memory_bytes"],
                **{key: parsed[key] for key in ("n_rois", "analysis_mode", "signal_mode", "baseline", "warnings", "has_traces", "has_delta_f", "available_metrics")},
            })
        # Commit only after every embedded workbook has passed validation/parsing.
        sessions.clear()
        sessions.update(restored)
        upload_jobs.clear()
        return {
            "project_id": manifest["project_id"], "saved_at": manifest["saved_at"],
            "workspace": manifest["workspace"], "files": results,
            "session": await get_session_meta(),
        }
    except asyncio.TimeoutError:
        _upload_error("project_timeout", "An embedded workbook took too long to load. The current project was kept.")
    except (ValueError, TypeError, RecursionError) as exc:
        _upload_error("invalid_project", str(exc))
    finally:
        project_busy = False


# ── Static frontend (mounted last so API routes take priority) ─────────────────

_frontend = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(_frontend):
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
