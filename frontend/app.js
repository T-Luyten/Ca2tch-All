'use strict';

const MAX_FILES = 50;

const COND_COLORS = [
    '#4c8cff', '#ff6b6b', '#51cf66', '#ffd43b',
    '#cc5de8', '#ff922b', '#22d3ee', '#f06595',
    '#74c0fc', '#a9e34b', '#ff6348', '#2ed573',
];

const REPLICATE_COLORS = [
    '#4c8cff', '#ff6b6b', '#51cf66', '#ffd43b',
    '#ff922b', '#22d3ee', '#f06595', '#845ef7',
    '#20c997', '#ffa94d',
];

const REPLICATE_SYMBOLS = [
    'circle', 'square', 'diamond', 'triangle-up',
    'triangle-down', 'cross', 'x', 'pentagon',
    'hexagon', 'star',
];

const METRIC_META = {
    peak:            { label: 'Peak',                   unit: 'ΔF/F₀'     },
    auc:             { label: 'AUC',                    unit: 'ΔF/F₀ · s' },
    event_fwhm:      { label: 'Event FWHM',             unit: 's'          },
    event_frequency: { label: 'Event Frequency',        unit: 'Hz'         },
    time_to_peak:    { label: 'Time To Peak',           unit: 's'          },
    decay_t_half:    { label: 'Decay t½',               unit: 's'          },
    rate_of_rise:    { label: 'Rate Of Rise',           unit: 'ΔF/F₀ / s' },
    tg_peak:         { label: 'TG Peak',                unit: 'ΔF/F₀'     },
    tg_slope:        { label: 'TG Initial Slope',       unit: 'ΔF/F₀ / s' },
    tg_auc:          { label: 'TG AUC',                 unit: 'ΔF/F₀ · s' },
    addback_peak:    { label: 'Add-Back Peak',          unit: 'ΔF/F₀'     },
    addback_slope:   { label: 'Add-Back Initial Slope', unit: 'ΔF/F₀ / s' },
    addback_auc:     { label: 'Add-Back AUC',           unit: 'ΔF/F₀ · s' },
    addback_latency: { label: 'Add-Back Time To Peak',  unit: 's'          },
};

const BASE_LAYOUT = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { color: '#1f2937', family: 'system-ui, sans-serif', size: 12 },
    margin: { t: 44, r: 16, b: 56, l: 60 },
    xaxis: { gridcolor: '#e3ebf5', zerolinecolor: '#d2ddeb', linecolor: '#c6d3e3', showgrid: true },
    yaxis: { gridcolor: '#e3ebf5', zerolinecolor: '#d2ddeb', linecolor: '#c6d3e3', showgrid: true },
    legend: { bgcolor: 'rgba(0,0,0,0)', bordercolor: 'rgba(0,0,0,0)' },
    showlegend: true,
};

const state = {
    files: new Map(),
    currentTab: 'delta',
    plotStyle: 'violin',
    refreshTimer: null,
    condColorMap: {},
    paneTemplates: {},
    controls: {
        summaryStat: 'mean',
        errorBars: 'sem',
        pointSize: 5,
        pointAlpha: 0.45,
        meanSize: 11,
        jitter: 0.18,
        paired: false,
        replicateDist: false,
        conditionOrder: 'entered',
        logScale: false,
        yMin: '',
        yMax: '',
        rotate: false,
        showGrid: true,
    },
};

function slugifyFilename(text) {
    return String(text || 'plot')
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'plot';
}

function plotTitleToFilename(gd) {
    return slugifyFilename(gd?.layout?.title?.text || 'multi-analysis-plot');
}

function openPdfPrintView(imageUrl, title) {
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) return;
    const safeTitle = title || 'Plot';
    win.document.write(`<!doctype html><html><head><title>${safeTitle}</title><style>
        body{margin:0;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
        img{max-width:100vw;max-height:100vh}
    </style></head><body><img src="${imageUrl}" alt="${safeTitle}"></body></html>`);
    win.document.close();
    win.onload = () => win.print();
}

function getPlotlyConfig() {
    const config = {
        responsive: true,
        displaylogo: false,
        toImageButtonOptions: {
            format: 'png',
            filename: 'multi-analysis-plot',
            width: 1800,
            height: 1200,
            scale: 3,
        },
    };

    if (window.Plotly?.Icons?.camera) {
        config.modeBarButtonsToAdd = [
            {
                name: 'Download SVG',
                icon: window.Plotly.Icons.camera,
                click: gd => window.Plotly.downloadImage(gd, {
                    format: 'svg',
                    filename: plotTitleToFilename(gd),
                    width: 1800,
                    height: 1200,
                }),
            },
            {
                name: 'Print / Save PDF',
                icon: window.Plotly.Icons.disk || window.Plotly.Icons.camera,
                click: async gd => {
                    const svgUrl = await window.Plotly.toImage(gd, {
                        format: 'svg',
                        width: 1800,
                        height: 1200,
                    });
                    openPdfPrintView(svgUrl, gd?.layout?.title?.text || 'Plot');
                },
            },
        ];
    }

    return config;
}

