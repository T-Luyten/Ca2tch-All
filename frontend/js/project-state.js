import { PALETTES, state } from './state.js';

const defaultControls = { ...state.controls };
const workspaceFields = ['controls', 'currentTab', 'plotStyle', 'condPalette', 'condColorMap',
    'dayColorMap', 'manualConditionOrder', 'labelOverrides', 'groupByDay', 'hiddenConditions'];

export function captureProjectWorkspace(extra = {}) {
    return JSON.parse(JSON.stringify(Object.fromEntries([
        ...workspaceFields.map(key => [key, state[key]]), ...Object.entries(extra),
    ])));
}

function colorMap(value) {
    return Object.fromEntries(Object.entries(value || {}).filter(([key, color]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key)
        && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)));
}

export function restoreProjectWorkspace(workspace) {
    const controls = { ...defaultControls };
    for (const [key, defaultValue] of Object.entries(defaultControls)) {
        const value = workspace.controls?.[key];
        if (['xMin', 'xMax', 'yMin', 'yMax'].includes(key)
            && (value === '' || typeof value === 'number' && Number.isFinite(value))) {
            controls[key] = value;
            continue;
        }
        if (typeof value === typeof defaultValue
            && (typeof value !== 'number' || Number.isFinite(value))
            && (typeof value !== 'string' || value.length <= 1000)) controls[key] = value;
    }
    // Keep panel opening explicit when entering a project.
    controls.statsPanelOpen = false;
    controls.summaryPanelOpen = false;
    state.controls = controls;
    state.hiddenConditions = Array.isArray(workspace.hiddenConditions)
        ? [...new Set(workspace.hiddenConditions.filter(value => typeof value === 'string'))] : [];
    state.currentTab = typeof workspace.currentTab === 'string' ? workspace.currentTab : 'raw';
    state.plotStyle = ['violin', 'bar', 'box', 'strip', 'raincloud'].includes(workspace.plotStyle) ? workspace.plotStyle : 'violin';
    state.condPalette = Object.hasOwn(PALETTES, workspace.condPalette) ? workspace.condPalette : 'default';
    state.condColorMap = colorMap(workspace.condColorMap);
    state.dayColorMap = colorMap(workspace.dayColorMap);
    state.manualConditionOrder = (Array.isArray(workspace.manualConditionOrder) ? workspace.manualConditionOrder : []).filter(value => typeof value === 'string');
    state.labelOverrides = Object.fromEntries(Object.entries(workspace.labelOverrides || {}).filter(([key]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, value]) => [key,
        Object.fromEntries(['title', 'x', 'y'].filter(axis => typeof value?.[axis] === 'string')
            .map(axis => [axis, value[axis]])),
    ]));
    state.groupByDay = workspace.groupByDay === true;
}
