function makeStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    clear() {
      store.clear();
    },
  };
}

function makeClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    contains(value) {
      return values.has(value);
    },
    toggle(value, force) {
      if (force === undefined) {
        if (values.has(value)) {
          values.delete(value);
          return false;
        }
        values.add(value);
        return true;
      }
      if (force) values.add(value);
      else values.delete(value);
      return !!force;
    },
  };
}

function makeElement(overrides = {}) {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: { display: '' },
    classList: makeClassList(),
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(handler);
    },
    dispatchEvent(type, event = {}) {
      for (const handler of this.listeners[type] || []) {
        handler(event);
      }
    },
    contains() {
      return false;
    },
    querySelector() {
      return null;
    },
    ...overrides,
  };
}

const styleBar = makeElement({ style: { display: 'flex' } });
const rawTab = makeElement({ dataset: { tab: 'raw' }, textContent: 'Raw F' });
const deltaTab = makeElement({ dataset: { tab: 'delta' }, textContent: 'ΔF / F₀' });
const peakTab = makeElement({ dataset: { tab: 'peak' }, textContent: 'Peak' });
const hiddenMetricsNote = makeElement({ style: { display: 'none' } });
const traceExclusionNote = makeElement({ style: { display: 'none' } });
const plotTitleOverride = makeElement();
const xLabelOverride = makeElement();
const yLabelOverride = makeElement();
const statusBar = makeElement();
const fileCount = makeElement();
const fileInput = makeElement();
const dropHint = makeElement({ style: { display: '' } });
const uploadJobList = makeElement({ style: { display: 'none' } });
const plotPlaceholder = makeElement({ style: { display: '' } });
const paneRaw = makeElement({ id: 'pane-raw', style: { display: 'none' }, innerHTML: '<div id="plot-raw-traces" class="plot-div"></div>' });
const paneDelta = makeElement({ id: 'pane-delta', style: { display: 'none' }, innerHTML: '<div id="plot-delta-traces" class="plot-div"></div>' });
const plotRaw = makeElement({ id: 'plot-raw-traces' });
const plotDelta = makeElement({ id: 'plot-delta-traces' });
const fileList = makeElement();
const purgeConditionSelect = makeElement();
const purgeConditionBtn = makeElement();
const purgeOldestCount = makeElement({ value: '1' });
const purgeOldestBtn = makeElement();
const conditionDatalist = makeElement();
const conditionLegendPanel = makeElement({ style: { display: 'none' } });
const conditionLegend = makeElement();
const replicateLegendPanel = makeElement({ style: { display: 'none' } });
const replicateLegend = makeElement();
const pointSizeValue = makeElement();
const pointAlphaValue = makeElement();
const jitterValue = makeElement();
const formatContextNote = makeElement();
const filesPanel = makeElement();
const controlsPanel = makeElement();
const formatControls = makeElement();
const resetLabelsBtn = makeElement();
const resetTypographyBtn = makeElement();
const resetRangesBtn = makeElement();

const byId = {
  'style-bar': styleBar,
  'status-bar': statusBar,
  'file-count': fileCount,
  'file-input': fileInput,
  'drop-hint': dropHint,
  'upload-job-list': uploadJobList,
  'plot-title-override': plotTitleOverride,
  'x-label-override': xLabelOverride,
  'y-label-override': yLabelOverride,
  'hidden-metrics-note': hiddenMetricsNote,
  'trace-exclusion-note': traceExclusionNote,
  'plot-placeholder': plotPlaceholder,
  'pane-raw': paneRaw,
  'pane-delta': paneDelta,
  'plot-raw-traces': plotRaw,
  'plot-delta-traces': plotDelta,
  'file-list': fileList,
  'purge-condition-select': purgeConditionSelect,
  'purge-condition-btn': purgeConditionBtn,
  'purge-oldest-count': purgeOldestCount,
  'purge-oldest-btn': purgeOldestBtn,
  'condition-datalist': conditionDatalist,
  'condition-legend-panel': conditionLegendPanel,
  'condition-legend': conditionLegend,
  'replicate-legend-panel': replicateLegendPanel,
  'replicate-legend': replicateLegend,
  'point-size-value': pointSizeValue,
  'point-alpha-value': pointAlphaValue,
  'jitter-value': jitterValue,
  'format-context-note': formatContextNote,
  'files-panel': filesPanel,
  'controls-panel': controlsPanel,
  'format-controls': formatControls,
  'reset-labels-btn': resetLabelsBtn,
  'reset-typography-btn': resetTypographyBtn,
  'reset-ranges-btn': resetRangesBtn,
};

globalThis.document = {
  body: { dataset: {} },
  readyState: 'complete',
  addEventListener() {},
  querySelectorAll(selector) {
    if (selector === '.tab-btn') return [rawTab, deltaTab, peakTab];
    if (selector === '.style-btn') return [];
    if (selector === '.plot-pane') return [paneRaw, paneDelta];
    return [];
  },
  getElementById(id) {
    return byId[id] || null;
  },
};

globalThis.window = {
  setTimeout,
  clearTimeout,
  Plotly: {
    react(...args) {
      globalThis.__plotlyCalls.push(args);
    },
  },
};
globalThis.requestAnimationFrame = callback => callback();
globalThis.__plotlyCalls = [];
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonResponse(data) {
  return {
    ok: true,
    headers: { get: name => (name === 'content-type' ? 'application/json' : null) },
    async json() { return data; },
  };
}

const core = await import('./js/core.js');
const preferences = await import('./js/preferences.js');
const dom = await import('./js/dom.js');
const stateModule = await import('./js/state.js');
const plotController = await import('./js/plot-controller.js');

const {
  assignColor,
  currentDeltaLabel,
  currentRawLabel,
  currentSignalMode,
  dayColorForFile,
  daySymbolForFile,
  defaultPlotLabels,
  enrichMetricData,
  enrichTraceData,
  hasDayMetadata,
  parseRange,
  moveManualCondition,
  plotLabels,
  resetConditionColor,
  resetLabelOverrides,
  setActiveTab,
  setConditionColor,
  setLabelOverride,
  sortConditions,
  syncManualConditionOrder,
  updateStyleBarVisibility,
  updateTraceTabLabels,
  updateTraceExclusionNotice,
} = core;
const {
  persistPreferences,
  restoreConditionForFile,
  restorePreferences,
} = preferences;
const {
  renderFileList,
  updateFileCount,
  updateUploadJobs,
} = dom;
const { DAY_PALETTE, normalizeDay, sortedDayKeys, state } = stateModule;
const { refreshCurrentTab } = plotController;