function assignColor(condition) {
    if (!state.condColorMap[condition]) {
        const used = Object.values(state.condColorMap);
        const next = COND_COLORS.find(c => !used.includes(c)) || COND_COLORS[used.length % COND_COLORS.length];
        state.condColorMap[condition] = next;
    }
    return state.condColorMap[condition];
}

function condColor(condition) {
    return state.condColorMap[condition] || '#4c8cff';
}

function replicateColor(index) {
    return REPLICATE_COLORS[index % REPLICATE_COLORS.length];
}

function replicateSymbol(index) {
    return REPLICATE_SYMBOLS[index % REPLICATE_SYMBOLS.length];
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function buildGroups() {
    const groups = {};
    for (const [fid, info] of state.files) {
        if (!info.condition) continue;
        if (!groups[info.condition]) groups[info.condition] = [];
        groups[info.condition].push(fid);
    }
    return groups;
}

function hasGroups() {
    return Object.keys(buildGroups()).length > 0;
}

async function apiUpload(file) {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body.detail || 'Upload failed');
    }
    return resp.json();
}

async function apiDelete(fileId) {
    await fetch(`/api/file/${fileId}`, { method: 'DELETE' });
}

async function apiDeleteAll() {
    await fetch('/api/files', { method: 'DELETE' });
}

async function fetchMetrics(groups) {
    const resp = await fetch('/api/plot/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
    });
    if (!resp.ok) throw new Error('Failed to fetch metrics');
    return resp.json();
}

async function fetchTraces(groups, traceType) {
    const resp = await fetch('/api/plot/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, trace_type: traceType }),
    });
    if (!resp.ok) throw new Error('Failed to fetch traces');
    return resp.json();
}

function finiteValues(values) {
    return (values || []).map(v => Number(v)).filter(Number.isFinite);
}

function mean(values) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleSd(values) {
    if (values.length <= 1) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((sum, v) => sum + ((v - m) ** 2), 0) / (values.length - 1));
}

function summarize(values, kind = state.controls.summaryStat) {
    if (!values.length) return 0;
    return kind === 'median' ? median(values) : mean(values);
}

function summarizePerFrame(seriesList, kind = state.controls.summaryStat) {
    if (!seriesList.length) return [];
    const nFrames = Math.min(...seriesList.map(arr => arr.length));
    const out = [];
    for (let i = 0; i < nFrames; i += 1) {
        const vals = finiteValues(seriesList.map(arr => arr[i]));
        out.push(vals.length ? summarize(vals, kind) : 0);
    }
    return out;
}

function errorForValues(values, mode = state.controls.errorBars) {
    if (mode === 'none' || values.length <= 1) return 0;
    const sd = sampleSd(values);
    const sem = sd / Math.sqrt(values.length);
    if (mode === 'sd') return sd;
    if (mode === 'ci') return 1.96 * sem;
    return sem;
}

function errorPerFrame(seriesList, mode = state.controls.errorBars) {
    if (!seriesList.length || mode === 'none') return [];
    const nFrames = Math.min(...seriesList.map(arr => arr.length));
    const out = [];
    for (let i = 0; i < nFrames; i += 1) {
        const vals = finiteValues(seriesList.map(arr => arr[i]));
        out.push(errorForValues(vals, mode));
    }
    return out;
}

function errorLabel() {
    if (state.controls.errorBars === 'sd') return 'SD';
    if (state.controls.errorBars === 'ci') return '95% CI';
    if (state.controls.errorBars === 'none') return 'No Error Bar';
    return 'SEM';
}

function parseAxisRange() {
    const minVal = state.controls.yMin === '' ? null : Number(state.controls.yMin);
    const maxVal = state.controls.yMax === '' ? null : Number(state.controls.yMax);
    if (Number.isFinite(minVal) && Number.isFinite(maxVal)) return [minVal, maxVal];
    return null;
}

function buildGroupsEnteredOrder() {
    return Object.keys(buildGroups());
}

function sortConditions(conditionNames, getValue) {
    const order = state.controls.conditionOrder;
    if (order === 'alpha') return [...conditionNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (order === 'summary') {
        return [...conditionNames].sort((a, b) => getValue(a) - getValue(b));
    }
    const entered = buildGroupsEnteredOrder();
    return [...conditionNames].sort((a, b) => entered.indexOf(a) - entered.indexOf(b));
}

function orderedMetricConditions(metricData) {
    const names = Object.keys(metricData);
    return sortConditions(names, cond => metricData[cond]?.condition_summary ?? 0);
}

function orderedTraceConditions(traceData) {
    const names = Object.keys(traceData);
    return sortConditions(names, cond => {
        const vals = traceData[cond]?.condition_summary || [];
        return vals.length ? summarize(vals, 'mean') : 0;
    });
}

function enrichMetricData(metric, metricsData) {
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
                summary: values.length ? summarize(values) : 0,
            };
        }).filter(file => file.values.length);

        const summaries = files.map(file => file.summary);
        enriched[cond] = {
            files,
            n_files: files.length,
            condition_summary: summaries.length ? summarize(summaries) : 0,
            condition_error: errorForValues(summaries),
        };
    }
    return enriched;
}

