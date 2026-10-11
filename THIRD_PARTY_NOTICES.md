# Third-party software notices

Ca2tchAll's original application code is licensed under the MIT License in
[LICENSE](LICENSE), copyright © 2026 Tomas Luyten. Dependencies retain their
own copyright notices and licenses; the project MIT license does not replace
those terms. This inventory was reviewed on 11 October 2026.

## Code included in this repository

The full **Plotly.js 2.27.0** browser distribution is included in
`frontend/vendor/` and `bundle/frontend/vendor/`. Plotly's own code is MIT
licensed, copyright Plotly, Inc. Keep both of these files with the JavaScript:

- [LICENSE-plotly.txt](frontend/vendor/LICENSE-plotly.txt): the upstream Plotly MIT license.
- [plotly.min.js.LICENSE.txt](frontend/vendor/plotly.min.js.LICENSE.txt): retained upstream dependency notices and supplemental license texts, including the BSD notices for Mapbox GL JS 1.10.1, d3-color, and ieee754, and MIT notices for embedded utilities.

The companion file was assembled from the [upstream unminified 2.27.0 distribution](https://github.com/plotly/plotly.js/blob/v2.27.0/dist/plotly.js)
and the linked upstream license files. It is not an upstream-generated notice
file or a complete package-by-package dependency inventory. Its filename matches
the reference retained in the minified JavaScript header. Do not remove the
library header. Regenerate and review these notices when replacing Plotly.

Upstream reference: [Plotly.js 2.27.0 license](https://github.com/plotly/plotly.js/blob/v2.27.0/LICENSE).

## Python dependencies installed during setup

The source repository does not include Python, a virtual environment, or Python
dependency binaries. The launch/setup scripts install the packages from
`backend/requirements.txt` (or its identical bundle copy). Installed wheels
carry their own license files and notices.

| Direct dependency | Requirement | Main license |
| --- | --- | --- |
| FastAPI | `0.136.0` | MIT |
| Uvicorn, standard extras | `0.44.0` | BSD-3-Clause; extras have their own licenses |
| python-multipart | `0.0.26` | Apache-2.0 |
| pandas | `3.0.2` | BSD-3-Clause; includes additional third-party notices |
| openpyxl | `3.1.5` | MIT |
| NumPy | `2.4.4` | BSD-3-Clause; includes additional third-party notices |
| SciPy | `>=1.15.3` | BSD-3-Clause; wheel contents have additional licenses |
| statsmodels | `>=0.14.5` | BSD-3-Clause |

License information was checked against the installed packages' metadata and
license files. The inspected environment resolves SciPy to 1.18.1 and statsmodels
to 0.14.6; these are observations, not additional version pins.

The runtime dependency chain also includes:

| Components observed in the inspected environment | Main license |
| --- | --- |
| AnyIO, annotated-types, annotated-doc, Pydantic, pydantic-core, typing-inspection, h11, PyYAML, watchfiles, httptools, et_xmlfile, six | MIT |
| Starlette, Click, idna, websockets, python-dotenv | BSD-3-Clause |
| Patsy | BSD-2-Clause |
| python-dateutil | Apache-2.0 / BSD-3-Clause; retain the package's dual-license notice |
| packaging | Apache-2.0 OR BSD-2-Clause |
| typing_extensions | PSF-2.0 |
| uvloop (non-Windows installations) | MIT / Apache-2.0; retain both provided license files |

This is a platform-dependent snapshot. Windows setup can also install Colorama
and tzdata, and optional tools such as `httpx` (tests) or `xlrd` (legacy `.xls`
reading) have their own dependencies and licenses. The exact installed package
files, rather than this summary table, determine the notices for a built release.

## Redistributing an installed or packaged application

- Include the project `LICENSE`, this notice document, and both Plotly notice files. `sync_bundle.sh` copies these into the portable bundle.
- If shipping an installed Python environment, keep every dependency's license, copyright, NOTICE, and attribution files, including files under `.dist-info` and licenses for embedded native libraries. A list of package names alone does not satisfy those notice requirements.
- NumPy/SciPy wheels may bundle BLAS/LAPACK and compiler runtime libraries under additional BSD, MIT, or GPL/LGPL licenses with applicable exceptions. Preserve the exact wheel's full notices and satisfy any source/relinking obligations for the artifacts actually redistributed; the project MIT license does not cover those libraries.
- The Windows setup script downloads CPython 3.12.9. If redistributing that installed runtime, preserve its license and third-party notices. See [Python 3.12 license and acknowledgements](https://docs.python.org/3.12/license.html).
- Apache-licensed components require their license and any applicable upstream NOTICE files to be retained; mark modifications if their code is changed.
- Review the resolved dependencies again for each platform and whenever versions change. The lower bounds on SciPy/statsmodels and unpinned transitive dependencies mean that later installs may differ from this inventory.

## Other project assets

The review found no separate third-party license header in the application's
Python/JavaScript source or local artwork. Palette names identify their sources
(Okabe–Ito, Tol, ColorBrewer, and NPG); they are not project ownership claims.
Absence of a header does not establish the provenance of artwork, example data,
or previously copied code. Any externally supplied asset must retain its own
required attribution and permission terms.
