import { DEFAULT_CONTROL_VALUES, PREFERENCES_STORAGE_KEY, SESSION_LAYOUT_STORAGE_KEY, state } from './state.js';
import { getDom } from './dom.js';

export function persistPreferences() {
    try {
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
            condColorMap: state.condColorMap,
            manualConditionOrder: state.manualConditionOrder,
            labelOverrides: state.labelOverrides,
            controls: state.controls,
            plotStyle: state.plotStyle,
            currentTab: state.currentTab,
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
            if (Array.isArray(saved.manualConditionOrder)) {
                state.manualConditionOrder = [...saved.manualConditionOrder];
            }
            if (saved.labelOverrides && typeof saved.labelOverrides === 'object') {
                state.labelOverrides = { ...state.labelOverrides, ...saved.labelOverrides };
            }
            if (saved.controls && typeof saved.controls === 'object') {
                state.controls = { ...state.controls, ...saved.controls };
            }
            if (typeof saved.plotStyle === 'string') {
                state.plotStyle = saved.plotStyle;
            }
            if (typeof saved.currentTab === 'string') {
                state.currentTab = saved.currentTab;
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
        if (condition) {
            assignments[info.file_name] = condition;
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
        const condition = assignments[fileName];
        return typeof condition === 'string' ? condition : '';
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