function enrichTraceData(tracesData) {
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
            condition_summary: summarizePerFrame(fileSeries),
            condition_error: errorPerFrame(fileSeries),
        };
    }
    return enriched;
}

function pointCoords(catPos, value) {
    return state.controls.rotate ? { x: value, y: catPos } : { x: catPos, y: value };
}

function arrayCoords(catVals, valueVals) {
    return state.controls.rotate ? { x: valueVals, y: catVals } : { x: catVals, y: valueVals };
}

function metricLayout(meta, tickvals, ticktext, nConds) {
    const yLabel = meta.unit ? `${meta.label} (${meta.unit})` : meta.label;
    const valueAxis = {
        gridcolor: '#e3ebf5',
        zerolinecolor: '#d2ddeb',
        linecolor: '#c6d3e3',
        showgrid: state.controls.showGrid,
        type: state.controls.logScale ? 'log' : 'linear',
    };
    const range = parseAxisRange();
    if (range) valueAxis.range = state.controls.logScale ? range.map(v => Math.log10(v)) : range;

    if (state.controls.rotate) {
        return {
            ...BASE_LAYOUT,
            title: { text: meta.label, font: { size: 13 } },
            xaxis: { ...valueAxis, title: { text: yLabel, font: { size: 11 } } },
            yaxis: {
                ...BASE_LAYOUT.yaxis,
                showgrid: false,
                tickvals,
                ticktext,
                range: [-0.5, nConds - 0.5],
            },
        };
    }

    return {
        ...BASE_LAYOUT,
        title: { text: meta.label, font: { size: 13 } },
        xaxis: {
            ...BASE_LAYOUT.xaxis,
            showgrid: false,
            tickvals,
            ticktext,
            range: [-0.5, nConds - 0.5],
        },
        yaxis: { ...valueAxis, title: { text: yLabel, font: { size: 11 } } },
    };
}

function traceLayout(title, yLabel) {
    const layout = {
        ...BASE_LAYOUT,
        title: { text: title, font: { size: 13 } },
        xaxis: { ...BASE_LAYOUT.xaxis, title: { text: 'Time (s)', font: { size: 11 } }, showgrid: state.controls.showGrid },
        yaxis: { ...BASE_LAYOUT.yaxis, title: { text: yLabel, font: { size: 11 } }, showgrid: state.controls.showGrid },
    };
    const range = parseAxisRange();
    if (range) layout.yaxis.range = state.controls.logScale ? range.map(v => Math.log10(v)) : range;
    layout.yaxis.type = state.controls.logScale ? 'log' : 'linear';
    return layout;
}

function pairedLineTraces(conditions, metricData) {
    if (!state.controls.paired) return [];
    const maxReplicates = Math.max(0, ...conditions.map(cond => (metricData[cond]?.files || []).length));
    const traces = [];
    for (let ri = 0; ri < maxReplicates; ri += 1) {
        const catVals = [];
        const vals = [];
        const labels = [];
        conditions.forEach((cond, ci) => {
            const file = metricData[cond]?.files?.[ri];
            if (!file) return;
            catVals.push(ci);
            vals.push(file.summary);
            labels.push(file.file_name);
        });
        if (vals.length < 2) continue;
        const coords = arrayCoords(catVals, vals);
        traces.push({
            type: 'scatter',
            ...coords,
            mode: 'lines',
            showlegend: false,
            hoverinfo: 'skip',
            line: {
                color: hexToRgba(replicateColor(ri), 0.45),
                width: 1.4,
                dash: 'dot',
            },
        });
    }
    return traces;
}