function resetState() {
  state.files = new Map();
  state.uploadJobs = new Map();
  state.sessionMemoryLimitBytes = 0;
  state.browserWarnFileBytes = 0;
  state.parseTimeoutSeconds = 0;
  state.currentTab = 'raw';
  state.plotStyle = 'violin';
  state.condColorMap = {};
  state.manualConditionOrder = [];
  state.labelOverrides = {};
  state.paneTemplates = {};
  state.controls.conditionOrder = 'entered';
  fileCount.textContent = '';
  statusBar.textContent = '';
  uploadJobList.innerHTML = '';
  uploadJobList.style.display = 'none';
  traceExclusionNote.textContent = '';
  traceExclusionNote.style.display = 'none';
  hiddenMetricsNote.textContent = '';
  hiddenMetricsNote.style.display = 'none';
  plotPlaceholder.textContent = '';
  plotPlaceholder.style.display = '';
  paneRaw.style.display = 'none';
  paneDelta.style.display = 'none';
  globalThis.__plotlyCalls.length = 0;
}

resetState();
state.sessionMemoryLimitBytes = 2 * 1024 * 1024;
state.files.set('1', { file_name: 'A.xlsx', condition: 'DMSO', memory_bytes: 1048576 });
state.files.set('2', { file_name: 'B.xlsx', condition: 'Drug', memory_bytes: 524288 });
updateFileCount();
assert(fileCount.textContent.includes('2 / 50 files max'), 'file count should include max label');
assert(currentSignalMode() === 'fluorescence', 'default files should resolve to fluorescence mode');
state.files.get('1').signal_mode = 'ratio';
state.files.get('2').signal_mode = 'ratio';
assert(currentSignalMode() === 'ratio', 'ratio-tagged files should resolve to ratio mode');
assert(currentDeltaLabel({ spaced: false }) === 'ΔR/R₀', 'delta label should switch to ratio wording');
assert(currentRawLabel({ spaced: false }) === 'Raw R/R₀', 'raw label should switch to ratio wording');
updateTraceTabLabels();
assert(rawTab.textContent === 'Raw R / R₀', 'raw tab label should switch to ratio wording');
assert(deltaTab.textContent === 'ΔR / R₀', 'delta tab label should switch to ratio wording');
state.files.get('1').signal_mode = 'fluorescence';
state.files.get('2').signal_mode = 'fluorescence';
assert(defaultPlotLabels('raw').y === 'Raw F (a.u.)', 'raw default y label should use fluorescence wording');
setLabelOverride('title', 'Custom Raw Title', 'raw');
setLabelOverride('x', 'Seconds', 'raw');
setLabelOverride('y', 'Signal', 'raw');
assert(plotLabels('raw').title === 'Custom Raw Title', 'custom title should override default');
assert(plotLabels('raw').x === 'Seconds', 'custom x label should override default');
assert(plotLabels('raw').y === 'Signal', 'custom y label should override default');
resetLabelOverrides('raw');
assert(plotLabels('raw').title === defaultPlotLabels('raw').title, 'reset should restore default title');
state.currentTab = 'peak';
state.controls.rotate = true;
assert(defaultPlotLabels('peak').x.includes('Peak'), 'rotated metric x label should default to the metric value label');
assert(defaultPlotLabels('peak').y === '', 'rotated metric y label should default to empty');
state.controls.rotate = false;
state.controls.xAxisTickAngle = '-45';
persistPreferences();
state.controls.xAxisTickAngle = '0';
restorePreferences();
assert(state.controls.xAxisTickAngle === '-45', 'x-axis tick angle control should persist');

state.controls.yMin = '1.25';
state.controls.yMax = '';
const partialY = parseRange('yMin', 'yMax');
assert(partialY && partialY.min === 1.25 && partialY.max === null, 'range parser should allow min-only ranges');
syncManualConditionOrder();
assert(state.manualConditionOrder.join(',') === 'DMSO,Drug', 'manual order should follow entered conditions');
moveManualCondition('Drug', -1);
assert(state.manualConditionOrder.join(',') === 'Drug,DMSO', 'manual move should reorder conditions');
state.controls.conditionOrder = 'manual';
assert(sortConditions(['DMSO', 'Drug'], () => 0).join(',') === 'Drug,DMSO', 'manual sort should use saved order');

assignColor('DMSO');
const defaultColor = state.condColorMap.DMSO;
setConditionColor('DMSO', '#123456');
assert(state.condColorMap.DMSO === '#123456', 'custom color should be stored');
resetConditionColor('DMSO');
assert(state.condColorMap.DMSO !== '#123456', 'reset should remove custom override');
assert(state.condColorMap.DMSO === defaultColor, 'reset should restore assigned palette color');

state.files.get('1').condition = 'Vehicle';
setActiveTab('delta');
assert(styleBar.hidden === true, 'style bar should hide on trace tabs');
assert(styleBar.style.display === 'none', 'style bar display should be none on trace tabs');
assert(globalThis.document.body.dataset.activeTab === 'delta', 'body should track the active tab');
setActiveTab('peak');
assert(styleBar.hidden === false, 'style bar should show on metric tabs');
assert(styleBar.style.display === 'flex', 'style bar display should be restored on metric tabs');
updateStyleBarVisibility('raw');
assert(styleBar.hidden === true, 'explicit style bar visibility update should hide on raw tab');
setActiveTab('delta');
persistPreferences();
assert(restoreConditionForFile('A.xlsx') === 'Vehicle', 'session layout should restore file condition by filename');

resetState();
restorePreferences();
assert(state.currentTab === 'delta', 'preferences should restore last active tab');

resetState();
state.uploadJobs.set('job-running', {
  job_id: 'job-running',
  file_name: 'running.xlsx',
  status: 'running',
  progress: 0.45,
  message: 'Reading metrics…',
});
state.uploadJobs.set('job-done', {
  job_id: 'job-done',
  file_name: 'done.xlsx',
  status: 'completed',
  progress: 1,
  message: 'Upload complete.',
});
state.uploadJobs.set('job-canceled', {
  job_id: 'job-canceled',
  file_name: 'canceled.xlsx',
  status: 'canceled',
  progress: 1,
  message: 'Upload canceled.',
});
updateUploadJobs();
assert(uploadJobList.style.display !== 'none', 'upload job list should show when jobs exist');
assert(uploadJobList.innerHTML.includes('data-upload-action="cancel"'), 'active upload jobs should render cancel button');
assert(uploadJobList.innerHTML.includes('data-upload-action="dismiss"'), 'finished upload jobs should render dismiss button');
assert(uploadJobList.innerHTML.includes('Reading metrics…'), 'upload job list should render progress messages');
assert(uploadJobList.innerHTML.includes('Upload canceled.'), 'upload job list should render canceled message');

