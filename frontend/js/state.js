export const MAX_FILES = 50;

export const PALETTES = {
    default: [
        '#4c8cff', '#ff6b6b', '#51cf66', '#ffd43b',
        '#cc5de8', '#ff922b', '#22d3ee', '#f06595',
        '#74c0fc', '#a9e34b', '#ff6348', '#2ed573',
    ],
    'okabe-ito': [
        '#E69F00', '#56B4E9', '#009E73', '#F0E442',
        '#0072B2', '#D55E00', '#CC79A7', '#999999',
    ],
};

export const COND_COLORS = PALETTES.default;

export const REPLICATE_COLORS = [
    '#4c8cff', '#ff6b6b', '#51cf66', '#ffd43b',
    '#ff922b', '#22d3ee', '#f06595', '#845ef7',
    '#20c997', '#ffa94d',
];

export const REPLICATE_SYMBOLS = [
    'circle', 'square', 'diamond', 'triangle-up',
    'triangle-down', 'cross', 'x', 'pentagon',
    'hexagon', 'star',
];

export const METRIC_META = {
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

export const METRIC_TAB_MAP = {
    peak: 'peak',
    auc: 'auc',
    fwhm: 'event_fwhm',
    frequency: 'event_frequency',
    ttp: 'time_to_peak',
    decay: 'decay_t_half',
    rise: 'rate_of_rise',
    tg_peak: 'tg_peak',
    tg_slope: 'tg_slope',
    tg_auc: 'tg_auc',
    addback_peak: 'addback_peak',
    addback_slope: 'addback_slope',
    addback_auc: 'addback_auc',
    addback_latency: 'addback_latency',
};

export const BASE_LAYOUT = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { color: '#1f2937', family: 'system-ui, sans-serif', size: 12 },
    margin: { t: 34, r: 10, b: 42, l: 50, pad: 2 },
    xaxis: {
        gridcolor: '#e3ebf5',
        zerolinecolor: '#d2ddeb',
        linecolor: '#c6d3e3',
        showgrid: true,
        automargin: true,
    },
    yaxis: {
        gridcolor: '#e3ebf5',
        zerolinecolor: '#d2ddeb',
        linecolor: '#c6d3e3',
        showgrid: true,
        automargin: true,
    },
    legend: { bgcolor: 'rgba(0,0,0,0)', bordercolor: 'rgba(0,0,0,0)' },
    showlegend: true,
};

export const DEFAULT_CONTROL_VALUES = {
    fontFamily: 'system-ui, sans-serif',
    plotTitleFontSize: 13,
    xAxisTitleFontSize: 11,
    yAxisTitleFontSize: 11,
    xAxisTickFontSize: 12,
    xAxisTickAngle: '0',
    yAxisTickFontSize: 12,
    legendFontSize: 12,
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
};

export const PREFERENCES_STORAGE_KEY = 'calcium-multi-analysis-preferences-v1';
export const SESSION_LAYOUT_STORAGE_KEY = 'calcium-multi-analysis-session-v1';

export const state = {
    files: new Map(),
    uploadJobs: new Map(),
    sessionMemoryLimitBytes: 0,
    browserWarnFileBytes: 0,
    parseTimeoutSeconds: 0,
    currentTab: 'raw',
    plotStyle: 'violin',
    refreshTimer: null,
    condPalette: 'default',
    condColorMap: {},
    manualConditionOrder: [],
    labelOverrides: {},
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
        xMin: '',
        xMax: '',
        yMin: '',
        yMax: '',
        rotate: false,
        showGrid: true,
        showConditionLegend: true,
        showReplicateLegend: true,
        fontFamily: 'system-ui, sans-serif',
        plotTitleFontSize: 13,
        xAxisTitleFontSize: 11,
        yAxisTitleFontSize: 11,
        xAxisTickFontSize: 12,
        xAxisTickAngle: '0',
        yAxisTickFontSize: 12,
        legendFontSize: 12,
    },
};
