const STORAGE_KEY = 'calcium-multi-analysis-theme-v1';

export function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'light';
}

export function initTheme() {
    document.documentElement.setAttribute('data-theme', getTheme());
}

export function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.setAttribute('data-theme', next);
    return next;
}
