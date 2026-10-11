import { state } from './state.js';

async function parseErrorBody(resp, fallbackMessage) {
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        try {
            const body = await resp.json();
            const detail = body?.detail;
            if (typeof detail === 'string' && detail.trim()) {
                return { message: detail.trim(), code: '' };
            }
            if (detail && typeof detail === 'object') {
                const message = typeof detail.message === 'string' && detail.message.trim()
                    ? detail.message.trim()
                    : fallbackMessage;
                const code = typeof detail.code === 'string' ? detail.code : '';
                return { message, code };
            }
        } catch (_) { /* fall through */ }
    }
    return { message: `${fallbackMessage} (${resp.status} ${resp.statusText})`, code: '' };
}

function throwApiError(message, code) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

async function safeJson(resp, fallbackMessage) {
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
        throw new Error(`${fallbackMessage}: unexpected response type`);
    }
    return resp.json();
}

export async function apiStartUpload(file) {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Upload failed');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Upload failed');
}

export async function apiUploadStatus(jobId) {
    const resp = await fetch(`/api/upload/${jobId}`);
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch upload status');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch upload status');
}

export async function apiCancelUpload(jobId) {
    const resp = await fetch(`/api/upload/${jobId}`, { method: 'DELETE' });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to cancel upload');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to cancel upload');
}

export async function apiSessionMeta() {
    const resp = await fetch('/api/session');
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch session metadata');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch session metadata');
}

export async function apiDelete(fileId) {
    const resp = await fetch(`/api/file/${fileId}`, { method: 'DELETE' });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to delete file');
        throwApiError(message, code);
    }
}

export async function apiDeleteAll() {
    const resp = await fetch('/api/files', { method: 'DELETE' });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to delete all files');
        throwApiError(message, code);
    }
}

function plotStatsRequestFields() {
    return {
        summary_stat: state.controls.summaryStat,
        error_mode: state.controls.errorBars,
    };
}

function plotOutlierMode() {
    if (!state.controls.excludeOutliers) return null;
    return state.controls.outlierMethod === 'modified_zscore' ? 'zscore' : 'iqr';
}

export async function fetchMetrics(groups, { fileDays = {}, poolByDay = false } = {}) {
    const resp = await fetch('/api/plot/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            groups,
            ...plotStatsRequestFields(),
            outlier_mode: plotOutlierMode(),
            file_days: fileDays,
            pool_by_day: poolByDay,
        }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch metrics');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch metrics');
}

export async function fetchTraces(groups, traceType, { fileDays = {}, poolByDay = state.controls.poolByDay } = {}) {
    const resp = await fetch('/api/plot/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, trace_type: traceType, ...plotStatsRequestFields(), file_days: fileDays, pool_by_day: poolByDay }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch traces');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch traces');
}

export async function fetchComparability(replicates) {
    const resp = await fetch('/stats/comparability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicates }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Comparability analysis failed');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Comparability analysis failed');
}

export async function fetchPairwiseStats(metric, groups, paired = false, fileDays = {}, excludedFileIds = [], { summaryStat = 'mean', poolByDay = false } = {}) {
    const resp = await fetch('/api/stats/pairwise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            metric,
            groups,
            paired,
            summary_stat: summaryStat,
            pool_by_day: poolByDay,
            file_days: fileDays,
            excluded_file_ids: excludedFileIds,
        }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch pairwise statistics');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch pairwise statistics');
}

export async function fetchSummaryStats(metric, groups, {
    summaryStat = 'mean',
    paired = false,
    poolByDay = false,
    referenceCondition = null,
    fileDays = {},
    excludedFileIds = [],
} = {}) {
    const resp = await fetch('/api/stats/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            metric,
            groups,
            summary_stat: summaryStat,
            paired,
            pool_by_day: poolByDay,
            reference_condition: referenceCondition,
            file_days: fileDays,
            excluded_file_ids: excludedFileIds,
        }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch summary statistics');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch summary statistics');
}

export async function apiSaveProject(project) {
    const resp = await fetch('/api/project/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to save project');
        throwApiError(message, code);
    }
    return resp.blob();
}

export async function apiOpenProject(file) {
    const body = new FormData();
    body.append('file', file);
    const resp = await fetch('/api/project/open', { method: 'POST', body });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to open project');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to open project');
}
