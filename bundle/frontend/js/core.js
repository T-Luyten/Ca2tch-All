import { plotColor, plotTheme } from './theme.js';
import {
    BASE_LAYOUT,
    COND_COLORS,
    dayColorForKey,
    dayKey,
    daySymbolForKey,
    METRIC_META,
    METRIC_TAB_MAP,
    PALETTES,
    REPLICATE_COLORS,
    REPLICATE_SYMBOLS,
    state,
    sortedDayKeys,
} from './state.js';
import { getDom } from './dom.js';
import {
    finiteValues,
    summarize,
} from './stats.js';

export function slugifyFilename(text) {
    return String(text || 'plot')
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'plot';
}

export function plotTitleToFilename(gd) {
    return slugifyFilename(gd?.layout?.title?.text || 'multi-analysis-plot');
}

export function setActiveTab(tab) {
    state.currentTab = tab;
    const { tabButtons } = getDom();
    tabButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    updateStyleBarVisibility(tab);
}

export function activePalette() {
    return PALETTES[state.condPalette] || PALETTES.default;
}

export function assignColor(condition) {
    if (!state.condColorMap[condition]) {
        const palette = activePalette();
        const used = Object.values(state.condColorMap);
        const next = palette.find(color => !used.includes(color)) || palette[used.length % palette.length];
        state.condColorMap[condition] = next;
    }
    return state.condColorMap[condition];
}

export function applyPalette() {
    const palette = activePalette();
    const conditions = [...new Set([...state.files.values()].map(f => f.condition).filter(Boolean))];
    state.condColorMap = {};
    conditions.forEach((cond, i) => {
        state.condColorMap[cond] = palette[i % palette.length];
    });
}

export function condColor(condition) {
    return plotColor(state.condColorMap[condition] || '#4c8cff');
}

