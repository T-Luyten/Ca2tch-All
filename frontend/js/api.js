function errorFromResponseBody(body, fallbackMessage) {
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
    return { message: fallbackMessage, code: '' };
}

export async function apiStartUpload(file) {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        const { message, code } = errorFromResponseBody(body, 'Upload failed');
        const error = new Error(message);
        error.code = code;
        throw error;
    }
    return resp.json();
}

export async function apiUploadStatus(jobId) {
    const resp = await fetch(`/api/upload/${jobId}`);
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        const { message, code } = errorFromResponseBody(body, 'Failed to fetch upload status');
        const error = new Error(message);
        error.code = code;
        throw error;
    }
    return resp.json();
}

export async function apiCancelUpload(jobId) {
    const resp = await fetch(`/api/upload/${jobId}`, { method: 'DELETE' });
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        const { message, code } = errorFromResponseBody(body, 'Failed to cancel upload');
        const error = new Error(message);
        error.code = code;
        throw error;
    }
    return resp.json();
}

export async function apiSessionMeta() {
    const resp = await fetch('/api/session');
    if (!resp.ok) throw new Error('Failed to fetch session metadata');
    return resp.json();
}

export async function apiDelete(fileId) {
    await fetch(`/api/file/${fileId}`, { method: 'DELETE' });
}

export async function apiDeleteAll() {
    await fetch('/api/files', { method: 'DELETE' });
}

export async function fetchMetrics(groups) {
    const resp = await fetch('/api/plot/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
    });
    if (!resp.ok) throw new Error('Failed to fetch metrics');
    return resp.json();
}

export async function fetchTraces(groups, traceType) {
    const resp = await fetch('/api/plot/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, trace_type: traceType }),
    });
    if (!resp.ok) throw new Error('Failed to fetch traces');
    return resp.json();
}
