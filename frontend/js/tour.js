const TOUR_KEY = 'ca2tchall-tour-seen';

const STEPS = [
    {
        target: '#files-panel',
        title: 'Welcome to Ca²⁺tchAll · 1 / 5',
        body: 'Start here. Drag <strong>.xlsx</strong> files exported from your Calcium Imaging Analyzer into this panel, or click <strong>Add Files</strong> in the header.<br><br>Type a <strong>condition name</strong> next to each file to group replicates (e.g. "Control", "Treated").',
        position: 'right',
    },
    {
        target: '#plot-tabs',
        title: 'Metric Tabs · 2 / 5',
        body: 'Once conditions are assigned, interactive plots appear automatically. Each calcium metric — Peak, AUC, FWHM, Event Frequency, and more — gets its own tab.',
        position: 'bottom',
    },
    {
        target: '#controls-panel',
        title: 'Plot Controls · 3 / 5',
        body: 'Fine-tune the visualisation: choose <strong>summary statistics</strong> (mean / median), error bars, condition order, point size, and jitter. All plots update in real time.',
        position: 'bottom',
    },
    {
        target: '#format-panel',
        title: 'Appearance · 4 / 5',
        body: 'Customise condition colours, chart labels, font sizes, and axis ranges. The Plotly toolbar on each plot lets you zoom, pan, and download as PNG.',
        position: 'left',
    },
    {
        target: '#theme-toggle',
        title: "You're all set! · 5 / 5",
        body: 'Toggle dark / light mode here. Your preferences — colours, chart style, controls — are saved in the browser and persist across page refreshes and server restarts.<br><br>Click <strong>?</strong> any time to replay this tour.',
        position: 'bottom',
    },
];

let currentStep = -1;
let svgOverlay = null;
let tooltipEl = null;

function hasTourBeenSeen() {
    try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; }
}

function markTourSeen() {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* ignore */ }
}

function injectStyles() {
    if (document.getElementById('tour-styles')) return;
    const s = document.createElement('style');
    s.id = 'tour-styles';
    s.textContent = `
        #tour-overlay {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            z-index: 9997;
            pointer-events: none;
            overflow: visible;
        }
        #tour-tooltip {
            position: fixed;
            z-index: 9999;
            background: var(--panel);
            color: var(--text);
            border: 1px solid var(--panel-border);
            border-radius: 10px;
            padding: 18px 20px;
            width: 300px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.35);
            font-size: 13px;
            line-height: 1.6;
            pointer-events: all;
        }
        #tour-tooltip h3 {
            margin: 0 0 10px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.07em;
            color: var(--muted);
        }
        #tour-tooltip p { margin: 0 0 16px; }
        #tour-nav {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #tour-dots {
            display: flex;
            gap: 5px;
            flex: 1;
        }
        .tour-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--panel-border);
            transition: background 0.2s;
        }
        .tour-dot.active { background: var(--accent); }
        .tour-nav-btn {
            padding: 5px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        }
        #tour-next {
            background: var(--accent);
            color: #fff;
            border: none;
        }
        #tour-prev {
            background: var(--btn-bg);
            color: var(--text);
            border: 1px solid var(--panel-border);
        }
        #tour-prev:disabled { opacity: 0.35; cursor: default; }
        #tour-skip {
            background: transparent;
            border: none;
            color: var(--muted);
            cursor: pointer;
            font-size: 12px;
            padding: 4px 6px;
            margin-left: auto;
        }
        #tour-btn {
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 9996;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            border: 1px solid var(--panel-border);
            background: var(--panel);
            color: var(--text);
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            opacity: 0.65;
            transition: opacity 0.15s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #tour-btn:hover { opacity: 1; }
    `;
    document.head.appendChild(s);
}

function buildSvgOverlay() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'tour-overlay';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    document.body.appendChild(svg);
    return svg;
}

function updateSvgOverlay(targetRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 6;
    const x = Math.max(0, targetRect.left - pad);
    const y = Math.max(0, targetRect.top - pad);
    const w = Math.min(vw - x, targetRect.width + pad * 2);
    const h = Math.min(vh - y, targetRect.height + pad * 2);
    const rx = 8;
    const accentColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim() || '#4c8cff';

    svgOverlay.innerHTML = `
        <defs>
            <mask id="tour-cutout">
                <rect width="${vw}" height="${vh}" fill="white"/>
                <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="black"/>
            </mask>
        </defs>
        <rect width="${vw}" height="${vh}" fill="rgba(0,0,0,0.55)" mask="url(#tour-cutout)"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"
              fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.85"/>
    `;
}

