# second-client — Steel Analysis & Design Calculator

Single-page **Steel Analysis & Design Calculator** (structural steel workspace) for coursework: tension, compression, bending, shear, tension rod, steel grades, and section properties. Built as static HTML/CSS/JS under `steelforge/`.

## Source repository

Canonical GitHub project: [github.com/markings199/second-client](https://github.com/markings199/second-client)

```bash
git clone https://github.com/markings199/second-client.git
```

Your machine’s folder name (for example `Civil Engineering Department`) does not need to match the repo name. What ties your copy to GitHub is the Git remote `origin`; this workspace should use:

`https://github.com/markings199/second-client.git`

## Run locally

From this folder:

```bash
cd steelforge
python -m http.server 5500
```

Open [http://127.0.0.1:5500/](http://127.0.0.1:5500/) (or open `steelforge/index.html` in a browser; a local server avoids fetch/CORS issues for CSV assets).

## Layout

| Path | Role |
|------|------|
| `steelforge/index.html` | App shell, nav, loads `pages/*.html` into the panel |
| `steelforge/pages/` | Module fragments (overview, tension, compression, …) |
| `steelforge/css/` | Styles (`style.css` hub + module layout sheets) |
| `steelforge/js/` | Calculators, CSV helpers, `main.js` page loader |

## Context

Civil Engineering Department tooling (Bicol University branding in the UI).
