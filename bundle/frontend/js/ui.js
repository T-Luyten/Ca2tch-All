import { bindFormatControlEvents } from './format-events.js';
import { bindProjectControls } from './project.js';
import { renderSummaryContent } from './summary-panel.js';
import { apiCancelUpload, apiDelete, apiDeleteAll, apiSessionMeta, apiStartUpload, apiUploadStatus } from './api.js';
import { renderComparabilityDashboard } from './comparability-panel.js';
import {
    applyPalette,
    assignColor,
    buildGroups,
    moveManualCondition,
    resizeVisiblePlots,
    applyWarningVisibility,
    resetConditionColor,
    resetLabelOverrides,
    setActiveTab,
    setConditionColor,
    setLabelOverride,
    syncManualConditionOrder,
    updateFormatPanelContext,
} from './core.js';
import {
    applyControlsToDom,
    applyPlotStyleToDom,
    persistPreferences,
    resetControls,
    restoreConditionForFile,
    restoreDayForFile,
    restorePreferences,
} from './preferences.js';
import {
    cachePaneTemplates,
    getDom,
    refreshDatalist,
    registerDynamicTabElements,
    renderFileList,
    setStatus,
    showPlaceholder,
    syncControlsToState,
    updateConditionLegend,
    updateFileColorBar,
    updateFileCount,
    updateReplicateLegend,
    updateUploadJobs,
} from './dom.js';
import { registerDynamicMetricTarget, scheduleRefresh } from './plot-controller.js';
import { assignDayColor, dayKey, MAX_FILES, METRIC_TAB_MAP, normalizeDay, state } from './state.js';
import { getTheme, initTheme, toggleTheme } from './theme.js';
import { maybeStartTour } from './tour.js';

function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function upsertUploadJob(jobId, patch) {
    const current = state.uploadJobs.get(jobId) || { job_id: jobId };
    state.uploadJobs.set(jobId, { ...current, ...patch });
    updateUploadJobs();
}

