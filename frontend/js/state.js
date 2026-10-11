import { plotColor } from './theme.js';
export const MAX_FILES = 50;

export const PALETTES = {
    default: [
        '#4c8cff', '#ff6b6b', '#51cf66', '#ffd43b',
        '#cc5de8', '#ff922b', '#22d3ee', '#f06595',
        '#74c0fc', '#a9e34b', '#ff6348', '#2ed573',
    ],
    // Okabe & Ito (2008) — the standard colorblind-safe qualitative palette
    'okabe-ito': [
        '#E69F00', '#56B4E9', '#009E73', '#F0E442',
        '#0072B2', '#D55E00', '#CC79A7', '#999999',
    ],
    // Paul Tol, "bright" qualitative scheme — colorblind-safe
    'tol-bright': [
        '#4477AA', '#66CCEE', '#228833', '#CCBB44',
        '#EE6677', '#AA3377', '#BBBBBB',
    ],
    // Paul Tol, "muted" qualitative scheme — colorblind-safe, print-friendly
    'tol-muted': [
        '#332288', '#88CCEE', '#44AA99', '#117733',
        '#999933', '#DDCC77', '#CC6677', '#882255', '#AA4499',
    ],
    // ColorBrewer Dark2 — colorblind-safe qualitative
    'dark2': [
        '#1B9E77', '#D95F02', '#7570B3', '#E7298A',
        '#66A61E', '#E6AB02', '#A6761D', '#666666',
    ],
    // NPG (Nature Publishing Group, via ggsci) — journal-style figures
    'npg': [
        '#E64B35', '#4DBBD5', '#00A087', '#3C5488',
        '#F39B7F', '#8491B4', '#91D1C2', '#DC0000',
        '#7E6148', '#B09C85',
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

export const DAY_PALETTE = [
    '#E69F00', '#56B4E9', '#009E73', '#F0E442',
    '#0072B2', '#D55E00', '#CC79A7', '#999999',
];

export const DAY_SYMBOLS = REPLICATE_SYMBOLS;

const dayDisplayLabels = new Map();

export function normalizeDay(value) {
    const typed = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!typed) return { key: '', label: '' };
    const key = typed.toLowerCase();
    if (!dayDisplayLabels.has(key)) dayDisplayLabels.set(key, typed);
    return { key, label: dayDisplayLabels.get(key) };
}

export function dayKey(value) {
    return normalizeDay(value).key;
}

export function dayDisplayLabel(key) {
    return dayDisplayLabels.get(key) || key;
}

export function sortedDayKeys() {
    const keys = new Set();
    for (const file of state.files.values()) {
        const { key } = normalizeDay(file.day);
        if (key) keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function dayColorForKey(key) {
    if (!key) return null;
    const index = sortedDayKeys().indexOf(key);
    if (index < 0) return null;
    const color = DAY_PALETTE[index % DAY_PALETTE.length];
    state.dayColorMap[key] = color;
    return plotColor(color);
}

export function daySymbolForKey(key) {
    if (!key) return null;
    const index = sortedDayKeys().indexOf(key);
    if (index < 0) return null;
    return DAY_SYMBOLS[index % DAY_SYMBOLS.length];
}

export function assignDayColor(day) {
    return dayColorForKey(dayKey(day));
}

export const state = {
    files: new Map(),
    uploadJobs: new Map(),
    maxFiles: MAX_FILES,
    sessionMemoryLimitBytes: 0,
    browserWarnFileBytes: 0,
    parseTimeoutSeconds: 0,
    projectId: null,
    currentTab: 'raw',
    plotStyle: 'violin',
    refreshTimer: null,
    condPalette: 'default',
    condColorMap: {},
    dayColorMap: {},
    groupByDay: false,
    hiddenConditions: [],
    manualConditionOrder: [],
    labelOverrides: {},
    paneTemplates: {},
    controls: {
        summaryStat: 'mean',
        errorBars: 'sem',
        showTraceErrorBand: true,
        showTraceErrorBounds: false,
        showTraceReplicates: true,
        pointSize: 5,
        pointAlpha: 0.45,
        meanSize: 11,
        jitter: 0.18,
        paired: false,
        poolByDay: false,
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
        showSignificance: false,
        showWarnings: true,
        excludeOutliers: false,
        outlierMethod: 'iqr',
        statsPanelOpen: false,
        summaryPanelOpen: false,
        summaryPanelTab: 'per-replicate',
        summaryReferenceCondition: '',
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
