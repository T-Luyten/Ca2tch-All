import { DEFAULT_CONTROL_VALUES, normalizeDay, PREFERENCES_STORAGE_KEY, SESSION_LAYOUT_STORAGE_KEY, state } from './state.js';
import { getDom } from './dom.js';

export function persistPreferences() {
    try {
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
            condColorMap: state.condColorMap,
            dayColorMap: state.dayColorMap,
            condPalette: state.condPalette,
            manualConditionOrder: state.manualConditionOrder,
            labelOverrides: state.labelOverrides,
            controls: state.controls,
            plotStyle: state.plotStyle,
            currentTab: state.currentTab,
            groupByDay: state.groupByDay,
        }));
    } catch (_) {
        // Ignore localStorage failures.
    }

    persistSessionLayout();
}

export function restorePreferences() {
    try {
        const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
            if (saved.condColorMap && typeof saved.condColorMap === 'object') {
                state.condColorMap = { ...state.condColorMap, ...saved.condColorMap };
            }
            if (saved.dayColorMap && typeof saved.dayColorMap === 'object') {
                const entries = Object.entries(saved.dayColorMap)
                    .map(([day, color]) => [normalizeDay(day).key, color])
                    .filter(([key]) => !!key);
                const values = entries.map(([, color]) => color);
                const hasDuplicates = values.length !== new Set(values).size;
                state.dayColorMap = hasDuplicates ? {} : { ...state.dayColorMap, ...Object.fromEntries(entries) };
            }
            if (Array.isArray(saved.manualConditionOrder)) {
                state.manualConditionOrder = [...saved.manualConditionOrder];
            }
            if (saved.labelOverrides && typeof saved.labelOverrides === 'object') {
                state.labelOverrides = { ...state.labelOverrides, ...saved.labelOverrides };
            }
            if (saved.controls && typeof saved.controls === 'object') {
                state.controls = { ...state.controls, ...saved.controls };
            }
            if (typeof saved.condPalette === 'string') {
                state.condPalette = saved.condPalette;
            }
            if (typeof saved.plotStyle === 'string') {
                state.plotStyle = saved.plotStyle;
            }
            if (typeof saved.currentTab === 'string') {
                state.currentTab = saved.currentTab;
            }
            if (typeof saved.groupByDay === 'boolean') {
                state.groupByDay = saved.groupByDay;
            }
        }
    } catch (_) {
        // Ignore malformed saved preferences.
    }
}

function buildSessionAssignments() {
    const assignments = {};
    for (const info of state.files.values()) {
        if (!info?.file_name) continue;
        const condition = String(info.condition || '').trim();
        const day = normalizeDay(info.day).label;
        if (condition || day) {
            assignments[info.file_name] = { condition, day };
        }
    }
    return assignments;
}

export function persistSessionLayout() {
    try {
        sessionStorage.setItem(SESSION_LAYOUT_STORAGE_KEY, JSON.stringify({
            fileAssignments: buildSessionAssignments(),
        }));
    } catch (_) {
        // Ignore sessionStorage failures.
    }
}

export function restoreConditionForFile(fileName) {
    try {
        const raw = sessionStorage.getItem(SESSION_LAYOUT_STORAGE_KEY);
        if (!raw) return '';
        const saved = JSON.parse(raw);
        const assignments = saved?.fileAssignments;
        if (!assignments || typeof assignments !== 'object') return '';
        const entry = assignments[fileName];
        if (typeof entry === 'string') return entry; // legacy format
        if (entry && typeof entry === 'object') return entry.condition || '';
        return '';
    } catch (_) {
        return '';
    }
}

export function restoreDayForFile(fileName) {
    try {
        const raw = sessionStorage.getItem(SESSION_LAYOUT_STORAGE_KEY);
        if (!raw) return '';
        const saved = JSON.parse(raw);
        const assignments = saved?.fileAssignments;
        if (!assignments || typeof assignments !== 'object') return '';
        const entry = assignments[fileName];
        if (entry && typeof entry === 'object') return entry.day || '';
        return '';
    } catch (_) {
        return '';
    }
}

export function setControlElementValue(key, value) {
    const el = getDom().controlElements.find(candidate => candidate.dataset.control === key);
    if (!el) return;
    if (el.type === 'checkbox') {
        el.checked = !!value;
        return;
    }
    el.value = value;
}

export function resetControls(keys) {
    keys.forEach(key => {
        if (!(key in DEFAULT_CONTROL_VALUES)) return;
        state.controls[key] = DEFAULT_CONTROL_VALUES[key];
        setControlElementValue(key, DEFAULT_CONTROL_VALUES[key]);
    });
}

export function applyControlsToDom() {
    Object.entries(state.controls).forEach(([key, value]) => {
        setControlElementValue(key, value);
    });
}

export function applyPlotStyleToDom() {
    getDom().styleButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === state.plotStyle);
    });
}
