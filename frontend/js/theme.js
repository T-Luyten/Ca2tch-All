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

export function setTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
}

// Plot colors are derived for display; saved condition colors stay unchanged.
export function plotTheme() {
    const dark = getTheme() === 'dark';
    return dark ? {
        background: '#161c27', text: '#dde6f3', muted: '#aebdd0',
        grid: '#2a374b', zero: '#53657d', axis: '#687c96',
        outline: '#dde6f3', significant: '#dde6f3',
    } : {
        background: '#ffffff', text: '#1f2937', muted: '#7a7a9a',
        grid: '#e3ebf5', zero: '#d2ddeb', axis: '#c6d3e3',
        outline: '#0d1b35', significant: '#333333',
    };
}

export function plotColor(color) {
    if (getTheme() !== 'dark' || !/^#[0-9a-f]{6}$/i.test(color || '')) return color;
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    const luminance = rgb => rgb.map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    // Brighten dark colors until they contrast against the plot background.
    let bright = channels;
    for (let mix = 0; luminance(bright) < 0.30 && mix <= 1; mix += 0.05) {
        bright = channels.map(value => Math.round(value + (255 - value) * mix));
    }
    return '#' + bright.map(value => value.toString(16).padStart(2, '0')).join('');
}