function conditionSummaryTrace(ci, cond, data) {
    const hw = 0.14;
    const summary = data.condition_summary;
    const error = data.condition_error;
    const barCat = [ci - hw, ci + hw];
    const barVals = [summary, summary];
    const barCoords = arrayCoords(barCat, barVals);
    const traces = [{
        type: 'scatter',
        ...barCoords,
        mode: 'lines',
        legendgroup: cond,
        showlegend: false,
        hoverinfo: 'skip',
        line: { color: 'rgba(31,41,55,0.9)', width: 3 },
    }];

    if (state.controls.errorBars !== 'none' && data.n_files >= 2) {
        const coords = pointCoords(ci, summary);
        traces.push({
            type: 'scatter',
            x: [coords.x],
            y: [coords.y],
            mode: 'markers',
            legendgroup: cond,
            showlegend: false,
            hovertemplate: `${cond}<br>${state.controls.summaryStat}: ${summary.toFixed(4)}<br>${errorLabel()}: ${error.toFixed(4)}<br>(${data.n_files} experiments)<extra></extra>`,
            error_y: state.controls.rotate ? undefined : {
                type: 'data',
                array: [error],
                color: 'rgba(31,41,55,0.9)',
                thickness: 2.5,
                width: 8,
            },
            error_x: state.controls.rotate ? {
                type: 'data',
                array: [error],
                color: 'rgba(31,41,55,0.9)',
                thickness: 2.5,
                width: 8,
            } : undefined,
            marker: { size: 1, color: 'rgba(0,0,0,0)' },
        });
    }

    return traces;
}

function replicateMeanTrace(ci, cond, data, showLegend) {
    const files = data.files || [];
    const width = state.controls.jitter;
    const catPos = files.map((_, fi) => files.length <= 1 ? ci : ci + ((fi / (files.length - 1)) - 0.5) * width);
    const vals = files.map(file => file.summary);
    const coords = arrayCoords(catPos, vals);
    return {
        type: 'scatter',
        ...coords,
        customdata: files.map(file => [file.file_name, file.values.length, file.summary]),
        mode: 'markers',
        legendgroup: cond,
        showlegend: !!showLegend,
        name: cond,
        hovertemplate: '%{customdata[0]}<br>Replicate summary: %{customdata[1]} ROIs<br>Value: %{customdata[2]:.4f}<extra></extra>',
        marker: {
            size: state.controls.meanSize,
            color: files.map(file => replicateColor(file.replicate_index)),
            line: { color: '#0d1b35', width: 1.5 },
            symbol: files.map(file => replicateSymbol(file.replicate_index)),
        },
    };
}

function replicateRoiTraces(ci, cond, data, metricLabel) {
    const traces = [];
    const width = state.controls.jitter;
    const roiSpread = Math.max(0.04, Math.min(width * 0.85, 0.16));
    for (const file of data.files || []) {
        const vals = file.values || [];
        if (!vals.length) continue;
        const center = data.files.length <= 1
            ? ci
            : ci + ((file.replicate_index / (data.files.length - 1)) - 0.5) * width;
        const catVals = vals.map((_, i) => vals.length <= 1 ? center : center + ((i / (vals.length - 1)) - 0.5) * roiSpread);
        const coords = arrayCoords(catVals, vals);
        traces.push({
            type: 'scatter',
            ...coords,
            mode: 'markers',
            legendgroup: cond,
            showlegend: false,
            customdata: vals.map(v => [file.file_name, v]),
            hovertemplate: '%{customdata[0]}<br>' + `${metricLabel}: %{customdata[1]:.4f}<extra></extra>`,
            marker: {
                size: state.controls.pointSize,
                color: hexToRgba(replicateColor(file.replicate_index), state.controls.pointAlpha),
                line: { width: 0 },
                symbol: replicateSymbol(file.replicate_index),
            },
        });
    }
    return traces;
}

function violinTraces(ci, cond, data, metricLabel) {
    const traces = [];
    const files = data.files || [];
    if (state.controls.replicateDist) {
        const width = state.controls.jitter;
        files.forEach(file => {
            if ((file.values || []).length < 3) return;
            const center = files.length <= 1
                ? ci
                : ci + ((file.replicate_index / (files.length - 1)) - 0.5) * width;
            const coords = arrayCoords(Array(file.values.length).fill(center), file.values);
            traces.push({
                type: 'violin',
                ...coords,
                orientation: state.controls.rotate ? 'h' : 'v',
                name: cond,
                legendgroup: cond,
                showlegend: false,
                side: 'both',
                points: false,
                box: { visible: false },
                meanline: { visible: false },
                fillcolor: hexToRgba(replicateColor(file.replicate_index), 0.12),
                line: { color: hexToRgba(replicateColor(file.replicate_index), 0.5), width: 1.1 },
                hovertemplate: `${file.file_name}<br>${metricLabel}: %{${state.controls.rotate ? 'x' : 'y'}:.4f}<extra></extra>`,
                width: Math.max(0.16, state.controls.jitter * 0.75),
                spanmode: 'soft',
            });
        });
        return traces;
    }

    const allVals = files.flatMap(file => file.values);
    if (allVals.length >= 3) {
        const coords = arrayCoords(Array(allVals.length).fill(ci), allVals);
        traces.push({
            type: 'violin',
            ...coords,
            orientation: state.controls.rotate ? 'h' : 'v',
            name: cond,
            legendgroup: cond,
            showlegend: true,
            side: 'both',
            points: false,
            box: { visible: false },
            meanline: { visible: false },
            fillcolor: hexToRgba(condColor(cond), 0.22),
            line: { color: hexToRgba(condColor(cond), 0.7), width: 1.5 },
            hovertemplate: `${cond}<br>${metricLabel}: %{${state.controls.rotate ? 'x' : 'y'}:.4f}<extra></extra>`,
            width: 0.7,
            spanmode: 'soft',
        });
    }
    return traces;
}

