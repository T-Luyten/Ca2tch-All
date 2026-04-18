import { plotTitleToFilename } from './core.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function openPrintWindow() {
    return window.open('', '_blank');
}

function openPrintReadyImage(win, imageUrl, title) {
    if (!win) return false;
    const safeTitle = title || 'Plot';

    win.document.open();
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(safeTitle)}</title><style>
        @page { margin: 12mm; }
        html,body{margin:0;background:#f5f7fb;color:#1f2937;font-family:system-ui,sans-serif}
        body{min-height:100vh;display:flex;flex-direction:column}
        .toolbar{padding:12px 16px;border-bottom:1px solid #d9e2ef;background:#fff}
        .hint{font-size:14px}
        .canvas{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
        img{max-width:100%;max-height:calc(100vh - 88px);display:block;box-shadow:0 8px 32px rgba(15,23,42,0.12)}
    </style></head><body>
      <div class="toolbar"><div class="hint">Use your browser Print dialog in this tab to save as PDF.</div></div>
      <div class="canvas"><img id="print-image" alt="${escapeHtml(safeTitle)}"></div>
    </body></html>`);
    win.document.close();

    const img = win.document.getElementById('print-image');
    if (!img) {
        win.close();
        return false;
    }
    img.onload = () => {
        win.document.title = safeTitle;
        win.focus();
        win.setTimeout(() => {
            try {
                win.print();
            } catch (_) {
                // Ignore print failures and leave the print-ready tab open.
            }
        }, 120);
    };
    img.src = imageUrl;
    return true;
}

export function getPlotlyConfig() {
    const config = {
        responsive: true,
        displaylogo: false,
        toImageButtonOptions: {
            format: 'png',
            filename: 'multi-analysis-plot',
            width: 1800,
            height: 1200,
            scale: 3,
        },
    };

    if (window.Plotly?.Icons?.camera) {
        config.modeBarButtonsToAdd = [
            {
                name: 'Download SVG',
                icon: window.Plotly.Icons.camera,
                click: gd => window.Plotly.downloadImage(gd, {
                    format: 'svg',
                    filename: plotTitleToFilename(gd),
                    width: 1800,
                    height: 1200,
                }),
            },
            {
                name: 'Print / Save PDF',
                icon: window.Plotly.Icons.disk || window.Plotly.Icons.camera,
                click: async gd => {
                    const printWin = openPrintWindow();
                    const pngUrl = await window.Plotly.toImage(gd, {
                        format: 'png',
                        width: 1800,
                        height: 1200,
                        scale: 3,
                    });
                    const opened = openPrintReadyImage(printWin, pngUrl, gd?.layout?.title?.text || 'Plot');
                    if (!opened) {
                        window.Plotly.downloadImage(gd, {
                            format: 'png',
                            filename: plotTitleToFilename(gd),
                            width: 1800,
                            height: 1200,
                            scale: 3,
                        });
                    }
                },
            },
        ];
    }

    return config;
}
