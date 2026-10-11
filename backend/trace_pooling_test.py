"""Regression checks for daily trace pooling and independent-day uncertainty."""
import asyncio
import math
import numpy as np
from scipy import stats
from main import PlotTracesRequest, plot_traces, sessions


def source(values, times=None, name='duplicate.xlsx'):
    times = times if times is not None else [0, 1, 2]
    if isinstance(values, (int, float)):
        values = [[values] * len(times)]
    return {
        'file_name': name,
        'traces': {'time_s': times, 'rois': {f'ROI_{i}': [v * 10 for v in row] for i, row in enumerate(values)}},
        'delta_f': {'time_s': times, 'rois': {f'ROI_{i}': row for i, row in enumerate(values)}},
    }


async def main():
    sessions.clear()
    sessions.update({fid: source(value) for fid, value in [('a', 2), ('b', 2), ('c', 2), ('d', 6)]})
    groups = {'Control': ['a', 'b', 'c', 'd']}
    days = {'a': 'Day 1', 'b': 'Day 1', 'c': 'Day 1', 'd': 'Day 2'}
    for trace_type, scale in [('raw', 10), ('delta', 1)]:
        unpooled = (await plot_traces(PlotTracesRequest(groups=groups, file_days=days, trace_type=trace_type, error_mode='sd')))['Control']
        np.testing.assert_allclose(unpooled['condition_mean'], [3 * scale] * 3)
        assert unpooled['n_files'] == 4
        assert [f['file_id'] for f in unpooled['files']] == ['a', 'b', 'c', 'd']
        for error_mode, expected in [('sd', math.sqrt(8)), ('sem', 2), ('ci', 2 * stats.t.ppf(0.975, 1)), ('none', 0)]:
            pooled = (await plot_traces(PlotTracesRequest(groups=groups, file_days=days, pool_by_day=True, trace_type=trace_type, error_mode=error_mode)))['Control']
            np.testing.assert_allclose(pooled['condition_summary'], [4 * scale] * 3)
            np.testing.assert_allclose(pooled['condition_error'], [expected * scale] * 3)
            assert pooled['n_files'] == 2 and pooled['n_source_files'] == 4
            assert pooled['files'][0]['file_ids'] == ['a', 'b', 'c']
            assert pooled['files'][0]['file_id'] == 'day:Control:Day 1'
            assert pooled['files'][0]['day'] == 'Day 1'
            assert pooled['files'][0]['n_rois'] == 3
        single_day = (await plot_traces(PlotTracesRequest(groups=groups, file_days={fid: 'Day 1' for fid in groups['Control']}, pool_by_day=True, trace_type=trace_type, error_mode='sd')))['Control']
        assert single_day['n_files'] == 1
        assert single_day['condition_error'] == [0] * 3  # frontend omits error bands for <2 replicates

    # Pool cells within each day: a file with more ROIs contributes more cells,
    # but an entire day still has only one vote in the condition summary.
    sessions.update({'a': source([[1, 1, 1], [3, 3, 3]]), 'b': source([[10, 10, 10]]), 'd': source(8)})
    weighted = (await plot_traces(PlotTracesRequest(groups={'Control': ['a', 'b', 'd']}, file_days=days, pool_by_day=True)))['Control']
    np.testing.assert_allclose(weighted['files'][0]['mean'], [14 / 3] * 3)
    np.testing.assert_allclose(weighted['condition_mean'], [(14 / 3 + 8) / 2] * 3)

    # Missing values are excluded at each frame, not weighted as zeros.
    sessions['a'] = source([[1, 1, 1], [3, np.nan, 3]])
    finite = (await plot_traces(PlotTracesRequest(groups={'Control': ['a', 'b', 'd']}, file_days=days, pool_by_day=True)))['Control']
    np.testing.assert_allclose(finite['files'][0]['mean'], [14 / 3, 11 / 2, 14 / 3])

    # Resample different grids before averaging same-day ROIs.
    sessions.update({'a': source([[0, 2, 4]], [0, 2, 4]), 'b': source([[2, 3, 4]], [0, 1, 2]), 'd': source([[5, 6, 7]], [0, 1, 2])})
    aligned = (await plot_traces(PlotTracesRequest(groups={'Control': ['a', 'b', 'd']}, file_days=days, pool_by_day=True)))['Control']
    assert aligned['time_s'] == [0, 1, 2]
    np.testing.assert_allclose(aligned['files'][0]['mean'], [1, 2, 3])
    np.testing.assert_allclose(aligned['condition_mean'], [3, 4, 5])
    assert any('resampled' in message for message in aligned['warnings'])

    # Missing-day files remain independent; unavailable traces cannot add a replicate.
    sessions['c'] = {'file_name': 'no-traces.xlsx', 'traces': {}, 'delta_f': {}}
    sparse = (await plot_traces(PlotTracesRequest(groups=groups, file_days={'a': 'Day 1', 'b': 'Day 1', 'c': 'Day 3'}, pool_by_day=True)))['Control']
    assert sparse['n_files'] == 2 and sparse['n_source_files'] == 3
    assert sparse['files'][1]['file_id'] == 'd' and sparse['files'][1]['day'] is None
    no_labels = (await plot_traces(PlotTracesRequest(groups=groups, pool_by_day=True)))['Control']
    assert no_labels['n_files'] == 3

    # A shared day label in different conditions must never merge conditions.
    separated = await plot_traces(PlotTracesRequest(groups={'Control': ['a', 'b'], 'Drug': ['d']}, file_days={'a': 'Day 1', 'b': 'Day 1', 'd': 'Day 1'}, pool_by_day=True))
    assert separated['Control']['n_files'] == separated['Drug']['n_files'] == 1
    assert separated['Control']['files'][0]['file_id'] != separated['Drug']['files'][0]['file_id']

    # Median is taken across daily mean curves, rather than across individual files.
    sessions.update({'a': source(1), 'b': source(1), 'c': source(3), 'd': source(11)})
    median = (await plot_traces(PlotTracesRequest(groups=groups, file_days={'a': 'Day 1', 'b': 'Day 1', 'c': 'Day 2', 'd': 'Day 3'}, pool_by_day=True, summary_stat='median', error_mode='sd')))['Control']
    np.testing.assert_allclose(median['condition_summary'], [3] * 3)
    np.testing.assert_allclose(median['condition_error'], [np.std([1, 3, 11], ddof=1)] * 3)
    sessions.clear()
    print('Trace pooling tests passed: equal-day weighting, raw/delta, SD/SEM/CI, ROI pooling, missing data, resampling, and median.')


if __name__ == '__main__':
    asyncio.run(main())
