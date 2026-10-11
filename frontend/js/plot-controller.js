import { fetchMetrics, fetchPairwiseStats, fetchSummaryStats, fetchTraces } from './api.js';
import {
    buildGroups,
    orderedMetricConditions,
    orderedTraceConditions,
    conditionVisibilityMessage,
    firstVisibleTab,
    hasGroups,
    isTabVisible,
    plotLabels,
    resizeVisiblePlots,
    setActiveTab,
    updateTraceExclusionNotice,
    updateFormatPanelContext,
    updateMetricTabVisibility,
} from './core.js';
import {
    getDom,
    escapeHtml,
    hidePlaceholder,
    restorePane,
    setStatus,
    showNoDataMessage,
    showPane,
    showPlaceholder,
    updateReplicateLegend,
} from './dom.js';
import { addSignificanceAnnotations, renderMetricChart } from './metric-renderers.js';
import { persistPreferences } from './preferences.js';
import { normalizeDay, state } from './state.js';
import { clearSummaryPanel, renderSummaryPanel, renderSummaryPanelError } from './summary-panel.js';
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

export function registerDynamicMetricTarget(metric, plotId) {
    METRIC_PLOT_TARGETS[metric] = [plotId, metric];
}

let refreshEpoch = 0;

export function invalidatePendingRefresh() {
    ++refreshEpoch;
    clearTimeout(state.refreshTimer);
}

function renderStatsTable(stats, enrichedMetricsData = null) {
    const statsPanel = document.getElementById('stats-panel');
    const statsContent = document.getElementById('stats-content');
    const statsIcon = document.getElementById('stats-toggle-icon');
    if (!statsPanel || !statsContent) return;

    if (!state.controls.showSignificance || !stats) {
        const button = document.getElementById('stats-header');
        if (button) { button.disabled = true; button.setAttribute('aria-expanded', 'false'); }
        statsPanel.style.display = 'none';
        statsContent.innerHTML = '';
        statsContent.style.display = 'none';
        return;
    }

    let html = '';

    // Outlier summary
    if (enrichedMetricsData && state.controls.excludeOutliers) {
        let totalExcluded = 0;
        let totalFiles = 0;
        const outlierDetails = [];
        for (const [cond, data] of Object.entries(enrichedMetricsData)) {
            totalFiles += data.n_files || 0;
            totalExcluded += data.n_excluded || 0;
            const names = (data.files || []).filter(f => f.isOutlier).map(f => escapeHtml(f.file_name));
            if (names.length) outlierDetails.push(`<b>${escapeHtml(cond)}</b>: ${names.join(', ')}`);
        }
        if (totalExcluded > 0) {
            const methodName = state.controls.outlierMethod === 'modified_zscore' ? 'Modified Z-score' : 'IQR';
            html += `<div class="anova-row" style="color:#666;">${methodName}: ${totalExcluded} file${totalExcluded > 1 ? 's' : ''} excluded out of ${totalFiles}</div>`;
            html += `<div style="font-size:11px;color:#888;margin-bottom:8px;">${outlierDetails.join('; ')}</div>`;
        }
    }

    if (stats.anova_significant !== undefined) {
        const sigClass = stats.anova_significant ? 'sig-true' : 'sig-false';
        const sigText = stats.anova_significant ? 'significant' : 'not significant';
        html += `<div class="anova-row">One-way ANOVA: F = ${stats.anova_f.toFixed(2)}, p = ${stats.anova_p < 0.001 ? '< 0.001' : stats.anova_p.toFixed(3)} (<span class="${sigClass}">${sigText}</span>)</div>`;
    }

    const twoway = stats.twoway_anova;
    if (twoway && twoway.length) {
        html += '<table><thead><tr><th>Source</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p</th></tr></thead><tbody>';
        for (const row of twoway) {
            const sigClass = row.significant ? 'sig-true' : 'sig-false';
            html += `<tr>
                <td>${escapeHtml(row.source)}</td>
                <td>${row.ss != null ? row.ss.toFixed(3) : '—'}</td>
                <td>${row.df != null ? row.df.toFixed(1) : '—'}</td>
                <td>${row.ms != null ? row.ms.toFixed(3) : '—'}</td>
                <td>${row.f_statistic != null && row.f_statistic > 0 ? row.f_statistic.toFixed(2) : '—'}</td>
                <td class="${sigClass}">${row.p_value != null ? (row.p_value < 0.001 ? '< 0.001' : row.p_value.toFixed(3)) : '—'}</td>
            </tr>`;
        }
        html += '</tbody></table>';
    }

    const comparisons = stats.comparisons || [];
    if (comparisons.length) {
        html += '<table><thead><tr><th>Comparison</th><th>Test</th><th>Raw p</th><th>Corrected p</th><th>Result</th></tr></thead><tbody>';
        for (const c of comparisons) {
            const sigClass = c.significant ? 'sig-true' : 'sig-false';
            html += `<tr>
                <td>${escapeHtml(c.condition_a)} vs ${escapeHtml(c.condition_b)}</td>
                <td>${escapeHtml(c.test_used || 't-test')}</td>
                <td>${c.p_value < 0.001 ? '< 0.001' : c.p_value.toFixed(3)}</td>
                <td>${c.p_corrected < 0.001 ? '< 0.001' : c.p_corrected.toFixed(3)}</td>
                <td class="${sigClass}">${escapeHtml(c.stars)}</td>
            </tr>`;
        }
        html += '</tbody></table>';
    }

    statsContent.innerHTML = html;
    statsPanel.style.display = state.controls.statsPanelOpen ? 'block' : 'none';
    const statsButton = document.getElementById('stats-header');
    if (statsButton) statsButton.disabled = false;
    statsContent.style.display = state.controls.statsPanelOpen ? 'block' : 'none';
    if (statsIcon) statsIcon.textContent = state.controls.statsPanelOpen ? '−' : '+';
    document.getElementById('stats-header')?.setAttribute('aria-expanded', String(!!state.controls.statsPanelOpen));
    requestAnimationFrame(resizeVisiblePlots);
}

