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
const sessionMemory = makeElement({ dataset: {} });
const sessionMemoryLabel = makeElement();
const sessionMemoryFill = makeElement({ style: { width: '' } });
const sessionMemoryText = makeElement();
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
  'session-memory': sessionMemory,
  'session-memory-label': sessionMemoryLabel,
  'session-memory-fill': sessionMemoryFill,
  'session-memory-text': sessionMemoryText,
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
globalThis.__plotlyCalls = [];
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  defaultPlotLabels,
  enrichTraceData,
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
const { state } = stateModule;
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
  sessionMemoryLabel.textContent = '';
  sessionMemoryText.textContent = '';
  sessionMemoryFill.style.width = '';
  sessionMemory.dataset = {};
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
assert(sessionMemoryLabel.textContent.includes('75%'), 'session memory label should include percent usage');
assert(sessionMemoryText.textContent.includes('1.5 MB / 2.0 MB'), 'session memory text should include usage and limit');
assert(sessionMemory.dataset.level === 'warning', 'session memory should warn at 70% usage');
assert(sessionMemoryFill.style.width === '75%', 'session memory meter should reflect usage');
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
    files: [
      { file_name: 'trace-ok.xlsx', mean: [1, NaN, 2], n_rois: 3 },
    ],
  },
});
assert(enrichedTraces.Vehicle.time_s.length === 3, 'trace enrichment should preserve time axis length');
assert(enrichedTraces.Vehicle.files[0].mean.length === 3, 'trace enrichment should preserve mean length (NaNs become gaps)');

globalThis.fetch = async (url, options = {}) => {
  if (url === '/api/plot/metrics') {
    return {
      ok: true,
      async json() {
        return {
          Vehicle: {
            peak: {
              files: [
                { file_id: 'trace-ok', file_name: 'trace-ok.xlsx', values: [1, 2], mean: 1.5 },
                { file_id: 'metrics-only', file_name: 'metrics-only.xlsx', values: [2, 3], mean: 2.5 },
              ],
              condition_mean: 2,
              condition_sem: 0.5,
              n_files: 2,
            },
          },
        };
      },
    };
  }
  if (url === '/api/plot/traces') {
    return {
      ok: true,
      async json() {
        return {
          Vehicle: {
            time_s: [0, 1],
            files: [
              { file_name: 'trace-ok.xlsx', mean: [1, 2], n_rois: 3 },
            ],
            condition_mean: [1, 2],
            condition_sem: [0, 0],
            n_files: 1,
          },
        };
      },
    };
  }
  throw new Error(`Unexpected fetch: ${url} ${options.method || 'GET'}`);
};

setActiveTab('raw');
await refreshCurrentTab(() => ({ Vehicle: ['trace-ok', 'metrics-only'] }));
assert(traceExclusionNote.style.display !== 'none', 'trace exclusion note should show for mixed trace support');
assert(traceExclusionNote.textContent.includes('metrics-only.xlsx'), 'trace exclusion note should name excluded file');
assert(traceExclusionNote.textContent.includes('Raw_Traces skipped because the trace sheet is too large'), 'trace exclusion note should include exact warning reason');
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
    return { ok: true, async json() { return { Vehicle: { peak: { files: [], condition_mean: 0, condition_sem: 0, n_files: 0 } } }; } };
  }
  if (url === '/api/plot/traces') {
    // Traces for the second refresh return immediately; the first refresh should never reach this.
    return { ok: true, async json() { return { Vehicle: { time_s: [0], files: [{ file_name: 'x', mean: [1], n_rois: 1 }], condition_mean: [1], condition_sem: [0], n_files: 1 } }; } };
  }
  throw new Error(`Unexpected fetch: ${url} ${options.method || 'GET'}`);
};
const slow = refreshCurrentTab(() => ({ Vehicle: ['trace-ok'] }));
await sleep(5);
const fast = refreshCurrentTab(() => ({ Vehicle: ['trace-ok'] }));
await Promise.all([slow, fast]);
assert(globalThis.__plotlyCalls.length === 1, `only the latest refresh should render (got ${globalThis.__plotlyCalls.length})`);

updateTraceExclusionNotice('');
assert(traceExclusionNote.style.display === 'none', 'trace exclusion note should hide when cleared');

console.log('Frontend smoke test passed: ordering, upload job UI, and trace exclusion rendering.');
