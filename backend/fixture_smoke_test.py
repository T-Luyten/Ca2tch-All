import asyncio
import os
import sys
from pathlib import Path

from fastapi import HTTPException

from main import PlotMetricsRequest, PlotTracesRequest, delete_all_files, get_upload, plot_metrics, plot_traces, sessions, upload, upload_jobs


class DummyUploadFile:
    def __init__(self, path: Path):
        self.path = path
        self.filename = path.name

    async def read(self) -> bytes:
        return self.path.read_bytes()


FIXTURE_EXPECTATIONS = {
    "Bcl2mCherry_3uMSonrot_3uMCarbachol_analysis.xlsx": {
        "nonzero_metrics": {
            "peak", "auc", "event_fwhm", "event_frequency", "time_to_peak",
            "decay_t_half", "rate_of_rise", "tg_peak", "tg_slope", "tg_auc",
            "addback_peak", "addback_slope", "addback_auc", "addback_latency",
        },
        "zero_metrics": set(),
    },
    "DMSO_01_analysis.xlsx": {
        "nonzero_metrics": {
            "tg_peak", "tg_slope", "tg_auc",
            "addback_peak", "addback_slope", "addback_auc", "addback_latency",
        },
        "zero_metrics": {
            "peak", "auc", "event_fwhm", "event_frequency",
            "time_to_peak", "decay_t_half", "rate_of_rise",
        },
    },
}


async def wait_for_upload(file: DummyUploadFile, timeout_seconds: float = 20.0) -> dict:
    started = await upload(file)
    assert started["status"] in {"queued", "running"}

    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        status = await get_upload(started["job_id"])
        if status["status"] == "completed":
            return status["result"]
        if status["status"] in {"failed", "canceled"}:
            raise HTTPException(400, status["error"])
        await asyncio.sleep(0.05)

    raise AssertionError(f"Timed out waiting for upload job {started['job_id']}")


async def main(force_exit: bool = False) -> None:
    sessions.clear()
    base = Path(__file__).resolve().parent.parent
    fixture_paths = [base / name for name in FIXTURE_EXPECTATIONS]

    uploaded = []
    for path in fixture_paths:
        assert path.exists(), f"Missing fixture: {path.name}"
        result = await wait_for_upload(DummyUploadFile(path))
        uploaded.append(result)

    groups = {result["file_name"]: [result["file_id"]] for result in uploaded}
    metrics = await plot_metrics(PlotMetricsRequest(groups=groups))

    for result in uploaded:
        file_name = result["file_name"]
        expected = FIXTURE_EXPECTATIONS[file_name]
        condition_metrics = metrics[file_name]

        for metric in expected["nonzero_metrics"]:
            values = condition_metrics[metric]["files"][0]["values"]
            assert any(abs(float(value)) > 1e-12 for value in values), f"{file_name}: expected nonzero {metric}"

        for metric in expected["zero_metrics"]:
            values = condition_metrics[metric]["files"][0]["values"]
            assert all(abs(float(value)) <= 1e-12 for value in values), f"{file_name}: expected zero-only {metric}"

    combined_groups = {"combined": [result["file_id"] for result in uploaded]}
    raw_traces = await asyncio.wait_for(
        plot_traces(PlotTracesRequest(groups=combined_groups, trace_type="raw")),
        timeout=15.0,
    )
    delta_traces = await asyncio.wait_for(
        plot_traces(PlotTracesRequest(groups=combined_groups, trace_type="delta")),
        timeout=15.0,
    )

    assert raw_traces["combined"]["n_files"] >= 1
    assert delta_traces["combined"]["n_files"] >= 1
    assert len(raw_traces["combined"]["time_s"]) > 0
    assert len(delta_traces["combined"]["condition_mean"]) == len(delta_traces["combined"]["time_s"])

    # If a file is excluded (e.g. mismatched time base), the backend must emit a warning.
    if raw_traces["combined"]["n_files"] < len(uploaded):
        warnings = raw_traces["combined"].get("warnings") or []
        assert warnings, "Expected warnings when trace files are excluded from aggregation"
    if delta_traces["combined"]["n_files"] < len(uploaded):
        warnings = delta_traces["combined"].get("warnings") or []
        assert warnings, "Expected warnings when trace files are excluded from aggregation"

    await delete_all_files()
    assert sessions == {}
    upload_jobs.clear()

    print("Fixture smoke test passed: real uploads, expected zero/nonzero metrics, and trace aggregation.")
    sys.stdout.flush()
    if force_exit:
        os._exit(0)


if __name__ == "__main__":
    asyncio.run(main(force_exit=True))
