import assert from 'node:assert/strict';
import { chooseProjectDestination, projectFilename, writeProjectFile } from './js/project-save.js';

const events = [];
let pickerOptions;
const blob = new Blob(['project archive']);
const handle = {
    name: 'Experiment.ca2tchall',
    async createWritable() {
        return {
            async write(data) { assert.equal(data, blob); events.push('write'); },
            async close() { events.push('close'); },
            async abort() { events.push('abort'); },
        };
    },
};
globalThis.window = {
    showSaveFilePicker(options) { pickerOptions = options; events.push('picker'); return Promise.resolve(handle); },
    setTimeout() {},
};
const choosing = chooseProjectDestination('Experiment');
assert.deepEqual(events, ['picker'], 'picker must open synchronously while click activation is available');
const destination = await choosing;
assert.equal(pickerOptions.suggestedName, 'Experiment.ca2tchall');
assert.deepEqual(pickerOptions.types[0].accept, { 'application/zip': ['.ca2tchall'] });
assert.equal(await writeProjectFile(destination, blob), 'saved');
assert.deepEqual(events, ['picker', 'write', 'close']);

window.showSaveFilePicker = () => Promise.reject(new DOMException('Cancelled', 'AbortError'));
await assert.rejects(chooseProjectDestination('Experiment'), { name: 'AbortError' });
assert.equal(events.filter(event => event === 'write').length, 1, 'cancellation must not write anything');

let aborted = false;
await assert.rejects(writeProjectFile({ handle: { async createWritable() {
    return { async write() { throw new Error('Disk full'); }, async close() { assert.fail('must not commit'); }, async abort() { aborted = true; } };
} } }, blob), /Disk full/);
assert(aborted, 'failed writes should abort before replacing existing data');

let downloadedName;
let removed = false;
globalThis.document = {
    body: { appendChild() {} },
    createElement() { return { click() { downloadedName = this.download; }, remove() { removed = true; } }; },
};
delete window.showSaveFilePicker;
window.prompt = () => 'New experiment';
const fallback = await chooseProjectDestination('Experiment');
assert.equal(fallback.name, 'New experiment.ca2tchall');
assert.equal(await writeProjectFile(fallback, blob), 'downloaded');
assert.equal(downloadedName, 'New experiment.ca2tchall');
assert(removed);
window.prompt = () => null;
await assert.rejects(chooseProjectDestination('Experiment'), { name: 'AbortError' });
assert.equal(projectFilename(' Trial.CA2TCHALL '), 'Trial.ca2tchall');
assert.throws(() => projectFilename('../trial'), /filename/);
assert.throws(() => projectFilename('   '), /filename/);

// Verify the actual Save button opens the picker before waiting for initialization.
function element(extra = {}) {
    return { style: {}, dataset: {}, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, ...extra };
}
const elements = {
    'save-project': element(), 'open-project': element(), 'project-input': element(),
    'main': element(), 'file-input': element(), 'status-bar': element(),
    'format-panel': element({ hidden: true }),
};
document.getElementById = id => elements[id] || null;
document.querySelectorAll = () => [];
window.confirm = () => true;
globalThis.localStorage = { getItem: () => 'light' };
const { state } = await import('./js/state.js');
const { bindProjectControls } = await import('./js/project.js');
state.files.set('file-1', { condition: 'Control' });
let resolveReady;
let readyFinished = false;
let fetchCalls = 0;
const ready = new Promise(resolve => { resolveReady = () => { readyFinished = true; resolve(); }; });
window.showSaveFilePicker = () => {
    assert(!readyFinished, 'save picker must not wait for asynchronous initialization');
    return Promise.reject(new DOMException('Cancelled', 'AbortError'));
};
globalThis.fetch = async () => { fetchCalls++; assert.fail('cancelled saves must not contact the backend'); };
bindProjectControls({ ready, ensureMetricTabs() {} });
await elements['save-project'].listeners.click();
assert.equal(fetchCalls, 0);
assert.equal(elements['status-bar'].textContent, 'Save cancelled.');
assert.equal(elements['main'].inert, false);
assert.equal(elements['save-project'].disabled, false);
resolveReady();
console.log('Project save tests passed: native destination, click activation, cancellation, write failures, and download fallback.');
