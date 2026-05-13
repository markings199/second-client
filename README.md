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

From this folder (workspace root, where `start.ps1` lives), run:

```powershell
.\start.ps1
```

This always serves the app from `steelforge\` on port 5500 and opens your browser to `http://127.0.0.1:5500/`.

Manual equivalent (if you prefer):

```powershell
cd steelforge
python -m http.server 5500
```

Then open one of:

- App: <http://127.0.0.1:5500/>
- Compression: <http://127.0.0.1:5500/#compression>
- Tension: <http://127.0.0.1:5500/#tension>
- Bending: <http://127.0.0.1:5500/#bending>
- Shear: <http://127.0.0.1:5500/#shear>

If you see a directory listing with an unrelated folder name (e.g. `born2be-steel-header`), it means an HTTP server on port 5500 is being run from a different folder by another VS Code/Cursor window or another tool. Stop that server first, then run `.\start.ps1` from this workspace.

Opening `steelforge/index.html` directly with `file://` will not work reliably — the calculators load CSV assets and require a local HTTP server.

## Layout

| Path | Role |
|------|------|
| `steelforge/index.html` | App shell, nav, loads `pages/*.html` into the panel |
| `steelforge/pages/` | Module fragments (overview, tension, compression, …) |
| `steelforge/css/` | Styles (`style.css` hub + module layout sheets) |
| `steelforge/js/` | Calculators, CSV helpers, `main.js` page loader |

## Context

Civil Engineering Department tooling (Bicol University branding in the UI).
