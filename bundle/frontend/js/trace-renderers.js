import { plotTheme } from './theme.js';
import { dayColorForKey, dayDisplayLabel, daySymbolForKey, state } from './state.js';
import {
    axisStyle,
    buildBaseLayout,
    condColor,
    dayColorForFile,
    enrichTraceData,
    hasDayMetadata,
    hexToRgba,
    layoutFontFamily,
    maxTraceReplicates,
    orderedTraceConditions,
    visibleConditionData,
    plottedDayKeys,
    parseAxisRange,
    parseRange,
    replicateColor,
    showConditionLegendInPlot,
    showReplicateLegendInPlot,
    xAxisTickAngle,
} from './core.js';
import { getPlotlyConfig } from './plotly-config.js';

function traceLayout(title, xLabel, yLabel) {
    const base = buildBaseLayout();
    const layout = {
        ...base,
        title: { text: title, font: { family: layoutFontFamily(), size: state.controls.plotTitleFontSize } },
        xaxis: {
            ...base.xaxis,
            ...axisStyle({ showGrid: state.controls.showGrid }),
            title: { text: xLabel, font: { family: layoutFontFamily(), size: state.controls.xAxisTitleFontSize } },
            tickfont: { family: layoutFontFamily(), size: state.controls.xAxisTickFontSize },
            tickangle: xAxisTickAngle(),
        },
        yaxis: {
            ...base.yaxis,
            ...axisStyle({ showGrid: state.controls.showGrid }),
            title: { text: yLabel, font: { family: layoutFontFamily(), size: state.controls.yAxisTitleFontSize } },
            tickfont: { family: layoutFontFamily(), size: state.controls.yAxisTickFontSize },
        },
    };
    const xRange = parseRange('xMin', 'xMax');
    const yRange = parseAxisRange();
    if (xRange && (xRange.min !== null || xRange.max !== null)) {
        layout.xaxis.range = [
            xRange.min !== null ? xRange.min : undefined,
            xRange.max !== null ? xRange.max : undefined,
        ];
    }
    if (yRange && (yRange.min !== null || yRange.max !== null)) {
        if (state.controls.logScale) {
            const min = yRange.min !== null && yRange.min > 0 ? Math.log10(yRange.min) : undefined;
            const max = yRange.max !== null && yRange.max > 0 ? Math.log10(yRange.max) : undefined;
            layout.yaxis.range = [min, max];
        } else {
            layout.yaxis.range = [
                yRange.min !== null ? yRange.min : undefined,
                yRange.max !== null ? yRange.max : undefined,
            ];
        }
    }
    layout.yaxis.type = state.controls.logScale ? 'log' : 'linear';
    return layout;
}

function traceDayLegendTraces(traceData) {
    return plottedDayKeys(traceData).map(key => ({
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

function traceReplicateLegendTraces(traceData) {
    if (state.controls.showTraceReplicates === false || !showReplicateLegendInPlot()) return [];
    if (state.groupByDay && hasDayMetadata()) return traceDayLegendTraces(traceData);
    const maxReplicates = maxTraceReplicates(traceData);
    const traces = [];
    for (let ri = 0; ri < maxReplicates; ri += 1) {
        traces.push({
            type: 'scatter',
            x: [null],
            y: [null],
            mode: 'lines',
            name: `Replicate ${ri + 1}`,
            legendgroup: `replicate-${ri}`,
            showlegend: true,
            hoverinfo: 'skip',
            line: {
                color: replicateColor(ri),
                width: 2,
                dash: state.controls.paired ? 'dot' : 'solid',
            },
        });
    }
    return traces;
}

export function renderTraceComparison(containerId, rawTraceData, title, xLabel, yLabel) {
    const tracesData = visibleConditionData(enrichTraceData(rawTraceData));
    const conditions = orderedTraceConditions(tracesData);
    const traces = [];

    conditions.forEach(cond => {
        const data = tracesData[cond];
        const timeArr = data.time_s || [];

        if (state.controls.showTraceReplicates !== false) data.files.forEach(file => {
            traces.push({
                type: 'scatter',
                x: timeArr,
                y: file.mean,
                mode: 'lines',
                legendgroup: cond,
                showlegend: false,
                hovertemplate: `${file.file_name} (${file.n_rois} ROIs)<br>%{y:.4f}<extra></extra>`,
                line: {
                    color: hexToRgba(dayColorForFile(file) || replicateColor(file.replicate_index), Math.max(0.25, state.controls.pointAlpha)),
                    width: 1.2,
                    dash: state.controls.paired ? 'dot' : 'solid',
                },
            });
        });

        const showBand = state.controls.showTraceErrorBand !== false;
        const showBounds = state.controls.showTraceErrorBounds === true;
        if (state.controls.errorBars !== 'none' && data.n_files >= 2 && (showBand || showBounds)) {
            const upper = data.condition_summary.map((value, i) => value + (data.condition_error[i] || 0));
            const lower = data.condition_summary.map((value, i) => value - (data.condition_error[i] || 0));
            traces.push({
                type: 'scatter',
                x: timeArr,
                y: upper,
                mode: 'lines',
                line: { width: showBounds ? 1 : 0, color: condColor(cond), dash: 'dot' },
                legendgroup: cond,
                showlegend: false,
                hoverinfo: 'skip',
            });
            traces.push({
                type: 'scatter',
                x: timeArr,
                y: lower,
                mode: 'lines',
                line: { width: showBounds ? 1 : 0, color: condColor(cond), dash: 'dot' },
                fill: showBand ? 'tonexty' : 'none',
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
            name: `${cond} (${state.controls.summaryStat}, n = ${data.n_files}${data.pool_by_day ? ' replicates' : ''})`,
            legendgroup: cond,
            showlegend: showConditionLegendInPlot(),
            hovertemplate: `${cond}<br>%{y:.4f}<extra></extra>`,
            line: { color: condColor(cond), width: 2.8 },
        });
    });

    traces.push(...traceReplicateLegendTraces(tracesData));

    window.Plotly.react(containerId, traces, traceLayout(title, xLabel, yLabel), getPlotlyConfig());
}
