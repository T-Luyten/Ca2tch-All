import {
    buildGroups,
    isConditionVisible,
    condColor,
    currentConditionNames,
    replicateColor,
    replicateSymbol,
    syncManualConditionOrder,
} from './core.js';
import { MAX_FILES, normalizeDay, state } from './state.js';

const dom = {
    initialized: false,
    byId: {},
    plotPanes: [],
    tabButtons: [],
    styleButtons: [],
    controlElements: [],
    xRangeSections: [],
};

function initDomCache() {
    if (dom.initialized) return dom;
    dom.byId = {
        statusBar: document.getElementById('status-bar'),
        styleBar: document.getElementById('style-bar'),
        plotPlaceholder: document.getElementById('plot-placeholder'),
        fileCount: document.getElementById('file-count'),
        fileInput: document.getElementById('file-input'),
        dropHint: document.getElementById('drop-hint'),
        uploadJobList: document.getElementById('upload-job-list'),
        conditionDatalist: document.getElementById('condition-datalist'),
        fileList: document.getElementById('file-list'),
        condPalette: document.getElementById('cond-palette'),
        conditionLegendPanel: document.getElementById('condition-legend-panel'),
        conditionLegend: document.getElementById('condition-legend'),
        replicateLegendPanel: document.getElementById('replicate-legend-panel'),
        replicateLegend: document.getElementById('replicate-legend'),
        pointSizeValue: document.getElementById('point-size-value'),
        pointAlphaValue: document.getElementById('point-alpha-value'),
        jitterValue: document.getElementById('jitter-value'),
        formatContextNote: document.getElementById('format-context-note'),
        hiddenMetricsNote: document.getElementById('hidden-metrics-note'),
        traceExclusionNote: document.getElementById('trace-exclusion-note'),
        filesPanel: document.getElementById('files-panel'),
        controlsPanel: document.getElementById('controls-panel'),
        formatControls: document.getElementById('format-controls'),
        plotTitleOverride: document.getElementById('plot-title-override'),
        xLabelOverride: document.getElementById('x-label-override'),
        yLabelOverride: document.getElementById('y-label-override'),
        resetLabelsBtn: document.getElementById('reset-labels-btn'),
        resetTypographyBtn: document.getElementById('reset-typography-btn'),
        resetRangesBtn: document.getElementById('reset-ranges-btn'),
        themeToggle: document.getElementById('theme-toggle'),
        comparabilityPanel: document.getElementById('comparability-panel'),
        comparabilityContent: document.getElementById('comparability-content'),
        comparabilityToggleIcon: document.getElementById('comparability-toggle-icon'),
        statsPanel: document.getElementById('stats-panel'),
        statsContent: document.getElementById('stats-content'),
        statsToggleIcon: document.getElementById('stats-toggle-icon'),
        statsHeader: document.getElementById('stats-header'),
        summaryPanel: document.getElementById('summary-panel'),
        summaryContent: document.getElementById('summary-content'),
        summaryToggleIcon: document.getElementById('summary-toggle-icon'),
        summaryHeader: document.getElementById('summary-header'),
    };
    dom.plotPanes = [...document.querySelectorAll('.plot-pane')];
    dom.tabButtons = [...document.querySelectorAll('.tab-btn')];
    dom.styleButtons = [...document.querySelectorAll('.style-btn')];
    dom.controlElements = [...document.querySelectorAll('[data-control]')];
    dom.xRangeSections = [...document.querySelectorAll('[data-format-section="x-range"]')];
    dom.initialized = true;
    return dom;
}

