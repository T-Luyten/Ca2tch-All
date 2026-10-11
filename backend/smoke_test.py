import io
import os
import sys
import time
import asyncio

import pandas as pd
from fastapi import HTTPException
import main as app_main

from main import (
    PairwiseRequest,
    PlotMetricsRequest,
    PlotTracesRequest,
    SummaryStatsRequest,
    cancel_upload,
    current_total_session_bytes,
    delete_all_files,
    delete_file,
    get_upload,
    plot_metrics,
    plot_traces,
    sessions,
    stats_pairwise,
    stats_summary,
    upload_jobs,
    upload,
)


class DummyUploadFile:
    def __init__(self, filename: str, content: bytes):
        self.filename = filename
        self._content = content

    async def read(self) -> bytes:
        return self._content


def build_workbook_bytes(label: str, peak_offset: float, *, time_values: list[float] | None = None, peak_values: list[float] | None = None) -> bytes:
    peaks = peak_values if peak_values is not None else [1.2 + peak_offset, 1.5 + peak_offset, 1.1 + peak_offset]
    n_rois = len(peaks)

    def sized(base: list[float]) -> list[float]:
        return (base * (n_rois // len(base) + 1))[:n_rois]

    metrics = pd.DataFrame({
        "roi_id": list(range(1, n_rois + 1)),
        "peak": peaks,
        "auc": sized([0.0, 0.0, 0.0]),
        "event_fwhm": sized([8.0, 7.5, 8.3]),
        "event_frequency": sized([0.2, 0.25, 0.22]),
        "time_to_peak": sized([14.0, 13.5, 14.2]),
        "decay_t_half": sized([6.0, 6.2, 5.9]),
        "rate_of_rise": sized([0.11, 0.12, 0.10]),
        "tg_peak": sized([0.0, 0.0, 0.0]),
        "tg_slope": sized([0.0, 0.0, 0.0]),
        "tg_auc": sized([0.0, 0.0, 0.0]),
        "addback_peak": sized([0.0, 0.0, 0.0]),
        "addback_slope": sized([0.0, 0.0, 0.0]),
        "addback_auc": sized([0.0, 0.0, 0.0]),
        "addback_latency": sized([0.0, 0.0, 0.0]),
    })
    settings = pd.DataFrame({
        "key": ["analysis_mode"],
        "value": ["single"],
    })
    metadata = pd.DataFrame({
        "key": ["label"],
        "value": [label],
    })
    time_values = time_values or [0, 1, 2, 3]
    raw_traces = pd.DataFrame({
        "Time_s": time_values,
        "ROI_1": [100, 120, 140, 130][: len(time_values)],
        "ROI_2": [102, 118, 143, 129][: len(time_values)],
        "ROI_3": [98, 121, 141, 128][: len(time_values)],
    })
    deltaf = pd.DataFrame({
        "Time_s": time_values,
        "ROI_1": [0.0, 0.3, 0.6, 0.4][: len(time_values)],
        "ROI_2": [0.0, 0.28, 0.62, 0.38][: len(time_values)],
        "ROI_3": [0.0, 0.31, 0.58, 0.36][: len(time_values)],
    })

    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        metrics.to_excel(writer, sheet_name="Metrics", index=False)
        settings.to_excel(writer, sheet_name="Settings", index=False)
        metadata.to_excel(writer, sheet_name="Metadata", index=False)
        raw_traces.to_excel(writer, sheet_name="Raw_Traces", index=False)
        deltaf.to_excel(writer, sheet_name="DeltaF", index=False)
    return buffer.getvalue()


async def wait_for_upload(filename: str, content: bytes) -> dict:
    started = await upload(DummyUploadFile(filename, content))
    assert started["status"] in {"queued", "running"}
    deadline = time.time() + 10
    while time.time() < deadline:
        status = await get_upload(started["job_id"])
        if status["status"] == "completed":
            return status["result"]
        if status["status"] == "failed":
            raise HTTPException(400, status["error"])
        if status["status"] == "canceled":
            raise HTTPException(400, status["error"])
        await asyncio.sleep(0.05)
    raise AssertionError(f"Timed out waiting for upload job {started['job_id']}")


async def start_upload(filename: str, content: bytes) -> dict:
    started = await upload(DummyUploadFile(filename, content))
    assert started["status"] in {"queued", "running"}
    return started


async def wait_for_job_state(job_id: str, accepted_statuses: set[str], timeout_seconds: float = 10.0) -> dict:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        status = await get_upload(job_id)
        if status["status"] in accepted_statuses:
            return status
        await asyncio.sleep(0.05)
    raise AssertionError(f"Timed out waiting for upload job {job_id} to reach {sorted(accepted_statuses)}")


async def main(force_exit: bool = False) -> None:
    sessions.clear()
    print("check frontend entrypoint", flush=True)
    frontend_index = os.path.join(os.path.dirname(__file__), "..", "frontend", "index.html")
    with open(frontend_index, encoding="utf-8") as handle:
        index_html = handle.read()
    assert 'type="module" src="js/main.js' in index_html

    print("build workbooks", flush=True)
    workbook_a = build_workbook_bytes("vehicle", 0.0)
    workbook_b = build_workbook_bytes("drug", 0.4)

    upload_payloads = [
        ("vehicle_a.xlsx", workbook_a),
        ("vehicle_b.xlsx", workbook_b),
    ]

    uploaded = []
    for filename, content in upload_payloads:
        print(f"upload {filename}", flush=True)
        body = await wait_for_upload(filename, content)
        assert body["file_name"] == filename
        assert body["n_rois"] == 3
        assert body["memory_bytes"] > 0
        assert body["total_memory_bytes"] >= body["memory_bytes"]
        assert body["has_traces"] is True
        assert body["has_delta_f"] is True
        assert "peak" in body["available_metrics"]
        uploaded.append(body)

    groups = {"Condition A": [body["file_id"] for body in uploaded]}

    print("metrics", flush=True)
    metrics = await plot_metrics(PlotMetricsRequest(groups=groups))
    assert "Condition A" in metrics
    assert metrics["Condition A"]["peak"]["n_files"] == 2
    assert metrics["Condition A"]["auc"]["n_files"] == 2
    assert metrics["Condition A"]["auc"]["condition_mean"] == 0.0
    assert metrics["Condition A"]["tg_peak"]["condition_mean"] == 0.0
    peak_default = metrics["Condition A"]["peak"]
    assert "condition_summary" in peak_default and "condition_error" in peak_default
    assert all(f["is_outlier"] is False for f in peak_default["files"])
    assert peak_default["condition_error"] == peak_default["condition_sem"]

    print("metrics summary/error/outlier options", flush=True)
    workbook_d = build_workbook_bytes("vehicle", 0.8)
    uploaded_d = await wait_for_upload("vehicle_d.xlsx", workbook_d)
    groups3 = {"Condition A": [b["file_id"] for b in uploaded] + [uploaded_d["file_id"]]}

    median_metrics = await plot_metrics(PlotMetricsRequest(
        groups=groups3, summary_stat="median", error_mode="sd", outlier_mode="iqr"))
    peak_median = median_metrics["Condition A"]["peak"]
    assert peak_median["n_files"] == 3
    for f in peak_median["files"]:
        assert "summary" in f and isinstance(f["is_outlier"], bool)
    # Per-file medians of peaks are 1.2 / 1.6 / 2.0 -> median 1.6, SD 0.4.
    assert abs(peak_median["condition_summary"] - 1.6) < 1e-9
    assert abs(peak_median["condition_error"] - 0.4) < 1e-9

    print("metrics CI error uses t-multiplier", flush=True)
    ci_metrics = await plot_metrics(PlotMetricsRequest(groups=groups3, error_mode="ci"))
    peak_ci = ci_metrics["Condition A"]["peak"]
    assert peak_ci["condition_sem"] > 0
    # n = 3 files -> t(0.975, 2) = 4.303
    assert abs(peak_ci["condition_error"] / peak_ci["condition_sem"] - 4.303) < 1e-3

    none_metrics = await plot_metrics(PlotMetricsRequest(groups=groups3, error_mode="none"))
    assert none_metrics["Condition A"]["peak"]["condition_error"] == 0.0

    print("metrics invalid options rejected", flush=True)
    for kwargs in ({"summary_stat": "bogus"}, {"error_mode": "bogus"}, {"outlier_mode": "bogus"}):
        try:
            await plot_metrics(PlotMetricsRequest(groups=groups3, **kwargs))
            raise AssertionError(f"Expected 400 for {kwargs}")
        except HTTPException as exc:
            assert exc.status_code == 400

    print("raw traces", flush=True)
    raw_traces = await plot_traces(PlotTracesRequest(groups=groups, trace_type="raw"))
    assert raw_traces["Condition A"]["n_files"] == 2
    assert len(raw_traces["Condition A"]["time_s"]) == 4
    assert len(raw_traces["Condition A"]["files"][0]["mean"]) == 4

    print("delta traces", flush=True)
    delta_traces = await plot_traces(PlotTracesRequest(groups=groups, trace_type="delta"))
    assert delta_traces["Condition A"]["n_files"] == 2
    assert len(delta_traces["Condition A"]["condition_mean"]) == 4
    assert delta_traces["Condition A"].get("warnings") == []
    assert len(delta_traces["Condition A"]["condition_summary"]) == 4
    assert len(delta_traces["Condition A"]["condition_error"]) == 4

    print("traces summary/error options", flush=True)
    median_traces = await plot_traces(PlotTracesRequest(
        groups=groups, trace_type="delta", summary_stat="median", error_mode="sd"))
    assert len(median_traces["Condition A"]["condition_summary"]) == 4
    assert len(median_traces["Condition A"]["condition_error"]) == 4
    none_traces = await plot_traces(PlotTracesRequest(groups=groups, trace_type="delta", error_mode="none"))
    assert all(v == 0.0 for v in none_traces["Condition A"]["condition_error"])
    try:
        await plot_traces(PlotTracesRequest(groups=groups, trace_type="delta", error_mode="bogus"))
        raise AssertionError("Expected 400 for invalid trace error_mode")
    except HTTPException as exc:
        assert exc.status_code == 400

    print("trace timebase mismatch resampling", flush=True)
    workbook_c = build_workbook_bytes("vehicle", 0.0, time_values=[0, 2, 4, 6])
    mismatched = await wait_for_upload("mismatch.xlsx", workbook_c)
    mismatch_groups = {"Condition A": [uploaded[0]["file_id"], mismatched["file_id"]]}
    mismatch_delta = await plot_traces(PlotTracesRequest(groups=mismatch_groups, trace_type="delta"))
    # Both files are now resampled to a common time axis rather than excluded.
    assert mismatch_delta["Condition A"]["n_files"] == 2
    warnings = mismatch_delta["Condition A"].get("warnings") or []
    assert any("mismatch.xlsx" in str(w) for w in warnings)
    assert any("resampled" in str(w) for w in warnings)

    print("memory limit rejection", flush=True)
    previous_limit = app_main.MAX_TOTAL_SESSION_BYTES
    try:
        app_main.MAX_TOTAL_SESSION_BYTES = current_total_session_bytes()
        try:
            await wait_for_upload("overflow.xlsx", workbook_a)
            raise AssertionError("Expected upload to be rejected by session memory limit")
        except HTTPException as exc:
            assert exc.status_code == 400
            assert exc.detail["code"] == "total_ram_cap"
            assert "total RAM cap" in exc.detail["message"]
    finally:
        app_main.MAX_TOTAL_SESSION_BYTES = previous_limit

    print("structure rejection", flush=True)
    try:
        # Valid ZIP magic bytes but corrupt contents, so the upload passes the
        # file-type gate and is rejected by the workbook structure check.
        await wait_for_upload("broken.xlsx", b"PK" + b"not-an-excel-workbook")
        raise AssertionError("Expected invalid workbook structure to be rejected")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail["code"] == "bad_structure"

    print("roi limit rejection", flush=True)
    previous_roi_limit = app_main.MAX_ROIS_PER_FILE
    try:
        app_main.MAX_ROIS_PER_FILE = 2
        try:
            await wait_for_upload("too_many_rois.xlsx", workbook_a)
            raise AssertionError("Expected upload to be rejected by ROI limit")
        except HTTPException as exc:
            assert exc.status_code == 400
            assert exc.detail["code"] == "too_many_rois"
            assert "ROI limit" in exc.detail["message"]
    finally:
        app_main.MAX_ROIS_PER_FILE = previous_roi_limit

    print("trace degradation", flush=True)
    previous_trace_limit = app_main.TRACE_CELL_SOFT_LIMIT
    try:
        app_main.TRACE_CELL_SOFT_LIMIT = 2
        degraded = await wait_for_upload("metrics_only.xlsx", workbook_a)
        assert degraded["available_metrics"]
        assert degraded["has_traces"] is False
        assert degraded["has_delta_f"] is False
        assert degraded["warnings"]
    finally:
        app_main.TRACE_CELL_SOFT_LIMIT = previous_trace_limit

    print("job running state", flush=True)
    original_parser = app_main._parse_uploaded_workbook
    original_timeout = app_main.PARSE_TIMEOUT_SECONDS
    try:
        def slow_parser(filename: str, content: bytes, progress=None) -> dict:
            if progress:
                progress(stage="open", progress=0.2, message="Opening workbook…")
            time.sleep(0.2)
            if progress:
                progress(stage="metrics", progress=0.5, message="Reading metrics…")
            time.sleep(0.2)
            return original_parser(filename, content, progress)

        app_main._parse_uploaded_workbook = slow_parser
        app_main.PARSE_TIMEOUT_SECONDS = 5
        started = await start_upload("slow_running.xlsx", workbook_a)
        running = await wait_for_job_state(started["job_id"], {"running", "completed"})
        assert running["status"] in {"running", "completed"}
        if running["status"] == "running":
            assert running["progress"] > started["progress"]
        await wait_for_job_state(started["job_id"], {"completed"})
    finally:
        app_main._parse_uploaded_workbook = original_parser
        app_main.PARSE_TIMEOUT_SECONDS = original_timeout

    print("job cancel", flush=True)
    try:
        def cancellable_parser(filename: str, content: bytes, progress=None) -> dict:
            if progress:
                progress(stage="open", progress=0.2, message="Opening workbook…")
            time.sleep(0.3)
            if progress:
                progress(stage="metrics", progress=0.45, message="Reading metrics…")
            time.sleep(0.5)
            return original_parser(filename, content, progress)

        app_main._parse_uploaded_workbook = cancellable_parser
        app_main.PARSE_TIMEOUT_SECONDS = 5
        started = await start_upload("cancel_me.xlsx", workbook_a)
        await wait_for_job_state(started["job_id"], {"running", "completed"})
        canceled = await cancel_upload(started["job_id"])
        assert canceled["status"] == "canceled"
        assert canceled["error"]["code"] == "upload_canceled"
        final = await wait_for_job_state(started["job_id"], {"canceled"})
        assert final["status"] == "canceled"
    finally:
        app_main._parse_uploaded_workbook = original_parser
        app_main.PARSE_TIMEOUT_SECONDS = original_timeout

    print("job timeout", flush=True)
    try:
        def timeout_parser(filename: str, content: bytes, progress=None) -> dict:
            if progress:
                progress(stage="open", progress=0.15, message="Opening workbook…")
            time.sleep(0.25)
            if progress:
                progress(stage="metrics", progress=0.35, message="Reading metrics…")
            time.sleep(0.25)
            return original_parser(filename, content, progress)

        app_main._parse_uploaded_workbook = timeout_parser
        app_main.PARSE_TIMEOUT_SECONDS = 0.1
        started = await start_upload("timeout.xlsx", workbook_a)
        timed_out = await wait_for_job_state(started["job_id"], {"failed"})
        assert timed_out["error"]["code"] == "parse_timeout"
        assert "parse timeout" in timed_out["error"]["message"]
    finally:
        app_main._parse_uploaded_workbook = original_parser
        app_main.PARSE_TIMEOUT_SECONDS = original_timeout

    print("stats summary numeric checks", flush=True)
    # build_workbook_bytes peaks are [1.2+off, 1.5+off, 1.1+off], so each
    # file's mean peak is 3.8/3 + off. Offsets are chosen so the replicate
    # means are known exactly.
    stat_files = {}
    for label, offset in (("a1", 0.0), ("a2", 0.2), ("b1", 0.6), ("b2", 1.0)):
        stat_files[label] = await wait_for_upload(f"stat_{label}.xlsx", build_workbook_bytes(label, offset))
    stat_groups = {
        "Control": [stat_files["a1"]["file_id"], stat_files["a2"]["file_id"]],
        "Treatment": [stat_files["b1"]["file_id"], stat_files["b2"]["file_id"]],
    }
    summary = await stats_summary(SummaryStatsRequest(metric="peak", groups=stat_groups))
    assert summary["pairing_mode"] is None and summary["pairing_warning"] is None
    assert len(summary["replicates"]) == 4
    for rep in summary["replicates"]:
        assert rep["n"] == 3
        assert rep["shapiro_stat"] is not None and rep["shapiro_p"] is not None
        # n = 3 -> ci95 = t(0.975, 2) * sem = 4.3026527 * sd / sqrt(3)
        assert abs(rep["ci95"] / rep["sem"] - 4.302652729749275) < 1e-9
    cond_by_name = {c["condition"]: c for c in summary["conditions"]}
    assert cond_by_name["Control"]["n_replicates"] == 2
    assert cond_by_name["Treatment"]["n_replicates"] == 2
    # Control summary = 3.8/3 + 0.1, Treatment summary = 3.8/3 + 0.8.
    assert abs(cond_by_name["Control"]["summary"] - (3.8 / 3 + 0.1)) < 1e-9
    assert abs(cond_by_name["Treatment"]["summary"] - (3.8 / 3 + 0.8)) < 1e-9
    assert len(summary["effect_sizes"]) == 1
    effect = summary["effect_sizes"][0]
    assert effect["condition"] == "Treatment" and effect["reference"] == "Control"
    assert effect["paired"] is False
    assert abs(effect["difference"] - 0.7) < 1e-9
    # Welch CI by hand: control sd^2 = 0.02, treatment sd^2 = 0.08 (offset
    # spacings 0.2 and 0.4), n1 = n2 = 2 -> v1 = 0.01, v2 = 0.04,
    # se = sqrt(0.05), Welch-Satterthwaite df = 0.05^2 / (0.01^2 + 0.04^2).
    from scipy import stats as scipy_stats
    v1, v2 = 0.01, 0.04
    welch_df = (v1 + v2) ** 2 / (v1 ** 2 + v2 ** 2)  # n1 - 1 = n2 - 1 = 1
    expected_half = float(scipy_stats.t.ppf(0.975, welch_df)) * (v1 + v2) ** 0.5
    assert abs(effect["ci_low"] - (0.7 - expected_half)) < 1e-9
    assert abs(effect["ci_high"] - (0.7 + expected_half)) < 1e-9
    assert effect["excludes_zero"] is False

    print("stats summary paired by day", flush=True)
    stat_days = {
        stat_files["a1"]["file_id"]: "day1",
        stat_files["b1"]["file_id"]: "day1",
        stat_files["a2"]["file_id"]: "day2",
        stat_files["b2"]["file_id"]: "day2",
    }
    paired_summary = await stats_summary(SummaryStatsRequest(
        metric="peak", groups=stat_groups, paired=True, file_days=stat_days))
    assert paired_summary["pairing_mode"] == "day"
    assert paired_summary["pairing_warning"] is None
    paired_effect = paired_summary["effect_sizes"][0]
    assert paired_effect["paired"] is True
    # Per-pair differences: day1 = 0.6, day2 = 0.8 -> mean 0.7, sd 0.1414…,
    # half-width = t(0.975, 1) * sd / sqrt(2) = 12.7062047 * 0.1.
    assert abs(paired_effect["difference"] - 0.7) < 1e-9
    expected_paired_half = 12.706204736174695 * 0.1
    assert abs(paired_effect["ci_low"] - (0.7 - expected_paired_half)) < 1e-9
    assert abs(paired_effect["ci_high"] - (0.7 + expected_paired_half)) < 1e-9
    assert paired_effect["excludes_zero"] is False

    print("stats summary ordinal pairing fallback", flush=True)
    ordinal_summary = await stats_summary(SummaryStatsRequest(
        metric="peak", groups=stat_groups, paired=True))
    assert ordinal_summary["pairing_mode"] == "ordinal"
    assert ordinal_summary["pairing_warning"]
    assert "paired by order" in ordinal_summary["pairing_warning"]
    assert abs(ordinal_summary["effect_sizes"][0]["difference"] - 0.7) < 1e-9

    print("stats summary exclusions and errors", flush=True)
    excluded_summary = await stats_summary(SummaryStatsRequest(
        metric="peak", groups=stat_groups, excluded_file_ids=[stat_files["a2"]["file_id"]]))
    excluded_control = next(c for c in excluded_summary["conditions"] if c["condition"] == "Control")
    assert excluded_control["n_replicates"] == 1
    assert excluded_control["sd"] is None and excluded_control["sem"] is None and excluded_control["ci95"] is None
    for bad_kwargs in (
        {"metric": "bogus"},
        {"metric": "peak", "summary_stat": "bogus"},
        {"metric": "peak", "groups": {}},
        {"metric": "peak", "groups": {"Control": ["no-such-file"]}},
        {"metric": "peak", "reference_condition": "Nope"},
    ):
        try:
            kwargs = {"metric": "peak", "groups": stat_groups, **bad_kwargs}
            await stats_summary(SummaryStatsRequest(**kwargs))
            raise AssertionError(f"Expected error for {bad_kwargs}")
        except HTTPException as exc:
            assert exc.status_code in {400, 404}

    print("pool by day", flush=True)
    pool_days = {
        stat_files["a1"]["file_id"]: "day1",
        stat_files["a2"]["file_id"]: "day1",
        stat_files["b1"]["file_id"]: "day1",
        stat_files["b2"]["file_id"]: "day2",
    }
    pooled = await stats_summary(SummaryStatsRequest(
        metric="peak", groups=stat_groups, pool_by_day=True, file_days=pool_days))
    pooled_control = next(c for c in pooled["conditions"] if c["condition"] == "Control")
    assert pooled_control["n_replicates"] == 1  # a1 + a2 share day1 -> one unit
    pooled_control_rep = next(r for r in pooled["replicates"] if r["condition"] == "Control")
    assert pooled_control_rep["n"] == 6
    assert pooled_control_rep["day"] == "day1"
    # pooled mean over a1+a2 peaks: (3.8 + 4.4) / 6
    assert abs(pooled_control_rep["mean"] - 8.2 / 6) < 1e-9
    pooled_treatment = next(c for c in pooled["conditions"] if c["condition"] == "Treatment")
    assert pooled_treatment["n_replicates"] == 2
    # the unpooled call above is unaffected
    assert cond_by_name["Control"]["n_replicates"] == 2

    pooled_plot = await plot_metrics(PlotMetricsRequest(
        groups=stat_groups, file_days=pool_days, pool_by_day=True))
    control_files = pooled_plot["Control"]["peak"]["files"]
    assert len(control_files) == 1
    assert control_files[0]["day"] == "day1"
    assert len(control_files[0]["values"]) == 6
    assert abs(control_files[0]["mean"] - 8.2 / 6) < 1e-9
    treatment_files = pooled_plot["Treatment"]["peak"]["files"]
    assert len(treatment_files) == 2
    assert [f["day"] for f in treatment_files] == ["day1", "day2"]
    # condition summary across the two day units, matching unpooled math
    assert abs(pooled_plot["Treatment"]["peak"]["condition_summary"] - (3.8 / 3 + 0.8)) < 1e-9

    print("pool by day paired", flush=True)
    all_day1 = {fid: "day1" for fid in pool_days}
    pooled_paired = await stats_summary(SummaryStatsRequest(
        metric="peak", groups=stat_groups, pool_by_day=True, file_days=all_day1, paired=True))
    assert pooled_paired["pairing_mode"] == "day"
    # only one matched pair -> paired effect size skipped with a note
    assert pooled_paired["effect_sizes"] == []
    assert ">= 2 matched pairs" in pooled_paired["pairing_warning"]

    # balanced 2-day setup: same-day units of different conditions must keep
    # distinct unit ids, otherwise paired differences collapse to zero
    balanced_paired = await stats_summary(SummaryStatsRequest(
        metric="peak", groups=stat_groups, pool_by_day=True, file_days=stat_days, paired=True))
    assert balanced_paired["pairing_mode"] == "day"
    assert len({r["file_id"] for r in balanced_paired["replicates"]}) == 4
    balanced_effect = balanced_paired["effect_sizes"][0]
    assert abs(balanced_effect["difference"] - 0.7) < 1e-9
    assert abs(balanced_effect["ci_low"] - (0.7 - expected_paired_half)) < 1e-9
    assert abs(balanced_effect["ci_high"] - (0.7 + expected_paired_half)) < 1e-9

    print("pairwise follows summary stat", flush=True)
    skew_files = {}
    for label, peaks in (("c1", [0.0, 0.0, 9.0]), ("c2", [1.0, 1.0, 10.0]),
                         ("d1", [5.0, 5.0, 14.0]), ("d2", [6.0, 6.0, 16.0])):
        skew_files[label] = await wait_for_upload(
            f"skew_{label}.xlsx", build_workbook_bytes(label, 0.0, peak_values=peaks))
    skew_groups = {
        "Control": [skew_files["c1"]["file_id"], skew_files["c2"]["file_id"]],
        "Treatment": [skew_files["d1"]["file_id"], skew_files["d2"]["file_id"]],
    }
    mean_stats = await stats_pairwise(PairwiseRequest(metric="peak", groups=skew_groups, summary_stat="mean"))
    median_stats = await stats_pairwise(PairwiseRequest(metric="peak", groups=skew_groups, summary_stat="median"))
    _, p_mean = scipy_stats.ttest_ind([3.0, 4.0], [8.0, 28.0 / 3.0], equal_var=False)
    _, p_median = scipy_stats.ttest_ind([0.0, 1.0], [5.0, 6.0], equal_var=False)
    assert abs(mean_stats.comparisons[0].p_value - p_mean) < 1e-9
    assert abs(median_stats.comparisons[0].p_value - p_median) < 1e-9
    assert abs(mean_stats.comparisons[0].p_value - median_stats.comparisons[0].p_value) > 1e-6

    print("cleanup", flush=True)
    await delete_file(uploaded[0]["file_id"])
    assert uploaded[0]["file_id"] not in sessions

    await delete_all_files()
    assert sessions == {}
    upload_jobs.clear()

    print("Smoke test passed: frontend entrypoint, upload, metrics, traces, and cleanup.")
    sys.stdout.flush()
    if force_exit:
        os._exit(0)


if __name__ == "__main__":
    asyncio.run(main(force_exit=True))