function buildTooltip() {
    const el = document.createElement('div');
    el.id = 'tour-tooltip';
    el.innerHTML = `
        <h3></h3>
        <p></p>
        <div id="tour-nav">
            <div id="tour-dots"></div>
            <button class="tour-nav-btn" id="tour-prev">← Back</button>
            <button class="tour-nav-btn" id="tour-next">Next →</button>
            <button id="tour-skip">Skip</button>
        </div>
    `;
    document.body.appendChild(el);
    el.querySelector('#tour-prev').addEventListener('click', () => showStep(currentStep - 1));
    el.querySelector('#tour-next').addEventListener('click', () => {
        if (currentStep < STEPS.length - 1) showStep(currentStep + 1);
        else endTour();
    });
    el.querySelector('#tour-skip').addEventListener('click', () => endTour());
    return el;
}

function positionTooltip(targetRect, position) {
    const margin = 18;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const tW = tooltipEl.offsetWidth;
    const tH = tooltipEl.offsetHeight;

    let top, left;
    switch (position) {
        case 'right':
            top = targetRect.top + (targetRect.height - tH) / 2;
            left = targetRect.right + margin;
            break;
        case 'left':
            top = targetRect.top + (targetRect.height - tH) / 2;
            left = targetRect.left - tW - margin;
            break;
        case 'bottom':
            top = targetRect.bottom + margin;
            left = targetRect.left + (targetRect.width - tW) / 2;
            break;
        default: // top
            top = targetRect.top - tH - margin;
            left = targetRect.left + (targetRect.width - tW) / 2;
    }

    tooltipEl.style.top = `${Math.max(8, Math.min(top, vpH - tH - 8))}px`;
    tooltipEl.style.left = `${Math.max(8, Math.min(left, vpW - tW - 8))}px`;
}

export function showStep(n) {
    if (n < 0 || n >= STEPS.length) return;
    currentStep = n;
    const step = STEPS[n];
    const target = document.querySelector(step.target);

    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    tooltipEl.querySelector('h3').textContent = step.title;
    tooltipEl.querySelector('p').innerHTML = step.body;
    tooltipEl.querySelector('#tour-dots').innerHTML = STEPS
        .map((_, i) => `<span class="tour-dot${i === n ? ' active' : ''}"></span>`)
        .join('');

    const prevBtn = tooltipEl.querySelector('#tour-prev');
    const nextBtn = tooltipEl.querySelector('#tour-next');
    prevBtn.disabled = n === 0;
    nextBtn.textContent = n === STEPS.length - 1 ? 'Finish ✓' : 'Next →';

    requestAnimationFrame(() => {
        if (!target) {
            tooltipEl.style.top = '50%';
            tooltipEl.style.left = '50%';
            tooltipEl.style.transform = 'translate(-50%,-50%)';
            svgOverlay.innerHTML = `<rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/>`;
            return;
        }
        tooltipEl.style.transform = '';
        const rect = target.getBoundingClientRect();
        updateSvgOverlay(rect);
        positionTooltip(rect, step.position);
    });
}

export function endTour() {
    svgOverlay?.remove();
    tooltipEl?.remove();
    svgOverlay = null;
    tooltipEl = null;
    currentStep = -1;
    markTourSeen();
}

export function startTour() {
    injectStyles();
    endTour();
    svgOverlay = buildSvgOverlay();
    tooltipEl = buildTooltip();
    showStep(0);
}

export function maybeStartTour() {
    if (!hasTourBeenSeen()) {
        // Delay past the 2 s splash screen fade-out
        setTimeout(startTour, 2800);
    }
}

document.addEventListener('keydown', e => {
    if (currentStep < 0) return;
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight') {
        if (currentStep < STEPS.length - 1) showStep(currentStep + 1);
        else endTour();
    } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        showStep(currentStep - 1);
    }
});

// Always inject styles and wire the help button, even when the tour is skipped
injectStyles();
document.getElementById('tour-btn')?.addEventListener('click', startTour);