resetState();
state.files.set('trace-ok', {
  file_name: 'trace-ok.xlsx',
  condition: 'Vehicle',
  assignment_source: 'manual',
  n_rois: 3,
  analysis_mode: 'single',
  signal_mode: 'fluorescence',
  memory_bytes: 1024,
  available_metrics: ['peak'],
  warnings: [],
  has_traces: true,
  has_delta_f: true,
  trace_status: '',
});
state.files.set('metrics-only', {
  file_name: 'metrics-only.xlsx',
  condition: 'Vehicle',
  assignment_source: 'restored',
  n_rois: 3,
  analysis_mode: 'single',
  signal_mode: 'fluorescence',
  memory_bytes: 1024,
  available_metrics: ['peak'],
  warnings: ['Raw_Traces skipped because the trace sheet is too large for interactive loading'],
  has_traces: false,
  has_delta_f: false,
  trace_status: 'traces skipped',
});
renderFileList();
assert(fileList.innerHTML.includes('traces skipped'), 'file list should show trace status for degraded file');
assert(fileList.innerHTML.includes('Raw_Traces skipped because the trace sheet is too large'), 'file list should render exact warning text');
assert(fileList.innerHTML.includes('Restored: Vehicle'), 'file list should mark restored condition assignments');

const enrichedTraces = enrichTraceData({
  Vehicle: {
    time_s: [0, 1, 2],
    condition_summary: [1, 1.5, 2],
    condition_error: [0, 0.1, 0.2],
    files: [
      { file_id: 'trace-ok', file_name: 'trace-ok.xlsx', mean: [1, NaN, 2], n_rois: 3 },
    ],
  },
});
assert(enrichedTraces.Vehicle.time_s.length === 3, 'trace enrichment should preserve time axis length');
assert(enrichedTraces.Vehicle.files[0].mean.length === 3, 'trace enrichment should preserve mean length (NaNs become gaps)');
assert(enrichedTraces.Vehicle.condition_summary.join(',') === '1,1.5,2', 'trace enrichment should use backend condition_summary verbatim');
assert(enrichedTraces.Vehicle.condition_error.join(',') === '0,0.1,0.2', 'trace enrichment should use backend condition_error verbatim');

const enrichedMetrics = enrichMetricData('peak', {
  Vehicle: {
    peak: {
      files: [
        { file_id: 'a', file_name: 'a.xlsx', values: [1, 2], mean: 1.5, summary: 1.5, is_outlier: false },
        { file_id: 'b', file_name: 'b.xlsx', values: [10, 11], mean: 10.5, summary: 10.5, is_outlier: true },
      ],
      condition_summary: 1.5,
      condition_error: 0.25,
      condition_mean: 6,
      condition_sem: 4.5,
      n_files: 2,
    },
  },
});
assert(enrichedMetrics.Vehicle.files[0].summary === 1.5, 'metric enrichment should use backend per-file summary');
assert(enrichedMetrics.Vehicle.files[1].isOutlier === true, 'backend is_outlier should drive the exclusion flag');
assert(enrichedMetrics.Vehicle.condition_summary === 1.5, 'backend condition_summary should be used verbatim');
assert(enrichedMetrics.Vehicle.condition_error === 0.25, 'backend condition_error should be used verbatim');
assert(enrichedMetrics.Vehicle.n_excluded === 1 && enrichedMetrics.Vehicle.n_included === 1, 'excluded counts should derive from backend outlier flags');

globalThis.fetch = async (url, options = {}) => {
  if (url === '/api/plot/metrics') {
    const body = JSON.parse(options.body);
    assert(body.summary_stat === 'mean', 'metrics request should send summary_stat from controls');
    assert(body.error_mode === 'sem', 'metrics request should send error_mode from controls');
    assert(body.outlier_mode === null, 'metrics request should send null outlier_mode when exclusion is off');
    return jsonResponse({
      Vehicle: {
        peak: {
          files: [
            { file_id: 'trace-ok', file_name: 'trace-ok.xlsx', values: [1, 2], mean: 1.5, summary: 1.5, is_outlier: false },
            { file_id: 'metrics-only', file_name: 'metrics-only.xlsx', values: [2, 3], mean: 2.5, summary: 2.5, is_outlier: false },
          ],
          condition_summary: 2,
          condition_error: 0.5,
          condition_mean: 2,
          condition_sem: 0.5,
          n_files: 2,
        },
      },
    });
  }
  if (url === '/api/plot/traces') {
    const body = JSON.parse(options.body);
    assert(body.summary_stat === 'mean', 'traces request should send summary_stat from controls');
    assert(body.error_mode === 'sem', 'traces request should send error_mode from controls');
    return jsonResponse({
      Vehicle: {
        time_s: [0, 1],
        files: [
          { file_id: 'trace-ok', file_name: 'trace-ok.xlsx', mean: [1, 2], n_rois: 3 },
        ],
        condition_summary: [1, 2],
        condition_error: [0, 0],
        condition_mean: [1, 2],
        condition_sem: [0, 0],
        n_files: 1,
        warnings: ['metrics-only.xlsx: resampled to align time axes'],
      },
    });
  }
  throw new Error(`Unexpected fetch: ${url} ${options.method || 'GET'}`);
};

setActiveTab('raw');
await refreshCurrentTab(() => ({ Vehicle: ['trace-ok', 'metrics-only'] }));
assert(traceExclusionNote.style.display !== 'none', 'trace exclusion note should show for mixed trace support');
assert(traceExclusionNote.textContent.includes('metrics-only.xlsx'), 'trace exclusion note should name excluded file');
assert(traceExclusionNote.textContent.includes('Raw_Traces skipped because the trace sheet is too large'), 'trace exclusion note should include exact warning reason');
assert(traceExclusionNote.textContent.includes('Trace warnings'), 'trace exclusion note should include backend trace warnings');
assert(globalThis.__plotlyCalls.length === 1, 'trace refresh should render the trace plot once');

