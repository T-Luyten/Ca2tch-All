import { fetchComparability } from './api.js';

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

export function summarize(values, kind = 'mean') {
    if (!values.length) return 0;
    return kind === 'median' ? median(values) : mean(values);
}

// ===== CROSS-DAY COMPARABILITY STATISTICS =====
// All comparability statistics are computed by the backend; the frontend is
// view-only and surfaces a failure instead of fabricating fallback numbers.

export async function computeComparabilityMetrics(replicates) {
    return fetchComparability(replicates);
}