function renderSuperplot(containerId, metric, metricsData) {
    const meta = METRIC_META[metric] || { label: metric, unit: '' };
    const conditions = orderedMetricConditions(metricsData);
    if (!conditions.length) return;

    const traces = [...pairedLineTraces(conditions, metricsData)];
    const tickvals = [];
    const ticktext = [];

    conditions.forEach((cond, ci) => {
        const data = metricsData[cond];
        tickvals.push(ci);
        ticktext.push(`${cond}<br><sub style="color:#7a7a9a">(n = ${data.n_files})</sub>`);

        traces.push(...violinTraces(ci, cond, data, meta.label));
        traces.push(...replicateRoiTraces(ci, cond, data, meta.label));
        traces.push(replicateMeanTrace(ci, cond, data, !state.controls.replicateDist));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    Plotly.react(
        containerId,
        traces,
        {
            ...metricLayout(meta, tickvals, ticktext, conditions.length),
            violinmode: 'overlay',
            violingap: 0.2,
        },
        getPlotlyConfig(),
    );
}

function renderBarPlot(containerId, metric, metricsData) {
    const meta = METRIC_META[metric] || { label: metric, unit: '' };
    const conditions = orderedMetricConditions(metricsData);
    if (!conditions.length) return;

    const traces = [...pairedLineTraces(conditions, metricsData)];
    const tickvals = [];
    const ticktext = [];

    conditions.forEach((cond, ci) => {
        const data = metricsData[cond];
        tickvals.push(ci);
        ticktext.push(`${cond}<br><sub style="color:#7a7a9a">(n = ${data.n_files})</sub>`);

        const coords = pointCoords(ci, data.condition_summary);
        traces.push({
            type: 'bar',
            x: state.controls.rotate ? [coords.x] : [coords.x],
            y: state.controls.rotate ? [coords.y] : [coords.y],
            orientation: state.controls.rotate ? 'h' : 'v',
            name: cond,
            legendgroup: cond,
            showlegend: true,
            width: 0.5,
            marker: { color: hexToRgba(condColor(cond), 0.35), line: { color: condColor(cond), width: 1.5 } },
            error_y: !state.controls.rotate && state.controls.errorBars !== 'none' && data.n_files >= 2 ? {
                type: 'data',
                array: [data.condition_error],
                color: 'rgba(31,41,55,0.8)',
                thickness: 2,
                width: 8,
            } : undefined,
            error_x: state.controls.rotate && state.controls.errorBars !== 'none' && data.n_files >= 2 ? {
                type: 'data',
                array: [data.condition_error],
                color: 'rgba(31,41,55,0.8)',
                thickness: 2,
                width: 8,
            } : undefined,
            hovertemplate: `${cond}<br>${state.controls.summaryStat}: ${data.condition_summary.toFixed(4)}<br>${errorLabel()}: ${data.condition_error.toFixed(4)}<br>(${data.n_files} experiments)<extra></extra>`,
        });

        traces.push(replicateMeanTrace(ci, cond, data, false));
    });

    Plotly.react(
        containerId,
        traces,
        { ...metricLayout(meta, tickvals, ticktext, conditions.length), barmode: 'overlay' },
        getPlotlyConfig(),
    );
}

function renderBoxStylePlot(containerId, metric, metricsData) {
    const meta = METRIC_META[metric] || { label: metric, unit: '' };
    const conditions = orderedMetricConditions(metricsData);
    if (!conditions.length) return;

    const traces = [...pairedLineTraces(conditions, metricsData)];
    const tickvals = [];
    const ticktext = [];

    conditions.forEach((cond, ci) => {
        const data = metricsData[cond];
        tickvals.push(ci);
        ticktext.push(`${cond}<br><sub style="color:#7a7a9a">(n = ${data.n_files})</sub>`);

        const allVals = data.files.flatMap(file => file.values);
        if (allVals.length >= 4) {
            const coords = arrayCoords(Array(allVals.length).fill(ci), allVals);
            traces.push({
                type: 'box',
                ...coords,
                orientation: state.controls.rotate ? 'h' : 'v',
                name: cond,
                legendgroup: cond,
                showlegend: true,
                boxpoints: false,
                fillcolor: hexToRgba(condColor(cond), 0.22),
                line: { color: condColor(cond), width: 1.5 },
                width: 0.5,
                hovertemplate: `${cond}<br>${meta.label}: %{${state.controls.rotate ? 'x' : 'y'}:.4f}<extra></extra>`,
            });
        }

        traces.push(replicateMeanTrace(ci, cond, data, allVals.length < 4));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    Plotly.react(
        containerId,
        traces,
        { ...metricLayout(meta, tickvals, ticktext, conditions.length), boxmode: 'overlay' },
        getPlotlyConfig(),
    );
}

function renderStripPlot(containerId, metric, metricsData) {
    const meta = METRIC_META[metric] || { label: metric, unit: '' };
    const conditions = orderedMetricConditions(metricsData);
    if (!conditions.length) return;

    const traces = [...pairedLineTraces(conditions, metricsData)];
    const tickvals = [];
    const ticktext = [];

    conditions.forEach((cond, ci) => {
        const data = metricsData[cond];
        tickvals.push(ci);
        ticktext.push(`${cond}<br><sub style="color:#7a7a9a">(n = ${data.n_files})</sub>`);
        traces.push(...replicateRoiTraces(ci, cond, data, meta.label));
        traces.push(replicateMeanTrace(ci, cond, data, true));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    Plotly.react(containerId, traces, metricLayout(meta, tickvals, ticktext, conditions.length), getPlotlyConfig());
}

function renderMetricChart(containerId, metric, rawMetricsData) {
    const metricsData = enrichMetricData(metric, rawMetricsData);
    switch (state.plotStyle) {
        case 'bar': renderBarPlot(containerId, metric, metricsData); break;
        case 'box': renderBoxStylePlot(containerId, metric, metricsData); break;
        case 'strip': renderStripPlot(containerId, metric, metricsData); break;
        default: renderSuperplot(containerId, metric, metricsData); break;
    }
}

function renderTraceComparison(containerId, rawTraceData, title, yLabel) {
    const tracesData = enrichTraceData(rawTraceData);
    const conditions = orderedTraceConditions(tracesData);
    const traces = [];

    conditions.forEach(cond => {
        const data = tracesData[cond];
        const timeArr = data.time_s || [];

        data.files.forEach(file => {
            traces.push({
                type: 'scatter',
                x: timeArr,
                y: file.mean,
                mode: 'lines',
                legendgroup: cond,
                showlegend: false,
                hovertemplate: `${file.file_name} (${file.n_rois} ROIs)<br>%{y:.4f}<extra></extra>`,
                line: {
                    color: hexToRgba(replicateColor(file.replicate_index), Math.max(0.25, state.controls.pointAlpha)),
                    width: 1.2,
                    dash: state.controls.paired ? 'dot' : 'solid',
                },
            });
        });

        if (state.controls.errorBars !== 'none' && data.n_files >= 2) {
            const upper = data.condition_summary.map((v, i) => v + (data.condition_error[i] || 0));
            const lower = data.condition_summary.map((v, i) => v - (data.condition_error[i] || 0));
            traces.push({
                type: 'scatter',
                x: timeArr,
                y: upper,
                mode: 'lines',
                line: { width: 0, color: condColor(cond) },
                legendgroup: cond,
                showlegend: false,
                hoverinfo: 'skip',
            });
            traces.push({
                type: 'scatter',
                x: timeArr,
                y: lower,
                mode: 'lines',
                line: { width: 0, color: condColor(cond) },
                fill: 'tonexty',
                fillcolor: hexToRgba(condColor(cond), 0.15),
                legendgroup: cond,
                showlegend: false,
                hoverinfo: 'skip',
            });
        }

        traces.push({
            type: 'scatter',
            x: timeArr,
            y: data.condition_summary,
            mode: 'lines',
            name: `${cond} (${state.controls.summaryStat}, n = ${data.n_files})`,
            legendgroup: cond,
            showlegend: true,
            hovertemplate: `${cond}<br>%{y:.4f}<extra></extra>`,
            line: { color: condColor(cond), width: 2.8 },
        });
    });

    Plotly.react(containerId, traces, traceLayout(title, yLabel), getPlotlyConfig());
}

function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refreshCurrentTab, 280);
}

async function refreshCurrentTab() {
    const groups = buildGroups();
    if (!hasGroups()) {
        showPlaceholder('Assign a condition name to at least one file to generate plots.');
        return;
    }

    hidePlaceholder();
    showPane(`pane-${state.currentTab}`);
    setStatus('Updating…');

    try {
        if (state.currentTab === 'delta' || state.currentTab === 'raw') {
            const traceType = state.currentTab === 'delta' ? 'delta' : 'raw';
            const data = await fetchTraces(groups, traceType);
            if (!Object.keys(data).length) {
                showNoDataMessage(`pane-${state.currentTab}`, 'No trace data found in the loaded files.');
            } else {
                restorePane(`pane-${state.currentTab}`);
                const title = state.currentTab === 'delta'
                    ? `ΔF / F₀ — ${state.controls.summaryStat} ± ${errorLabel()}`
                    : `Raw Fluorescence — ${state.controls.summaryStat} ± ${errorLabel()}`;
                const yLabel = state.currentTab === 'delta' ? 'ΔF / F₀' : 'Fluorescence (a.u.)';
                renderTraceComparison(`plot-${state.currentTab}-traces`, data, title, yLabel);
            }
        } else {
            const data = await fetchMetrics(groups);
            const tabMap = {
                peak_auc: () => { renderMetricChart('plot-peak', 'peak', data); renderMetricChart('plot-auc', 'auc', data); },
                fwhm: () => renderMetricChart('plot-fwhm', 'event_fwhm', data),
                frequency: () => renderMetricChart('plot-frequency', 'event_frequency', data),
                ttp: () => renderMetricChart('plot-ttp', 'time_to_peak', data),
                decay: () => renderMetricChart('plot-decay', 'decay_t_half', data),
                rise: () => renderMetricChart('plot-rise', 'rate_of_rise', data),
                tg: () => {
                    renderMetricChart('plot-tg-peak', 'tg_peak', data);
                    renderMetricChart('plot-tg-slope', 'tg_slope', data);
                    renderMetricChart('plot-tg-auc', 'tg_auc', data);
                },
                addback: () => {
                    renderMetricChart('plot-addback-peak', 'addback_peak', data);
                    renderMetricChart('plot-addback-slope', 'addback_slope', data);
                    renderMetricChart('plot-addback-auc', 'addback_auc', data);
                    renderMetricChart('plot-addback-latency', 'addback_latency', data);
                },
            };
            if (tabMap[state.currentTab]) tabMap[state.currentTab]();
        }

        updateReplicateLegend();
        setStatus('');
    } catch (err) {
        setStatus(`Error: ${err.message}`);
    }
}

function setStatus(msg) {
    document.getElementById('status-bar').textContent = msg;
}

function showPlaceholder(msg) {
    const ph = document.getElementById('plot-placeholder');
    ph.textContent = msg;
    ph.style.display = 'flex';
    document.querySelectorAll('.plot-pane').forEach(p => { p.style.display = 'none'; });
}

function hidePlaceholder() {
    document.getElementById('plot-placeholder').style.display = 'none';
}

function showPane(id) {
    document.querySelectorAll('.plot-pane').forEach(p => {
        p.style.display = p.id === id ? '' : 'none';
    });
}

function restorePane(paneId) {
    const pane = document.getElementById(paneId);
    if (!pane) return;
    const template = state.paneTemplates[paneId];
    if (template !== undefined && pane.innerHTML !== template) {
        pane.innerHTML = template;
    }
}

function showNoDataMessage(paneId, msg) {
    const pane = document.getElementById(paneId);
    if (pane) pane.innerHTML = `<div style="color:var(--muted);padding:24px;text-align:center">${msg}</div>`;
}

function updateFileCount() {
    const n = state.files.size;
    document.getElementById('file-count').textContent = `${n} / ${MAX_FILES} files`;
    document.getElementById('file-input').disabled = n >= MAX_FILES;
    document.getElementById('drop-hint').style.display = n === 0 ? '' : 'none';
}

function renderFileList() {
    const list = document.getElementById('file-list');
    if (state.files.size === 0) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = [...state.files.entries()].map(([fid, info]) => {
        const color = info.condition ? condColor(info.condition) : '#444';
        const name = info.file_name || '';
        const short = name.length > 26 ? `…${name.slice(-23)}` : name;
        const cond = (info.condition || '').replace(/"/g, '&quot;');
        return `
          <div class="file-row" id="file-row-${fid}">
            <div class="file-color-bar" id="cbar-${fid}" style="background:${color}"></div>
            <div class="file-info">
              <span class="file-name" title="${name}">${short}</span>
              <span class="file-meta">${info.n_rois} ROIs · ${info.analysis_mode || 'single'}</span>
            </div>
            <input
              type="text"
              class="condition-input"
              placeholder="Condition…"
              value="${cond}"
              data-fid="${fid}"
              list="condition-datalist"
            >
            <button class="delete-file-btn" data-fid="${fid}" title="Remove file">×</button>
          </div>`;
    }).join('');
    refreshDatalist();
}

function refreshDatalist() {
    const conditions = [...new Set([...state.files.values()].map(f => f.condition).filter(Boolean))];
    document.getElementById('condition-datalist').innerHTML = conditions.map(c => `<option value="${c}">`).join('');
}

function updateConditionLegend() {
    const conditions = [...new Set([...state.files.values()].map(f => f.condition).filter(Boolean))];
    const panel = document.getElementById('condition-legend-panel');
    const legend = document.getElementById('condition-legend');
    if (!conditions.length) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    legend.innerHTML = conditions.map(cond => {
        const color = condColor(cond);
        const n = [...state.files.values()].filter(f => f.condition === cond).length;
        return `
          <div class="legend-row">
            <span class="legend-dot" style="background:${color}"></span>
            <span class="legend-name">${cond}</span>
            <span class="legend-count">${n} file${n !== 1 ? 's' : ''}</span>
          </div>`;
    }).join('');
}

function updateReplicateLegend() {
    const panel = document.getElementById('replicate-legend-panel');
    const legend = document.getElementById('replicate-legend');
    const maxReplicates = Math.max(0, ...Object.values(buildGroups()).map(group => group.length));
    if (maxReplicates <= 0) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    legend.innerHTML = Array.from({ length: maxReplicates }, (_, i) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${replicateColor(i)}">${replicateSymbol(i) === 'circle' ? '●' : ''}</span>
        <span class="legend-name">Replicate ${i + 1}</span>
        <span class="legend-count">${replicateSymbol(i)}</span>
      </div>`).join('');
}

function updateFileColorBar(fid) {
    const info = state.files.get(fid);
    const bar = document.getElementById(`cbar-${fid}`);
    if (bar && info) bar.style.background = info.condition ? condColor(info.condition) : '#444';
}

function syncControlsToState() {
    document.querySelectorAll('[data-control]').forEach(el => {
        const key = el.dataset.control;
        if (!(key in state.controls)) return;
        if (el.type === 'checkbox') {
            state.controls[key] = el.checked;
        } else if (el.type === 'range' || el.type === 'number') {
            state.controls[key] = el.value === '' ? '' : Number(el.value);
        } else {
            state.controls[key] = el.value;
        }
    });
    document.getElementById('point-size-value').textContent = state.controls.pointSize;
    document.getElementById('point-alpha-value').textContent = Number(state.controls.pointAlpha).toFixed(2);
    document.getElementById('jitter-value').textContent = Number(state.controls.jitter).toFixed(2);
}

async function handleFiles(fileList) {
    const files = Array.from(fileList)
        .filter(file => /\.(xlsx|xls)$/i.test(file.name))
        .slice(0, MAX_FILES - state.files.size);

    if (!files.length) return;

    for (const file of files) {
        setStatus(`Uploading ${file.name}…`);
        try {
            const result = await apiUpload(file);
            state.files.set(result.file_id, {
                file_name: result.file_name,
                n_rois: result.n_rois,
                condition: '',
                analysis_mode: result.analysis_mode,
                available_metrics: result.available_metrics,
            });
        } catch (err) {
            setStatus(`Failed to load ${file.name}: ${err.message}`);
            return;
        }
    }

    renderFileList();
    updateFileCount();
    updateConditionLegend();
    updateReplicateLegend();
    scheduleRefresh();
    setStatus('');
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.plot-pane').forEach(pane => {
        state.paneTemplates[pane.id] = pane.innerHTML;
    });

    syncControlsToState();
    apiDeleteAll().catch(() => {});

    document.getElementById('file-input').addEventListener('change', e => {
        handleFiles(e.target.files);
        e.target.value = '';
    });

    const panel = document.getElementById('files-panel');
    panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drag-over'); });
    panel.addEventListener('dragleave', e => {
        if (!panel.contains(e.relatedTarget)) panel.classList.remove('drag-over');
    });
    panel.addEventListener('drop', e => {
        e.preventDefault();
        panel.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    document.getElementById('file-list').addEventListener('input', e => {
        if (!e.target.classList.contains('condition-input')) return;
        const fid = e.target.dataset.fid;
        const info = state.files.get(fid);
        if (!info) return;
        const val = e.target.value.trim();
        info.condition = val;
        if (val) assignColor(val);
        updateFileColorBar(fid);
        updateConditionLegend();
        updateReplicateLegend();
        refreshDatalist();
        scheduleRefresh();
    });

    document.getElementById('file-list').addEventListener('click', async e => {
        if (!e.target.classList.contains('delete-file-btn')) return;
        const fid = e.target.dataset.fid;
        await apiDelete(fid);
        state.files.delete(fid);
        renderFileList();
        updateFileCount();
        updateConditionLegend();
        updateReplicateLegend();
        scheduleRefresh();
    });

    document.querySelectorAll('.style-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.plotStyle = btn.dataset.style;
            scheduleRefresh();
        });
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentTab = btn.dataset.tab;
            scheduleRefresh();
        });
    });

    document.getElementById('controls-panel').addEventListener('input', () => {
        syncControlsToState();
        scheduleRefresh();
    });
    document.getElementById('controls-panel').addEventListener('change', () => {
        syncControlsToState();
        scheduleRefresh();
    });

    updateFileCount();
    updateReplicateLegend();
    showPlaceholder('Load .xlsx files exported from the Calcium Imaging Analyzer, then assign a condition name to each file.');
});
