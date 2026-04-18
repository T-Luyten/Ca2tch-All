import { state } from './state.js';
import {
    axisStyle,
    buildBaseLayout,
    condColor,
    enrichTraceData,
    hexToRgba,
    layoutFontFamily,
    maxTraceReplicates,
    orderedTraceConditions,
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

function traceReplicateLegendTraces(traceData) {
    if (!showReplicateLegendInPlot()) return [];
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
            const upper = data.condition_summary.map((value, i) => value + (data.condition_error[i] || 0));
            const lower = data.condition_summary.map((value, i) => value - (data.condition_error[i] || 0));
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
            showlegend: showConditionLegendInPlot(),
            hovertemplate: `${cond}<br>%{y:.4f}<extra></extra>`,
            line: { color: condColor(cond), width: 2.8 },
        });
    });

    traces.push(...traceReplicateLegendTraces(tracesData));

    window.Plotly.react(containerId, traces, traceLayout(title, xLabel, yLabel), getPlotlyConfig());
}
