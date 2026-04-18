import { apiCancelUpload, apiDelete, apiDeleteAll, apiSessionMeta, apiStartUpload, apiUploadStatus } from './api.js';
import {
    assignColor,
    buildGroups,
    moveManualCondition,
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
    restorePreferences,
} from './preferences.js';
import {
    cachePaneTemplates,
    getDom,
    refreshDatalist,
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
import { scheduleRefresh } from './plot-controller.js';
import { MAX_FILES, state } from './state.js';

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
    for (const fid of ids) {
        await apiDelete(fid);
        state.files.delete(fid);
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
        .slice(0, MAX_FILES - state.files.size);

    if (!files.length) return;
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
        });
        setStatus(precheckMessage);
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
            if (restoredCondition) assignColor(restoredCondition);
            if (restoredCondition) {
                restoredAssignments += 1;
                restoredConditions.add(restoredCondition);
            }
            state.files.set(result.file_id, {
                file_name: result.file_name,
                n_rois: result.n_rois,
                condition: restoredCondition,
                assignment_source: restoredCondition ? 'restored' : 'manual',
                analysis_mode: result.analysis_mode,
                signal_mode: result.signal_mode,
                memory_bytes: result.memory_bytes || 0,
                available_metrics: result.available_metrics,
                warnings: result.warnings || [],
                has_traces: !!result.has_traces,
                has_delta_f: !!result.has_delta_f,
                trace_status: traceStatusLabel(result),
            });
            state.sessionMemoryLimitBytes = Number(result.max_total_session_bytes) || state.sessionMemoryLimitBytes;
            const warningMessage = (result.warnings || []).join(' ');
            upsertUploadJob(activeJobId, {
                file_name: result.file_name,
                status: 'completed',
                progress: 1,
                message: warningMessage || 'Upload complete.',
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

export function bootstrap() {
    cachePaneTemplates();
    const { byId, filesPanel, styleButtons, tabButtons } = {
        byId: getDom().byId,
        filesPanel: getDom().byId.filesPanel,
        styleButtons: getDom().styleButtons,
        tabButtons: getDom().tabButtons,
    };
    restorePreferences();
    setActiveTab(state.currentTab);
    applyControlsToDom();
    applyPlotStyleToDom();
    syncControlsToState();
    apiDeleteAll()
        .then(() => apiSessionMeta())
        .then(meta => {
            state.sessionMemoryLimitBytes = Number(meta.max_total_session_bytes) || 0;
            state.browserWarnFileBytes = Number(meta.browser_warn_file_bytes) || 0;
            state.parseTimeoutSeconds = Number(meta.parse_timeout_seconds) || 0;
            updateFileCount();
            updateUploadJobs();
        })
        .catch(() => {});

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

    byId.purgeConditionBtn?.addEventListener('click', async () => {
        const condition = String(byId.purgeConditionSelect?.value || '').trim();
        if (!condition) {
            setStatus('Select a condition to remove its files.');
            return;
        }
        const fileIds = [...state.files.entries()]
            .filter(([, info]) => String(info.condition || '').trim() === condition)
            .map(([fid]) => fid);
        const removed = await removeFiles(fileIds, `Removing all files for ${condition}…`);
        if (removed > 0) {
            setStatus(`Removed ${removed} file${removed === 1 ? '' : 's'} from ${condition}.`);
            window.setTimeout(() => setStatus(''), 1800);
        }
    });

    byId.purgeOldestBtn?.addEventListener('click', async () => {
        const requested = Number(byId.purgeOldestCount?.value || 1);
        const count = Math.max(1, Math.min(state.files.size, Number.isFinite(requested) ? Math.floor(requested) : 1));
        const fileIds = [...state.files.keys()].slice(0, count);
        const removed = await removeFiles(fileIds, `Purging ${count} oldest upload${count === 1 ? '' : 's'}…`);
        if (removed > 0) {
            setStatus(`Purged ${removed} oldest upload${removed === 1 ? '' : 's'}.`);
            window.setTimeout(() => setStatus(''), 1800);
        }
    });

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
    byId.formatControls.addEventListener('input', () => handleControlsChanged(buildGroups));
    byId.formatControls.addEventListener('change', () => handleControlsChanged(buildGroups));

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
    showPlaceholder('Load .xlsx files exported from the Calcium Imaging Analyzer, then assign a condition name to each file.');
}
