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

export async function fetchMetrics(groups) {
    const resp = await fetch('/api/plot/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch metrics');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch metrics');
}

export async function fetchTraces(groups, traceType) {
    const resp = await fetch('/api/plot/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, trace_type: traceType }),
    });
    if (!resp.ok) {
        const { message, code } = await parseErrorBody(resp, 'Failed to fetch traces');
        throwApiError(message, code);
    }
    return safeJson(resp, 'Failed to fetch traces');
}
