# GitHub Pages deployment

PE Wayfinder is a browser-native static application. It needs no build framework, server process, database, authentication or runtime network service. GitHub Pages can serve it directly.

## Production files

Run from the repository root:

```powershell
python -m pip install -r requirements-test.txt
python -m playwright install chromium
python scripts/build-pages.py --output _site
python tests/pages-deployment-check.py --site _site
```

The builder copies exactly five files: `index.html`, `styles.css`, `core.js`, `app.js` and `data/training-items.js`. It verifies that the runtime corpus SHA-256 is `5075bc789ae4ac6854f85ddf1b80cf33aef583f0d0fb57892ee29c2fb056020d`, the final-r3 runtime hash. `.gitattributes` preserves the corpus bytes across Windows and Linux checkouts. The builder stops if the generated output already contains another file. It does not copy PDFs, audits, research archives, source maps, development tests or the demo page.

The app references its scripts and styles with relative paths. Its navigation stays inside one page, and there are no server routes or root-relative asset URLs. Those paths resolve at a GitHub Pages project URL such as `https://OWNER.github.io/pe-wayfinder/`. The production check serves the built files at `/pe-wayfinder/` and tests direct load, refresh, the 189-item corpus, completion, browser-local storage, the Reference Map, keyboard use and a 390-pixel mobile layout.

## Repository setup

1. Keep the repository's existing visibility and access settings. Confirm who can reach its Pages site under the plan and organization settings.
2. In **Settings → Pages**, choose **GitHub Actions** as the deployment source.
3. Commit and push the workflow and source files to the repository's normal default branch.
4. Open **Actions → Validate GitHub Pages build → Run workflow** and select the default branch. The workflow is manual-only. Its publish job runs only after the checks pass.
5. Open the deployment environment or repository Pages settings to get the site URL. Test that URL in a private browser window and on a mobile-sized screen before inviting pilot learners.

The Pages site has not been published. Keep repository visibility unchanged during setup.

## Validation before deployment

The workflow runs:

- `node tests/core-tests.js`
- `node tests/keyboard-shortcut-tests.js`
- `python scripts/build-pages.py --output _site`
- `python tests/pages-deployment-check.py --site _site`

CI installs the browser-test dependency from `requirements-test.txt` and installs Chromium with Playwright.

The production artifact is created from the allowlist. The test checkout may contain development and audit materials, but those files are never included in the Pages artifact. The official handbook is excluded by `.gitignore` and the builder does not include it. Learners open their own legally obtained Handbook 2.0 in a separate window.

## Local verification results

Verified on 2026-11-18 against the local final-r3 runtime:

- Core, keyboard-shortcut and corpus-release Node suites passed in the development workspace.
- The five-file Pages build passed with the expected final-r3 runtime hash.
- The hosted-path Playwright check passed at `/pe-wayfinder/`. It checked relative asset loads, direct access to both the directory and `index.html`, refresh, saved attempt history, keyboard access to the skip link and Reference Map, exact drill launch, completion, return navigation, and layouts at 320, 390 and 768 pixels.
- Both existing application browser suites passed. The Reference Map suite checked all 189 item routes and buttons at four viewport widths.

The workflow runs the core, shortcut and allowlisted production checks from a clean checkout. The broader development suites above depend on demo or audit materials omitted from the initial GitHub file set. The GitHub Actions workflow has not been dispatched, and the site has not been published.

## Progress and limits

Attempt history and settings remain in the learner's browser `localStorage`, scoped to the hosted origin. The app does not send progress to the repository or a server. Data saved on `file://`, localhost and the Pages origin are separate. Progress does not synchronize across browsers or devices. Learners can use the existing backup export/import controls when they need to transfer it.

Passing the hosting checks establishes that the app and its current corpus load and work in the tested browser configuration. The release classification remains **READY FOR LOCAL PILOT**. Actual PDF viewer retrieval, learner usability and educational effectiveness still require pilot evidence. Hosting does not change those findings or establish unrestricted public-release readiness.

## Repository exclusions

`.gitignore` excludes the handbook PDFs, local build output, local secrets, historical ZIP archives and source-inspection images from future additions. The Pages allowlist is the deployment control and also excludes tracked copies of development materials.
