import { fetchMetrics, fetchTraces } from './api.js';
import {
    firstVisibleTab,
    hasGroups,
    isTabVisible,
    plotLabels,
    setActiveTab,
    updateTraceExclusionNotice,
    updateFormatPanelContext,
    updateMetricTabVisibility,
} from './core.js';
import {
    hidePlaceholder,
    restorePane,
    setStatus,
    showNoDataMessage,
    showPane,
    showPlaceholder,
    updateReplicateLegend,
} from './dom.js';
import { renderMetricChart } from './metric-renderers.js';
import { state } from './state.js';
import { renderTraceComparison } from './trace-renderers.js';

const METRIC_PLOT_TARGETS = {
    peak: ['plot-peak', 'peak'],
    auc: ['plot-auc', 'auc'],
    fwhm: ['plot-fwhm', 'event_fwhm'],
    frequency: ['plot-frequency', 'event_frequency'],
    ttp: ['plot-ttp', 'time_to_peak'],
    decay: ['plot-decay', 'decay_t_half'],
    rise: ['plot-rise', 'rate_of_rise'],
    tg_peak: ['plot-tg-peak', 'tg_peak'],
    tg_slope: ['plot-tg-slope', 'tg_slope'],
    tg_auc: ['plot-tg-auc', 'tg_auc'],
    addback_peak: ['plot-addback-peak', 'addback_peak'],
    addback_slope: ['plot-addback-slope', 'addback_slope'],
    addback_auc: ['plot-addback-auc', 'addback_auc'],
    addback_latency: ['plot-addback-latency', 'addback_latency'],
};

let refreshEpoch = 0;

function renderMetricTab(metricsData, epoch) {
    if (epoch !== refreshEpoch) return;
    const target = METRIC_PLOT_TARGETS[state.currentTab];
    if (!target) return;
    const [containerId, metric] = target;
    renderMetricChart(containerId, metric, metricsData);
}

function renderTraceTab(data, epoch) {
    if (epoch !== refreshEpoch) return;
    restorePane(`pane-${state.currentTab}`);
    const labels = plotLabels();
    renderTraceComparison(`plot-${state.currentTab}-traces`, data, labels.title, labels.x, labels.y);
}

function traceSupportForFile(info, traceType) {
    if (!info) return false;
    return traceType === 'delta' ? !!info.has_delta_f : !!info.has_traces;
}

function traceExclusionMessage(groups, traceType) {
    const excluded = [];
    for (const fileIds of Object.values(groups)) {
        for (const fid of fileIds) {
            const info = state.files.get(fid);
            if (!info || traceSupportForFile(info, traceType)) continue;
            const reason = (Array.isArray(info.warnings) && info.warnings.length)
                ? info.warnings[0]
                : traceType === 'delta'
                    ? 'DeltaF traces are unavailable for this file'
                    : 'Raw traces are unavailable for this file';
            excluded.push(`${info.file_name}: ${reason}`);
        }
    }
    if (!excluded.length) return '';
    return `Trace plot exclusions. ${excluded.join('; ')}.`;
}

export function scheduleRefresh(buildGroups) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshCurrentTab(buildGroups), 280);
}

export async function refreshCurrentTab(buildGroups) {
    const epoch = ++refreshEpoch;
    const groups = buildGroups();
    if (!hasGroups(groups)) {
        updateMetricTabVisibility(null);
        updateTraceExclusionNotice('');
        showPlaceholder('Assign a condition name to at least one file to generate plots.');
        return;
    }

    setStatus('Updating…');

    try {
        const metricsData = await fetchMetrics(groups);
        if (epoch !== refreshEpoch) return;
        updateMetricTabVisibility(metricsData);

        if (!isTabVisible(state.currentTab)) {
            setActiveTab(firstVisibleTab() || 'raw');
        }

        updateFormatPanelContext();
        hidePlaceholder();
        showPane(`pane-${state.currentTab}`);

        if (state.currentTab === 'delta' || state.currentTab === 'raw') {
            const traceType = state.currentTab === 'delta' ? 'delta' : 'raw';
            const data = await fetchTraces(groups, traceType);
            if (epoch !== refreshEpoch) return;
            updateTraceExclusionNotice(traceExclusionMessage(groups, traceType));
            if (!Object.keys(data).length) {
                showNoDataMessage(`pane-${state.currentTab}`, 'No trace data found in the loaded files.');
            } else {
                renderTraceTab(data, epoch);
            }
        } else {
            updateTraceExclusionNotice('');
            renderMetricTab(metricsData, epoch);
        }

        updateReplicateLegend();
        setStatus('');
    } catch (err) {
        if (epoch !== refreshEpoch) return;
        setStatus(`Error: ${err.message}`);
    }
}
