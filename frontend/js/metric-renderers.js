import { state } from './state.js';
import {
    arrayCoords,
    axisStyle,
    buildBaseLayout,
    condColor,
    enrichMetricData,
    errorLabel,
    hexToRgba,
    layoutFontFamily,
    maxMetricReplicates,
    orderedMetricConditions,
    parseAxisRange,
    pointCoords,
    replicateColor,
    replicateSymbol,
    plotLabels,
    resolveMetricMeta,
    showConditionLegendInPlot,
    showReplicateLegendInPlot,
    xAxisTickAngle,
} from './core.js';
import { getPlotlyConfig } from './plotly-config.js';

function metricLayout(meta, tickvals, ticktext, nConds) {
    const base = buildBaseLayout();
    const labels = plotLabels();
    const defaultValueLabel = meta.unit ? `${meta.label} (${meta.unit})` : meta.label;
    const xLabel = labels.x || defaultValueLabel;
    const yLabel = labels.y || defaultValueLabel;
    const valueAxis = {
        ...axisStyle({ showGrid: state.controls.showGrid }),
        type: state.controls.logScale ? 'log' : 'linear',
        tickfont: { family: layoutFontFamily(), size: state.controls.yAxisTickFontSize },
    };
    const range = parseAxisRange();
    if (range) valueAxis.range = state.controls.logScale ? range.map(value => Math.log10(value)) : range;

    if (state.controls.rotate) {
        return {
            ...base,
            title: { text: labels.title, font: { family: layoutFontFamily(), size: state.controls.plotTitleFontSize } },
            xaxis: {
                ...valueAxis,
                title: { text: xLabel, font: { family: layoutFontFamily(), size: state.controls.xAxisTitleFontSize } },
                tickfont: { family: layoutFontFamily(), size: state.controls.xAxisTickFontSize },
            },
            yaxis: {
                ...base.yaxis,
                ...axisStyle({ showGrid: false, categorical: true }),
                showgrid: false,
                tickvals,
                ticktext,
                range: [-0.5, nConds - 0.5],
                title: { text: labels.y, font: { family: layoutFontFamily(), size: state.controls.yAxisTitleFontSize } },
                tickfont: { family: layoutFontFamily(), size: state.controls.yAxisTickFontSize },
            },
        };
    }

    return {
        ...base,
        title: { text: labels.title, font: { family: layoutFontFamily(), size: state.controls.plotTitleFontSize } },
        xaxis: {
            ...base.xaxis,
            ...axisStyle({ showGrid: false, categorical: true }),
            showgrid: false,
            tickvals,
            ticktext,
            range: [-0.5, nConds - 0.5],
            title: { text: labels.x, font: { family: layoutFontFamily(), size: state.controls.xAxisTitleFontSize } },
            tickfont: { family: layoutFontFamily(), size: state.controls.xAxisTickFontSize },
            tickangle: xAxisTickAngle(),
        },
        yaxis: { ...valueAxis, title: { text: yLabel, font: { family: layoutFontFamily(), size: state.controls.yAxisTitleFontSize } } },
    };
}