function clearStatsTable() {
    const button = document.getElementById('stats-header');
    if (button) { button.disabled = true; button.setAttribute('aria-expanded', 'false'); }
    const statsPanel = document.getElementById('stats-panel');
    const statsContent = document.getElementById('stats-content');
    if (statsPanel) statsPanel.style.display = 'none';
    if (statsContent) {
        statsContent.innerHTML = '';
        statsContent.style.display = 'none';
    }
    requestAnimationFrame(resizeVisiblePlots);
}

function collectFileDays() {
    const fileDays = {};
    for (const [fid, info] of state.files) {
        const day = normalizeDay(info.day).label;
        if (day) fileDays[fid] = day;
    }
    return fileDays;
}

async function refreshSummaryPanel(metric, groups, fileDays, excludedFileIds, epoch) {
    try {
        // The persisted reference condition may belong to a previous session's
        // data; only send it when it exists in the current groups, else let
        // the backend default to the first condition.
        const savedReference = state.controls.summaryReferenceCondition;
        const referenceCondition = savedReference && Object.keys(groups).includes(savedReference)
            ? savedReference
            : null;
        if (savedReference && !referenceCondition) {
            state.controls.summaryReferenceCondition = '';
            persistPreferences();
        }
        const data = await fetchSummaryStats(metric, groups, {
            summaryStat: state.controls.summaryStat,
            paired: state.controls.paired,
            poolByDay: state.controls.poolByDay,
            referenceCondition,
            fileDays,
            excludedFileIds,
        });
        if (epoch !== refreshEpoch) return;
        renderSummaryPanel(data, metric, {
            onReferenceChange: () => refreshSummaryPanel(metric, groups, fileDays, excludedFileIds, refreshEpoch),
        });
    } catch (e) {
        if (epoch !== refreshEpoch) return;
        console.warn('Failed to load summary statistics:', e);
        renderSummaryPanelError(metric, e.message);
    }
}

