import io
import os
import sys
import time
import asyncio

import pandas as pd
from fastapi import HTTPException
import main as app_main

from main import (
    PlotMetricsRequest,
    PlotTracesRequest,
    cancel_upload,
    current_total_session_bytes,
    delete_all_files,
    delete_file,
    get_upload,
    plot_metrics,
    plot_traces,
    sessions,
    upload_jobs,
    upload,
)


class DummyUploadFile:
    def __init__(self, filename: str, content: bytes):
        self.filename = filename
        self._content = content

    async def read(self) -> bytes:
        return self._content


def build_workbook_bytes(label: str, peak_offset: float) -> bytes:
    metrics = pd.DataFrame({
        "roi_id": [1, 2, 3],
        "peak": [1.2 + peak_offset, 1.5 + peak_offset, 1.1 + peak_offset],
        "auc": [0.0, 0.0, 0.0],
        "event_fwhm": [8.0, 7.5, 8.3],
        "event_frequency": [0.2, 0.25, 0.22],
        "time_to_peak": [14.0, 13.5, 14.2],
        "decay_t_half": [6.0, 6.2, 5.9],
        "rate_of_rise": [0.11, 0.12, 0.10],
        "tg_peak": [0.0, 0.0, 0.0],
        "tg_slope": [0.0, 0.0, 0.0],
        "tg_auc": [0.0, 0.0, 0.0],
        "addback_peak": [0.0, 0.0, 0.0],
        "addback_slope": [0.0, 0.0, 0.0],
        "addback_auc": [0.0, 0.0, 0.0],
        "addback_latency": [0.0, 0.0, 0.0],
    })
    settings = pd.DataFrame({
        "key": ["analysis_mode"],
        "value": ["single"],
    })
    metadata = pd.DataFrame({
        "key": ["label"],
        "value": [label],
    })
    raw_traces = pd.DataFrame({
        "Time_s": [0, 1, 2, 3],
        "ROI_1": [100, 120, 140, 130],
        "ROI_2": [102, 118, 143, 129],
        "ROI_3": [98, 121, 141, 128],
    })
    deltaf = pd.DataFrame({
        "Time_s": [0, 1, 2, 3],
        "ROI_1": [0.0, 0.3, 0.6, 0.4],
        "ROI_2": [0.0, 0.28, 0.62, 0.38],
        "ROI_3": [0.0, 0.31, 0.58, 0.36],
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
    assert 'type="module" src="js/main.js"' in index_html

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

    print("raw traces", flush=True)
    raw_traces = await plot_traces(PlotTracesRequest(groups=groups, trace_type="raw"))
    assert raw_traces["Condition A"]["n_files"] == 2
    assert len(raw_traces["Condition A"]["time_s"]) == 4
    assert len(raw_traces["Condition A"]["files"][0]["mean"]) == 4

    print("delta traces", flush=True)
    delta_traces = await plot_traces(PlotTracesRequest(groups=groups, trace_type="delta"))
    assert delta_traces["Condition A"]["n_files"] == 2
    assert len(delta_traces["Condition A"]["condition_mean"]) == 4

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
        await wait_for_upload("broken.xlsx", b"not-an-excel-workbook")
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