function pairedLineTraces(conditions, metricData) {
    if (!state.controls.paired) return [];
    const maxReplicates = Math.max(0, ...conditions.map(cond => (metricData[cond]?.files || []).length));
    const traces = [];
    for (let ri = 0; ri < maxReplicates; ri += 1) {
        const catVals = [];
        const vals = [];
        conditions.forEach((cond, ci) => {
            const file = metricData[cond]?.files?.[ri];
            if (!file) return;
            catVals.push(ci);
            vals.push(file.summary);
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

function metricReplicateLegendTraces(metricData) {
    if (!showReplicateLegendInPlot()) return [];
    const maxReplicates = maxMetricReplicates(metricData);
    const traces = [];
    for (let ri = 0; ri < maxReplicates; ri += 1) {
        traces.push({
            type: 'scatter',
            x: [null],
            y: [null],
            mode: 'markers',
            name: `Replicate ${ri + 1}`,
            legendgroup: `replicate-${ri}`,
            showlegend: true,
            hoverinfo: 'skip',
            marker: {
                size: state.controls.meanSize,
                color: replicateColor(ri),
                symbol: replicateSymbol(ri),
                line: { color: '#0d1b35', width: 1.2 },
            },
        });
    }
    return traces;
}

function metricConditionLegendTraces(conditions) {
    if (!showConditionLegendInPlot()) return [];
    return conditions.map(cond => ({
        type: 'scatter',
        x: [null],
        y: [null],
        mode: 'markers',
        name: cond,
        legendgroup: cond,
        showlegend: true,
        hoverinfo: 'skip',
        marker: {
            size: state.controls.meanSize,
            color: '#ffffff',
            symbol: 'circle',
            line: { color: hexToRgba(condColor(cond), 0.7), width: 2 },
        },
    }));
}

function conditionSummaryTrace(ci, cond, data) {
    const hw = 0.14;
    const summary = data.condition_summary;
    const error = data.condition_error;
    const barCoords = arrayCoords([ci - hw, ci + hw], [summary, summary]);
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

function replicateMeanTrace(ci, cond, data) {
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
        showlegend: false,
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
            customdata: vals.map(value => [file.file_name, value]),
            hovertemplate: `%{customdata[0]}<br>${metricLabel}: %{customdata[1]:.4f}<extra></extra>`,
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
            showlegend: false,
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
    const meta = resolveMetricMeta(metric);
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
        traces.push(replicateMeanTrace(ci, cond, data));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    traces.push(...metricConditionLegendTraces(conditions));
    traces.push(...metricReplicateLegendTraces(metricsData));

    window.Plotly.react(
        containerId,
        traces,
        { ...metricLayout(meta, tickvals, ticktext, conditions.length), violinmode: 'overlay', violingap: 0.2 },
        getPlotlyConfig(),
    );
}

function renderBarPlot(containerId, metric, metricsData) {
    const meta = resolveMetricMeta(metric);
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
            x: [coords.x],
            y: [coords.y],
            orientation: state.controls.rotate ? 'h' : 'v',
            name: cond,
            legendgroup: cond,
            showlegend: false,
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

        traces.push(replicateMeanTrace(ci, cond, data));
    });

    traces.push(...metricConditionLegendTraces(conditions));
    traces.push(...metricReplicateLegendTraces(metricsData));

    window.Plotly.react(
        containerId,
        traces,
        { ...metricLayout(meta, tickvals, ticktext, conditions.length), barmode: 'overlay' },
        getPlotlyConfig(),
    );
}

function renderBoxStylePlot(containerId, metric, metricsData) {
    const meta = resolveMetricMeta(metric);
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
                showlegend: false,
                boxpoints: false,
                fillcolor: hexToRgba(condColor(cond), 0.22),
                line: { color: condColor(cond), width: 1.5 },
                width: 0.5,
                hovertemplate: `${cond}<br>${meta.label}: %{${state.controls.rotate ? 'x' : 'y'}:.4f}<extra></extra>`,
            });
        }

        traces.push(replicateMeanTrace(ci, cond, data));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    traces.push(...metricConditionLegendTraces(conditions));
    traces.push(...metricReplicateLegendTraces(metricsData));

    window.Plotly.react(
        containerId,
        traces,
        { ...metricLayout(meta, tickvals, ticktext, conditions.length), boxmode: 'overlay' },
        getPlotlyConfig(),
    );
}

function renderStripPlot(containerId, metric, metricsData) {
    const meta = resolveMetricMeta(metric);
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
        traces.push(replicateMeanTrace(ci, cond, data));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    traces.push(...metricConditionLegendTraces(conditions));
    traces.push(...metricReplicateLegendTraces(metricsData));

    window.Plotly.react(containerId, traces, metricLayout(meta, tickvals, ticktext, conditions.length), getPlotlyConfig());
}

export function renderMetricChart(containerId, metric, rawMetricsData) {
    const metricsData = enrichMetricData(metric, rawMetricsData);
    switch (state.plotStyle) {
        case 'bar':
            renderBarPlot(containerId, metric, metricsData);
            break;
        case 'box':
            renderBoxStylePlot(containerId, metric, metricsData);
            break;
        case 'strip':
            renderStripPlot(containerId, metric, metricsData);
            break;
        default:
            renderSuperplot(containerId, metric, metricsData);
            break;
    }
}