async function renderMetricTab(metricsData, epoch) {
    if (epoch !== refreshEpoch) return;
    const target = METRIC_PLOT_TARGETS[state.currentTab];
    if (!target) {
        clearSummaryPanel();
        return;
    }
    const [containerId, metric] = target;
    restorePane(`pane-${state.currentTab}`);
    const enrichedMetricsData = renderMetricChart(containerId, metric, metricsData);

    if (!orderedMetricConditions(enrichedMetricsData).length) {
        showNoDataMessage(`pane-${state.currentTab}`, conditionVisibilityMessage());
    }
    const groups = buildGroups();
    const fileDays = collectFileDays();
    const excludedFileIds = [];
    for (const condData of Object.values(enrichedMetricsData)) {
        for (const file of condData.files || []) {
            if (file.isOutlier) excludedFileIds.push(file.file_id);
        }
    }

    if (state.controls.showSignificance) {
        try {
            const stats = await fetchPairwiseStats(metric, groups, state.controls.paired, fileDays, excludedFileIds, {
                summaryStat: state.controls.summaryStat,
                poolByDay: state.controls.poolByDay,
            });
            if (epoch !== refreshEpoch) return;
            addSignificanceAnnotations(containerId, stats.comparisons, enrichedMetricsData);
            renderStatsTable(stats, enrichedMetricsData);
        } catch (e) {
            console.warn('Failed to load significance stats:', e);
            clearStatsTable();
        }
    } else {
        clearStatsTable();
    }

    await refreshSummaryPanel(metric, groups, fileDays, excludedFileIds, epoch);
}

function renderTraceTab(data, epoch) {
    if (epoch !== refreshEpoch) return;
    restorePane(`pane-${state.currentTab}`);
    if (!orderedTraceConditions(data).length) {
        showNoDataMessage(`pane-${state.currentTab}`, conditionVisibilityMessage());
        return;
    }
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

function traceBackendWarningsMessage(traceData) {
    const warnings = [];
    for (const data of Object.values(traceData || {})) {
        for (const warning of data?.warnings || []) {
            if (warning) warnings.push(String(warning));
        }
    }
    if (!warnings.length) return '';
    return `Trace warnings. ${warnings.join('; ')}.`;
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
        clearSummaryPanel();
        showPlaceholder('Assign a condition name to at least one file to generate plots.');
        return;
    }

    setStatus('Updating…');

    try {
        const metricsData = await fetchMetrics(groups, {
            fileDays: collectFileDays(),
            poolByDay: state.controls.poolByDay,
        });
        if (epoch !== refreshEpoch) return;
        updateMetricTabVisibility(metricsData);

        if (!isTabVisible(state.currentTab)) {
            setActiveTab(firstVisibleTab() || 'raw');
        }

        updateFormatPanelContext();
        hidePlaceholder();
        showPane(`pane-${state.currentTab}`);

        if (state.currentTab === 'delta' || state.currentTab === 'raw') {
            clearStatsTable();
            clearSummaryPanel();
            const traceType = state.currentTab === 'delta' ? 'delta' : 'raw';
            const data = await fetchTraces(groups, traceType, { fileDays: collectFileDays(), poolByDay: state.controls.poolByDay });
            if (epoch !== refreshEpoch) return;
            const exclusion = traceExclusionMessage(groups, traceType);
            const backendWarnings = traceBackendWarningsMessage(data);
            updateTraceExclusionNotice([exclusion, backendWarnings].filter(Boolean).join(' '));
            if (!Object.keys(data).length) {
                showNoDataMessage(`pane-${state.currentTab}`, 'No trace data found in the loaded files.');
            } else {
                renderTraceTab(data, epoch);
            }
        } else {
            updateTraceExclusionNotice('');
            await renderMetricTab(metricsData, epoch);
        }

        updateReplicateLegend();
        setStatus('');
    } catch (err) {
        if (epoch !== refreshEpoch) return;
        setStatus(`Error: ${err.message}`);
    }
}
