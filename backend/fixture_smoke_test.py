import asyncio
import os
import sys
from pathlib import Path

from fastapi import HTTPException

from main import (
    PlotMetricsRequest,
    PlotTracesRequest,
    SummaryStatsRequest,
    delete_all_files,
    get_upload,
    plot_metrics,
    plot_traces,
    sessions,
    stats_summary,
    upload,
    upload_jobs,
)


class DummyUploadFile:
    def __init__(self, path: Path):
        self.path = path
        self.filename = path.name

    async def read(self) -> bytes:
        return self.path.read_bytes()


FIXTURE_EXPECTATIONS = {
    "example1.xlsx": {
        "nonzero_metrics": {
            "peak", "auc", "event_fwhm", "event_frequency", "time_to_peak",
            "decay_t_half", "rate_of_rise", "tg_peak", "tg_slope", "tg_auc",
            "addback_peak", "addback_slope", "addback_auc", "addback_latency",
        },
        "zero_metrics": set(),
    },
    "example2.xlsx": {
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
    metrics_opts = await plot_metrics(PlotMetricsRequest(
        groups=groups, summary_stat="median", error_mode="ci", outlier_mode="zscore"))

    for result in uploaded:
        file_name = result["file_name"]
        expected = FIXTURE_EXPECTATIONS[file_name]
        condition_metrics = metrics[file_name]
        opt_metrics = metrics_opts[file_name]

        for metric in expected["nonzero_metrics"]:
            values = condition_metrics[metric]["files"][0]["values"]
            assert any(abs(float(value)) > 1e-12 for value in values), f"{file_name}: expected nonzero {metric}"

        for metric in expected["zero_metrics"]:
            values = condition_metrics[metric]["files"][0]["values"]
            assert all(abs(float(value)) <= 1e-12 for value in values), f"{file_name}: expected zero-only {metric}"

        # New view-only fields must be present and consistent for every metric.
        for metric, block in opt_metrics.items():
            assert "condition_summary" in block and "condition_error" in block
            assert block["condition_error"] >= 0.0
            for f in block["files"]:
                assert "summary" in f and f["is_outlier"] is False

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
    for traces in (raw_traces, delta_traces):
        block = traces["combined"]
        assert len(block["condition_summary"]) == len(block["time_s"])
        assert len(block["condition_error"]) == len(block["time_s"])

    # If a file is excluded (e.g. mismatched time base), the backend must emit a warning.
    if raw_traces["combined"]["n_files"] < len(uploaded):
        warnings = raw_traces["combined"].get("warnings") or []
        assert warnings, "Expected warnings when trace files are excluded from aggregation"
    if delta_traces["combined"]["n_files"] < len(uploaded):
        warnings = delta_traces["combined"].get("warnings") or []
        assert warnings, "Expected warnings when trace files are excluded from aggregation"

    print("stats summary (fixtures)", flush=True)
    # Second copies of each fixture give two replicates per condition.
    uploaded_b = [await wait_for_upload(DummyUploadFile(path)) for path in fixture_paths]
    cond_groups = {
        "example1": [uploaded[0]["file_id"], uploaded_b[0]["file_id"]],
        "example2": [uploaded[1]["file_id"], uploaded_b[1]["file_id"]],
    }
    # tg_peak is non-zero in both fixtures, so both conditions have data.
    summary = await stats_summary(SummaryStatsRequest(metric="tg_peak", groups=cond_groups))

    for key in ("replicates", "conditions", "effect_sizes", "pairing_mode", "pairing_warning"):
        assert key in summary, f"Missing response field: {key}"
    assert summary["pairing_mode"] is None
    assert summary["pairing_warning"] is None

    assert len(summary["replicates"]) == 4
    rep_fields = {"file_id", "file_name", "condition", "day", "n", "mean", "median",
                  "sd", "sem", "ci95", "shapiro_stat", "shapiro_p"}
    for rep in summary["replicates"]:
        assert rep_fields <= set(rep), f"Replicate is missing fields: {rep_fields - set(rep)}"
        assert rep["n"] > 0
        assert rep["day"] is None
        if rep["n"] >= 3:
            assert rep["shapiro_p"] is not None
            assert rep["shapiro_stat"] is not None
        if rep["n"] >= 2:
            assert rep["sd"] is not None and rep["sem"] is not None and rep["ci95"] is not None

    assert len(summary["conditions"]) == 2
    cond_fields = {"condition", "n_replicates", "summary", "sd", "sem", "ci95"}
    cond_by_name = {}
    for cond in summary["conditions"]:
        assert cond_fields <= set(cond), f"Condition is missing fields: {cond_fields - set(cond)}"
        assert cond["n_replicates"] == 2
        assert cond["sd"] is not None and cond["sem"] is not None and cond["ci95"] is not None
        cond_by_name[cond["condition"]] = cond

    assert len(summary["effect_sizes"]) == 1
    es_fields = {"condition", "reference", "difference", "ci_low", "ci_high", "excludes_zero", "paired"}
    effect = summary["effect_sizes"][0]
    assert es_fields <= set(effect), f"Effect size is missing fields: {es_fields - set(effect)}"
    assert effect["condition"] == "example2"
    assert effect["reference"] == "example1"
    assert effect["paired"] is False
    expected_diff = cond_by_name["example2"]["summary"] - cond_by_name["example1"]["summary"]
    assert abs(effect["difference"] - expected_diff) < 1e-9
    assert effect["ci_low"] is not None and effect["ci_high"] is not None
    assert effect["ci_low"] <= effect["difference"] <= effect["ci_high"]
    assert effect["excludes_zero"] == bool(effect["ci_low"] > 0 or effect["ci_high"] < 0)

    print("stats summary paired by day (fixtures)", flush=True)
    file_days = {
        uploaded[0]["file_id"]: "day1",
        uploaded_b[0]["file_id"]: "day2",
        uploaded[1]["file_id"]: "day1",
        uploaded_b[1]["file_id"]: "day2",
    }
    paired_summary = await stats_summary(SummaryStatsRequest(
        metric="tg_peak", groups=cond_groups, paired=True, file_days=file_days))
    assert paired_summary["pairing_mode"] == "day"
    assert paired_summary["pairing_warning"] is None
    assert all(rep["day"] in {"day1", "day2"} for rep in paired_summary["replicates"])
    assert len(paired_summary["effect_sizes"]) == 1
    paired_effect = paired_summary["effect_sizes"][0]
    assert paired_effect["paired"] is True
    # Per-pair differences: identical copies, so both pairs have the same diff.
    rep_means = {rep["file_id"]: rep["mean"] for rep in paired_summary["replicates"]}
    pair_diff = rep_means[uploaded[1]["file_id"]] - rep_means[uploaded[0]["file_id"]]
    assert abs(paired_effect["difference"] - pair_diff) < 1e-9

    print("stats summary median stat (fixtures)", flush=True)
    median_summary = await stats_summary(SummaryStatsRequest(
        metric="tg_peak", groups=cond_groups, summary_stat="median"))
    for cond in median_summary["conditions"]:
        rep_medians = sorted(rep["median"] for rep in median_summary["replicates"]
                             if rep["condition"] == cond["condition"])
        # Median of two replicate summaries is their mean.
        assert abs(cond["summary"] - (rep_medians[0] + rep_medians[1]) / 2) < 1e-9

    await delete_all_files()
    assert sessions == {}
    upload_jobs.clear()

    print("Fixture smoke test passed: real uploads, expected zero/nonzero metrics, and trace aggregation.")
    sys.stdout.flush()
    if force_exit:
        os._exit(0)


if __name__ == "__main__":
    asyncio.run(main(force_exit=True))
