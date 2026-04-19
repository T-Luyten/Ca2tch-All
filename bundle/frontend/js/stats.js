export function finiteValues(values) {
    return (values || []).map(value => Number(value)).filter(Number.isFinite);
}

export function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sampleSd(values) {
    if (values.length <= 1) return 0;
    const avg = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}

export function summarize(values, kind = 'mean') {
    if (!values.length) return 0;
    return kind === 'median' ? median(values) : mean(values);
}

export function summarizePerFrame(seriesList, kind = 'mean') {
    if (!seriesList.length) return [];
    const nFrames = Math.min(...seriesList.map(arr => arr.length));
    const out = [];
    for (let i = 0; i < nFrames; i += 1) {
        const values = finiteValues(seriesList.map(arr => arr[i]));
        out.push(values.length ? summarize(values, kind) : 0);
    }
    return out;
}

export function errorForValues(values, mode = 'sem') {
    if (mode === 'none' || values.length <= 1) return 0;
    const sd = sampleSd(values);
    const sem = sd / Math.sqrt(values.length);
    if (mode === 'sd') return sd;
    if (mode === 'ci') return 1.96 * sem;
    return sem;
}

export function errorPerFrame(seriesList, mode = 'sem') {
    if (!seriesList.length || mode === 'none') return [];
    const nFrames = Math.min(...seriesList.map(arr => arr.length));
    const out = [];
    for (let i = 0; i < nFrames; i += 1) {
        const values = finiteValues(seriesList.map(arr => arr[i]));
        out.push(errorForValues(values, mode));
    }
    return out;
}
