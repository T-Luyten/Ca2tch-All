import { fetchMetrics } from './api.js';
import { buildGroups } from './core.js';
import { computeComparabilityMetrics } from './stats.js';
import { normalizeDay, state } from './state.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeNum(v, fallback = 0) {
    return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function formatPValue(p) {
    const num = safeNum(p, null);
    if (num === null) return 'N/A';
    if (num < 0.001) return '< 0.001';
    return num.toFixed(3);
}

function collectReplicatesFromMetrics(metricsData) {
    const seenFiles = new Set();
    const replicates = [];
    for (const [condition, condMetrics] of Object.entries(metricsData || {})) {
        // Use only the first metric that has files (avoid duplicates across metrics)
        const metricsWithFiles = Object.values(condMetrics || {}).filter(m => m?.files?.length);
        if (!metricsWithFiles.length) continue;
        const metricData = metricsWithFiles[0];
        for (const file of metricData.files) {
            const fileKey = file.file_id || file.file_name;
            if (seenFiles.has(fileKey)) continue;
            seenFiles.add(fileKey);

            const fileInfo = file.file_id ? state.files.get(file.file_id) : undefined;
            const day = fileInfo?.day ? normalizeDay(fileInfo.day).label : 'Unspecified';
            const baseline = fileInfo?.baseline || 0;
            const indicator_type = fileInfo?.signal_mode === 'ratio' ? 'ratiometric' : 'single-wavelength';

            // Send each ROI as its own replicate for response analysis
            for (const value of file.values || []) {
                if (!Number.isFinite(Number(value))) continue;
                replicates.push({
                    file_id: file.file_id || fileInfo?.id || file.file_name,
                    day,
                    condition,
                    baseline,
                    response: Number(value),
                    indicator_type,
                });
            }
        }
    }
    return replicates;
}

function getDiagnostics(replicates) {
    const days = [...new Set(replicates.map(r => r.day))];
    const files = [...new Set(replicates.map(r => r.file_id))];
    const dayCounts = {};
    const dayRoiCounts = {};
    for (const r of replicates) {
        dayCounts[r.day] = (dayCounts[r.day] || 0) + 1;
        if (!dayRoiCounts[r.day]) dayRoiCounts[r.day] = new Set();
        dayRoiCounts[r.day].add(r.file_id);
    }
    const filesPerDay = days.map(d => `${d}: ${dayRoiCounts[d]?.size || 0} file(s), ${dayCounts[d] || 0} ROI(s)`).join('; ');
    return { nReplicates: replicates.length, nDays: days.length, nFiles: files.length, filesPerDay };
}

