import { chooseProjectDestination, writeProjectFile } from './project-save.js';
import { apiOpenProject, apiSaveProject } from './api.js';
import { applyWarningVisibility, buildGroups, setActiveTab, syncManualConditionOrder } from './core.js';
import { getDom, refreshDatalist, renderFileList, setStatus, showPlaceholder,
    updateConditionLegend, updateFileCount, updateReplicateLegend, updateUploadJobs, syncControlsToState } from './dom.js';
import { applyControlsToDom, applyPlotStyleToDom, persistPreferences } from './preferences.js';
import { invalidatePendingRefresh, refreshCurrentTab } from './plot-controller.js';
import { captureProjectWorkspace, restoreProjectWorkspace } from './project-state.js';
import { clearSummaryPanel } from './summary-panel.js';
import { state } from './state.js';
import { getTheme, setTheme } from './theme.js';

export function bindProjectControls({ ready, ensureMetricTabs }) {
    const save = document.getElementById('save-project');
    const open = document.getElementById('open-project');
    const input = document.getElementById('project-input');
    let busy = false;
    let projectName = 'Ca2tchAll-project';

    async function run(action, { prepare } = {}) {
        if (busy) return;
        busy = true;
        save.disabled = open.disabled = true;
        const main = document.getElementById('main');
        main.inert = true;
        getDom().byId.fileInput.disabled = true;
        try {
            if ([...state.uploadJobs.values()].some(job => ['queued', 'running'].includes(job.status))) {
                throw new Error('Wait for uploads to finish before saving or opening a project.');
            }
            const prepared = prepare ? await prepare() : undefined;
            await ready;
            if ([...state.uploadJobs.values()].some(job => ['queued', 'running'].includes(job.status))) {
                throw new Error('Wait for uploads to finish before saving or opening a project.');
            }
            await action(prepared);
        } catch (error) {
            setStatus(error.name === 'AbortError' ? 'Save cancelled.' : `Project error: ${error.message}`);
        } finally {
            busy = false;
            save.disabled = open.disabled = false;
            main.inert = false;
            getDom().byId.fileInput.disabled = false;
        }
    }

    save.addEventListener('click', () => run(async destination => {
        setStatus('Saving project with embedded workbooks…');
        state.projectId ||= crypto.randomUUID();
        const assignments = Object.fromEntries([...state.files].map(([id, file]) => [id, {
            condition: file.condition || '', day: file.day || '',
        }]));
        const workspace = captureProjectWorkspace({
            theme: getTheme(), formatPanelOpen: !document.getElementById('format-panel').hidden,
        });
        const blob = await apiSaveProject({ project_id: state.projectId, assignments, workspace });
        const result = await writeProjectFile(destination, blob);
        projectName = destination.name.replace(/\.ca2tchall$/i, '');
        setStatus(result === 'saved'
            ? `Saved ${destination.name}.`
            : `Download started: ${destination.name}. Keep this file to continue later.`);
    }, { prepare: () => {
        if (!state.files.size) throw new Error('Add at least one Excel file before saving a project.');
        return chooseProjectDestination(projectName);
    } }));

    open.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (state.files.size && !window.confirm('Opening this project replaces the current workspace. Save your current project first if you want to keep it. Continue?')) return;
        run(async () => {
            setStatus('Opening project and reading embedded workbooks…');
            invalidatePendingRefresh();
            const project = await apiOpenProject(file);
            restoreProjectWorkspace(project.workspace);
            state.projectId = project.project_id;
            projectName = file.name.replace(/\.ca2tchall$/i, '') || 'Ca2tchAll-project';
            state.files.clear();
            state.uploadJobs.clear();
            for (const source of project.files) {
                state.files.set(source.file_id, {
                    ...source, id: source.file_id, assignment_source: 'project',
                    trace_status: source.has_traces || source.has_delta_f ? '' : source.warnings.length ? 'traces skipped' : '',
                });
                ensureMetricTabs(source.available_metrics);
            }
            state.maxFiles = project.session.max_files;
            state.sessionMemoryLimitBytes = project.session.max_total_session_bytes;
            syncManualConditionOrder();
            applyControlsToDom();
            syncControlsToState();
            applyPlotStyleToDom();
            getDom().byId.condPalette.value = state.condPalette;
            applyWarningVisibility();
            setTheme(project.workspace.theme === 'dark' ? 'dark' : 'light');
            getDom().byId.themeToggle.textContent = getTheme() === 'dark' ? 'Light mode' : 'Dark mode';
            document.getElementById('group-by-day-toggle').checked = state.groupByDay;
            const formattingOpen = project.workspace.formatPanelOpen === true;
            document.getElementById('format-panel').hidden = !formattingOpen;
            document.getElementById('format-toggle').setAttribute('aria-expanded', String(formattingOpen));
            for (const kind of ['stats', 'comparability']) {
                document.getElementById(`${kind}-panel`).style.display = 'none';
                document.getElementById(`${kind}-content`).style.display = 'none';
                document.getElementById(`${kind}-header`).setAttribute('aria-expanded', 'false');
            }
            clearSummaryPanel();
            renderFileList();
            refreshDatalist();
            updateConditionLegend();
            updateReplicateLegend();
            updateFileCount();
            updateUploadJobs();
            setActiveTab(state.currentTab);
            persistPreferences();
            showPlaceholder('Select a metric or trace tab to view the project.');
            await refreshCurrentTab(buildGroups);
            setStatus(`Opened ${file.name}: ${state.files.size} embedded workbook(s).`);
        });
    });
}
