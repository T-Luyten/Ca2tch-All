import { plotColor } from './theme.js';
import {
    axisStyle,
    isConditionVisible,
    buildBaseLayout,
    layoutFontFamily,
    resizeVisiblePlots,
    slugifyFilename,
} from './core.js';
import { persistPreferences } from './preferences.js';
import { getPlotlyConfig } from './plotly-config.js';
import { state } from './state.js';

const SUMMARY_TABS = [
    ['per-replicate', 'Per-replicate'],
    ['per-condition', 'Per-condition'],
    ['effect', 'Effect size'],
];

let lastRender = null;
let normalityDismissKey = '';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeNum(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function fmt(value, digits = 3) {
    const num = safeNum(value);
    return num === null ? '—' : num.toFixed(digits);
}

function formatPValue(p) {
    const num = safeNum(p);
    if (num === null) return 'N/A';
    if (num < 0.001) return '< 0.001';
    return num.toFixed(3);
}

function summaryStatLabel() {
    return state.controls.summaryStat === 'median' ? 'Median' : 'Mean';
}

function conditionNames(data) {
    const fromConditions = (data?.conditions || []).map(c => c.condition).filter(Boolean);
    if (fromConditions.length) return fromConditions;
    const names = new Set();
    for (const row of data?.effect_sizes || []) {
        if (row.condition) names.add(row.condition);
        if (row.reference) names.add(row.reference);
    }
    return [...names];
}

function resolveReference(data) {
    const names = conditionNames(data);
    const saved = state.controls.summaryReferenceCondition;
    if (saved && names.includes(saved)) return saved;
    const fromEffects = data?.effect_sizes?.[0]?.reference;
    if (fromEffects && names.includes(fromEffects)) return fromEffects;
    return names[0] || '';
}

function normalityCounts(replicates) {
    const tested = (replicates || []).filter(r => safeNum(r.shapiro_p) !== null);
    const failing = tested.filter(r => Number(r.shapiro_p) < 0.05);
    return { tested: tested.length, failing: failing.length };
}

function normalityKey(data, metric) {
    const { tested, failing } = normalityCounts(data?.replicates);
    return `${metric}:${failing}/${tested}`;
}

function normalityBannerHtml(data, metric) {
    const { tested, failing } = normalityCounts(data?.replicates);
    // Paper-specified: warn when at least half of the tested replicates
    // deviate from normality (Shapiro-Wilk p < 0.05).
    if (!tested || failing < tested / 2) return '';
    if (normalityKey(data, metric) === normalityDismissKey) return '';
    return `
      <div class="summary-banner summary-banner-warn">
        <span>Most replicates deviate from normality (Shapiro-Wilk p &lt; 0.05). Consider using the Median summary statistic.</span>
        <button type="button" class="summary-banner-dismiss" title="Dismiss">×</button>
      </div>`;
}

function pairingNoticeHtml(data) {
    const mode = data?.pairing_mode || null;
    if (mode === 'ordinal') {
        const text = data.pairing_warning
            || 'Replicates were paired by file order (ordinal pairing). Assign day labels to files to pair by acquisition day.';
        return `<div class="summary-banner summary-banner-warn"><span>${escapeHtml(text)}</span></div>`;
    }
    if (mode === 'day') {
        return '<div class="summary-note">Replicates paired by acquisition day.</div>';
    }
    return '';
}

function perReplicateTabHtml(data) {
    const rows = data?.replicates || [];
    if (!rows.length) return '<p class="summary-placeholder">No replicate summaries available.</p>';
    return `
      <div class="summary-toolbar">
        <button type="button" class="mini-btn" data-summary-csv="per-replicate">Download CSV</button>
      </div>
      <table class="summary-table">
        <thead>
          <tr><th>File</th><th>Condition</th><th>Day</th><th>n</th><th>Mean</th><th>Median</th><th>SD</th><th>SEM</th><th>95% CI</th><th>Shapiro-Wilk p</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
              const p = safeNum(r.shapiro_p);
              return `<tr>
                <td>${escapeHtml(r.file_name || r.file_id)}</td>
                <td>${escapeHtml(r.condition)}</td>
                <td>${escapeHtml(r.day || '—')}</td>
                <td>${r.n ?? '—'}</td>
                <td>${fmt(r.mean)}</td>
                <td>${fmt(r.median)}</td>
                <td>${fmt(r.sd)}</td>
                <td>${fmt(r.sem)}</td>
                <td>${fmt(r.ci95)}</td>
                <td class="${p !== null && p < 0.05 ? 'norm-fail' : ''}">${formatPValue(r.shapiro_p)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
}

function perConditionTabHtml(data) {
    const rows = data?.conditions || [];
    if (!rows.length) return '<p class="summary-placeholder">No condition summaries available.</p>';
    return `
      <div class="summary-toolbar">
        <button type="button" class="mini-btn" data-summary-csv="per-condition">Download CSV</button>
      </div>
      <table class="summary-table">
        <thead>
          <tr><th>Condition</th><th>N replicates</th><th>${summaryStatLabel()}</th><th>SD</th><th>SEM</th><th>95% CI</th></tr>
        </thead>
        <tbody>
          ${rows.map(c => `<tr>
            <td>${escapeHtml(c.condition)}</td>
            <td>${c.n_replicates ?? '—'}</td>
            <td>${fmt(c.summary)}</td>
            <td>${fmt(c.sd)}</td>
            <td>${fmt(c.sem)}</td>
            <td>${fmt(c.ci95)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
}

function effectTabHtml(data) {
    const rows = data?.effect_sizes || [];
    const reference = resolveReference(data);
    const names = conditionNames(data);
    const select = names.length ? `
      <label class="control-label" for="summary-reference-select">Reference</label>
      <select id="summary-reference-select" class="summary-reference-select">
        ${names.map(name => `<option value="${escapeHtml(name)}"${name === reference ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
      </select>` : '';
    if (!rows.length) {
        return `
          <div class="summary-toolbar">${select}</div>
          <p class="summary-placeholder">No effect sizes available (need at least two conditions with replicates).</p>`;
    }
    return `
      <div class="summary-toolbar">
        ${select}
        <button type="button" class="mini-btn" data-summary-csv="effect">Download CSV</button>
      </div>
      <table class="summary-table">
        <thead>
          <tr><th>Condition</th><th>Difference vs ${escapeHtml(reference)}</th><th>95% CI low</th><th>95% CI high</th><th>CI excludes zero</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${escapeHtml(r.condition)}</td>
            <td>${fmt(r.difference)}</td>
            <td>${fmt(r.ci_low)}</td>
            <td>${fmt(r.ci_high)}</td>
            <td class="${r.excludes_zero ? 'pass' : 'ns'}">${r.excludes_zero ? 'Yes' : 'No'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div id="summary-effect-plot" class="summary-effect-plot"></div>`;
}

function tabBodyHtml(tab, data) {
    if (tab === 'per-condition') return perConditionTabHtml(data);
    if (tab === 'effect') return effectTabHtml(data);
    return perReplicateTabHtml(data);
}

function csvCell(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
    return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
}

function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function downloadSummaryCsv(kind) {
    if (!lastRender) return;
    const { data, metric } = lastRender;
    const slug = slugifyFilename(metric);
    if (kind === 'per-replicate') {
        const rows = (data.replicates || []).map(r => [
            r.file_name || r.file_id, r.condition, r.day ?? '', r.n ?? '',
            r.mean ?? '', r.median ?? '', r.sd ?? '', r.sem ?? '', r.ci95 ?? '',
            r.shapiro_p ?? '',
        ]);
        downloadCsv(`${slug}_per_replicate_summary.csv`, toCsv(
            ['File', 'Condition', 'Day', 'n', 'Mean', 'Median', 'SD', 'SEM', '95% CI', 'Shapiro-Wilk p'], rows));
        return;
    }
    if (kind === 'per-condition') {
        const rows = (data.conditions || []).map(c => [
            c.condition, c.n_replicates ?? '', c.summary ?? '', c.sd ?? '', c.sem ?? '', c.ci95 ?? '',
        ]);
        downloadCsv(`${slug}_per_condition_summary.csv`, toCsv(
            ['Condition', 'N replicates', summaryStatLabel(), 'SD', 'SEM', '95% CI'], rows));
        return;
    }
    const rows = (data.effect_sizes || []).map(r => [
        r.condition, r.reference ?? '', r.difference ?? '', r.ci_low ?? '', r.ci_high ?? '',
        r.excludes_zero ? 'yes' : 'no', r.paired ? 'paired' : 'unpaired',
    ]);
    downloadCsv(`${slug}_effect_sizes.csv`, toCsv(
        ['Condition', 'Reference', 'Difference', '95% CI low', '95% CI high', 'CI excludes zero', 'Pairing'], rows));
}

function renderEffectPlot(data) {
    const div = document.getElementById('summary-effect-plot');
    if (!div || !window.Plotly) return;
    const rows = (data?.effect_sizes || []).filter(r => safeNum(r.difference) !== null && isConditionVisible(r.condition));
    if (!rows.length) {
        window.Plotly.purge?.(div);
        div.innerHTML = '<p class="summary-placeholder">No visible conditions with effect-size estimates.</p>';
        return;
    }
    const reference = resolveReference(data);
    const trace = {
        type: 'scatter',
        mode: 'markers',
        x: rows.map(r => Number(r.difference)),
        y: rows.map(r => r.condition),
        error_x: {
            type: 'data',
            symmetric: false,
            array: rows.map(r => Math.max(0, Number(r.ci_high) - Number(r.difference)) || 0),
            arrayminus: rows.map(r => Math.max(0, Number(r.difference) - Number(r.ci_low)) || 0),
            thickness: 1.4,
            width: 6,
            color: plotColor('#4c8cff'),
        },
        marker: {
            size: 9,
            color: rows.map(r => plotColor(r.excludes_zero ? '#2f9e44' : '#4c8cff')),
        },
        hovertemplate: '%{y}: difference %{x:.3f}<extra></extra>',
        showlegend: false,
    };
    const layout = {
        ...buildBaseLayout(),
        title: {
            text: `Difference vs ${reference} (95% CI)`,
            font: { family: layoutFontFamily(), size: 12 },
        },
        xaxis: {
            ...axisStyle({ showGrid: true }),
            zeroline: false,
            title: { text: 'Difference', font: { family: layoutFontFamily(), size: 11 } },
        },
        yaxis: {
            ...axisStyle({ showGrid: false, categorical: true }),
            showgrid: false,
            automargin: true,
        },
        showlegend: false,
        height: Math.max(170, 70 + rows.length * 36),
        margin: { t: 36, r: 16, b: 40, l: 10, pad: 2 },
        shapes: [{
            type: 'line',
            x0: 0,
            x1: 0,
            xref: 'x',
            yref: 'paper',
            y0: 0,
            y1: 1,
            line: { color: plotColor('#b42318'), width: 1, dash: 'dash' },
        }],
    };
    window.Plotly.react(div, [trace], layout, getPlotlyConfig());
}

function wireSummaryEvents(content) {
    content.querySelectorAll('[data-summary-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.controls.summaryPanelTab = btn.dataset.summaryTab;
            persistPreferences();
            renderSummaryContent();
        });
    });
    content.querySelectorAll('[data-summary-csv]').forEach(btn => {
        btn.addEventListener('click', () => downloadSummaryCsv(btn.dataset.summaryCsv));
    });
    const refSelect = content.querySelector('#summary-reference-select');
    if (refSelect) {
        refSelect.addEventListener('change', () => {
            state.controls.summaryReferenceCondition = refSelect.value;
            persistPreferences();
            lastRender?.onReferenceChange?.(refSelect.value);
        });
    }
    const dismiss = content.querySelector('.summary-banner-dismiss');
    if (dismiss) {
        dismiss.addEventListener('click', () => {
            if (lastRender) normalityDismissKey = normalityKey(lastRender.data, lastRender.metric);
            renderSummaryContent();
        });
    }
}

export function renderSummaryContent() {
    if (!lastRender) return;
    const { data, metric } = lastRender;
    const content = document.getElementById('summary-content');
    if (!content) return;
    const activeTab = SUMMARY_TABS.some(([id]) => id === state.controls.summaryPanelTab)
        ? state.controls.summaryPanelTab
        : 'per-replicate';

    content.innerHTML = `
      ${pairingNoticeHtml(data)}
      ${normalityBannerHtml(data, metric)}
      <div class="summary-tabs">
        ${SUMMARY_TABS.map(([id, label]) => `<button type="button" class="summary-tab-btn${id === activeTab ? ' active' : ''}" data-summary-tab="${id}">${label}</button>`).join('')}
      </div>
      <div class="summary-tab-body">${tabBodyHtml(activeTab, data)}</div>`;
    wireSummaryEvents(content);
    if (activeTab === 'effect' && state.controls.summaryPanelOpen) renderEffectPlot(data);
}

function applyOpenState() {
    const content = document.getElementById('summary-content');
    const icon = document.getElementById('summary-toggle-icon');
    const open = !!state.controls.summaryPanelOpen;
    if (content) content.style.display = open ? 'block' : 'none';
    if (icon) icon.textContent = open ? '−' : '+';
    document.getElementById('summary-header')?.setAttribute('aria-expanded', String(open));
}

export function renderSummaryPanel(data, metric, { onReferenceChange } = {}) {
    const panel = document.getElementById('summary-panel');
    const content = document.getElementById('summary-content');
    if (!panel || !content) return;
    lastRender = { data, metric, onReferenceChange };
    panel.style.display = state.controls.summaryPanelOpen ? 'block' : 'none';
    const button = document.getElementById('summary-header');
    if (button) button.disabled = false;
    applyOpenState();
    renderSummaryContent();
    requestAnimationFrame(resizeVisiblePlots);
}

export function renderSummaryPanelError(metric, message) {
    const panel = document.getElementById('summary-panel');
    const content = document.getElementById('summary-content');
    if (!panel || !content) return;
    lastRender = null;
    panel.style.display = state.controls.summaryPanelOpen ? 'block' : 'none';
    const button = document.getElementById('summary-header');
    if (button) button.disabled = false;
    applyOpenState();
    content.innerHTML = `<p class="summary-placeholder">Summary statistics unavailable: ${escapeHtml(message)}</p>`;
    requestAnimationFrame(resizeVisiblePlots);
}

export function clearSummaryPanel() {
    const button = document.getElementById('summary-header');
    if (button) { button.disabled = true; button.setAttribute('aria-expanded', 'false'); }
    const panel = document.getElementById('summary-panel');
    const content = document.getElementById('summary-content');
    lastRender = null;
    if (panel) panel.style.display = 'none';
    if (content) content.innerHTML = '';
    requestAnimationFrame(resizeVisiblePlots);
}
