"""Round-trip the actual project API with no external source files."""
import asyncio
import hashlib
import io
import json
import uuid
import zipfile

import httpx
from fastapi import HTTPException, UploadFile
import main as app_main
from smoke_test import build_workbook_bytes
from main import (ProjectSaveRequest, PlotMetricsRequest, PlotTracesRequest, SummaryStatsRequest,
                  save_project, open_project, plot_metrics, plot_traces, stats_summary)
from project_archive import read_archive


def edited_archive(content, edit_manifest=None, change_workbook=False):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(content)) as original, zipfile.ZipFile(output, 'w') as changed:
        for name in original.namelist():
            data = original.read(name)
            if name == 'manifest.json' and edit_manifest:
                manifest = json.loads(data)
                edit_manifest(manifest)
                data = json.dumps(manifest).encode()
            elif name.startswith('sources/') and change_workbook:
                data = bytes([data[0] ^ 1]) + data[1:]
            changed.writestr(name, data)
    return output.getvalue()


async def main():
    app_main.sessions.clear()
    app_main.upload_jobs.clear()
    originals = []
    assignments = {}
    for offset, condition in [(0, 'Control'), (2, 'Drug')]:
        # Identical filenames must remain distinct sources, including after save/open.
        content = build_workbook_bytes(condition, offset)
        parsed = app_main._parse_uploaded_workbook('same-name.xlsx', content)
        session = parsed['session_data']
        fid = session['provenance']['source_id']
        session['memory_bytes'] = parsed['estimated_memory_bytes']
        app_main.sessions[fid] = session
        assignments[fid] = {'condition': condition, 'day': 'Day 1'}
        originals.append((fid, content, dict(session['provenance'])))
    workspace = {
        'controls': {'summaryStat': 'median', 'showWarnings': False, 'poolByDay': True},
        'currentTab': 'peak', 'plotStyle': 'box', 'condPalette': 'okabe-ito',
        'condColorMap': {'Drug': '#123456'}, 'dayColorMap': {},
        'manualConditionOrder': ['Drug', 'Control'], 'labelOverrides': {'peak': {'title': 'My experiment'}},
        'hiddenConditions': ['Drug'],
        'groupByDay': True, 'theme': 'dark', 'formatPanelOpen': False,
    }
    project_id = str(uuid.uuid4())
    request = ProjectSaveRequest(project_id=project_id, assignments=assignments, workspace=workspace)
    groups = {assignment['condition']: [fid] for fid, assignment in assignments.items()}
    before_metrics = await plot_metrics(PlotMetricsRequest(groups=groups))
    before_traces = await plot_traces(PlotTracesRequest(groups=groups, trace_type='raw'))
    before_stats = await stats_summary(SummaryStatsRequest(metric='peak', groups=groups, summary_stat='median'))
    archive = (await save_project(request)).body
    manifest, workbooks = read_archive(archive, app_main.MAX_FILES, app_main.MAX_TOTAL_SESSION_BYTES)
    assert manifest['workspace'] == workspace
    assert [content for _, content in workbooks] == [content for _, content, _ in originals]
    assert [source['source_id'] for source, _ in workbooks] == list(assignments)
    # The source workbooks never exist on disk, and the in-memory session is discarded.
    app_main.sessions.clear()
    restored = await open_project(UploadFile(filename='test.ca2tchall', file=io.BytesIO(archive)))
    assert restored['project_id'] == project_id and restored['workspace'] == workspace
    assert len(restored['files']) == 2
    for fid, content, provenance in originals:
        assert app_main.sessions[fid]['source_workbook'] == content
        assert app_main.sessions[fid]['provenance'] == provenance
        assert provenance['sha256'] == hashlib.sha256(content).hexdigest()
    assert await plot_metrics(PlotMetricsRequest(groups=groups)) == before_metrics
    assert await plot_traces(PlotTracesRequest(groups=groups, trace_type='raw')) == before_traces
    assert await stats_summary(SummaryStatsRequest(metric='peak', groups=groups, summary_stat='median')) == before_stats
    resaved = (await save_project(request)).body
    resaved_manifest, _ = read_archive(resaved, app_main.MAX_FILES, app_main.MAX_TOTAL_SESSION_BYTES)
    assert resaved_manifest['sources'] == manifest['sources']
    kept = dict(app_main.sessions)
    # A correctly fingerprinted workbook still has to pass Excel validation.
    invalid_workbook_archive = io.BytesIO()
    damaged_manifest = json.loads(json.dumps(manifest))
    invalid_workbook = b"not an Excel workbook"
    damaged_manifest['sources'][0]['size_bytes'] = len(invalid_workbook)
    damaged_manifest['sources'][0]['sha256'] = hashlib.sha256(invalid_workbook).hexdigest()
    with zipfile.ZipFile(invalid_workbook_archive, 'w') as archive_writer:
        archive_writer.writestr('manifest.json', json.dumps(damaged_manifest))
        for index, (source, content) in enumerate(workbooks):
            archive_writer.writestr(source['archive_path'], invalid_workbook if index == 0 else content)
    invalid_projects = [
        invalid_workbook_archive.getvalue(),
        edited_archive(archive, lambda m: m['workspace'].update(bad_number=float('nan'))),
        b'not a project',
        edited_archive(archive, change_workbook=True),
        edited_archive(archive, lambda m: m.update(version=999)),
        edited_archive(archive, lambda m: m.pop('saved_at')),
        edited_archive(archive, lambda m: m['sources'][0].update(archive_path='../source.xlsx')),
        edited_archive(archive, lambda m: m['workspace'].update(manualConditionOrder='invalid')),
    ]
    for invalid in invalid_projects:
        try:
            await open_project(UploadFile(filename='broken.ca2tchall', file=io.BytesIO(invalid)))
            raise AssertionError('Invalid archive was accepted')
        except HTTPException as exc:
            assert exc.status_code == 400
        assert app_main.sessions == kept and not app_main.project_busy
    previous_cap = app_main.MAX_TOTAL_SESSION_BYTES
    app_main.MAX_TOTAL_SESSION_BYTES = 1
    try:
        try:
            await open_project(UploadFile(filename='oversize.ca2tchall', file=io.BytesIO(archive)))
            raise AssertionError('Memory limit was ignored')
        except HTTPException:
            assert app_main.sessions == kept
    finally:
        app_main.MAX_TOTAL_SESSION_BYTES = previous_cap
    app_main.upload_jobs['pending'] = {'status': 'running'}
    try:
        await save_project(request)
        raise AssertionError('Save during an active upload was accepted')
    except HTTPException as exc:
        assert exc.status_code == 409
    app_main.upload_jobs.clear()
    # Also exercise the real HTTP multipart and download routes.
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_main.app), base_url='http://test') as client:
        response = await client.post('/api/project/save', json=request.model_dump())
        assert response.status_code == 200 and response.headers['content-type'] == 'application/zip'
        response = await client.post('/api/project/open', files={'file': ('test.ca2tchall', response.content, 'application/zip')})
        assert response.status_code == 200 and response.json()['workspace'] == workspace
    app_main.sessions.clear()
    print('Project regression passed: embedded workbooks, settings, provenance, duplicate names, analysis round-trip, corruption, limits, and HTTP routes.')


if __name__ == '__main__':
    asyncio.run(main())