export function getDom() {
    return initDomCache();
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function noDataMessageMarkup(message) {
    return `<div style="color:var(--muted);padding:24px;text-align:center">${escapeHtml(message)}</div>`;
}

function fileRowMarkup(fid, info) {
    const color = info.condition ? condColor(info.condition) : '#444';
    const name = info.file_name || '';
    const condition = info.condition || '';
    const day = info.day || '';
    const traceNote = info.trace_status ? ` · ${info.trace_status}` : '';
    const meta = `${info.n_rois} ROIs · ${info.analysis_mode || 'single'}${traceNote}`;
    const warnings = Array.isArray(info.warnings) ? info.warnings.filter(Boolean) : [];
    const restoredBadge = info.assignment_source === 'restored' && condition
        ? `<span class="file-badge file-badge-restored" title="Condition restored from the previous session layout">${escapeHtml(`Restored: ${condition}`)}</span>`
        : '';
    return `
      <div class="file-row" id="file-row-${fid}">
        <div class="file-color-bar" id="cbar-${fid}" style="background:${color}"></div>
        <div class="file-info">
          <span class="file-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="file-meta">${escapeHtml(meta)}</span>
          ${restoredBadge}
          ${info.provenance ? `<details class="source-details">
            <summary>Source details</summary>
            <div>Source ID: ${escapeHtml(info.provenance.source_id)}</div>
            <div>Uploaded: ${escapeHtml(info.provenance.uploaded_at)}</div>
            <div>Workbook size: ${escapeHtml(info.provenance.size_bytes)} bytes</div>
            <div>SHA-256: ${escapeHtml(info.provenance.sha256)}</div>
          </details>` : ''}
          ${warnings.length ? `<span class="file-warning" title="${escapeHtml(warnings.join(' '))}">${escapeHtml(warnings[0])}</span>` : ''}
        </div>
        <div class="file-inputs">
          <input
            type="text"
            class="condition-input"
            placeholder="Condition…"
            value="${escapeHtml(condition)}"
            data-fid="${fid}"
            list="condition-datalist"
          >
          <input
            type="text"
            class="day-input"
            placeholder="Day (e.g. 2024-01-15)"
            value="${escapeHtml(day)}"
            data-fid="${fid}"
            data-field="day"
          >
        </div>
        <button class="delete-file-btn" data-fid="${fid}" title="Remove file">×</button>
      </div>`;
}

function uploadJobMarkup(job) {
    const progress = Math.max(0, Math.min(Number(job.progress) || 0, 1)) * 100;
    const isActive = job.status === 'queued' || job.status === 'running';
    return `
      <div class="upload-job" data-status="${escapeHtml(job.status || 'queued')}">
        <div class="upload-job-header">
          <span class="upload-job-name" title="${escapeHtml(job.file_name || job.filename || '')}">${escapeHtml(job.file_name || job.filename || 'Upload')}</span>
          <span class="upload-job-state">${escapeHtml(job.status || 'queued')}</span>
          <span class="upload-job-actions">
            ${isActive
                ? `<button type="button" class="upload-job-btn" data-upload-action="cancel" data-job-id="${escapeHtml(job.job_id || '')}">Cancel</button>`
                : `<button type="button" class="upload-job-btn" data-upload-action="dismiss" data-job-id="${escapeHtml(job.job_id || '')}">Dismiss</button>`}
          </span>
        </div>
        <div class="upload-job-progress" aria-hidden="true">
          <div class="upload-job-progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="upload-job-message" data-warning="${job.is_warning && (job.status === 'completed' || String(job.message || '').startsWith('Large file warning:')) ? 'true' : 'false'}">${escapeHtml(job.message || '')}</div>
      </div>`;
}

function conditionOrderButtonsMarkup(condition, index, total) {
    return `
      <button class="legend-order-btn" data-cond="${escapeHtml(condition)}" data-move="-1" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="legend-order-btn" data-cond="${escapeHtml(condition)}" data-move="1" title="Move down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
    `;
}

function conditionLegendRowMarkup(condition, index, total) {
    const color = condColor(condition);
    const count = [...state.files.values()].filter(file => file.condition === condition).length;
    const showManualControls = state.controls.conditionOrder === 'manual';
    return `
      <div class="legend-row condition-order-row">
        <span class="legend-dot" style="background:${color}"></span>
        <span class="legend-name">${escapeHtml(condition)}</span>
        <span class="legend-count">${count} file${count !== 1 ? 's' : ''}</span>
        <span class="legend-controls">
          <input class="legend-color-input" type="color" value="${state.condColorMap[condition] || color}" data-cond="${escapeHtml(condition)}" title="Choose color for ${escapeHtml(condition)}">
          <button class="legend-reset-btn" data-cond="${escapeHtml(condition)}" title="Reset ${escapeHtml(condition)} to default color">↺</button>
          ${showManualControls ? conditionOrderButtonsMarkup(condition, index, total) : ''}
        </span>
      </div>`;
}

function replicateLegendRowMarkup(index) {
    const symbol = replicateSymbol(index);
    return `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${replicateColor(index)}">${symbol === 'circle' ? '●' : ''}</span>
        <span class="legend-name">Replicate ${index + 1}</span>
        <span class="legend-count">${escapeHtml(symbol)}</span>
      </div>`;
}

export function registerDynamicTabElements(btn, pane) {
    const d = initDomCache();
    d.tabButtons.push(btn);
    d.plotPanes.push(pane);
}

export function cachePaneTemplates() {
    initDomCache().plotPanes.forEach(pane => {
        state.paneTemplates[pane.id] = pane.innerHTML;
    });
}

export function setStatus(message, isWarning = false) {
    const status = getDom().byId.statusBar;
    if (status) status.dataset.warning = String(isWarning);
    initDomCache().byId.statusBar.textContent = message;
}

export function showPlaceholder(message) {
    const { byId, plotPanes } = initDomCache();
    const placeholder = byId.plotPlaceholder;
    placeholder.textContent = message;
    placeholder.style.display = 'flex';
    plotPanes.forEach(pane => {
        pane.style.display = 'none';
    });
}

export function hidePlaceholder() {
    initDomCache().byId.plotPlaceholder.style.display = 'none';
}

export function showPane(id) {
    initDomCache().plotPanes.forEach(pane => {
        pane.style.display = pane.id === id ? '' : 'none';
    });
}

export function restorePane(paneId) {
    const pane = document.getElementById(paneId);
    if (!pane) return;
    const template = state.paneTemplates[paneId];
    if (template !== undefined && pane.innerHTML !== template) {
        pane.innerHTML = template;
    }
}

export function showNoDataMessage(paneId, message) {
    const pane = document.getElementById(paneId);
    if (pane) pane.innerHTML = noDataMessageMarkup(message);
}

export function updateFileCount() {
    const { byId } = initDomCache();
    const count = state.files.size;
    byId.fileCount.textContent = `${count} / ${state.maxFiles} files max`;
    byId.fileInput.disabled = count >= state.maxFiles;
    byId.dropHint.style.display = count === 0 ? '' : 'none';
}

export function updateUploadJobs() {
    const list = initDomCache().byId.uploadJobList;
    if (!list) return;
    const jobs = [...state.uploadJobs.values()];
    list.innerHTML = jobs.map(uploadJobMarkup).join('');
    list.style.display = jobs.length ? '' : 'none';
}

export function refreshDatalist() {
    const conditions = [...new Set([...state.files.values()].map(file => file.condition).filter(Boolean))];
    initDomCache().byId.conditionDatalist.innerHTML = conditions.map(condition => `<option value="${escapeHtml(condition)}">`).join('');
}

export function renderFileList() {
    const list = initDomCache().byId.fileList;
    if (state.files.size === 0) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = [...state.files.entries()].map(([fid, info]) => fileRowMarkup(fid, info)).join('');
    refreshDatalist();
}

export function updateConditionLegend() {
    const conditions = currentConditionNames();
    state.hiddenConditions = state.hiddenConditions.filter(condition => conditions.includes(condition));
    renderConditionVisibility(conditions);
    const { byId } = initDomCache();
    const panel = byId.conditionLegendPanel;
    const legend = byId.conditionLegend;
    if (!conditions.length) {
        panel.style.display = 'none';
        return;
    }
    const ordered = state.controls.conditionOrder === 'manual'
        ? [...syncManualConditionOrder()]
        : conditions;
    panel.style.display = '';
    legend.innerHTML = ordered.map((cond, index) => conditionLegendRowMarkup(cond, index, ordered.length)).join('');
}

export function updateReplicateLegend() {
    const { byId } = initDomCache();
    const panel = byId.replicateLegendPanel;
    const legend = byId.replicateLegend;
    const groups = Object.fromEntries(Object.entries(buildGroups()).filter(([condition]) => isConditionVisible(condition)));
    const traceTab = state.currentTab === 'raw' || state.currentTab === 'delta';
    const maxReplicates = Math.max(0, ...Object.values(groups).map(group => {
        const members = group.filter(fid => !traceTab || (state.currentTab === 'delta'
            ? state.files.get(fid)?.has_delta_f !== false : state.files.get(fid)?.has_traces !== false));
        return new Set(members.map(fid => {
            const day = normalizeDay(state.files.get(fid)?.day).key;
            return state.controls.poolByDay && day ? `day:${day}` : fid;
        })).size;
    }));
    if (maxReplicates <= 0 || traceTab && state.controls.showTraceReplicates === false) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    legend.innerHTML = Array.from({ length: maxReplicates }, (_, i) => replicateLegendRowMarkup(i)).join('');
}

export function updateFileColorBar(fid) {
    const info = state.files.get(fid);
    const bar = document.getElementById(`cbar-${fid}`);
    if (bar && info) bar.style.background = info.condition ? condColor(info.condition) : '#444';
}

export function syncControlsToState() {
    const { byId, controlElements } = initDomCache();
    controlElements.forEach(el => {
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
    byId.pointSizeValue.textContent = state.controls.pointSize;
    byId.pointAlphaValue.textContent = Number(state.controls.pointAlpha).toFixed(2);
    byId.jitterValue.textContent = Number(state.controls.jitter).toFixed(2);
}

export function renderConditionVisibility(conditions = currentConditionNames()) {
    const list = document.getElementById('condition-visibility');
    if (!list) return;
    list.innerHTML = conditions.length ? conditions.map(condition => `
        <label class="condition-visibility-row">
          <input type="checkbox" data-visible-condition="${escapeHtml(condition)}" ${isConditionVisible(condition) ? 'checked' : ''}>
          <span class="condition-visibility-swatch" style="background:${condColor(condition)}" aria-hidden="true"></span>
          <span>${escapeHtml(condition)}</span>
        </label>`).join('') : '<span class="control-note-text">Assign condition names to your files.</span>';
    const showAll = document.getElementById('show-all-conditions');
    if (showAll) showAll.disabled = !conditions.some(condition => !isConditionVisible(condition));
}