// Regression test: overlapping refresh calls should not allow stale results to render after a newer refresh completes.
resetState();
setActiveTab('raw');
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
globalThis.__plotlyCalls.length = 0;
let metricsCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  if (url === '/api/plot/metrics') {
    metricsCalls += 1;
    // Make the first refresh's metrics request resolve after the second refresh starts.
    if (metricsCalls === 1) await sleep(120);
    return jsonResponse({ Vehicle: { peak: { files: [], condition_summary: 0, condition_error: 0, condition_mean: 0, condition_sem: 0, n_files: 0 } } });
  }
  if (url === '/api/plot/traces') {
    // Traces for the second refresh return immediately; the first refresh should never reach this.
    return jsonResponse({ Vehicle: { time_s: [0], files: [{ file_id: 'x', file_name: 'x', mean: [1], n_rois: 1 }], condition_summary: [1], condition_error: [0], condition_mean: [1], condition_sem: [0], n_files: 1 } });
  }
  throw new Error(`Unexpected fetch: ${url} ${options.method || 'GET'}`);
};
const slow = refreshCurrentTab(() => ({ Vehicle: ['trace-ok'] }));
await sleep(5);
const fast = refreshCurrentTab(() => ({ Vehicle: ['trace-ok'] }));
await Promise.all([slow, fast]);
assert(globalThis.__plotlyCalls.length === 1, `only the latest refresh should render (got ${globalThis.__plotlyCalls.length})`);

// Outlier mode mapping: the UI control drives the backend outlier_mode field.
const api = await import('./js/api.js');
let capturedBody = null;
globalThis.fetch = async (url, options = {}) => {
  capturedBody = JSON.parse(options.body);
  return jsonResponse({});
};
state.controls.excludeOutliers = true;
state.controls.outlierMethod = 'iqr';
await api.fetchMetrics({ Vehicle: ['a'] });
assert(capturedBody.outlier_mode === 'iqr', 'iqr control should map to iqr outlier_mode');
state.controls.outlierMethod = 'modified_zscore';
await api.fetchMetrics({ Vehicle: ['a'] });
assert(capturedBody.outlier_mode === 'zscore', 'modified z-score control should map to zscore outlier_mode');
state.controls.excludeOutliers = false;
await api.fetchMetrics({ Vehicle: ['a'] });
assert(capturedBody.outlier_mode === null, 'disabled exclusion should send null outlier_mode');

// Summary stats endpoint: request body should follow the /api/stats/summary contract.
capturedBody = null;
let capturedUrl = null;
globalThis.fetch = async (url, options = {}) => {
  capturedUrl = url;
  capturedBody = JSON.parse(options.body);
  return jsonResponse({
    replicates: [],
    conditions: [],
    effect_sizes: [],
    pairing_mode: null,
    pairing_warning: null,
  });
};
await api.fetchSummaryStats('peak', { Vehicle: ['a'], Drug: ['b'] }, {
  summaryStat: 'median',
  paired: true,
  referenceCondition: 'Vehicle',
  fileDays: { a: 'Day 1' },
  excludedFileIds: ['b'],
});
assert(capturedUrl === '/api/stats/summary', 'summary stats should post to /api/stats/summary');
assert(capturedBody.metric === 'peak', 'summary request should send the metric');
assert(capturedBody.summary_stat === 'median', 'summary request should send summary_stat');
assert(capturedBody.paired === true, 'summary request should send the paired flag');
assert(capturedBody.reference_condition === 'Vehicle', 'summary request should send reference_condition');
assert(capturedBody.file_days.a === 'Day 1', 'summary request should send file_days');
assert(capturedBody.excluded_file_ids.join(',') === 'b', 'summary request should send excluded_file_ids');
const summaryDefault = await api.fetchSummaryStats('peak', { Vehicle: ['a'] });
assert(capturedBody.summary_stat === 'mean' && capturedBody.paired === false && capturedBody.reference_condition === null,
  'summary request defaults should be mean/unpaired/null reference');
assert(summaryDefault.pairing_mode === null, 'summary response should pass through pairing_mode');

// Summary panel module: import must succeed and DOM-touching functions must no-op without the panel elements.
const summaryPanel = await import('./js/summary-panel.js');
summaryPanel.clearSummaryPanel();
summaryPanel.renderSummaryPanel({ replicates: [], conditions: [], effect_sizes: [], pairing_mode: null }, 'peak');
summaryPanel.renderSummaryPanelError('peak', 'endpoint missing');
state.controls.summaryPanelOpen = true;
state.controls.summaryPanelTab = 'effect';
persistPreferences();
state.controls.summaryPanelOpen = false;
state.controls.summaryPanelTab = 'per-replicate';
restorePreferences();
assert(state.controls.summaryPanelOpen === true, 'summary panel open state should persist');
assert(state.controls.summaryPanelTab === 'effect', 'summary panel tab should persist');

// Day handling: normalization, deterministic ordering, and file_id-only matching.
resetState();
assert(normalizeDay('  Day  1 ').key === 'day 1', 'normalizeDay should trim, collapse whitespace, and lowercase the key');
assert(normalizeDay('  Day  1 ').label === 'Day 1', 'normalizeDay should keep first-seen casing for display');
assert(normalizeDay('day 1').label === 'Day 1', 'normalizeDay should reuse the first-seen display label');
state.files.set('f2', { id: 'f2', file_name: 'dup.xlsx', condition: 'A', day: 'Day 2' });
state.files.set('f10', { id: 'f10', file_name: 'dup.xlsx', condition: 'A', day: 'day 10' });
state.files.set('f1', { id: 'f1', file_name: 'other.xlsx', condition: 'A', day: 'day 1' });
assert(sortedDayKeys().join(',') === 'day 1,day 2,day 10', 'days should sort naturally (day2 < day10)');
state.groupByDay = true;
assert(hasDayMetadata(), 'normalized day metadata should be detected');
assert(dayColorForFile({ file_id: 'f1' }) === DAY_PALETTE[0], 'first sorted day should get the first palette color');
assert(dayColorForFile({ file_id: 'f2' }) === DAY_PALETTE[1], 'second sorted day should get the second palette color');
assert(dayColorForFile({ file_id: 'f10' }) === DAY_PALETTE[2], 'day 10 should sort after day 2 regardless of entry order');
assert(daySymbolForFile({ file_id: 'f10' }) !== daySymbolForFile({ file_id: 'f2' }), 'symbols should advance with the sorted day index');
// Duplicate filenames: a file must keep its own day even when another file shares its name.
state.files.set('f1dup', { id: 'f1dup', file_name: 'dup.xlsx', condition: 'A', day: 'day 1' });
assert(dayColorForFile({ file_id: 'f2' }) === DAY_PALETTE[1], 'duplicate filenames must not cross-map days');
assert(dayColorForFile({ file_id: 'f1dup' }) === DAY_PALETTE[0], 'file_id lookup should resolve the correct day');
state.groupByDay = false;
assert(dayColorForFile({ file_id: 'f2' }) === null, 'no day color when color-by-day is off');

