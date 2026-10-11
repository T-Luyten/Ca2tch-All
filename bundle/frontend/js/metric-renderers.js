import { plotTheme } from './theme.js';
import { dayColorForKey, dayDisplayLabel, daySymbolForKey, state } from './state.js';
import {
    arrayCoords,
    axisStyle,
    buildBaseLayout,
    condColor,
    dayColorForFile,
    daySymbolForFile,
    enrichMetricData,
    errorLabel,
    hasDayMetadata,
    hexToRgba,
    layoutFontFamily,
    maxMetricReplicates,
    orderedMetricConditions,
    visibleConditionData,
    plottedDayKeys,
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
    if (range && (range.min !== null || range.max !== null)) {
        if (state.controls.logScale) {
            const min = range.min !== null && range.min > 0 ? Math.log10(range.min) : undefined;
            const max = range.max !== null && range.max > 0 ? Math.log10(range.max) : undefined;
            valueAxis.range = [min, max];
        } else {
            valueAxis.range = [
                range.min !== null ? range.min : undefined,
                range.max !== null ? range.max : undefined,
            ];
        }
    }

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

function metricDayLegendTraces(metricData) {
    return plottedDayKeys(metricData).map(key => ({
        type: 'scatter',
        x: [null],
        y: [null],
        mode: 'markers',
        name: dayDisplayLabel(key),
        legendgroup: `day-${key}`,
        showlegend: true,
        hoverinfo: 'skip',
        marker: {
            size: state.controls.meanSize,
            color: dayColorForKey(key),
            symbol: daySymbolForKey(key),
            line: { color: plotTheme().outline, width: 1.2 },
        },
    }));
}

function metricReplicateLegendTraces(metricData) {
    if (!showReplicateLegendInPlot()) return [];
    if (state.groupByDay && hasDayMetadata()) return metricDayLegendTraces(metricData);
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
                line: { color: plotTheme().outline, width: 1.2 },
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
            color: plotTheme().background,
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
        line: { color: hexToRgba(plotTheme().text, 0.9), width: 3 },
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
            hovertemplate: `${cond}<br>${state.controls.summaryStat}: ${summary.toFixed(4)}<br>${errorLabel()}: ${error.toFixed(4)}<br>(${data.n_included ?? data.n_files} experiments${data.n_excluded ? `, ${data.n_excluded} outlier${data.n_excluded > 1 ? 's' : ''}` : ''})<extra></extra>`,
            error_y: state.controls.rotate ? undefined : {
                type: 'data',
                array: [error],
                color: hexToRgba(plotTheme().text, 0.9),
                thickness: 2.5,
                width: 8,
            },
            error_x: state.controls.rotate ? {
                type: 'data',
                array: [error],
                color: hexToRgba(plotTheme().text, 0.9),
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
    const included = files.filter(f => !f.isOutlier);
    const outliers = files.filter(f => f.isOutlier);
    const traces = [];

    if (included.length) {
        const catPos = included.map((_, fi) => included.length <= 1 ? ci : ci + ((fi / (included.length - 1)) - 0.5) * width);
        const vals = included.map(file => file.summary);
        const coords = arrayCoords(catPos, vals);
        traces.push({
            type: 'scatter',
            ...coords,
            customdata: included.map(file => [file.file_name, file.values.length, file.summary]),
            mode: 'markers',
            legendgroup: cond,
            showlegend: false,
            name: cond,
            hovertemplate: '%{customdata[0]}<br>Replicate summary: %{customdata[1]} ROIs<br>Value: %{customdata[2]:.4f}<extra></extra>',
            marker: {
                size: state.controls.meanSize,
                color: included.map(file => dayColorForFile(file) || replicateColor(file.replicate_index)),
                line: { color: plotTheme().outline, width: 1.5 },
                symbol: included.map(file => daySymbolForFile(file) || replicateSymbol(file.replicate_index)),
            },
        });
    }

    if (outliers.length) {
        const catPos = outliers.map((_, fi) => outliers.length <= 1 ? ci : ci + ((fi / (outliers.length - 1)) - 0.5) * width);
        const vals = outliers.map(file => file.summary);
        const coords = arrayCoords(catPos, vals);
        traces.push({
            type: 'scatter',
            ...coords,
            customdata: outliers.map(file => [file.file_name, file.values.length, file.summary]),
            mode: 'markers',
            legendgroup: cond,
            showlegend: false,
            name: `${cond} (outlier)`,
            hovertemplate: '%{customdata[0]}<br>Replicate summary: %{customdata[1]} ROIs<br>Value: %{customdata[2]:.4f}<br><b>Outlier</b><extra></extra>',
            marker: {
                size: state.controls.meanSize,
                color: '#cccccc',
                opacity: 0.5,
                line: { color: '#999999', width: 1.5 },
                symbol: outliers.map(file => daySymbolForFile(file) || replicateSymbol(file.replicate_index)),
            },
        });
    }

    return traces;
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
        const dColor = dayColorForFile(file);
        const isOutlier = file.isOutlier;
        traces.push({
            type: 'scatter',
            ...coords,
            mode: 'markers',
            legendgroup: cond,
            showlegend: false,
            customdata: vals.map(value => [file.file_name, value]),
            hovertemplate: `%{customdata[0]}<br>${metricLabel}: %{customdata[1]:.4f}${isOutlier ? '<br><b>Outlier</b>' : ''}<extra></extra>`,
            marker: {
                size: state.controls.pointSize,
                color: isOutlier ? '#dddddd' : (dColor ? hexToRgba(dColor, state.controls.pointAlpha) : hexToRgba(replicateColor(file.replicate_index), state.controls.pointAlpha)),
                opacity: isOutlier ? 0.25 : 1,
                line: { width: 0 },
                symbol: daySymbolForFile(file) || replicateSymbol(file.replicate_index),
            },
        });
    }
    return traces;
}

function violinTraces(ci, cond, data, metricLabel) {
    const traces = [];
    const files = (data.files || []).filter(f => !f.isOutlier);
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
                fillcolor: hexToRgba(dayColorForFile(file) || replicateColor(file.replicate_index), 0.12),
                line: { color: hexToRgba(dayColorForFile(file) || replicateColor(file.replicate_index), 0.5), width: 1.1 },
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

function halfViolinTrace(ci, cond, data, metricLabel) {
    const allVals = (data.files || []).filter(f => !f.isOutlier).flatMap(file => file.values);
    if (allVals.length < 3) return [];
    const coords = arrayCoords(Array(allVals.length).fill(ci), allVals);
    return [{
        type: 'violin',
        ...coords,
        orientation: state.controls.rotate ? 'h' : 'v',
        name: cond,
        legendgroup: cond,
        showlegend: false,
        side: 'positive',
        points: false,
        box: { visible: false },
        meanline: { visible: false },
        fillcolor: hexToRgba(condColor(cond), 0.35),
        line: { color: hexToRgba(condColor(cond), 0.8), width: 1.5 },
        hovertemplate: `${cond}<br>${metricLabel}: %{${state.controls.rotate ? 'x' : 'y'}:.4f}<extra></extra>`,
        width: 0.65,
        spanmode: 'soft',
    }];
}

function raindropTraces(ci, cond, data, metricLabel) {
    const traces = [];
    const rainCenter = ci - 0.25;
    const spread = 0.07;
    for (const file of data.files || []) {
        const vals = file.values || [];
        if (!vals.length) continue;
        const repOffset = data.files.length <= 1 ? 0
            : ((file.replicate_index / (data.files.length - 1)) - 0.5) * (spread * 0.5);
        const center = rainCenter + repOffset;
        const catVals = vals.map((_, i) =>
            vals.length <= 1 ? center : center + ((i / (vals.length - 1)) - 0.5) * spread
        );
        const coords = arrayCoords(catVals, vals);
        const isOutlier = file.isOutlier;
        traces.push({
            type: 'scatter',
            ...coords,
            mode: 'markers',
            legendgroup: cond,
            showlegend: false,
            customdata: vals.map(v => [file.file_name, v]),
            hovertemplate: `%{customdata[0]}<br>${metricLabel}: %{customdata[1]:.4f}${isOutlier ? '<br><b>Outlier</b>' : ''}<extra></extra>`,
            marker: {
                size: state.controls.pointSize,
                color: isOutlier ? '#dddddd' : hexToRgba(dayColorForFile(file) || replicateColor(file.replicate_index), state.controls.pointAlpha),
                opacity: isOutlier ? 0.25 : 1,
                line: { width: 0 },
                symbol: daySymbolForFile(file) || replicateSymbol(file.replicate_index),
            },
        });
    }
    return traces;
}

function renderRaincloud(containerId, metric, metricsData) {
    const meta = resolveMetricMeta(metric);
    const conditions = orderedMetricConditions(metricsData);
    if (!conditions.length) return;

    const traces = [...pairedLineTraces(conditions, metricsData)];
    const tickvals = [];
    const ticktext = [];

    conditions.forEach((cond, ci) => {
        const data = metricsData[cond];
        tickvals.push(ci);
        const n = data.n_included ?? data.n_files;
        const excl = data.n_excluded || 0;
        let label = `${cond}<br><sub style="color:${plotTheme().muted}">(n = ${n}`;
        if (excl > 0) label += `, ${excl} outlier${excl > 1 ? 's' : ''}`;
        label += ')</sub>';
        ticktext.push(label);
        traces.push(...halfViolinTrace(ci, cond, data, meta.label));
        traces.push(...raindropTraces(ci, cond, data, meta.label));
        traces.push(...replicateMeanTrace(ci, cond, data));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    traces.push(...metricConditionLegendTraces(conditions));
    traces.push(...metricReplicateLegendTraces(metricsData));

    const layout = metricLayout(meta, tickvals, ticktext, conditions.length);
    // Widen the axis range: rain sits at ci-0.25 to the left, violin extends ~0.35 to the right.
    if (state.controls.rotate) {
        layout.yaxis.range = [-0.75, conditions.length - 0.35];
    } else {
        layout.xaxis.range = [-0.75, conditions.length - 0.35];
    }

    window.Plotly.react(
        containerId,
        traces,
        { ...layout, violinmode: 'overlay', violingap: 0 },
        getPlotlyConfig(),
    );
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
        const n = data.n_included ?? data.n_files;
        const excl = data.n_excluded || 0;
        let label = `${cond}<br><sub style="color:${plotTheme().muted}">(n = ${n}`;
        if (excl > 0) label += `, ${excl} outlier${excl > 1 ? 's' : ''}`;
        label += ')</sub>';
        ticktext.push(label);
        traces.push(...violinTraces(ci, cond, data, meta.label));
        traces.push(...replicateRoiTraces(ci, cond, data, meta.label));
        traces.push(...replicateMeanTrace(ci, cond, data));
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
        const n = data.n_included ?? data.n_files;
        const excl = data.n_excluded || 0;
        let label = `${cond}<br><sub style="color:${plotTheme().muted}">(n = ${n}`;
        if (excl > 0) label += `, ${excl} outlier${excl > 1 ? 's' : ''}`;
        label += ')</sub>';
        ticktext.push(label);

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
                color: hexToRgba(plotTheme().text, 0.8),
                thickness: 2,
                width: 8,
            } : undefined,
            error_x: state.controls.rotate && state.controls.errorBars !== 'none' && data.n_files >= 2 ? {
                type: 'data',
                array: [data.condition_error],
                color: hexToRgba(plotTheme().text, 0.8),
                thickness: 2,
                width: 8,
            } : undefined,
            hovertemplate: `${cond}<br>${state.controls.summaryStat}: ${data.condition_summary.toFixed(4)}<br>${errorLabel()}: ${data.condition_error.toFixed(4)}<br>(${data.n_included ?? data.n_files} experiments${data.n_excluded ? `, ${data.n_excluded} outlier${data.n_excluded > 1 ? 's' : ''}` : ''})<extra></extra>`,
        });

        traces.push(...replicateMeanTrace(ci, cond, data));
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
        const n = data.n_included ?? data.n_files;
        const excl = data.n_excluded || 0;
        let label = `${cond}<br><sub style="color:${plotTheme().muted}">(n = ${n}`;
        if (excl > 0) label += `, ${excl} outlier${excl > 1 ? 's' : ''}`;
        label += ')</sub>';
        ticktext.push(label);

        const allVals = data.files.filter(f => !f.isOutlier).flatMap(file => file.values);
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

        traces.push(...replicateMeanTrace(ci, cond, data));
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
        const n = data.n_included ?? data.n_files;
        const excl = data.n_excluded || 0;
        let label = `${cond}<br><sub style="color:${plotTheme().muted}">(n = ${n}`;
        if (excl > 0) label += `, ${excl} outlier${excl > 1 ? 's' : ''}`;
        label += ')</sub>';
        ticktext.push(label);
        traces.push(...replicateRoiTraces(ci, cond, data, meta.label));
        traces.push(...replicateMeanTrace(ci, cond, data));
        traces.push(...conditionSummaryTrace(ci, cond, data));
    });

    traces.push(...metricConditionLegendTraces(conditions));
    traces.push(...metricReplicateLegendTraces(metricsData));

    window.Plotly.react(containerId, traces, metricLayout(meta, tickvals, ticktext, conditions.length), getPlotlyConfig());
}