function removeUploadJob(jobId) {
    state.uploadJobs.delete(jobId);
    updateUploadJobs();
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

const _knownMetricKeys = new Set(Object.values(METRIC_TAB_MAP));

function ensureMetricTabs(availableMetrics) {
    if (!Array.isArray(availableMetrics)) return;
    for (const metric of availableMetrics) {
        if (_knownMetricKeys.has(metric)) continue;
        _knownMetricKeys.add(metric);

        const label = metric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const plotId = `plot-dyn-${metric.replace(/_/g, '-')}`;
        const paneId = `pane-${metric}`;

        METRIC_TAB_MAP[metric] = metric;
        registerDynamicMetricTarget(metric, plotId);

        const tabsEl = document.getElementById('plot-tabs');
        const btn = document.createElement('button');
        btn.className = 'tab-btn';
        btn.dataset.tab = metric;
        btn.textContent = label;
        btn.style.display = 'none';
        tabsEl.appendChild(btn);

        const plotContent = document.getElementById('plot-content');
        const pane = document.createElement('div');
        pane.id = paneId;
        pane.className = 'plot-pane';
        pane.style.display = 'none';
        const plotDiv = document.createElement('div');
        plotDiv.id = plotId;
        plotDiv.className = 'plot-div';
        pane.appendChild(plotDiv);
        plotContent.appendChild(pane);

        registerDynamicTabElements(btn, pane);
        state.paneTemplates[paneId] = pane.innerHTML;
    }
}

function traceStatusLabel(result) {
    if (result.has_traces || result.has_delta_f) return '';
    if ((result.warnings || []).length) return 'traces skipped';
    return 'no traces';
}

async function waitForUploadJob(jobId, fileName) {
    for (;;) {
        const status = await apiUploadStatus(jobId);
        upsertUploadJob(jobId, {
            file_name: fileName,
            status: status.status,
            progress: status.progress,
            message: status.message,
        });
        if (status.status === 'completed') return status.result;
        if (status.status === 'canceled') {
            const error = new Error(status.error?.message || status.message || 'Upload canceled');
            error.code = status.error?.code || 'upload_canceled';
            throw error;
        }
        if (status.status === 'failed') {
            const error = new Error(status.error?.message || status.message || 'Upload failed');
            error.code = status.error?.code || '';
            throw error;
        }
        await delay(350);
    }
}

async function removeFiles(fileIds, statusMessage) {
    const ids = Array.from(new Set(fileIds)).filter(fid => state.files.has(fid));
    if (!ids.length) return 0;
    setStatus(statusMessage);
    try {
        for (const fid of ids) {
            await apiDelete(fid);
            state.files.delete(fid);
        }
    } catch (err) {
        setStatus(`Failed to remove file(s): ${err.message}`);
        return 0;
    }
    // Clean up dayColorMap entries for days that no longer have any files
    const remainingDays = new Set([...state.files.values()].map(f => dayKey(f.day)).filter(Boolean));
    for (const day of Object.keys(state.dayColorMap)) {
        if (!remainingDays.has(day)) {
            delete state.dayColorMap[day];
        }
    }
    syncManualConditionOrder();
    renderFileList();
    updateFileCount();
    updateConditionLegend();
    updateReplicateLegend();
    persistPreferences();
    scheduleRefresh(buildGroups);
    setStatus('');
    return ids.length;
}

async function handleFiles(fileList) {
    const files = Array.from(fileList)
        .filter(file => /\.(xlsx|xls)$/i.test(file.name))
        .slice(0, state.maxFiles - state.files.size);

    if (!files.length) return;

    const loadedNames = new Set([...state.files.values()].map(info => info.file_name));
    const duplicates = files.filter(f => loadedNames.has(f.name)).map(f => f.name);
    if (duplicates.length) {
        const list = duplicates.join('\n  • ');
        const proceed = window.confirm(
            `The following file${duplicates.length > 1 ? 's are' : ' is'} already loaded:\n\n  • ${list}\n\nUpload again anyway?`
        );
        if (!proceed) return;
    }

    let restoredAssignments = 0;
    const restoredConditions = new Set();

    for (const file of files) {
        const localJobId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let activeJobId = localJobId;
        const warnBytes = Number(state.browserWarnFileBytes) || 0;
        const precheckMessage = warnBytes > 0 && file.size > warnBytes
            ? `Large file warning: ${file.name} is ${formatBytes(file.size)} on disk. Parsing may be slow and trace sheets may be skipped.`
            : `Preparing ${file.name}…`;
        upsertUploadJob(localJobId, {
            file_name: file.name,
            status: 'queued',
            progress: 0.02,
            message: precheckMessage,
            is_warning: precheckMessage.startsWith('Large file warning:'),
        });
        setStatus(precheckMessage, precheckMessage.startsWith('Large file warning:'));
        try {
            const started = await apiStartUpload(file);
            activeJobId = started.job_id || localJobId;
            if (activeJobId !== localJobId) {
                removeUploadJob(localJobId);
            }
            upsertUploadJob(activeJobId, {
                file_name: file.name,
                status: started.status,
                progress: started.progress,
                message: started.message,
            });
            const result = await waitForUploadJob(activeJobId, file.name);
            const restoredCondition = restoreConditionForFile(result.file_name).trim();
            const restoredDay = normalizeDay(restoreDayForFile(result.file_name)).label;
            if (restoredCondition) assignColor(restoredCondition);
            if (restoredDay) assignDayColor(restoredDay);
            if (restoredCondition) {
                restoredAssignments += 1;
                restoredConditions.add(restoredCondition);
            }
            state.files.set(result.file_id, {
                id: result.file_id,
                provenance: result.provenance,
                file_name: result.file_name,
                n_rois: result.n_rois,
                condition: restoredCondition,
                day: restoredDay || undefined,
                baseline: result.baseline || 0,
                assignment_source: restoredCondition ? 'restored' : 'manual',
                analysis_mode: result.analysis_mode,
                signal_mode: result.signal_mode,
                memory_bytes: result.memory_bytes || 0,
                available_metrics: result.available_metrics || [],
                warnings: result.warnings || [],
                has_traces: !!result.has_traces,
                has_delta_f: !!result.has_delta_f,
                trace_status: traceStatusLabel(result),
            });
            ensureMetricTabs(result.available_metrics);
            state.sessionMemoryLimitBytes = Number(result.max_total_session_bytes) || state.sessionMemoryLimitBytes;
            const warningMessage = (result.warnings || []).join(' ');
            upsertUploadJob(activeJobId, {
                file_name: result.file_name,
                status: 'completed',
                progress: 1,
                message: warningMessage || 'Upload complete.',
                is_warning: !!warningMessage,
            });
            if (!warningMessage) {
                window.setTimeout(() => removeUploadJob(activeJobId), 1500);
            }
        } catch (err) {
            upsertUploadJob(activeJobId, {
                file_name: file.name,
                status: err.code === 'upload_canceled' ? 'canceled' : 'failed',
                progress: 1,
                message: err.message,
            });
            setStatus(
                err.code === 'upload_canceled'
                    ? `Canceled ${file.name}.`
                    : `Failed to load ${file.name}: ${err.message}`,
            );
            return;
        }
    }

    syncManualConditionOrder();
    renderFileList();
    updateFileCount();
    updateConditionLegend();
    updateReplicateLegend();
    persistPreferences();
    scheduleRefresh(buildGroups);
    if (restoredAssignments > 0) {
        const conditionSummary = [...restoredConditions].join(', ');
        setStatus(
            `Restored ${restoredAssignments} saved condition assignment${restoredAssignments === 1 ? '' : 's'}${conditionSummary ? `: ${conditionSummary}.` : '.'}`,
        );
        window.setTimeout(() => setStatus(''), 2600);
        return;
    }
    setStatus('');
}

function handleControlsChanged(buildGroups) {
    syncControlsToState();
    updateConditionLegend();
    persistPreferences();
    scheduleRefresh(buildGroups);
}

function dismissSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    splash.style.transition = 'opacity 0.8s ease';
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 900);
}