updateTraceExclusionNotice('');
assert(traceExclusionNote.style.display === 'none', 'trace exclusion note should hide when cleared');

console.log('Frontend smoke test passed: ordering, upload job UI, trace exclusion rendering, backend-driven stats, and day handling.');

// Statistics must respect a user's collapsed/open choice across metric refreshes.
const statsPanelEl = makeElement({ style: { display: 'none' } });
const statsContentEl = makeElement({ style: { display: 'none' } });
const statsIconEl = makeElement();
const statsButtonEl = makeElement({ disabled: true, setAttribute(name, value) { this[name] = value; } });
byId['stats-header'] = statsButtonEl;
byId['stats-panel'] = statsPanelEl;
byId['stats-content'] = statsContentEl;
byId['stats-toggle-icon'] = statsIconEl;
resetState();
state.files.set('gui-file', { file_name: 'gui.xlsx', condition: 'Vehicle', available_metrics: ['peak'] });
state.controls.showSignificance = true;
setActiveTab('peak');
globalThis.fetch = async url => {
  if (url === '/api/plot/metrics') return jsonResponse({ Vehicle: { peak: {
    files: [{ file_id: 'gui-file', file_name: 'gui.xlsx', values: [1, 2], summary: 1.5 }],
    condition_summary: 1.5, condition_error: 0, n_files: 1,
  } } });
  if (url === '/api/stats/pairwise') return jsonResponse({ comparisons: [] });
  if (url === '/api/stats/summary') return jsonResponse({ replicates: [], conditions: [], effect_sizes: [] });
  throw new Error(`Unexpected GUI regression fetch: ${url}`);
};
await refreshCurrentTab(() => ({ Vehicle: ['gui-file'] }));
assert(statsPanelEl.style.display === 'none', 'closed comparisons panel should take no workspace space');
assert(statsContentEl.style.display === 'none', 'statistics must not automatically expand');
assert(!statsButtonEl.disabled && statsButtonEl['aria-expanded'] === 'false', 'statistics button should be enabled and collapsed when results are available');
state.controls.statsPanelOpen = true;
await refreshCurrentTab(() => ({ Vehicle: ['gui-file'] }));
assert(statsContentEl.style.display === 'block', 'statistics should remain open when requested');
assert(statsPanelEl.style.display === 'block' && statsButtonEl['aria-expanded'] === 'true', 'open panel and button should agree');
state.controls.statsPanelOpen = false;
await refreshCurrentTab(() => ({ Vehicle: ['gui-file'] }));
assert(statsContentEl.style.display === 'none', 'refresh must preserve a collapsed statistics panel');
console.log('GUI regression passed: statistics open only when requested and preserve their state.');

// Warning visibility updates immediately and survives preference restoration.
const warningsToggleEl = makeElement({ checked: true });
byId['warnings-toggle'] = warningsToggleEl;
state.controls.showWarnings = false;
core.applyWarningVisibility();
assert(document.body.dataset.showWarnings === 'false' && !warningsToggleEl.checked, 'warning toggle should hide messages immediately');
persistPreferences();
state.controls.showWarnings = true;
restorePreferences();
core.applyWarningVisibility();
assert(state.controls.showWarnings === false && !warningsToggleEl.checked, 'warning visibility should persist');
state.controls.showWarnings = true;
core.applyWarningVisibility();
assert(document.body.dataset.showWarnings === 'true' && warningsToggleEl.checked, 'warnings can be shown again');
console.log('Warning visibility regression passed.');

// Project workspace snapshots are independent of subsequent edits and restore saved settings.
const projectState = await import('./js/project-state.js');
state.controls.summaryStat = 'median';
state.controls.yMin = 1.25;
state.controls.yMax = 8;
state.controls.showWarnings = false;
state.controls.summaryPanelOpen = true;
state.currentTab = 'peak';
state.plotStyle = 'box';
state.manualConditionOrder = ['Drug', 'Control'];
state.condColorMap = { Drug: '#123456' };
state.labelOverrides = { peak: { title: 'Saved figure', y: 'Calcium' } };
const savedWorkspace = projectState.captureProjectWorkspace({ theme: 'dark' });
state.controls.summaryStat = 'mean';
state.controls.yMin = '';
state.controls.showWarnings = true;
state.manualConditionOrder.reverse();
state.labelOverrides.peak.title = 'Changed figure';
assert(savedWorkspace.manualConditionOrder[0] === 'Drug' && savedWorkspace.labelOverrides.peak.title === 'Saved figure', 'project snapshot must not change with later edits');
projectState.restoreProjectWorkspace(savedWorkspace);
assert(state.controls.summaryStat === 'median' && state.controls.yMin === 1.25 && state.controls.yMax === 8, 'project should restore analysis settings and numeric axis limits');
assert(state.controls.showWarnings === false && state.plotStyle === 'box', 'project should restore visibility and chart style');
assert(state.condColorMap.Drug === '#123456' && state.labelOverrides.peak.title === 'Saved figure', 'project should restore source colors and labels');
assert(state.manualConditionOrder[0] === 'Drug' && state.currentTab === 'peak', 'project should restore condition order and metric tab');
assert(!state.controls.summaryPanelOpen && !state.controls.statsPanelOpen, 'opening a project must not automatically expand statistics');
console.log('Project workspace regression passed.');