export function setConditionColor(condition, color) {
    if (!condition || !/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
    state.condColorMap[condition] = color;
}

export function resetConditionColor(condition) {
    if (!condition) return;
    delete state.condColorMap[condition];
    assignColor(condition);
}

export function replicateColor(index) {
    return plotColor(REPLICATE_COLORS[index % REPLICATE_COLORS.length]);
}

export function replicateSymbol(index) {
    return REPLICATE_SYMBOLS[index % REPLICATE_SYMBOLS.length];
}

export function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function buildGroups() {
    const groups = {};
    for (const [fid, info] of state.files) {
        if (!info.condition) continue;
        if (!groups[info.condition]) groups[info.condition] = [];
        groups[info.condition].push(fid);
    }
    return groups;
}

export function hasDayMetadata() {
    return [...state.files.values()].some(f => {
        const key = dayKey(f.day);
        return key && key !== 'unspecified';
    });
}

export function hasGroups(groups = null) {
    const resolved = groups || buildGroups();
    return Object.keys(resolved).length > 0;
}

export function errorLabel() {
    if (state.controls.errorBars === 'sd') return 'SD';
    if (state.controls.errorBars === 'ci') return '95% CI';
    if (state.controls.errorBars === 'none') return 'No Error Bar';
    return 'SEM';
}

export function parseRange(minKey, maxKey) {
    const minVal = state.controls[minKey] === '' ? null : Number(state.controls[minKey]);
    const maxVal = state.controls[maxKey] === '' ? null : Number(state.controls[maxKey]);
    const minOk = Number.isFinite(minVal);
    const maxOk = Number.isFinite(maxVal);
    if (!minOk && !maxOk) return null;
    return {
        min: minOk ? minVal : null,
        max: maxOk ? maxVal : null,
    };
}

export function parseAxisRange() {
    return parseRange('yMin', 'yMax');
}

export function xAxisTickAngle() {
    const raw = state.controls.xAxisTickAngle;
    if (raw === true) return 45;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
}

export function showConditionLegendInPlot() {
    return !!state.controls.showConditionLegend;
}

export function showReplicateLegendInPlot() {
    return !!state.controls.showReplicateLegend;
}

export function buildGroupsEnteredOrder() {
    return Object.keys(buildGroups());
}

export function metricAdvertised(metric) {
    return [...state.files.values()].some(info => (info.available_metrics || []).includes(metric));
}

export function metricHasNonZeroData(metricsData, metric) {
    for (const condMetrics of Object.values(metricsData || {})) {
        const metricData = condMetrics?.[metric];
        for (const file of metricData?.files || []) {
            for (const value of file.values || []) {
                const num = Number(value);
                if (Number.isFinite(num) && Math.abs(num) > 1e-12) return true;
            }
        }
    }
    return false;
}

export function maxMetricReplicates(metricData) {
    return Math.max(0, ...Object.values(metricData || {}).map(cond => (cond?.files || []).length));
}

export function maxTraceReplicates(traceData) {
    return Math.max(0, ...Object.values(traceData || {}).map(cond => (cond?.files || []).length));
}

export function setTabVisible(tab, visible) {
    const btn = getDom().tabButtons.find(candidate => candidate.dataset.tab === tab);
    if (btn) btn.style.display = visible ? '' : 'none';
}

export function isTabVisible(tab) {
    const btn = getDom().tabButtons.find(candidate => candidate.dataset.tab === tab);
    return !!btn && btn.style.display !== 'none';
}

export function firstVisibleTab() {
    return getDom().tabButtons.find(btn => btn.style.display !== 'none')?.dataset.tab || null;
}

export function isTraceTab(tab = state.currentTab) {
    return tab === 'raw' || tab === 'delta';
}

function fileSignalMode(file) {
    if (file?.signal_mode === 'ratio' || file?.signal_mode === 'fluorescence') {
        return file.signal_mode;
    }
    return String(file?.analysis_mode || '').toLowerCase().includes('ratio') ? 'ratio' : 'fluorescence';
}

export function currentSignalMode() {
    const files = [...state.files.values()];
    if (!files.length) return 'fluorescence';
    const modes = new Set(files.map(fileSignalMode));
    if (modes.size === 1) {
        return modes.has('ratio') ? 'ratio' : 'fluorescence';
    }
    return 'mixed';
}

export function currentDeltaLabel({ spaced = true } = {}) {
    if (currentSignalMode() === 'ratio') {
        return spaced ? 'ΔR / R₀' : 'ΔR/R₀';
    }
    if (currentSignalMode() === 'mixed') {
        return spaced ? 'ΔF / F₀ or ΔR / R₀' : 'ΔF/F₀ or ΔR/R₀';
    }
    return spaced ? 'ΔF / F₀' : 'ΔF/F₀';
}

export function currentRawLabel({ spaced = true, withUnits = false } = {}) {
    if (currentSignalMode() === 'ratio') {
        return spaced ? 'Raw R / R₀' : 'Raw R/R₀';
    }
    if (currentSignalMode() === 'mixed') {
        return spaced ? 'Raw F or Raw R / R₀' : 'Raw F or Raw R/R₀';
    }
    return withUnits ? 'Raw F (a.u.)' : 'Raw F';
}

export function resolveMetricMeta(metric) {
    const meta = METRIC_META[metric] || { label: metric, unit: '' };
    const mode = currentSignalMode();
    let unit = meta.unit || '';
    if (mode === 'ratio') {
        unit = unit.replaceAll('ΔF/F₀', 'ΔR/R₀');
    } else if (mode === 'mixed') {
        unit = unit.replaceAll('ΔF/F₀', 'ΔF/F₀ or ΔR/R₀');
    }
    return {
        ...meta,
        unit,
    };
}

function metricKeyForTab(tab = state.currentTab) {
    return METRIC_TAB_MAP[tab] || tab;
}

export function defaultPlotLabels(tab = state.currentTab) {
    const traceErrorVisible = state.controls.errorBars !== 'none'
        && (state.controls.showTraceErrorBand !== false || state.controls.showTraceErrorBounds === true);
    const traceSummaryLabel = `${state.controls.summaryStat}${traceErrorVisible ? ` ± ${errorLabel()}` : ''}`;
    if (tab === 'delta') {
        return {
            title: `${currentDeltaLabel()} — ${traceSummaryLabel}`,
            x: 'Time (s)',
            y: currentDeltaLabel(),
        };
    }
    if (tab === 'raw') {
        return {
            title: `${currentRawLabel()} — ${traceSummaryLabel}`,
            x: 'Time (s)',
            y: currentRawLabel({ withUnits: true }),
        };
    }
    const meta = resolveMetricMeta(metricKeyForTab(tab));
    return {
        title: meta.label,
        x: state.controls.rotate ? (meta.unit ? `${meta.label} (${meta.unit})` : meta.label) : '',
        y: state.controls.rotate ? '' : (meta.unit ? `${meta.label} (${meta.unit})` : meta.label),
    };
}

export function plotLabels(tab = state.currentTab) {
    const defaults = defaultPlotLabels(tab);
    const overrides = state.labelOverrides?.[tab] || {};
    return {
        title: String(overrides.title || '').trim() || defaults.title,
        x: String(overrides.x || '').trim() || defaults.x,
        y: String(overrides.y || '').trim() || defaults.y,
    };
}

export function updateLabelOverrideInputs(tab = state.currentTab) {
    const { byId } = getDom();
    const overrides = state.labelOverrides?.[tab] || {};
    const defaults = defaultPlotLabels(tab);
    if (byId.plotTitleOverride) byId.plotTitleOverride.value = overrides.title || '';
    if (byId.xLabelOverride) byId.xLabelOverride.value = overrides.x || '';
    if (byId.yLabelOverride) byId.yLabelOverride.value = overrides.y || '';
    if (byId.plotTitleOverride) byId.plotTitleOverride.placeholder = defaults.title || 'Auto';
    if (byId.xLabelOverride) byId.xLabelOverride.placeholder = defaults.x || '(none)';
    if (byId.yLabelOverride) byId.yLabelOverride.placeholder = defaults.y || '(none)';
}

export function setLabelOverride(axis, value, tab = state.currentTab) {
    if (!['title', 'x', 'y'].includes(axis)) return;
    const clean = String(value || '').trim();
    const current = { ...(state.labelOverrides[tab] || {}) };
    if (clean) {
        current[axis] = clean;
    } else {
        delete current[axis];
    }
    if (Object.keys(current).length) {
        state.labelOverrides[tab] = current;
    } else {
        delete state.labelOverrides[tab];
    }
}

export function resetLabelOverrides(tab = state.currentTab) {
    delete state.labelOverrides[tab];
    updateLabelOverrideInputs(tab);
}

export function updateTraceTabLabels() {
    const tabButtons = getDom().tabButtons;
    const rawTab = tabButtons.find(btn => btn.dataset.tab === 'raw');
    const deltaTab = tabButtons.find(btn => btn.dataset.tab === 'delta');
    if (rawTab) rawTab.textContent = currentRawLabel({ withUnits: false });
    if (deltaTab) deltaTab.textContent = currentDeltaLabel();
}

export function updateStyleBarVisibility(tab = state.currentTab) {
    const styleBar = getDom().byId.styleBar;
    if (!styleBar) return;
    styleBar.hidden = isTraceTab(tab);
    styleBar.style.display = isTraceTab(tab) ? 'none' : 'flex';
    if (document.body) {
        document.body.dataset.activeTab = tab;
    }
}

export function updateFormatPanelContext() {
    const traceTab = isTraceTab();
    const { byId, xRangeSections } = getDom();
    updateTraceTabLabels();
    updateLabelOverrideInputs();
    updateStyleBarVisibility();
    xRangeSections.forEach(el => {
        el.style.display = traceTab ? '' : 'none';
    });
    const note = byId.formatContextNote;
    if (note) {
        note.textContent = traceTab
            ? 'Trace graphs support both X and Y range controls.'
            : 'Metric graphs use Y range only. X range does not apply on this tab.';
    }
}

function metricLabelForTab(tab) {
    const key = METRIC_TAB_MAP[tab];
    return METRIC_META[key]?.label
        || (key ? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : tab);
}

export function updateHiddenMetricsNotice(hiddenInfo) {
    const note = getDom().byId.hiddenMetricsNote;
    if (!note) return;
    const unavailableTabs = hiddenInfo?.unavailable || [];
    const zeroOnlyTabs = hiddenInfo?.zeroOnly || [];
    if (!unavailableTabs.length && !zeroOnlyTabs.length) {
        note.style.display = 'none';
        note.textContent = '';
        return;
    }
    const messages = [];
    if (unavailableTabs.length) {
        messages.push(`Unavailable in loaded files: ${unavailableTabs.map(metricLabelForTab).join(', ')}`);
    }
    if (zeroOnlyTabs.length) {
        messages.push(`All values are zero: ${zeroOnlyTabs.map(metricLabelForTab).join(', ')}`);
    }
    note.textContent = `Hidden metric tabs. ${messages.join('. ')}.`;
    note.style.display = '';
}

export function updateTraceExclusionNotice(message) {
    const note = getDom().byId.traceExclusionNote;
    if (!note) return;
    if (!message) {
        note.style.display = 'none';
        note.textContent = '';
        return;
    }
    note.textContent = message;
    note.style.display = '';
}

export function updateMetricTabVisibility(metricsData) {
    const hiddenInfo = {
        unavailable: [],
        zeroOnly: [],
    };
    Object.entries(METRIC_TAB_MAP).forEach(([tab, metric]) => {
        const advertised = metricAdvertised(metric);
        let visible = advertised;
        if (advertised && metricsData) {
            visible = metricHasNonZeroData(metricsData, metric);
        }
        setTabVisible(tab, visible);
        if (!visible) {
            if (!advertised) {
                hiddenInfo.unavailable.push(tab);
            } else {
                hiddenInfo.zeroOnly.push(tab);
            }
        }
    });
    updateHiddenMetricsNotice(hiddenInfo);
}

export function currentConditionNames() {
    return [...new Set([...state.files.values()].map(file => file.condition).filter(Boolean))];
}

export function syncManualConditionOrder() {
    const current = currentConditionNames();
    const kept = state.manualConditionOrder.filter(cond => current.includes(cond));
    const missing = current.filter(cond => !kept.includes(cond));
    state.manualConditionOrder = [...kept, ...missing];
    return state.manualConditionOrder;
}

export function manualConditionRank(condition) {
    const order = syncManualConditionOrder();
    const index = order.indexOf(condition);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

export function moveManualCondition(condition, direction) {
    const order = [...syncManualConditionOrder()];
    const index = order.indexOf(condition);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    state.manualConditionOrder = order;
}

export function sortConditions(conditionNames, getValue) {
    const order = state.controls.conditionOrder;
    if (order === 'manual') {
        return [...conditionNames].sort((a, b) => manualConditionRank(a) - manualConditionRank(b));
    }
    if (order === 'alpha') return [...conditionNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (order === 'summary') {
        return [...conditionNames].sort((a, b) => getValue(a) - getValue(b));
    }
    const entered = buildGroupsEnteredOrder();
    return [...conditionNames].sort((a, b) => entered.indexOf(a) - entered.indexOf(b));
}

export function orderedMetricConditions(metricData) {
    const names = Object.keys(metricData).filter(isConditionVisible);
    return sortConditions(names, cond => metricData[cond]?.condition_summary ?? 0);
}

export function orderedTraceConditions(traceData) {
    const names = Object.keys(traceData).filter(isConditionVisible);
    return sortConditions(names, cond => {
        const values = traceData[cond]?.condition_summary || [];
        return values.length ? summarize(values, 'mean') : 0;
    });
}

export function enrichMetricData(metric, metricsData) {
    // View-only: per-file summaries, outlier flags, and condition
    // summary/error are computed by the backend; only reshape here.
    const enriched = {};
    for (const [cond, condMetrics] of Object.entries(metricsData)) {
        const raw = condMetrics?.[metric];
        if (!raw) continue;
        const files = (raw.files || []).map((file, replicateIndex) => {
            const values = finiteValues(file.values);
            const backendSummary = Number(file.summary);
            return {
                ...file,
                values,
                replicate_index: replicateIndex,
                summary: Number.isFinite(backendSummary)
                    ? backendSummary
                    : (values.length ? summarize(values, state.controls.summaryStat) : 0),
                isOutlier: !!file.is_outlier,
            };
        }).filter(file => file.values.length);

        const nExcluded = files.filter(file => file.isOutlier).length;
        enriched[cond] = {
            files,
            n_files: Number.isFinite(Number(raw.n_files)) ? Number(raw.n_files) : files.length,
            n_included: files.length - nExcluded,
            n_excluded: nExcluded,
            condition_summary: Number(raw.condition_summary ?? raw.condition_mean ?? 0),
            condition_error: Number(raw.condition_error ?? raw.condition_sem ?? 0),
        };
    }
    return enriched;
}

export function enrichTraceData(tracesData) {
    // View-only: the backend aligns every file to the shared time_s grid and
    // supplies per-frame condition_summary/condition_error; do not truncate
    // or recompute here.
    const enriched = {};
    for (const [cond, data] of Object.entries(tracesData)) {
        const files = (data.files || []).map((file, replicateIndex) => ({
            ...file,
            replicate_index: replicateIndex,
            // Keep alignment with time_s; NaN/inf become gaps rather than shifting points in time.
            mean: (file.mean || []).map(value => Number(value)),
        })).filter(file => file.mean.length);
        if (!files.length) continue;
        const timeS = (data.time_s || []).map(Number);
        const summary = Array.isArray(data.condition_summary) && data.condition_summary.length
            ? data.condition_summary.map(Number)
            : (Array.isArray(data.condition_mean) ? data.condition_mean.map(Number) : []);
        const error = Array.isArray(data.condition_error) && data.condition_error.length
            ? data.condition_error.map(Number)
            : (Array.isArray(data.condition_sem) ? data.condition_sem.map(Number) : timeS.map(() => 0));
        enriched[cond] = {
            time_s: timeS,
            files,
            pool_by_day: !!data.pool_by_day,
            n_source_files: data.n_source_files,
            n_files: Number.isFinite(Number(data.n_files)) ? Number(data.n_files) : files.length,
            condition_summary: summary,
            condition_error: error,
        };
    }
    return enriched;
}

export function pointCoords(catPos, value) {
    return state.controls.rotate ? { x: value, y: catPos } : { x: catPos, y: value };
}

export function arrayCoords(catVals, valueVals) {
    return state.controls.rotate ? { x: valueVals, y: catVals } : { x: catVals, y: valueVals };
}

export function axisStyle({ showGrid = true, categorical = false } = {}) {
    return {
        color: plotTheme().text,
        gridcolor: plotTheme().grid,
        zerolinecolor: plotTheme().zero,
        linecolor: plotTheme().axis,
        showgrid: showGrid,
        zeroline: showGrid && !categorical,
        showline: showGrid,
    };
}

export function layoutFontFamily() {
    return state.controls.fontFamily || 'system-ui, sans-serif';
}

function dayKeyForFile(file) {
    // Match by file_id only: duplicate filenames are allowed and must not
    // cross-map days between files. Pooled same-day units are not in
    // state.files, so fall back to the backend-provided day on the payload.
    const fileInfo = state.files.get(file.file_id);
    if (fileInfo?.day) return dayKey(fileInfo.day);
    return file?.day ? dayKey(file.day) : '';
}

export function dayColorForFile(file) {
    if (!state.groupByDay || !hasDayMetadata()) return null;
    return dayColorForKey(dayKeyForFile(file));
}

export function daySymbolForFile(file) {
    if (!state.groupByDay || !hasDayMetadata()) return null;
    return daySymbolForKey(dayKeyForFile(file));
}

export function buildBaseLayout() {
    return {
        ...BASE_LAYOUT,
        paper_bgcolor: plotTheme().background,
        plot_bgcolor: plotTheme().background,
        xaxis: { ...BASE_LAYOUT.xaxis, ...axisStyle() },
        yaxis: { ...BASE_LAYOUT.yaxis, ...axisStyle() },
        hoverlabel: { bgcolor: plotTheme().background, bordercolor: plotTheme().axis, font: { color: plotTheme().text } },
        modebar: { bgcolor: 'rgba(0,0,0,0)', color: plotTheme().muted, activecolor: plotTheme().text },
        font: {
            ...BASE_LAYOUT.font,
            color: plotTheme().text,
            family: layoutFontFamily(),
        },
        legend: {
            ...BASE_LAYOUT.legend,
            font: {
                family: layoutFontFamily(),
                size: state.controls.legendFontSize,
                color: plotTheme().text,
            },
        },
    };
}

export function resizeVisiblePlots() {
    if (!window.Plotly) return;
    const plots = document.querySelectorAll('.plot-div, .summary-effect-plot');
    for (const div of plots) {
        if (div.data && div.getClientRects().length && div.clientWidth > 0) {
            window.Plotly.Plots.resize(div);
        }
    }
}

export function applyWarningVisibility() {
    const visible = state.controls.showWarnings !== false;
    document.body.dataset.showWarnings = String(visible);
    const toggle = document.getElementById('warnings-toggle');
    if (toggle) toggle.checked = visible;
}

export function isConditionVisible(condition) {
    return !state.hiddenConditions.includes(condition);
}

export function visibleConditionData(data) {
    return Object.fromEntries(Object.entries(data).filter(([condition]) => isConditionVisible(condition)));
}

export function plottedDayKeys(data) {
    const days = new Set(Object.values(visibleConditionData(data)).flatMap(condition =>
        (condition.files || []).map(file => dayKeyForFile(file))).filter(Boolean));
    return sortedDayKeys().filter(key => days.has(key));
}

export function conditionVisibilityMessage() {
    return currentConditionNames().some(isConditionVisible)
        ? 'No data for the visible conditions in this plot.'
        : 'All conditions are hidden. Select a condition in Plot formatting.';
}