export function renderMetricChart(containerId, metric, rawMetricsData) {
    const metricsData = enrichMetricData(metric, rawMetricsData);
    const plottedData = visibleConditionData(metricsData);
    if (!Object.keys(plottedData).length) return metricsData;
    switch (state.plotStyle) {
        case 'bar':       renderBarPlot(containerId, metric, plottedData);     break;
        case 'box':       renderBoxStylePlot(containerId, metric, plottedData); break;
        case 'strip':     renderStripPlot(containerId, metric, plottedData);   break;
        case 'raincloud': renderRaincloud(containerId, metric, plottedData);   break;
        default:          renderSuperplot(containerId, metric, plottedData);   break;
    }
    return metricsData;
}

export function addSignificanceAnnotations(containerId, comparisons, metricsData) {
    const conditions = orderedMetricConditions(metricsData);
    if (conditions.length < 2) return;

    const allComparisons = (comparisons || []).filter(c =>
        conditions.includes(c.condition_a) && conditions.includes(c.condition_b)
    );
    if (!allComparisons.length) return;

    // Compute the range of visible content for bracket positioning.
    // Bar charts don't display raw ROI values, so anchoring brackets above
    // them would place brackets far above the bars and squish the plot.
    const showsRoiValues = state.plotStyle !== 'bar';
    let maxVal = -Infinity;
    let minVal = Infinity;
    const consider = (v) => {
        if (!Number.isFinite(v)) return;
        maxVal = Math.max(maxVal, v);
        minVal = Math.min(minVal, v);
    };
    for (const cond of conditions) {
        const data = metricsData[cond];
        if (!data) continue;
        for (const file of data.files || []) {
            if (showsRoiValues) {
                for (const v of file.values || []) consider(v);
            }
            consider(file.summary);
        }
        consider(data.condition_summary + data.condition_error);
        consider(data.condition_summary - data.condition_error);
    }

    if (!Number.isFinite(maxVal) || !Number.isFinite(minVal)) {
        console.warn('[Significance] could not compute data range for brackets');
        return;
    }

    const dataRange = Math.abs(maxVal - minVal);
    const step = dataRange < 1e-12 ? 1 : dataRange * 0.07;
    const tickLen = step * 0.35;

    // Build indexed pairs and sort by condition distance (closest first)
    const pairs = allComparisons.map(c => {
        const i = conditions.indexOf(c.condition_a);
        const j = conditions.indexOf(c.condition_b);
        return { ...c, left: Math.min(i, j), right: Math.max(i, j) };
    }).sort((a, b) => (a.right - a.left) - (b.right - b.left));

    // Assign bracket levels greedily to avoid overlaps
    const assigned = [];
    for (const pair of pairs) {
        let level = 0;
        while (true) {
            const sameLevel = assigned.filter(a => a.level === level);
            const overlaps = sameLevel.some(a =>
                !(pair.right < a.left || pair.left > a.right)
            );
            if (!overlaps) break;
            level++;
        }
        pair.level = level;
        assigned.push(pair);
    }

    const shapes = [];
    const annotations = [];

    for (const pair of assigned) {
        const yBase = maxVal + (pair.level + 1) * step;
        const ci = pair.left;
        const cj = pair.right;
        const color = pair.significant ? plotTheme().significant : plotTheme().muted;
        const text = pair.significant ? pair.stars : 'ns';

        if (state.controls.rotate) {
            shapes.push(
                { type: 'line', x0: yBase, y0: ci, x1: yBase, y1: cj, line: { width: 1, color }, xref: 'x', yref: 'y' },
                { type: 'line', x0: yBase, y0: ci, x1: yBase - tickLen, y1: ci, line: { width: 1, color }, xref: 'x', yref: 'y' },
                { type: 'line', x0: yBase, y0: cj, x1: yBase - tickLen, y1: cj, line: { width: 1, color }, xref: 'x', yref: 'y' }
            );
            annotations.push({
                x: yBase + tickLen * 0.5,
                y: (ci + cj) / 2,
                text,
                showarrow: false,
                font: { size: 13, color },
                xref: 'x', yref: 'y',
                xanchor: 'left', yanchor: 'middle',
            });
        } else {
            shapes.push(
                { type: 'line', x0: ci, y0: yBase, x1: cj, y1: yBase, line: { width: 1, color }, xref: 'x', yref: 'y' },
                { type: 'line', x0: ci, y0: yBase, x1: ci, y1: yBase - tickLen, line: { width: 1, color }, xref: 'x', yref: 'y' },
                { type: 'line', x0: cj, y0: yBase, x1: cj, y1: yBase - tickLen, line: { width: 1, color }, xref: 'x', yref: 'y' }
            );
            annotations.push({
                x: (ci + cj) / 2,
                y: yBase + tickLen * 0.3,
                text,
                showarrow: false,
                font: { size: 13, color },
                xref: 'x', yref: 'y',
                xanchor: 'center', yanchor: 'bottom',
            });
        }
    }

    const update = { annotations, shapes };

    // Extend the value axis just enough to fit the brackets instead of letting
    // autorange re-scale the plot (which squishes the bars). Respect manual ranges.
    const manualRange = parseAxisRange();
    const hasManualRange = !!(manualRange && (manualRange.min !== null || manualRange.max !== null));
    if (!hasManualRange && assigned.length) {
        const maxLevel = Math.max(...assigned.map(p => p.level));
        const topVal = maxVal + (maxLevel + 1) * step + tickLen + step * 0.8;
        const axisName = state.controls.rotate ? 'xaxis' : 'yaxis';
        const gd = document.getElementById(containerId);
        const currentRange = gd?.layout?.[axisName]?.range;
        const lo = Array.isArray(currentRange) ? currentRange[0] : undefined;
        let hi = topVal;
        if (state.controls.logScale) {
            hi = Math.log10(Math.max(topVal, 1e-12));
        }
        if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
            update[`${axisName}.range`] = [lo, hi];
        }
    }

    window.Plotly.relayout(containerId, update);
}