// Independently hide uncertainty shading, boundary lines, and replicate traces.
const { renderTraceComparison } = await import('./js/trace-renderers.js');
const crowdedTraces = Object.fromEntries(['Control', 'Drug A', 'Drug B'].map((condition, i) => [condition, {
  time_s: [0, 1, 2], condition_summary: [i + 1, i + 2, i + 3],
  condition_error: [0.1, 0.2, 0.3], n_files: 2,
  files: [
    { file_id: `${i}-a`, file_name: `${i}-a.xlsx`, mean: [i, i + 1, i + 2], n_rois: 3 },
    { file_id: `${i}-b`, file_name: `${i}-b.xlsx`, mean: [i + 2, i + 3, i + 4], n_rois: 3 },
  ],
}]));
state.controls.showReplicateLegend = true;
state.controls.errorBars = 'sem';
state.groupByDay = false;
for (const showBand of [false, true]) {
  for (const showBounds of [false, true]) {
    for (const showReplicates of [false, true]) {
      state.controls.showTraceErrorBand = showBand;
      state.controls.showTraceErrorBounds = showBounds;
      state.controls.showTraceReplicates = showReplicates;
      renderTraceComparison('plot-raw-traces', crowdedTraces, 'Trace', 'Time', 'R/R₀');
      const traces = globalThis.__plotlyCalls.at(-1)[1];
      const summaries = traces.filter(trace => trace.name && trace.x[0] !== null);
      assert(summaries.length === 3, 'all condition summary curves must remain visible');
      summaries.forEach(trace => assert(trace.y.join(',') === crowdedTraces[trace.legendgroup].condition_summary.join(','), 'visibility controls must not change summary data'));
      const bounds = traces.filter(trace => trace.hoverinfo === 'skip' && trace.x[0] !== null);
      assert(bounds.length === (showBand || showBounds ? 6 : 0), 'only create uncertainty traces when requested');
      assert(bounds.filter(trace => trace.fill === 'tonexty').length === (showBand ? 3 : 0), 'error bands should toggle independently');
      assert(bounds.filter(trace => trace.line.width > 0).length === (showBounds ? 6 : 0), 'both boundary lines should toggle independently');
      const replicates = traces.filter(trace => trace.hovertemplate?.includes('ROIs'));
      assert(replicates.length === (showReplicates ? 6 : 0), 'replicate traces should toggle independently');
      assert(traces.filter(trace => trace.name?.startsWith('Replicate ')).length === (showReplicates ? 2 : 0), 'hide replicate legend entries together with their traces');
    }
  }
}
state.controls.errorBars = 'none';
state.controls.showTraceErrorBand = state.controls.showTraceErrorBounds = true;
renderTraceComparison('plot-delta-traces', crowdedTraces, 'Trace', 'Time', 'ΔR/R₀');
assert(!globalThis.__plotlyCalls.at(-1)[1].some(trace => trace.fill === 'tonexty' || trace.hoverinfo === 'skip' && trace.x[0] !== null), 'Error None must disable bands and bounds');
state.controls.errorBars = 'sem';
state.controls.showTraceErrorBand = state.controls.showTraceErrorBounds = state.controls.showTraceReplicates = false;
assert(!core.defaultPlotLabels('delta').title.includes('±'), 'summary-only trace title should not imply visible errors');
persistPreferences();
state.controls.showTraceErrorBand = state.controls.showTraceErrorBounds = state.controls.showTraceReplicates = true;
restorePreferences();
assert(!state.controls.showTraceErrorBand && !state.controls.showTraceErrorBounds && !state.controls.showTraceReplicates, 'trace visibility choices should persist');
const traceWorkspace = projectState.captureProjectWorkspace();
state.controls.showTraceErrorBand = state.controls.showTraceErrorBounds = state.controls.showTraceReplicates = true;
projectState.restoreProjectWorkspace(traceWorkspace);
assert(!state.controls.showTraceErrorBand && !state.controls.showTraceErrorBounds && !state.controls.showTraceReplicates, 'projects should restore trace visibility choices');
console.log('Trace visibility regression passed: all toggle combinations, Error None, unchanged summaries, and saved settings.');

// The refresh must send daily pooling and normalized day assignments to both trace types.
resetState();
state.controls.poolByDay = true;
state.controls.showTraceReplicates = true;
for (const [fid, day] of [['a', 'Day 1'], ['b', 'day 1'], ['c', 'Day 1'], ['d', 'Day 2']]) {
  state.files.set(fid, { file_name: 'duplicate.xlsx', condition: 'Control', day, available_metrics: ['peak'], has_traces: true, has_delta_f: true });
}
let traceRequests = 0;
globalThis.fetch = async (url, options) => {
  if (url === '/api/plot/metrics') return jsonResponse({ Control: { peak: { files: [], condition_summary: 2, n_files: 2 } } });
  assert(url === '/api/plot/traces', 'trace refresh must call trace endpoint');
  const body = JSON.parse(options.body);
  assert(body.pool_by_day === true && body.file_days.a === body.file_days.b && body.file_days.d === 'Day 2', 'trace request must carry pooling and normalized source days');
  traceRequests++;
  return jsonResponse({ Control: {
    time_s: [0, 1, 2], condition_summary: [4, 4, 4], condition_error: [2, 2, 2],
    n_files: 2, n_source_files: 4, pool_by_day: true,
    files: [
      { file_id: 'day:Control:Day 1', day: 'Day 1', file_ids: ['a', 'b', 'c'], file_name: 'Day 1 (3 files)', mean: [2, 2, 2], n_rois: 3 },
      { file_id: 'day:Control:Day 2', day: 'Day 2', file_ids: ['d'], file_name: 'duplicate.xlsx', mean: [6, 6, 6], n_rois: 1 },
    ],
  } });
};
for (const tab of ['raw', 'delta']) {
  setActiveTab(tab);
  await refreshCurrentTab(() => ({ Control: ['a', 'b', 'c', 'd'] }));
  const rendered = globalThis.__plotlyCalls.at(-1)[1];
  const summaryCurve = rendered.find(trace => trace.name?.startsWith('Control'));
  assert(summaryCurve.y.join(',') === '4,4,4' && summaryCurve.name.includes('2 replicates'), 'trace legend and summary must reflect independent daily units');
  assert(!replicateLegend.innerHTML.includes('Replicate 3'), 'sidebar replicate legend must use pooled count');
}
assert(traceRequests === 2, 'pooling should be passed for raw and delta trace tabs');
state.groupByDay = true;
assert(dayColorForFile({ file_id: 'day:Control:Day 1', day: 'Day 1' }) === dayColorForFile({ file_id: 'a' }), 'pooled curves must preserve day color mapping');
console.log('Trace pooling UI regression passed: raw/delta requests, daily legend counts, and day colors.');

