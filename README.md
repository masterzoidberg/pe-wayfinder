# PE Wayfinder

PE Wayfinder is a local-first practice tool for PE Mechanical: Machine Design and Materials candidates. It trains recognition of an engineering cue, prediction of handbook terminology, navigation to a relevant reference, and diagnosis of retrieval difficulty.

## Run locally

Open `index.html` in a current browser with JavaScript enabled. There is no build step, backend, account, or runtime network dependency. A separate local server also works:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/` and open your own legally obtained copy of the NCEES PE Mechanical Reference Handbook 2.0 in a separate window. Wayfinder does not include the handbook.

## Training and saved progress

Each drill asks the learner to identify a concept, predict a search phrase, look in the handbook, report the result, and diagnose the bottleneck. Reference Map provides a direct entry point for each released drill.

Attempts and settings are saved in browser `localStorage`. They remain in that browser and origin. They do not synchronize across devices. Use the app's backup controls to move progress manually.

## GitHub Pages

The app uses relative asset paths and works under a project subpath such as `/pe-wayfinder/`. Build the five-file deployment package and test it with:

```powershell
python scripts/build-pages.py --output _site
python -m pip install -r requirements-test.txt
python -m playwright install chromium
python tests/pages-deployment-check.py --site _site
```

The manual-only workflow in `.github/workflows/pages.yml` runs the clean-checkout regressions and subpath browser test before deployment. See [deployment setup](docs/github-pages-deployment.md). Publishing is a separate manual action.

## Pilot status and scope

The current classification is **READY FOR LOCAL PILOT**. Corpus and application checks do not establish PDF viewer reliability, learning effectiveness, or unrestricted public-release readiness. Learners use their own Handbook 2.0. Progress stays in their browser.

The runtime corpus contains 189 reviewed drills across 106 concept families. It practices selected retrieval routes and knowledge boundaries. It is not a comprehensive PE course, question bank, engineering solver, or handbook replacement.

## Source layout

- `index.html`, `styles.css`, `app.js`, and `core.js` make up the browser application.
- `data/training-items.js` contains the authoritative released runtime corpus. `.gitattributes` preserves its verified bytes across platforms.
- `scripts/build-pages.py` creates an allowlisted static site and verifies the final-r3 runtime hash.
- `tests/` contains the core, shortcut, and hosted-path checks used by the Pages workflow.

The build includes only the application shell, styles, scripts, and runtime corpus. Research files, archives, local handbook files, demo content and tests are excluded from the hosted artifact.
