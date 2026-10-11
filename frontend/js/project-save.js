const EXTENSION = '.ca2tchall';

export function projectFilename(name) {
    const trimmed = String(name).trim();
    const base = trimmed.replace(/\.ca2tchall$/i, '');
    if (!base || /[\\/<>:"|?*\x00-\x1f]/.test(base)) {
        throw new Error('Enter a project filename without folder paths or special characters.');
    }
    return `${base}${EXTENSION}`;
}

// Call directly from the click handler, before network requests or other awaits.
export async function chooseProjectDestination(suggestedName) {
    const name = projectFilename(suggestedName);
    if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
            id: 'ca2tchall-project',
            suggestedName: name,
            types: [{ description: 'Ca2tchAll project', accept: { 'application/zip': [EXTENSION] } }],
            excludeAcceptAllOption: true,
        });
        return { name: handle.name, handle };
    }
    const entered = window.prompt(
        'Project filename:\n\nYour browser controls the save folder. Enable “Ask where to save each file” in its download settings to choose a location.',
        name,
    );
    if (entered === null) throw new DOMException('Save cancelled.', 'AbortError');
    return { name: projectFilename(entered), handle: null };
}

export async function writeProjectFile(destination, blob) {
    if (destination.handle) {
        const stream = await destination.handle.createWritable();
        try {
            await stream.write(blob);
            await stream.close();
        } catch (error) {
            // Uncommitted changes should not replace an existing project after a failed write.
            try { await stream.abort(); } catch { /* The stream may already be closed. */ }
            throw error;
        }
        return 'saved';
    }
    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = destination.name;
        document.body.appendChild(link);
        try { link.click(); } finally { link.remove(); }
    } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return 'downloaded';
}