// Condition visibility is presentation-only across all graph styles and project saves.
resetState();
state.hiddenConditions = [];
state.groupByDay = false;
state.controls.paired = true;
state.controls.poolByDay = false;
state.controls.showTraceReplicates = true;
state.controls.showConditionLegend = true;
state.controls.showReplicateLegend = true;
state.controls.showSignificance = true;
const visibleGroups = { Control: ['v-a'], Hidden: ['v-b'], Drug: ['v-c'] };
for (const [condition, [id]] of Object.entries(visibleGroups)) {
  state.files.set(id, { file_name: `${condition}.xlsx`, condition, available_metrics: ['peak'], has_traces: true, has_delta_f: true });
}
const visibilityMetrics = Object.fromEntries(Object.entries(visibleGroups).map(([condition, [id]], i) => [condition, { peak: {
  files: [{ file_id: id, file_name: `${condition}.xlsx`, values: [i * 100 + 1, i * 100 + 2], summary: i * 100 + 1.5, is_outlier: condition === 'Hidden' }],
  condition_summary: i * 100 + 1.5, condition_error: 0.5, n_files: 1,
} }]));
state.hiddenConditions = ['Hidden'];
const { renderMetricChart, addSignificanceAnnotations } = await import('./js/metric-renderers.js');
for (const style of ['violin', 'bar', 'box', 'strip', 'raincloud']) {
  state.plotStyle = style;
  const enriched = renderMetricChart('plot-peak', 'peak', visibilityMetrics);
  assert(enriched.Hidden.files[0].isOutlier, 'hidden condition must remain available for statistical exclusion handling');
  const [target, traces, layout] = globalThis.__plotlyCalls.at(-1);
  assert(!traces.some(trace => trace.legendgroup === 'Hidden' || trace.name === 'Hidden'), `hidden condition must be absent in ${style} traces and legends`);
  const categoryAxis = state.controls.rotate ? layout.yaxis : layout.xaxis;
  assert(categoryAxis.tickvals.join(',') === '0,1', `visible conditions should have compact category positions in ${style}`);
  assert(!categoryAxis.ticktext.join(',').includes('Hidden'), 'hidden condition must be removed from axis labels');
}
let annotationUpdate;
window.Plotly.relayout = (target, update) => { annotationUpdate = update; };
const enrichedVisibility = core.enrichMetricData('peak', visibilityMetrics);
addSignificanceAnnotations('plot-peak', [
  { condition_a: 'Control', condition_b: 'Hidden', significant: true, stars: '**' },
  { condition_a: 'Control', condition_b: 'Drug', significant: true, stars: '*' },
], enrichedVisibility);
assert(annotationUpdate.annotations.length === 1 && annotationUpdate.shapes.length === 3, 'only comparisons between visible conditions should be annotated');
renderTraceComparison('plot-raw-traces', {
  Control: crowdedTraces.Control, Hidden: crowdedTraces['Drug A'], Drug: crowdedTraces['Drug B'],
}, 'Traces', 'Time', 'Signal');
assert(!globalThis.__plotlyCalls.at(-1)[1].some(trace => trace.legendgroup === 'Hidden'), 'hidden condition must be removed from trace curves and error bands');

const checklist = makeElement();
const showAllButton = makeElement();
byId['condition-visibility'] = checklist;
byId['show-all-conditions'] = showAllButton;
dom.updateConditionLegend();
assert(checklist.innerHTML.includes('data-visible-condition="Hidden"'), 'hidden conditions must remain in the checklist');
assert(!showAllButton.disabled, 'Show all should be enabled while conditions are hidden');
state.files.set('v-new', { file_name: 'new.xlsx', condition: 'New condition' });
dom.updateConditionLegend();
assert(core.isConditionVisible('New condition'), 'new condition names should start visible');
state.files.get('v-b').condition = 'Renamed';
dom.updateConditionLegend();
assert(!state.hiddenConditions.includes('Hidden') && core.isConditionVisible('Renamed'), 'renaming away the last member should prune stale hidden names');
state.files.get('v-b').condition = 'Hidden';
state.files.delete('v-new');
state.hiddenConditions = ['Hidden'];
const savedVisibility = projectState.captureProjectWorkspace();
state.hiddenConditions = [];
projectState.restoreProjectWorkspace(savedVisibility);
assert(state.hiddenConditions.join(',') === 'Hidden', 'projects should restore condition visibility');
projectState.restoreProjectWorkspace({ controls: {} });
assert(state.hiddenConditions.length === 0, 'older projects should show all conditions');
state.hiddenConditions = ['Hidden'];

// Actual metric refresh must send identical groups and hidden outliers to both statistics endpoints.
const statisticsRequests = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  assert(JSON.stringify(body.groups) === JSON.stringify(visibleGroups), 'hiding conditions must never filter backend groups');
  if (url === '/api/plot/metrics') return jsonResponse(visibilityMetrics);
  statisticsRequests.push([url, body]);
  if (url === '/api/stats/pairwise') return jsonResponse({ comparisons: [{ condition_a: 'Control', condition_b: 'Hidden', test_used: 'Welch', p_value: 0.1, p_corrected: 0.2, stars: 'ns' }] });
  if (url === '/api/stats/summary') return jsonResponse({ replicates: [], conditions: [], effect_sizes: [] });
  throw new Error(`Unexpected visibility endpoint: ${url}`);
};
state.controls.showSignificance = true;
state.plotStyle = 'bar';
setActiveTab('peak');
await refreshCurrentTab(() => visibleGroups);
assert(statisticsRequests.length === 2 && statisticsRequests.every(([, body]) => body.excluded_file_ids.includes('v-b')), 'hidden-condition outliers must still reach pairwise and summary statistics');
assert(statsContentEl.innerHTML.includes('Control vs Hidden'), 'statistical tables must retain hidden conditions');
const baselineRequests = JSON.stringify(statisticsRequests);
statisticsRequests.length = 0;
state.hiddenConditions = Object.keys(visibleGroups);
await refreshCurrentTab(() => visibleGroups);
assert(JSON.stringify(statisticsRequests) === baselineRequests, 'hiding all conditions must keep statistics requests identical');
// Pane mock for peak is added only for the all-hidden message.
byId['pane-peak'] = makeElement();
await refreshCurrentTab(() => visibleGroups);
assert(byId['pane-peak'].innerHTML.includes('All conditions are hidden'), 'all-hidden plots must explain how to restore conditions');
state.hiddenConditions = [];
await refreshCurrentTab(() => visibleGroups);
assert(globalThis.__plotlyCalls.at(-1)[1].some(trace => trace.legendgroup === 'Hidden'), 'restoring visibility must restore graph content');

// Effect-size tables keep all results while their graph hides selected conditions.
const summaryContentEl = makeElement({ querySelectorAll: () => [] });
byId['summary-panel'] = makeElement();
byId['summary-content'] = summaryContentEl;
byId['summary-effect-plot'] = makeElement();
state.controls.summaryPanelOpen = true;
state.controls.summaryPanelTab = 'effect';
state.controls.summaryReferenceCondition = 'Control';
state.hiddenConditions = ['Control', 'Hidden'];
const effectData = {
  conditions: Object.keys(visibleGroups).map(condition => ({ condition })), replicates: [],
  effect_sizes: [
    { condition: 'Hidden', reference: 'Control', difference: 2, ci_low: 1, ci_high: 3 },
    { condition: 'Drug', reference: 'Control', difference: 4, ci_low: 3, ci_high: 5 },
  ],
};
summaryPanel.renderSummaryPanel(effectData, 'peak');
const effectCall = globalThis.__plotlyCalls.at(-1);
assert(effectCall[1][0].y.join(',') === 'Drug' && effectCall[2].title.text.includes('Control'), 'effect plots must hide condition rows while retaining the reference');
assert(summaryContentEl.innerHTML.includes('<td>Hidden</td>'), 'effect-size table must remain unfiltered');
state.hiddenConditions.push('Drug');
summaryPanel.renderSummaryContent();
assert(byId['summary-effect-plot'].innerHTML.includes('No visible conditions'), 'empty effect-size graphs should have a clear placeholder');
console.log('Condition visibility regression passed: chart styles, statistics invariance, annotations, empty graphs, checklist, and projects.');

