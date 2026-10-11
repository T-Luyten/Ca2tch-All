"""Verify release assets can be served without any external script downloads."""
import asyncio
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import tempfile

import httpx
import main

ROOT = Path(__file__).resolve().parent.parent


class ScriptSources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            src = dict(attrs).get('src')
            if src:
                self.sources.append(src)


async def check_assets():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://local-app') as client:
        response = await client.get('/')
        assert response.status_code == 200
        assert "script-src 'self';" in response.headers['content-security-policy']
        assert 'cdn.plot.ly' not in response.headers['content-security-policy']
        scripts = ScriptSources()
        scripts.feed(response.text)
        assert 'vendor/plotly-2.27.0.min.js' in scripts.sources
        for source in scripts.sources:
            assert not source.startswith(('http:', 'https:', '//'))
            asset = await client.get('/' + source)
            assert asset.status_code == 200, source
            assert 'javascript' in asset.headers['content-type'], source
            if 'plotly-' in source:
                expected = (ROOT / 'frontend' / source).read_bytes()
                assert asset.content == expected
                assert b'plotly.js v2.27.0' in expected[:200]
        for name in ['plotly-2.27.0.min.js', 'LICENSE-plotly.txt']:
            assert (ROOT / 'frontend/vendor' / name).read_bytes() == (ROOT / 'bundle/frontend/vendor' / name).read_bytes()
    # Missing vendored assets must fail before a release is changed.
    for missing in ['plotly-2.27.0.min.js', 'LICENSE-plotly.txt']:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shutil.copy(ROOT / 'sync_bundle.sh', root / 'sync_bundle.sh')
            vendor = root / 'frontend/vendor'
            vendor.mkdir(parents=True)
            for name in ['plotly-2.27.0.min.js', 'LICENSE-plotly.txt']:
                if name != missing:
                    (vendor / name).write_text('test fixture')
            result = subprocess.run(['bash', str(root / 'sync_bundle.sh')], capture_output=True, text=True)
            assert result.returncode != 0
            assert f'Missing bundled Plotly asset: frontend/vendor/{missing}' in result.stderr
            assert not (root / 'bundle').exists()
    print('Bundled asset tests passed: local script serving, CSP, identical release files, and missing-asset guards.')


if __name__ == '__main__':
    asyncio.run(check_assets())