export function bootstrap() {
    cachePaneTemplates();
    initTheme();
    const { byId, filesPanel, styleButtons, tabButtons } = {
        byId: getDom().byId,
        filesPanel: getDom().byId.filesPanel,
        styleButtons: getDom().styleButtons,
        tabButtons: getDom().tabButtons,
    };

    if (byId.themeToggle) {
        const updateToggleLabel = () => {
            byId.themeToggle.textContent = getTheme() === 'dark' ? 'Light mode' : 'Dark mode';
        };
        updateToggleLabel();
        byId.themeToggle.addEventListener('click', () => {
            toggleTheme();
            updateToggleLabel();
            updateConditionLegend();
            updateReplicateLegend();
            renderSummaryContent();
            scheduleRefresh(buildGroups);
        });
    }

    // Watch actual plot space, including sidebar toggles and browser zoom.
    if (window.ResizeObserver) {
        let resizeFrame;
        const observer = new window.ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(resizeVisiblePlots);
        });
        observer.observe(document.getElementById('plot-content'));
    }
    const formatToggle = document.getElementById('format-toggle');
    formatToggle?.addEventListener('click', () => {
        const panel = document.getElementById('format-panel');
        panel.hidden = !panel.hidden;
        formatToggle.setAttribute('aria-expanded', String(!panel.hidden));
        requestAnimationFrame(resizeVisiblePlots);
    });
    document.getElementById('condition-visibility')?.addEventListener('change', event => {
        const condition = event.target.dataset.visibleCondition;
        if (!condition) return;
        state.hiddenConditions = state.hiddenConditions.filter(name => name !== condition);
        if (!event.target.checked) state.hiddenConditions.push(condition);
        updateConditionLegend();
        updateReplicateLegend();
        renderSummaryContent();
        scheduleRefresh(buildGroups);
    });
    document.getElementById('show-all-conditions')?.addEventListener('click', () => {
        state.hiddenConditions = [];
        updateConditionLegend();
        updateReplicateLegend();
        renderSummaryContent();
        scheduleRefresh(buildGroups);
    });
    restorePreferences();
    applyWarningVisibility();
    document.getElementById('warnings-toggle')?.addEventListener('change', event => {
        state.controls.showWarnings = event.target.checked;
        applyWarningVisibility();
        persistPreferences();
        requestAnimationFrame(resizeVisiblePlots);
    });
    // Results open only after a request in this session, even with saved preferences.
    state.controls.statsPanelOpen = false;
    state.controls.summaryPanelOpen = false;
    setActiveTab(state.currentTab);
    applyControlsToDom();
    applyPlotStyleToDom();
    syncControlsToState();

    const ready = apiDeleteAll()
        .then(() => {
            state.dayColorMap = {};
            state.condColorMap = {};
        })
        .then(() => apiSessionMeta())
        .then(meta => {
            state.maxFiles = Number(meta.max_files) || MAX_FILES;
            state.sessionMemoryLimitBytes = Number(meta.max_total_session_bytes) || 0;
            state.browserWarnFileBytes = Number(meta.browser_warn_file_bytes) || 0;
            state.parseTimeoutSeconds = Number(meta.parse_timeout_seconds) || 0;
            updateFileCount();
            updateUploadJobs();
            dismissSplash();
        })
        .catch(err => {
            setStatus(`Backend init failed: ${err.message}`);
            dismissSplash();
        });

    bindProjectControls({ ready, ensureMetricTabs });

    byId.fileInput.addEventListener('change', event => {
        handleFiles(event.target.files);
        event.target.value = '';
    });

    const panel = filesPanel;
    panel.addEventListener('dragover', event => {
        event.preventDefault();
        panel.classList.add('drag-over');
    });
    panel.addEventListener('dragleave', event => {
        if (!panel.contains(event.relatedTarget)) panel.classList.remove('drag-over');
    });
    panel.addEventListener('drop', event => {
        event.preventDefault();
        panel.classList.remove('drag-over');
        handleFiles(event.dataTransfer.files);
    });

    byId.fileList.addEventListener('input', event => {
        if (!event.target.classList.contains('condition-input')) return;
        const fid = event.target.dataset.fid;
        const info = state.files.get(fid);
        if (!info) return;
        const value = event.target.value.trim();
        info.condition = value;
        info.assignment_source = 'manual';
        if (value) assignColor(value);
        syncManualConditionOrder();
        updateFileColorBar(fid);
        updateConditionLegend();
        updateReplicateLegend();
        refreshDatalist();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    byId.fileList.addEventListener('input', event => {
        if (!event.target.classList.contains('day-input')) return;
        const fid = event.target.dataset.fid;
        const info = state.files.get(fid);
        if (!info) return;
        const { key, label } = normalizeDay(event.target.value);
        info.day = key ? label : undefined;
        if (key) assignDayColor(label);
        updateReplicateLegend();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    byId.fileList.addEventListener('click', async event => {
        if (!event.target.classList.contains('delete-file-btn')) return;
        const fid = event.target.dataset.fid;
        await removeFiles([fid], 'Removing file…');
    });

    byId.uploadJobList?.addEventListener('click', async event => {
        const action = event.target.dataset.uploadAction;
        const jobId = event.target.dataset.jobId;
        if (!action || !jobId) return;
        if (action === 'dismiss') {
            removeUploadJob(jobId);
            return;
        }
        if (action === 'cancel') {
            try {
                await apiCancelUpload(jobId);
                upsertUploadJob(jobId, {
                    status: 'canceled',
                    progress: 1,
                    message: 'Upload canceled.',
                });
                setStatus('Upload canceled.');
            } catch (err) {
                setStatus(`Failed to cancel upload: ${err.message}`);
            }
        }
    });

    if (byId.condPalette) {
        byId.condPalette.value = state.condPalette;
        byId.condPalette.addEventListener('change', () => {
            state.condPalette = byId.condPalette.value;
            applyPalette();
            renderFileList();
            updateConditionLegend();
            persistPreferences();
            scheduleRefresh(buildGroups);
        });
    }

    byId.conditionLegend.addEventListener('click', event => {
        if (event.target.classList.contains('legend-reset-btn')) {
            const condition = event.target.dataset.cond;
            if (!condition) return;
            resetConditionColor(condition);
            renderFileList();
            updateConditionLegend();
            persistPreferences();
            scheduleRefresh(buildGroups);
            return;
        }
        if (!event.target.classList.contains('legend-order-btn')) return;
        const condition = event.target.dataset.cond;
        const direction = Number(event.target.dataset.move || 0);
        if (!condition || !Number.isFinite(direction)) return;
        moveManualCondition(condition, direction);
        updateConditionLegend();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    byId.conditionLegend.addEventListener('input', event => {
        if (!event.target.classList.contains('legend-color-input')) return;
        const condition = event.target.dataset.cond;
        const color = event.target.value;
        if (!condition) return;
        setConditionColor(condition, color);
        renderFileList();
        updateConditionLegend();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    styleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            styleButtons.forEach(candidate => candidate.classList.remove('active'));
            btn.classList.add('active');
            state.plotStyle = btn.dataset.style;
            persistPreferences();
            scheduleRefresh(buildGroups);
        });
    });

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveTab(btn.dataset.tab);
            updateFormatPanelContext();
            scheduleRefresh(buildGroups);
        });
    });

    byId.controlsPanel.addEventListener('input', () => handleControlsChanged(buildGroups));
    byId.controlsPanel.addEventListener('change', () => handleControlsChanged(buildGroups));
    bindFormatControlEvents(byId.formatControls, () => handleControlsChanged(buildGroups));

    const groupByDayToggle = document.getElementById('group-by-day-toggle');
    if (groupByDayToggle) {
        groupByDayToggle.checked = !!state.groupByDay;
        groupByDayToggle.addEventListener('change', () => {
            state.groupByDay = groupByDayToggle.checked;
            scheduleRefresh(buildGroups);
        });
    }

    const comparabilityHeader = document.getElementById('comparability-header');
    if (comparabilityHeader) {
        comparabilityHeader.addEventListener('click', () => {
            const body = byId.comparabilityContent;
            const icon = byId.comparabilityToggleIcon;
            if (!body) return;
            const isOpen = body.style.display !== 'none';
            comparabilityHeader.setAttribute('aria-expanded', String(!isOpen));
            byId.comparabilityPanel.style.display = isOpen ? 'none' : 'block';
            if (isOpen) {
                body.style.display = 'none';
                if (icon) icon.textContent = '+';
            } else {
                body.style.display = 'block';
                if (icon) icon.textContent = '−';
                renderComparabilityDashboard('comparability-content');
            }
        });
    }

    const statsHeader = document.getElementById('stats-header');
    if (statsHeader) {
        statsHeader.addEventListener('click', () => {
            const body = byId.statsContent;
            const icon = byId.statsToggleIcon;
            if (!body) return;
            const isOpen = body.style.display !== 'none';
            if (isOpen) {
                body.style.display = 'none';
                if (icon) icon.textContent = '+';
            } else {
                body.style.display = 'block';
                if (icon) icon.textContent = '−';
            }
            byId.statsPanel.style.display = isOpen ? 'none' : 'block';
            state.controls.statsPanelOpen = !isOpen;
            statsHeader.setAttribute('aria-expanded', String(!isOpen));
            persistPreferences();
            requestAnimationFrame(resizeVisiblePlots);
        });
    }

    const summaryHeader = document.getElementById('summary-header');
    if (summaryHeader) {
        summaryHeader.addEventListener('click', () => {
            const body = byId.summaryContent;
            const icon = byId.summaryToggleIcon;
            if (!body) return;
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            if (icon) icon.textContent = isOpen ? '+' : '−';
            summaryHeader.setAttribute('aria-expanded', String(!isOpen));
            byId.summaryPanel.style.display = isOpen ? 'none' : 'block';
            state.controls.summaryPanelOpen = !isOpen;
            if (!isOpen) renderSummaryContent();
            persistPreferences();
            requestAnimationFrame(resizeVisiblePlots);
        });
    }

    ['plotTitleOverride', 'xLabelOverride', 'yLabelOverride'].forEach(id => {
        byId[id]?.addEventListener('input', event => {
            const axis = event.target.dataset.labelOverride;
            setLabelOverride(axis, event.target.value);
            persistPreferences();
            scheduleRefresh(buildGroups);
        });
    });

    byId.resetLabelsBtn?.addEventListener('click', () => {
        resetLabelOverrides();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    byId.resetTypographyBtn.addEventListener('click', () => {
        resetControls([
            'fontFamily',
            'plotTitleFontSize',
            'xAxisTitleFontSize',
            'yAxisTitleFontSize',
            'xAxisTickFontSize',
            'yAxisTickFontSize',
            'legendFontSize',
        ]);
        syncControlsToState();
        updateConditionLegend();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    byId.resetRangesBtn.addEventListener('click', () => {
        resetControls(['xMin', 'xMax', 'yMin', 'yMax']);
        syncControlsToState();
        updateConditionLegend();
        persistPreferences();
        scheduleRefresh(buildGroups);
    });

    updateFileCount();
    updateUploadJobs();
    updateReplicateLegend();
    updateFormatPanelContext();
    showPlaceholder('Load .xlsx files exported from Ca²⁺tch-One, then assign a condition name to each file.');
    maybeStartTour();
}