// Check trace empty-state recovery and legends when only a hidden condition has a day.
state.hiddenConditions = [];
state.groupByDay = true;
state.files.get('v-a').day = 'Visible day';
state.files.get('v-b').day = 'Hidden day';
state.files.get('v-c').day = 'Visible day';
state.hiddenConditions = ['Hidden'];
const dayVisibilityTraces = Object.fromEntries(Object.entries(visibleGroups).map(([condition, [id]], i) => [condition, {
  time_s: [0, 1, 2], condition_summary: [i + 1, i + 1, i + 1], condition_error: [0, 0, 0], n_files: 1,
  files: [{ file_id: id, file_name: `${condition}.xlsx`, mean: [i + 1, i + 1, i + 1], n_rois: 2 }],
}]));
renderTraceComparison('plot-raw-traces', dayVisibilityTraces, 'Traces', 'Time', 'Signal');
assert(!globalThis.__plotlyCalls.at(-1)[1].some(trace => trace.name === 'Hidden day'), 'day legend must not include days used only by hidden conditions');
state.groupByDay = false;
state.controls.yMin = 0;
state.controls.yMax = 10;
state.controls.rotate = false;
renderMetricChart('plot-peak', 'peak', visibilityMetrics);
assert(globalThis.__plotlyCalls.at(-1)[2].yaxis.range.join(',') === '0,10', 'condition visibility must respect manual axis ranges');
globalThis.fetch = async (url, options) => {
  assert(JSON.stringify(JSON.parse(options.body).groups) === JSON.stringify(visibleGroups), 'trace visibility must retain all backend groups');
  return jsonResponse(url === '/api/plot/metrics' ? visibilityMetrics : dayVisibilityTraces);
};
for (const tab of ['raw', 'delta']) {
  state.hiddenConditions = Object.keys(visibleGroups);
  setActiveTab(tab);
  await refreshCurrentTab(() => visibleGroups);
  assert(byId[`pane-${tab}`].innerHTML.includes('All conditions are hidden'), 'raw/delta tabs must explain all-hidden graphs');
  state.hiddenConditions = [];
  await refreshCurrentTab(() => visibleGroups);
  assert(globalThis.__plotlyCalls.at(-1)[1].some(trace => trace.legendgroup === 'Hidden'), 'restoring conditions must recover trace plots');
}
console.log('Condition visibility recovery passed: trace tabs, day legends, and manual axes.');

// Browsers dispatch input before change. The formatting input handler must not
// replace a condition checkbox before its dedicated change listener can run.
const { bindFormatControlEvents } = await import('./js/format-events.js');
const formattingEvents = makeElement();
let formattingRedraws = 0;
bindFormatControlEvents(formattingEvents, () => { formattingRedraws += 1; });
for (const checked of [false, true]) {
  const checkbox = { dataset: { visibleCondition: 'Drug' }, checked };
  formattingEvents.dispatchEvent('input', { target: checkbox });
  assert(formattingRedraws === 0, 'condition input must not redraw the checkbox before change');
  formattingEvents.dispatchEvent('change', { target: checkbox });
  assert(formattingRedraws === 0, 'condition change must be handled only by its dedicated listener');
}
for (const type of ['input', 'change']) {
  formattingEvents.dispatchEvent(type, { target: { dataset: { control: 'showTraceErrorBand' } } });
}
assert(formattingRedraws === 2, 'regular formatting controls must retain input/change updates');
console.log('Condition checkbox event regression passed: input/change ordering and formatting controls.');

const { plotColor, plotTheme } = await import('./js/theme.js');
const themeKey = 'calcium-multi-analysis-theme-v1';
state.hiddenConditions = [];
state.controls.yMin = null;
state.controls.yMax = null;
state.condColorMap.Control = '#0072b2';
const originalColors = JSON.stringify(state.condColorMap);
localStorage.setItem(themeKey, 'dark');
assert(plotColor('#000000') !== '#000000', 'dark colors must brighten for dark plots');
assert(plotColor('#00ffff') === '#00ffff', 'bright colors must retain their identity');
assert(core.condColor('Control') !== '#0072b2', 'condition colors must adapt for dark backgrounds');
for (const style of ['violin', 'bar', 'box', 'strip', 'raincloud']) {
  state.plotStyle = style;
  renderMetricChart('plot-peak', 'peak', visibilityMetrics);
  const [, traces, layout] = globalThis.__plotlyCalls.at(-1);
  assert(layout.paper_bgcolor === '#161c27' && layout.plot_bgcolor === '#161c27', `${style} must have dark plot backgrounds`);
  assert(layout.font.color === '#dde6f3' && layout.legend.font.color === '#dde6f3', `${style} text and legend must be light`);
  assert(layout.xaxis.gridcolor === '#2a374b' && layout.yaxis.gridcolor === '#2a374b', `${style} grids must adapt`);
  for (const trace of traces) {
    for (const error of [trace.error_x, trace.error_y]) {
      if (error?.color) assert(!error.color.includes('31,41,55'), 'metric error bars must remain visible in dark mode');
    }
  }
}
renderTraceComparison('plot-raw-traces', dayVisibilityTraces, 'Traces', 'Time', 'Signal');
assert(globalThis.__plotlyCalls.at(-1)[2].font.color === plotTheme().text, 'trace labels must follow dark mode');
summaryPanel.renderSummaryPanel(effectData, 'peak');
assert(globalThis.__plotlyCalls.at(-1)[2].plot_bgcolor === '#161c27', 'effect-size plots must follow dark mode');
assert(JSON.stringify(state.condColorMap) === originalColors, 'theme changes must preserve saved colors');
localStorage.setItem(themeKey, 'light');
assert(core.condColor('Control') === '#0072b2', 'light mode must restore original condition colors');
renderMetricChart('plot-peak', 'peak', visibilityMetrics);
assert(globalThis.__plotlyCalls.at(-1)[2].paper_bgcolor === '#ffffff', 'switching to light must restore white plots');
console.log('Plot theme regression passed: metric styles, traces, effects, error bars, and reversible colors.');