export async function renderComparabilityDashboard(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const hasDayData = [...state.files.values()].some(f => {
        const key = normalizeDay(f.day).key;
        return key && key !== 'unspecified';
    });
    if (!hasDayData) {
        container.innerHTML = '<p class="comparability-placeholder">Upload files and assign days to see comparability analysis.</p>';
        return;
    }

    container.innerHTML = '<p class="comparability-loading">Running comparability analysis…</p>';

    let results;
    let replicates = [];
    try {
        const groups = buildGroups();
        const metricsData = await fetchMetrics(groups);
        replicates = collectReplicatesFromMetrics(metricsData);
        if (replicates.length === 0) {
            container.innerHTML = '<p class="comparability-placeholder">No data available for comparability analysis.</p>';
            return;
        }
    } catch (err) {
        container.innerHTML = `<p class="comparability-placeholder">Analysis failed: ${escapeHtml(err.message)}</p>`;
        console.error('Comparability dashboard error:', err);
        return;
    }

    try {
        results = await computeComparabilityMetrics(replicates);
    } catch (err) {
        container.innerHTML = `<p class="comparability-placeholder">Comparability analysis requires the backend. ${escapeHtml(err.message)}</p>`;
        console.error('Comparability dashboard error:', err);
        return;
    }

    try {
        const verdict = results.overall_verdict || 'Unknown';
        const verdictClass = verdict === 'Comparable' ? 'verdict-pass'
                           : verdict === 'Caution' ? 'verdict-caution'
                           : 'verdict-fail';

        const diag = getDiagnostics(replicates);
        let html = `
        <div class="comparability-dashboard">
          <h3>Cross-Day Comparability Assessment</h3>
          <div class="verdict-banner ${verdictClass}">
            <span class="verdict-label">Verdict:</span>
            <span class="verdict-value">${escapeHtml(verdict)}</span>
          </div>
          <div class="comparability-section comparability-diagnostics">
            <h4>Diagnostics</h4>
            <p>${diag.nReplicates} ROI replicates from ${diag.nFiles} file(s) across ${diag.nDays} day(s)</p>
            <p class="diag-detail">${escapeHtml(diag.filesPerDay)}</p>
          </div>
        `;

        const baselineStats = results.baseline_stats || [];
        if (baselineStats.length) {
            html += `
          <div class="comparability-section">
            <h4>Baseline Statistics by Day</h4>
            <table class="comparability-table">
              <thead>
                <tr><th>Day</th><th>Mean</th><th>SD</th><th>CV (%)</th><th>N</th></tr>
              </thead>
              <tbody>
                ${baselineStats.map(s => `
                  <tr class="${safeNum(s.cv_percent, 0) > 15 ? 'cv-high' : ''}">
                    <td>${escapeHtml(s.day)}</td>
                    <td>${safeNum(s.mean).toFixed(3)}</td>
                    <td>${safeNum(s.std).toFixed(3)}</td>
                    <td>${safeNum(s.cv_percent).toFixed(1)}%</td>
                    <td>${s.n_replicates ?? 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
        }

        const baselineAnova = results.baseline_anova;
        if (baselineAnova) {
            const sig = baselineAnova.significant;
            html += `
          <div class="comparability-section">
            <h4>Baseline ANOVA (Across Days)</h4>
            <p>F(${baselineAnova.df_between}, ${baselineAnova.df_within}) = ${safeNum(baselineAnova.f_statistic).toFixed(2)}, p = ${safeNum(baselineAnova.p_value).toExponential(2)} ${sig ? '<span class="sig">(significant)</span>' : '<span class="ns">(not significant)</span>'}</p>
          </div>`;
        }

        const baselineICC = results.baseline_icc;
        const responseICC = results.response_icc;
        const baselineIccVal = safeNum(baselineICC?.icc_value, null);
        const responseIccVal = safeNum(responseICC?.icc_value, null);
        const baselineComputable = baselineICC?.computable ?? (baselineIccVal !== null);
        const responseComputable = responseICC?.computable ?? (responseIccVal !== null);
        html += `
          <div class="comparability-section">
            <h4>Intraclass Correlation Coefficient (ICC)</h4>
            <table class="comparability-table">
              <thead><tr><th>Metric</th><th>ICC</th><th>Status</th></tr></thead>
              <tbody>
                <tr>
                  <td>Raw Baseline (F₀/R₀)</td>
                  <td>${baselineComputable && baselineIccVal !== null ? baselineIccVal.toFixed(3) : 'N/A'}</td>
                  <td class="${baselineICC?.comparable ? 'pass' : 'fail'}">${escapeHtml(baselineICC?.interpretation || 'N/A')}</td>
                </tr>
                <tr>
                  <td>Normalized Response (ΔF/F₀)</td>
                  <td>${responseComputable && responseIccVal !== null ? responseIccVal.toFixed(3) : 'N/A'}</td>
                  <td class="${responseICC?.comparable ? 'pass' : 'warn'}">${escapeHtml(responseICC?.interpretation || 'N/A')}</td>
                </tr>
              </tbody>
            </table>
          </div>`;

        const normality = results.normality_by_condition || [];
        if (normality.length) {
            html += `
          <div class="comparability-section">
            <h4>Normality Test (Shapiro-Wilk) by Condition</h4>
            <table class="comparability-table">
              <thead><tr><th>Condition</th><th>W</th><th>p-value</th><th>Normal?</th><th>N</th></tr></thead>
              <tbody>
                ${normality.map(n => `
                  <tr>
                    <td>${escapeHtml(n.condition)}</td>
                    <td>${safeNum(n.w_statistic, null)?.toFixed(3) ?? 'N/A'}</td>
                    <td>${formatPValue(n.p_value)}</td>
                    <td class="${n.is_normal ? 'pass' : 'warn'}">${n.is_normal ? 'Yes' : 'No'}</td>
                    <td>${n.n_samples ?? 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
        }

        const vc = results.variance_components;
        if (vc && vc.between_day_variance !== undefined) {
            html += `
          <div class="comparability-section">
            <h4>Mixed Model Variance Decomposition</h4>
            <p>Between-day variance: ${safeNum(vc.between_day_variance, 0).toExponential(2)}</p>
            <p>Within-day variance: ${safeNum(vc.within_day_variance, 0).toExponential(2)}</p>
            <p>ICC from model: ${safeNum(vc.icc_from_model, 0).toFixed(3)}</p>
          </div>`;
        }

        const conditionEffects = results.condition_effects || [];
        if (conditionEffects.length) {
            html += `
          <div class="comparability-section">
            <h4>Condition Effects (Mixed Model)</h4>
            <table class="comparability-table">
              <thead><tr><th>Condition</th><th>Estimate</th><th>SE</th><th>z</th><th>p</th><th>Sig?</th></tr></thead>
              <tbody>
                ${conditionEffects.map(ce => `
                  <tr>
                    <td>${escapeHtml(ce.condition)}</td>
                    <td>${safeNum(ce.estimate).toFixed(3)}</td>
                    <td>${safeNum(ce.std_error).toFixed(3)}</td>
                    <td>${safeNum(ce.z_score).toFixed(2)}</td>
                    <td>${safeNum(ce.p_value).toExponential(2)}</td>
                    <td class="${ce.significant ? 'pass' : 'ns'}">${ce.significant ? '***' : 'ns'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
        }

        const warnings = results.warnings || [];
        if (warnings.length) {
            html += `
          <div class="comparability-warnings">
            <h4>Warnings</h4>
            <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
          </div>`;
        }

        html += '</div>';
        container.innerHTML = html;
    } catch (renderErr) {
        container.innerHTML = `<p class="comparability-placeholder">Dashboard render error: ${escapeHtml(renderErr.message)}</p>`;
        console.error('Dashboard render error:', renderErr);
    }
}
