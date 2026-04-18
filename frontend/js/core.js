import {
    BASE_LAYOUT,
    COND_COLORS,
    METRIC_META,
    METRIC_TAB_MAP,
    REPLICATE_COLORS,
    REPLICATE_SYMBOLS,
    state,
} from './state.js';
import { getDom } from './dom.js';
import {
    errorForValues,
    errorPerFrame,
    finiteValues,
    summarize,
    summarizePerFrame,
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

export function assignColor(condition) {
    if (!state.condColorMap[condition]) {
        const used = Object.values(state.condColorMap);
        const next = COND_COLORS.find(color => !used.includes(color)) || COND_COLORS[used.length % COND_COLORS.length];
        state.condColorMap[condition] = next;
    }
    return state.condColorMap[condition];
}

export function condColor(condition) {
    return state.condColorMap[condition] || '#4c8cff';
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
    return REPLICATE_COLORS[index % REPLICATE_COLORS.length];
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

export function hasGroups() {
    return Object.keys(buildGroups()).length > 0;
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
    if (Number.isFinite(minVal) && Number.isFinite(maxVal)) return [minVal, maxVal];
    return null;
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
    if (tab === 'delta') {
        return {
            title: `${currentDeltaLabel()} — ${state.controls.summaryStat} ± ${errorLabel()}`,
            x: 'Time (s)',
            y: currentDeltaLabel(),
        };
    }
    if (tab === 'raw') {
        return {
            title: `${currentRawLabel()} — ${state.controls.summaryStat} ± ${errorLabel()}`,
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
    return METRIC_META[METRIC_TAB_MAP[tab]]?.label || tab;
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
    const names = Object.keys(metricData);
    return sortConditions(names, cond => metricData[cond]?.condition_summary ?? 0);
}

export function orderedTraceConditions(traceData) {
    const names = Object.keys(traceData);
    return sortConditions(names, cond => {
        const values = traceData[cond]?.condition_summary || [];
        return values.length ? summarize(values, 'mean') : 0;
    });
}

export function enrichMetricData(metric, metricsData) {
    const enriched = {};
    for (const [cond, condMetrics] of Object.entries(metricsData)) {
        const raw = condMetrics?.[metric];
        if (!raw) continue;
        const files = (raw.files || []).map((file, replicateIndex) => {
            const values = finiteValues(file.values);
            return {
                ...file,
                values,
                replicate_index: replicateIndex,
                summary: values.length ? summarize(values, state.controls.summaryStat) : 0,
            };
        }).filter(file => file.values.length);

        const summaries = files.map(file => file.summary);
        enriched[cond] = {
            files,
            n_files: files.length,
            condition_summary: summaries.length ? summarize(summaries, state.controls.summaryStat) : 0,
            condition_error: errorForValues(summaries, state.controls.errorBars),
        };
    }
    return enriched;
}

export function enrichTraceData(tracesData) {
    const enriched = {};
    for (const [cond, data] of Object.entries(tracesData)) {
        const files = (data.files || []).map((file, replicateIndex) => ({
            ...file,
            replicate_index: replicateIndex,
            mean: finiteValues(file.mean),
        })).filter(file => file.mean.length);
        if (!files.length) continue;
        const nFrames = Math.min(...files.map(file => file.mean.length), (data.time_s || []).length);
        const trimmedFiles = files.map(file => ({ ...file, mean: file.mean.slice(0, nFrames) }));
        const fileSeries = trimmedFiles.map(file => file.mean);
        enriched[cond] = {
            time_s: (data.time_s || []).slice(0, nFrames),
            files: trimmedFiles,
            n_files: trimmedFiles.length,
            condition_summary: summarizePerFrame(fileSeries, state.controls.summaryStat),
            condition_error: errorPerFrame(fileSeries, state.controls.errorBars),
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
        gridcolor: '#e3ebf5',
        zerolinecolor: '#d2ddeb',
        linecolor: '#c6d3e3',
        showgrid: showGrid,
        zeroline: showGrid && !categorical,
        showline: showGrid,
    };
}

export function layoutFontFamily() {
    return state.controls.fontFamily || 'system-ui, sans-serif';
}

export function buildBaseLayout() {
    return {
        ...BASE_LAYOUT,
        font: {
            ...BASE_LAYOUT.font,
            family: layoutFontFamily(),
        },
        legend: {
            ...BASE_LAYOUT.legend,
            font: {
                family: layoutFontFamily(),
                size: state.controls.legendFontSize,
            },
        },
    };
}
