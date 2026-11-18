(function () {
  'use strict';

  const core = window.PEWayfinderCore;
  const demoSafeManifest = window.PEWayfinderDemoSafeManifest || null;
  const demoSafeMode = Boolean(demoSafeManifest);
  const demoSafeItemIds = new Set(demoSafeMode ? demoSafeManifest.items
    .filter((entry) => entry.factCheckVerdict === 'PASS' && entry.releaseApproved === true && entry.blockingIssueCount === 0 && entry.recommendedDisposition === 'KEEP')
    .map((entry) => entry.itemId) : []);
  const sourceItems = Array.isArray(window.PEWayfinderItems) ? window.PEWayfinderItems : [];
  const builtInItems = demoSafeMode ? sourceItems.filter((item) => demoSafeItemIds.has(item.id)) : sourceItems;
  const contentValidation = demoSafeMode && builtInItems.length !== demoSafeItemIds.size
    ? { ok: false, errors: ['The demo-safe items do not match the audit manifest.'] }
    : core.validateTrainingItems(builtInItems);
  const main = document.getElementById('app-main');
  const alertBox = document.getElementById('app-alert');
  const pageContext = document.getElementById('page-context');
  const storageStatus = document.getElementById('storage-status');
  function getStorage(key) {
    try {
      const localStorage = window.localStorage;
      return {
        getItem: () => localStorage.getItem(key),
        setItem: (_storageKey, value) => localStorage.setItem(key, value)
      };
    } catch (error) {
      return {
        getItem: () => null,
        setItem: () => { throw new Error('Browser storage is unavailable.'); }
      };
    }
  }
  const storage = getStorage(demoSafeMode ? core.STORAGE_KEY + '-demo-safe' : core.STORAGE_KEY);
  const loadResult = core.safeLoadState(storage);
  let appState = loadResult.state;
  let currentSession = appState.incompleteSession && appState.incompleteSession.stage !== 'idle' ? appState.incompleteSession : null;
  let trainingViewStage = null;
  const TRAINING_VIEW_STAGES = ['recognition', 'searchPrediction', 'hunt', 'feedback', 'diagnosis', 'complete'];
  let view = 'home';
  let mapReturnId = null;
  let pendingImport = null;
  let editingPersonalId = null;
  let toastTimer = null;
  let timerInterval = null;

  const VIEW_CONTEXT = {
    home: 'Workspace / Start here',
    training: 'Training / Retrieval loop',
    progress: 'Progress / What to work on',
    map: 'Reference map / Handbook orientation',
    miss: 'Add this miss / Personal content',
    settings: 'Settings / Local preferences'
  };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function listHtml(values, className) {
    if (!Array.isArray(values) || !values.length) return '<span class="muted small">None recorded</span>';
    return '<ul class="chip-list ' + (className || '') + '">' + values.map((value) => '<li class="chip">' + escapeHtml(value) + '</li>').join('') + '</ul>';
  }

  function getPhaseConfig(phase) {
    return core.PHASE_CONFIG[phase] || core.PHASE_CONFIG.accuracy;
  }

  function phaseLabel(phase) {
    return getPhaseConfig(phase).label;
  }

  function verificationLabel(item) {
    if (!item) return 'Archived item';
    if (item.contentStatus === 'personal') return 'Personal';
    const status = item.sourceVerification && item.sourceVerification.status;
    if (status === 'needs_review') return 'Needs review';
    if (status === 'demo') return 'Demo';
    if (status === 'verified') return 'Verified';
    return 'Unverified';
  }

  function supportLabel(item) {
    const support = item && item.supportType ? item.supportType : 'uncertain';
    return support.charAt(0).toUpperCase() + support.slice(1);
  }

  function getAllItems() {
    return builtInItems.concat((appState.personalItems || []).filter((item) => item.active !== false));
  }

  function findItem(id) {
    return getAllItems().find((item) => item.id === id) || builtInItems.find((item) => item.id === id) || null;
  }

  function sourceBadge(item) {
    if (!item) return '<span class="source-badge">Archived item</span>';
    const status = verificationLabel(item);
    const className = item.contentStatus === 'personal' ? ' personal' : (status === 'Needs review' || status === 'Demo' ? ' partial' : '');
    return '<span class="source-badge' + className + '" aria-label="Verification status: ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return Math.max(0, ms) + ' ms';
    const seconds = ms / 1000;
    if (seconds < 60) return seconds.toFixed(seconds < 10 ? 1 : 0) + ' s';
    return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function announce(message, kind) {
    if (!message) return;
    alertBox.textContent = message;
    alertBox.hidden = false;
    alertBox.classList.toggle('is-success', kind === 'success');
    if (kind === 'success') {
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => { alertBox.hidden = true; }, 4200);
    }
  }

  function persist() {
    appState.incompleteSession = currentSession;
    const result = core.saveState(storage, appState);
    storageStatus.textContent = result.ok ? 'Local only' : 'Save issue';
    if (!result.ok) announce(result.error, 'error');
    return result.ok;
  }

  function nav(nextView) {
    if (!VIEW_CONTEXT[nextView]) return;
    view = nextView;
    render();
  }

  function startTraining(itemId) {
    const items = getAllItems();
    const selectableItems = demoSafeMode ? builtInItems : items;
    const item = itemId ? items.find((candidate) => candidate.id === itemId) : core.selectNextItem(selectableItems, appState.attempts, { excludedIds: [], phase: appState.preferences.phase });
    if (!item) {
      announce('No active training items are available.', 'error');
      return;
    }
    mapReturnId = view === 'map' ? item.id : null;
    currentSession = core.beginSession(item, appState.preferences, Date.now());
    trainingViewStage = currentSession.stage;
    if (demoSafeMode) currentSession.targetLength = Math.min(currentSession.targetLength, builtInItems.length);
    if (mapReturnId) currentSession.targetLength = 1;
    persist();
    view = 'training';
    render();
  }

  function startNextItem() {
    if (!currentSession || currentSession.stage !== 'complete') return;
    if (currentSession.sequence >= currentSession.targetLength) {
      currentSession = null;
      trainingViewStage = null;
      appState.incompleteSession = null;
      persist();
      announce('Session complete. Your attempt history is saved.', 'success');
      if (mapReturnId) { nav('map'); return; }
      render();
      return;
    }
    const exclusions = [currentSession.itemId].concat(currentSession.recentItemIds || []);
    const selectableItems = demoSafeMode ? builtInItems : getAllItems();
    const item = core.selectNextItem(selectableItems, appState.attempts, { excludedIds: exclusions, phase: appState.preferences.phase });
    if (!item) {
      currentSession = null;
      trainingViewStage = null;
      persist();
      render();
      return;
    }
    const next = core.beginSession(item, appState.preferences, Date.now());
    next.sessionId = currentSession.sessionId;
    next.sequence = currentSession.sequence + 1;
    next.targetLength = currentSession.targetLength;
    next.recentItemIds = (currentSession.recentItemIds || []).concat(currentSession.itemId).slice(-5);
    next.attempt.sessionId = next.sessionId;
    currentSession = next;
    trainingViewStage = currentSession.stage;
    persist();
    render();
  }

  function stopTraining() {
    const interrupted = core.interruptAttempt(currentSession, Date.now());
    if (interrupted) appState.attempts.push(interrupted);
    currentSession = null;
    trainingViewStage = null;
    appState.incompleteSession = null;
    persist();
    nav(mapReturnId ? 'map' : 'home');
  }

  function updatePreference(name, value) {
    if (name === 'phase' && core.TRAINING_PHASES.includes(value)) {
      appState.preferences.phase = value;
      appState.preferences.showTimer = getPhaseConfig(value).defaultShowTimer;
    }
    if (name === 'showTimer') appState.preferences.showTimer = Boolean(value);
    if (name === 'sessionLength' && [5, 10, 20].includes(Number(value))) appState.preferences.sessionLength = Number(value);
    persist();
    render();
  }

  function renderHome() {
    const progress = core.deriveProgress(getAllItems(), appState.attempts);
    const hasHistory = progress.total > 0;
    const nextAction = currentSession ? 'Resume current drill' : 'Start training';
    return '<section class="view" aria-labelledby="home-title">' +
      '<div class="home-grid">' +
        '<div class="home-intro">' +
          '<p class="eyebrow">PE Mechanical / Machine Design + Materials</p>' +
          '<h1 id="home-title">Find the path before you find the formula.</h1>' +
          '<p class="home-lede">Open your authorized copy of the NCEES PE Mechanical Reference Handbook 2.0 in a separate window. Wayfinder does not include the handbook. Start training for a guided drill, or choose Reference map to practice a specific topic.</p>' +
          '<div class="hero-actions"><button class="button button-primary" data-action="start-or-resume" type="button">' + escapeHtml(nextAction) + ' <span aria-hidden="true">→</span></button><button class="button button-secondary" data-view="progress" type="button">See progress</button></div>' +
          '<div class="info-stamp"><span>' + builtInItems.length + (demoSafeMode ? ' independently release-approved demo drills' : ' source-mapped drills') + '</span><span>Handbook 2.0</span><span>Local only</span></div>' +
        '</div>' +
        '<aside class="loop-card" aria-label="The retrieval loop"><p class="eyebrow">The loop</p><h2>One focused repetition.</h2><ol class="loop-list">' +
          '<li class="loop-step"><span class="loop-index">01</span><div><p class="loop-step-title">Recognize</p><p class="loop-step-copy">Name the engineering idea.</p></div></li>' +
          '<li class="loop-step"><span class="loop-index">02</span><div><p class="loop-step-title">Predict search</p><p class="loop-step-copy">Commit to your natural wording.</p></div></li>' +
          '<li class="loop-step"><span class="loop-index">03</span><div><p class="loop-step-title">Hunt</p><p class="loop-step-copy">Use the official handbook externally.</p></div></li>' +
          '<li class="loop-step"><span class="loop-index">04</span><div><p class="loop-step-title">Identify</p><p class="loop-step-copy">Check whether the material applies.</p></div></li>' +
          '<li class="loop-step"><span class="loop-index">05</span><div><p class="loop-step-title">Diagnose</p><p class="loop-step-copy">Name what actually slowed you down.</p></div></li>' +
        '</ol></aside>' +
      '</div>' +
      '<div class="home-lower">' +
        '<article class="mini-card"><p class="eyebrow">Current phase</p><strong>' + escapeHtml(phaseLabel(appState.preferences.phase)) + '</strong><p>' + escapeHtml(getPhaseConfig(appState.preferences.phase).description) + '</p></article>' +
        '<article class="mini-card"><p class="eyebrow">Recent work</p><strong>' + progress.total + '</strong><p>' + (hasHistory ? progress.retrievalSuccesses + ' retrieval successes / ' + progress.retrievalMisses + ' misses' : 'No attempts yet. Your first drill stays lightweight.') + '</p></article>' +
        '<article class="mini-card"><p class="eyebrow">Reference boundary</p><strong>External</strong><p>The official NCEES handbook stays in your own PDF window. Wayfinder never embeds it.</p></article>' +
      '</div>' +
    '</section>';
  }

  function renderTrainingIdle() {
    return '<section class="view" aria-labelledby="training-title"><div class="page-heading"><div><p class="eyebrow">Training loop</p><h1 id="training-title">Ready when you are.</h1><p>Each drill takes you from an engineering cue to a handbook hunt, then records why retrieval worked or failed.</p></div></div>' +
      '<div class="training-layout"><article class="training-card"><p class="eyebrow">Current phase · ' + escapeHtml(phaseLabel(appState.preferences.phase)) + '</p><h2>' + escapeHtml(getPhaseConfig(appState.preferences.phase).description) + '</h2><ol class="side-list" style="display:grid;justify-content:initial;margin:20px 0 0;gap:13px"><li><strong style="text-align:left">1. Read the cue</strong><span>Identify the engineering situation.</span></li><li><strong style="text-align:left">2. Make a call</strong><span>Write the concept and search phrase you would try.</span></li><li><strong style="text-align:left">3. Search externally</strong><span>Use your official NCEES reference.</span></li><li><strong style="text-align:left">4. Diagnose</strong><span>Tell the app what slowed you down.</span></li></ol><div class="form-actions"><button class="button button-primary" data-action="start-training" type="button">Start first drill <span aria-hidden="true">→</span></button><span class="helper">Session length: ' + escapeHtml(String(demoSafeMode ? builtInItems.length : appState.preferences.sessionLength)) + '</span></div></article><aside class="side-stack"><div class="side-card"><p class="eyebrow">Content</p><h3>Representative, not exhaustive</h3><p>' + escapeHtml(demoSafeMode ? builtInItems.length + ' independently release-approved drills are active for this demo.' : builtInItems.length + ' source-mapped drills cover the six MDM domains and include transfer practice.') + '</p></div><div class="side-card"><p class="eyebrow">Keyboard</p><h3>Enter to advance</h3><p>During a hunt, F means found and C means could not find it.</p></div></aside></div></section>';
  }

  function renderTrainingStage() {
    const session = currentSession;
    const item = findItem(session.itemId);
    if (!item) return '<section class="view"><div class="empty-state"><strong>This training item is no longer available.</strong><p>The attempt was not completed. You can return home and continue with the current content set.</p><button class="button button-secondary" data-action="stop-training" type="button">Return home</button></div></section>';
    const stage = trainingViewStage || session.stage;
    const stageIndex = TRAINING_VIEW_STAGES.indexOf(stage);
    const viewingEarlierStep = stageIndex < TRAINING_VIEW_STAGES.indexOf(session.stage);
    const stageNames = { recognition: 'Recognize', searchPrediction: 'Predict search', hunt: 'Hunt', feedback: 'Identify', diagnosis: 'Diagnose', complete: 'Recorded' };
    const step = { recognition: '1 / 4', searchPrediction: '2 / 4', hunt: '3 / 4', feedback: '4 / 4', diagnosis: '4 / 4', complete: 'Done' }[stage];
    let content = '';
    if (stage === 'recognition') {
      content = '<form id="recognition-form"><p class="eyebrow">What concept or topic do you think this is testing?</p><div class="prompt-box">' + escapeHtml(item.prompt) + '</div><div class="field"><label for="concept-response">Your concept call</label><p class="field-help">Use your own words. The answer is stored exactly as written.</p><input id="concept-response" type="text" maxlength="240" autocomplete="off" required autofocus value="' + escapeHtml(session.attempt.conceptResponse || '') + '"></div><div class="form-actions"><button class="button button-primary" type="submit">Continue to search prediction <span aria-hidden="true">→</span></button><button class="button button-quiet" data-action="stop-training" type="button">Exit drill</button><span class="helper">Enter to continue</span></div></form>';
    } else if (stage === 'searchPrediction') {
      content = '<form id="search-form"><p class="eyebrow">What would you search for in the NCEES handbook?</p><div class="prompt-box">' + escapeHtml(item.prompt) + '</div><div class="field"><label for="search-phrase">Your predicted search</label><p class="field-help">Enter the phrase you would try. If the handbook cannot settle the question, enter what information you would need instead.</p><input id="search-phrase" type="text" maxlength="240" autocomplete="off" required autofocus value="' + escapeHtml(session.attempt.searchPhrase || '') + '"></div><div class="form-actions"><button class="button button-primary" type="submit">Start handbook hunt <span aria-hidden="true">→</span></button><button class="button button-quiet" data-action="stop-training" type="button">Exit drill</button><span class="helper">Enter to continue</span></div></form>';
    } else if (stage === 'hunt') {
      const elapsedMs = Number.isFinite(session.attempt.elapsedMs) ? session.attempt.elapsedMs : Date.now() - session.attempt.searchStartedAt;
      const timer = appState.preferences.showTimer ? '<div class="hunt-timer" data-timer aria-label="Elapsed handbook hunt time">' + formatDuration(elapsedMs) + '</div>' : '<span class="muted small">Timing recorded quietly</span>';
      const recordedResult = viewingEarlierStep ? '<p class="transcript"><strong>Recorded result:</strong> ' + escapeHtml(session.attempt.retrievalResult === 'found' ? 'FOUND IT' : 'COULDN\'T FIND IT') + '</p>' : '';
      content = '<p class="eyebrow">Search the official reference</p><div class="prompt-box">' + escapeHtml(item.prompt) + '</div><div class="transcript"><strong>Your search:</strong> ' + escapeHtml(session.attempt.searchPhrase) + '</div>' + recordedResult + '<div class="hunt-callout"><p>For a lookup, switch to the PDF and press Ctrl+F (Cmd+F on Mac). Use Enter to move through matches and check the surrounding material. If you decided the information must come from another source, choose COULDN&#39;T FIND IT and explain that decision in diagnosis.</p>' + timer + '</div><div class="hunt-actions"><button class="button found-button" data-action="complete-hunt" data-result="found" type="button">FOUND IT <span class="shortcut">F</span></button><button class="button missed-button" data-action="complete-hunt" data-result="missed" type="button">COULDN\'T FIND IT <span class="shortcut">C</span></button></div><div class="form-actions"><button class="button button-quiet" data-action="stop-training" type="button">Exit without completing</button></div>';
    } else if (stage === 'feedback') {
      const resultWord = session.attempt.retrievalResult === 'found' ? 'You reached the material.' : 'The material did not come into view.';
      const verificationText = verificationLabel(item) === 'Verified' ? 'Verified source mapping.' : verificationLabel(item) + ' content; do not treat it as authoritative built-in content.';
      content = '<p class="eyebrow">Identify the route</p><h2>' + escapeHtml(resultWord) + '</h2><p class="muted">Now compare your path with the reference route. This is feedback, not a score.</p><div class="feedback-grid"><div><div class="feedback-block"><h3>Target concept</h3><p>' + escapeHtml(item.targetConcept) + '</p></div><div class="feedback-block"><h3>Clues that mattered</h3><p>' + escapeHtml(item.recognitionClues.join('; ')) + '</p></div><div class="feedback-block"><h3>Why it applies</h3><p>' + escapeHtml(item.briefExplanation) + '</p></div></div><div><div class="feedback-block"><h3>Handbook location</h3><p>' + escapeHtml(item.handbookLocationLabel) + '</p></div><div class="feedback-block"><h3>Useful search terms</h3>' + (item.preferredSearchTerms.length ? listHtml(item.preferredSearchTerms) : '<p>No preferred search route is supplied for this prior-knowledge task. Use the boundary note below.</p>') + '</div></div></div><div class="feedback-grid" style="margin-top:25px"><div class="feedback-block"><h3>Verification</h3><p>' + escapeHtml(verificationText) + (demoSafeMode ? ' Independent release review: PASS for this drill.' : '') + '</p></div><div class="feedback-block"><h3>Handbook / prior-knowledge boundary</h3><p><strong>' + escapeHtml(supportLabel(item)) + ' handbook support.</strong> ' + escapeHtml(item.priorKnowledgeNote || 'No separate prior-knowledge note is supplied.') + '</p></div></div><div class="feedback-block" style="margin-top:25px"><h3>Concept self-assessment <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></h3><div class="hero-actions">' + ['correct', 'close', 'missed'].map((value) => '<button class="button ' + (session.attempt.conceptSelfAssessment === value ? 'button-primary' : 'button-secondary') + '" data-action="assessment" data-assessment="' + value + '" type="button">' + value.charAt(0).toUpperCase() + value.slice(1) + '</button>').join('') + '</div></div><div class="form-actions"><button class="button button-primary" data-action="to-diagnosis" type="button">Continue to diagnosis <span aria-hidden="true">→</span></button></div>';
    } else if (stage === 'diagnosis') {
      const selected = session.attempt.failureReason || '';
      const successfulSearchField = selected === 'searchLanguage' ? '<div class="field"><label for="successful-search-phrase">What search finally worked? <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label><p class="field-help">Capture one short replacement phrase if you found a better route. Leave it blank if none emerged.</p><input id="successful-search-phrase" type="text" maxlength="180" autocomplete="off" value="' + escapeHtml(session.attempt.successfulSearchPhrase || '') + '"></div>' : '';
      content = '<form id="diagnosis-form"><p class="eyebrow">What slowed you down?</p><h2>Name the bottleneck, not the outcome.</h2><p class="muted">Choose one. A note is optional and never needed to continue.</p><div class="diagnosis-list">' + core.FAILURE_REASONS.map((reason) => '<label class="diagnosis-option ' + (selected === reason.id ? 'is-selected' : '') + '"><input type="radio" name="failure-reason" value="' + reason.id + '" ' + (selected === reason.id ? 'checked' : '') + '><span>' + escapeHtml(reason.label) + '</span></label>').join('') + '</div>' + successfulSearchField + '<div class="field"><label for="optional-note">Optional note</label><textarea id="optional-note" maxlength="500" placeholder="One short observation, if useful">' + escapeHtml(session.attempt.optionalNote || '') + '</textarea></div><div class="form-actions"><button class="button button-primary" type="submit" ' + (selected ? '' : 'disabled') + '>Record diagnosis <span aria-hidden="true">→</span></button><span class="helper">One click is enough; notes are optional.</span></div></form>';
    } else if (stage === 'complete') {
      const itemCount = session.sequence >= session.targetLength;
      const reason = core.getFailureReason(session.attempt.failureReason);
      content = '<p class="eyebrow">Attempt recorded</p><h2>Good. The next decision is already made.</h2><div class="complete-callout"><p><strong>' + escapeHtml(reason.shortLabel) + '</strong><br>Hunt time: ' + formatDuration(session.attempt.elapsedMs) + ' · ' + escapeHtml(session.attempt.retrievalResult === 'found' ? 'Found in handbook' : 'Not found') + '</p><button class="button button-primary" data-action="next-item" type="button">' + (itemCount ? 'Finish session' : 'Next item') + ' <span aria-hidden="true">→</span><span class="shortcut">N</span></button></div><div class="feedback-grid"><div><div class="feedback-block"><h3>Search route</h3><p>' + escapeHtml(item.handbookLocationLabel) + '</p></div></div><div><div class="feedback-block"><h3>Reminder</h3><p>Correct strategy comes before speed. Use the issue you selected to guide the next repetition.</p></div></div></div>';
    }
    const feedbackVisible = ['feedback', 'diagnosis', 'complete'].includes(stage);
    const trainingTitle = feedbackVisible ? item.targetConcept : 'Find the right route.';
    const releaseReviewRow = demoSafeMode ? '<li><span>Independent release review</span><strong>PASS</strong></li>' : '';
    const routeCard = feedbackVisible ? '<div class="side-card"><p class="eyebrow">Source route</p><ul class="side-list"><li><span>Verification</span><strong>' + escapeHtml(verificationLabel(item)) + '</strong></li>' + releaseReviewRow + '<li><span>Handbook support</span><strong>' + escapeHtml(supportLabel(item)) + '</strong></li><li><span>Location</span><strong>' + escapeHtml(item.handbookLocationLabel) + '</strong></li><li><span>Version</span><strong>' + escapeHtml(item.handbookVersion || 'Not a direct lookup') + '</strong></li><li><span>Family</span><strong>' + escapeHtml(item.conceptFamily) + '</strong></li></ul></div>' : '<div class="side-card"><p class="eyebrow">Hold the answer</p><h3>Your route first</h3><p>The target concept, location, and useful terms appear after you commit the handbook result.</p></div>';
    const drillCard = feedbackVisible ? '<div class="side-card"><p class="eyebrow">This drill trains</p><h3>' + escapeHtml(item.targetConcept) + '</h3><p>Handbook support: ' + escapeHtml(supportLabel(item)) + '<br>Verification: ' + escapeHtml(verificationLabel(item)) + '</p></div>' : '<div class="side-card"><p class="eyebrow">Reference status</p><h3>Handbook support: ' + escapeHtml(supportLabel(item)) + '</h3><p>Verification: ' + escapeHtml(verificationLabel(item)) + '<br>Exam scope: ' + escapeHtml(item.examTopic) + '</p></div>';
    const previousButton = stageIndex > 0 ? '<button class="button button-quiet" data-action="back-step" type="button">← Back</button>' : '';
    const returnButton = viewingEarlierStep ? '<button class="button button-secondary" data-action="return-to-current-step" type="button">Return to current step <span aria-hidden="true">→</span></button>' : '';
    const trainingNavigation = previousButton || returnButton ? '<nav class="form-actions training-navigation" aria-label="Training step navigation">' + previousButton + returnButton + '</nav>' : '';
    return '<section class="view" aria-labelledby="training-title"><div class="training-header"><div class="training-label">' + escapeHtml(stageNames[stage]) + ' <span aria-hidden="true">/</span> ' + step + '</div><div class="progress-note">Session ' + session.sequence + ' of ' + session.targetLength + ' · ' + escapeHtml((appState.preferences.phase || 'accuracy').toUpperCase()) + '</div></div><div class="training-layout"><article class="training-card"><div class="small muted mono">' + escapeHtml(item.examDomain) + ' · ' + escapeHtml(item.examTopic) + '</div><div style="display:flex;justify-content:space-between;gap:16px;align-items:start;margin-top:12px"><h1 id="training-title" style="font-size:clamp(1.75rem,3vw,2.8rem);margin-bottom:0">' + escapeHtml(trainingTitle) + '</h1>' + sourceBadge(item) + '</div>' + content + trainingNavigation + '</article><aside class="side-stack">' + drillCard + routeCard + '<div class="side-card"><p class="eyebrow">Keyboard</p><p>Enter advances text fields. In a hunt: <span class="mono">F</span> found, <span class="mono">C</span> not found. <span class="mono">N</span> loads the next item.</p></div></aside></div></section>';
  }

  function renderTraining() {
    if (!currentSession) {
      trainingViewStage = null;
      return renderTrainingIdle();
    }
    if (!TRAINING_VIEW_STAGES.includes(trainingViewStage)) trainingViewStage = currentSession.stage;
    return renderTrainingStage();
  }

  function renderProgress() {
    const progress = core.deriveProgress(getAllItems(), appState.attempts);
    const total = Math.max(1, progress.total);
    const reasons = core.FAILURE_REASONS.filter((reason) => reason.id !== 'noProblem');
    const breakdown = reasons.map((reason) => '<div class="breakdown-row"><span>' + escapeHtml(reason.shortLabel) + '</span><div class="bar" aria-hidden="true"><span style="width:' + Math.min(100, Math.round((progress.failureCounts[reason.id] / total) * 100)) + '%"></span></div><strong>' + progress.failureCounts[reason.id] + '</strong></div>').join('');
    const areas = progress.areas.length ? '<div class="area-list">' + progress.areas.slice(0, 8).map((area) => '<div class="area-row"><div><strong>' + escapeHtml(area.name) + '</strong><span>Primary problem: ' + escapeHtml(area.primaryIssue) + '</span></div><span class="area-count">' + area.misses + ' miss' + (area.misses === 1 ? '' : 'es') + '</span></div>').join('') + '</div>' : '<div class="empty-state"><strong>Your weak areas will appear here.</strong><p>Complete a few drills and diagnose the reason, not just the result.</p></div>';
    const transfers = progress.transferFamilies.length ? '<div class="transfer-list">' + progress.transferFamilies.map((family) => '<div class="transfer-row"><span>' + escapeHtml(family.name) + ' · ' + family.variants + ' variants</span><strong>' + family.successful + ' successful / ' + family.attempts + ' attempts</strong></div>').join('') + '</div>' : '<div class="empty-state"><strong>Transfer families are ready.</strong><p>Variants will show here after you work across a family.</p></div>';
    const searchLessons = progress.searchLanguageLessons.length ? '<section class="panel search-lessons"><p class="eyebrow">Recent search-language lessons</p><h2>Keep the words that worked.</h2><ul class="search-lesson-list">' + progress.searchLanguageLessons.map((lesson) => '<li><span>' + escapeHtml(lesson.initial) + '</span><span class="search-lesson-arrow" aria-hidden="true">→</span><strong>' + escapeHtml(lesson.successful) + '</strong></li>').join('') + '</ul></section>' : '';
    const recent = progress.recent.length ? '<div class="recent-panel panel"><h2>Recent training</h2><table class="attempt-table"><thead><tr><th>Concept</th><th>Result</th><th>Diagnosis</th><th>Hunt time</th></tr></thead><tbody>' + progress.recent.map((attempt) => { const item = findItem(attempt.trainingItemId); return '<tr><td><strong>' + escapeHtml(item ? item.targetConcept : attempt.trainingItemId) + '</strong><br><span class="muted">' + escapeHtml(item ? item.examDomain : 'Archived content') + '</span></td><td class="' + (attempt.retrievalResult === 'found' ? 'result-found' : 'result-missed') + '">' + (attempt.retrievalResult === 'found' ? 'Found' : 'Missed') + '</td><td>' + escapeHtml(core.getFailureReason(attempt.failureReason).shortLabel) + '</td><td>' + formatDuration(attempt.elapsedMs) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
    const phase = getPhaseConfig(appState.preferences.phase);
    const timeNote = appState.preferences.phase === 'speed' ? 'time informs practice; it is not mastery' : 'hunt time is recorded; correctness stays separate';
    return '<section class="view" aria-labelledby="progress-title"><div class="page-heading"><div><p class="eyebrow">Progress</p><h1 id="progress-title">What should get your next hour?</h1><p>Derived from attempt history. There is no synthetic readiness score here.</p></div><div class="heading-actions"><button class="button button-primary" data-action="start-or-resume" type="button">' + (currentSession ? 'Resume training' : 'Start training') + ' <span aria-hidden="true">→</span></button></div></div><div class="stats-grid"><div class="stat-card"><span class="stat-label">Completed</span><strong>' + progress.total + '</strong><br><small>attempts</small></div><div class="stat-card"><span class="stat-label">Retrieval</span><strong>' + progress.retrievalSuccesses + '</strong><br><small>found / ' + progress.retrievalMisses + ' not found</small></div><div class="stat-card"><span class="stat-label">Median hunt</span><strong>' + formatDuration(progress.medianElapsedMs) + '</strong><br><small>completed hunts only</small></div><div class="stat-card"><span class="stat-label">Phase</span><strong style="font-size:1.35rem">' + escapeHtml(phase.label) + '</strong><br><small>' + escapeHtml(timeNote) + '</small></div></div><div class="progress-grid"><section class="panel"><p class="eyebrow">Failure breakdown</p><h2>Separate the bottlenecks.</h2>' + breakdown + '<p class="small muted" style="margin:20px 0 0">Counts include your selected diagnosis, so a found item can still reveal a recognition or speed issue.</p></section><section class="panel"><p class="eyebrow">Areas needing work</p><h2>Practice with intent.</h2>' + areas + '</section></div><div class="progress-grid" style="margin-top:18px"><section class="panel"><p class="eyebrow">Transfer performance</p><h2>Can you recognize it again?</h2>' + transfers + '</section><section class="panel"><p class="eyebrow">Personal content</p><h2>Real misses count too.</h2><p class="muted">' + (appState.personalItems || []).filter((item) => item.active !== false).length + ' active personal item(s). They stay distinct from verified NCEES mappings.</p><button class="button button-secondary" data-view="miss" type="button">Review personal misses</button></section></div>' + searchLessons + recent + '</section>';
  }

  function renderMap() {
    const grouped = new Map();
    getAllItems().filter((item) => item.contentStatus !== 'personal').forEach((item) => {
      const chapter = item.handbookChapter || 'Prior-knowledge boundary';
      if (!grouped.has(chapter)) grouped.set(chapter, new Map());
      const key = item.conceptFamily;
      if (!grouped.get(chapter).has(key)) grouped.get(chapter).set(key, []);
      grouped.get(chapter).get(key).push(item);
    });
    const chapters = Array.from(grouped.entries()).map(([chapter, families], index) => {
      const routes = Array.from(families.values()).map((members) => {
        const targets = Array.from(new Set(members.map((item) => item.targetConcept)));
        const drills = members.map((item) => {
          const printed = item.handbookLocationLabel.match(/printed pp?\. ([\d,–\- ]+)/);
          const pdf = printed && !item.handbookLocationLabel.includes('PDF p.')
            ? ' · PDF pages ' + printed[1].trim().replace(/\d+/g, page => String(Number(page) + 16)) : '';
          const sections = [item.handbookSection, item.handbookSubsection].filter(Boolean).join(' › ');
          const search = item.preferredSearchTerms.length ? '<p class="map-search"><strong>' + (item.supportType === 'primarily prior knowledge' ? 'Neighboring search terms' : 'Search terms') + '</strong></p>' + listHtml(item.preferredSearchTerms) : '<p class="map-search">No preferred search route. Use the knowledge-boundary note.</p>';
          const alternates = item.alternateSearchTerms.length ? '<p class="map-search"><strong>Alternate terms</strong></p>' + listHtml(item.alternateSearchTerms) : '';
          const note = item.priorKnowledgeNote ? '<p class="map-boundary">' + escapeHtml(item.priorKnowledgeNote) + '</p>' : '';
          return '<div class="map-row" data-map-item="' + escapeHtml(item.id) + '"><div><strong>' + escapeHtml(item.targetConcept) + '</strong><p class="map-cue">' + escapeHtml(item.prompt) + '</p><span>' + escapeHtml(item.examDomain) + ' · ' + escapeHtml(item.examTopic) + '</span></div><div><strong>' + escapeHtml(supportLabel(item)) + ' handbook support</strong><p class="map-location">' + escapeHtml(item.handbookLocationLabel + pdf) + '</p><p>' + escapeHtml(sections) + '</p><p>' + escapeHtml(item.briefExplanation) + '</p>' + search + alternates + note + '</div><button class="button button-quiet" data-train-item="' + escapeHtml(item.id) + '" aria-label="Drill: ' + escapeHtml(item.targetConcept) + '" type="button">Drill <span aria-hidden="true">→</span></button></div>';
        }).join('');
        return '<details class="map-family" data-family="' + escapeHtml(members[0].conceptFamily) + '"><summary><span>' + escapeHtml(targets.join(' / ')) + '</span><span class="muted small">' + members.length + (members.length === 1 ? ' drill' : ' drills') + '</span></summary><div class="map-drills">' + drills + '</div></details>';
      }).join('');
      return '<details class="map-item" ' + (index === 0 ? 'open' : '') + '><summary><span>' + escapeHtml(chapter) + '</span><span class="muted small">' + families.size + ' concept families</span></summary><div class="map-sections">' + routes + '</div></details>';
    }).join('');
    return '<section class="view" aria-labelledby="map-title"><div class="page-heading"><div><p class="eyebrow">Reference map</p><h1 id="map-title">Know the terrain. Keep the book external.</h1><p>Expand a chapter and concept family to compare its drills, search terms and locations. Choose Drill to practice that cue. Locations use printed handbook pages. In the supplied PDF, printed page 82 is PDF page 98.</p></div></div><div class="map-grid">' + chapters + '</div><div class="panel" style="margin-top:18px"><p class="eyebrow">Boundary note</p><p class="muted" style="margin-bottom:0">Partial and prior-knowledge routes state what the handbook can supply. A neighboring section does not supply missing theory. Search guidance was checked by extraction and page inspection; PDF-viewer search behavior remains unverified.</p></div></section>';
  }

  function renderMiss() {
    const editing = editingPersonalId ? (appState.personalItems || []).find((item) => item.id === editingPersonalId) : null;
    const details = editing && editing.personalDetails ? editing.personalDetails : {};
    const personal = (appState.personalItems || []).filter((item) => item.active !== false);
    const list = personal.length ? '<div class="personal-list">' + personal.map((item) => '<article class="personal-row"><div class="personal-row-header"><div><h3>' + escapeHtml(item.prompt) + '</h3><p>' + escapeHtml(item.targetConcept) + '</p></div>' + sourceBadge(item) + '</div><div class="hero-actions"><button class="button button-quiet" data-edit-personal="' + escapeHtml(item.id) + '" type="button">Edit</button><button class="button button-quiet" data-archive-personal="' + escapeHtml(item.id) + '" type="button">Archive</button><button class="button button-secondary" data-train-item="' + escapeHtml(item.id) + '" type="button">Train this miss <span aria-hidden="true">→</span></button></div></article>').join('') + '</div>' : '<div class="empty-state"><strong>No personal misses yet.</strong><p>Capture a concise cue after practice while the retrieval failure is fresh.</p></div>';
    return '<section class="view" aria-labelledby="miss-title"><div class="page-heading"><div><p class="eyebrow">Personal content</p><h1 id="miss-title">Turn a real miss into a future cue.</h1><p>Capture only what you need to train retrieval. Do not copy an entire copyrighted practice problem.</p></div></div><div class="miss-layout"><article class="form-panel"><p class="eyebrow">' + (editing ? 'Edit personal item' : 'Add this miss') + '</p><h2>' + (editing ? 'Update the cue.' : 'Keep it short and useful.') + '</h2><form id="personal-form"><div class="field"><label for="personal-cue">Short cue or situation</label><input id="personal-cue" type="text" maxlength="240" required value="' + escapeHtml(editing ? editing.prompt : '') + '"></div><div class="field"><label for="personal-target">Target concept, if known</label><input id="personal-target" type="text" maxlength="160" value="' + escapeHtml(editing ? editing.targetConcept : '') + '"></div><div class="field"><label for="personal-searched">What I searched</label><input id="personal-searched" type="text" maxlength="180" value="' + escapeHtml(editing ? details.searched : '') + '"></div><div class="field"><label for="personal-eventual">What eventually worked</label><input id="personal-eventual" type="text" maxlength="180" value="' + escapeHtml(editing ? details.eventual : '') + '"></div><div class="field"><label for="personal-why">Why I missed it</label><textarea id="personal-why" maxlength="400">' + escapeHtml(editing ? details.whyMissed : '') + '</textarea></div><div class="field"><label for="personal-location">Optional handbook location</label><input id="personal-location" type="text" maxlength="180" value="' + escapeHtml(editing ? editing.handbookLocationLabel : '') + '"></div><div class="field"><label for="personal-note">Optional note</label><textarea id="personal-note" maxlength="400">' + escapeHtml(editing ? details.note : '') + '</textarea></div><div class="form-actions"><button class="button button-primary" type="submit">' + (editing ? 'Save changes' : 'Save personal miss') + ' <span aria-hidden="true">→</span></button>' + (editing ? '<button class="button button-quiet" data-action="cancel-edit" type="button">Cancel</button>' : '') + '</div></form></article><aside><div class="privacy-note"><strong>Source boundary</strong><br>Personal items are never presented as verified NCEES mappings. The location and terminology are your notes until you verify them yourself.</div><div style="margin-top:18px"><p class="eyebrow">Active personal items</p>' + list + '</div></aside></div></section>';
  }

  function renderSettings() {
    const phase = appState.preferences.phase || 'accuracy';
    const importPanel = pendingImport ? '<div class="import-preview" role="dialog" aria-labelledby="import-title"><strong id="import-title">Backup ready to import</strong><p style="margin:5px 0 10px">' + pendingImport.attempts.length + ' attempts and ' + pendingImport.personalItems.length + ' personal item(s) will replace current local user data. Built-in content stays with the app.</p><div class="hero-actions"><button class="button button-primary" data-action="confirm-import" type="button">Confirm import</button><button class="button button-quiet" data-action="cancel-import" type="button">Cancel</button></div></div>' : '';
    return '<section class="view" aria-labelledby="settings-title"><div class="page-heading"><div><p class="eyebrow">Settings</p><h1 id="settings-title">Keep the controls small.</h1><p>Preferences, backups, and a clear boundary around what stays on this device.</p></div></div><div class="settings-grid"><section class="settings-panel"><p class="eyebrow">Training preferences</p><div class="setting-row"><div class="setting-copy"><strong>Training phase</strong><span>' + escapeHtml(getPhaseConfig(phase).description) + '</span></div><select data-pref="phase" aria-label="Training phase"><option value="accuracy" ' + (phase === 'accuracy' ? 'selected' : '') + '>Accuracy</option><option value="strategy" ' + (phase === 'strategy' ? 'selected' : '') + '>Strategy</option><option value="speed" ' + (phase === 'speed' ? 'selected' : '') + '>Speed</option><option value="mixed" ' + (phase === 'mixed' ? 'selected' : '') + '>Mixed</option></select></div><div class="setting-row"><div class="setting-copy"><strong>Visible hunt timer</strong><span>Timing is always recorded; Speed starts with the timer shown.</span></div><label class="toggle"><input type="checkbox" data-pref="showTimer" ' + (appState.preferences.showTimer ? 'checked' : '') + '> Show timer</label></div><div class="setting-row"><div class="setting-copy"><strong>Session length</strong><span>Use a short loop or a longer block.</span></div><select data-pref="sessionLength" aria-label="Session length"><option value="5" ' + (appState.preferences.sessionLength === 5 ? 'selected' : '') + '>5 items</option><option value="10" ' + (appState.preferences.sessionLength === 10 ? 'selected' : '') + '>10 items</option><option value="20" ' + (appState.preferences.sessionLength === 20 ? 'selected' : '') + '>20 items</option></select></div></section><section class="settings-panel"><p class="eyebrow">Backup and restore</p><div class="setting-row"><div class="setting-copy"><strong>Export backup</strong><span>JSON of attempts, personal items, and preferences.</span></div><button class="button button-secondary" data-action="export" type="button">Export JSON</button></div><div class="setting-row"><div class="setting-copy"><strong>Import backup</strong><span>Validate first; existing data changes only after confirmation.</span></div><label class="button button-secondary" for="import-file">Choose JSON<input id="import-file" type="file" accept="application/json,.json" hidden></label></div>' + importPanel + '</section><section class="settings-panel"><p class="eyebrow">Version boundary</p><div class="setting-row"><div class="setting-copy"><strong>Application</strong><span>Software version</span></div><strong class="mono small">' + core.APP_VERSION + '</strong></div><div class="setting-row"><div class="setting-copy"><strong>Content</strong><span>Built-in training dataset</span></div><strong class="mono small">' + core.CONTENT_VERSION + '</strong></div><div class="setting-row"><div class="setting-copy"><strong>Storage schema</strong><span>Persistent local data</span></div><strong class="mono small">v' + core.STORAGE_SCHEMA_VERSION + '</strong></div><div class="setting-row"><div class="setting-copy"><strong>Handbook</strong><span>Mapping checked against</span></div><strong class="mono small">v' + core.HANDBOOK_VERSION + '</strong></div></section><section class="settings-panel"><p class="eyebrow">Destructive</p><h2 style="font-size:1.25rem">Reset local progress</h2><p class="muted small">Removes attempts, personal items, and any incomplete drill from this browser. Export a backup first if you may want to recover it.</p><button class="button button-danger" data-action="reset" type="button">Reset progress</button></section></div></section>';
  }

  function render() {
    window.clearInterval(timerInterval);
    pageContext.textContent = VIEW_CONTEXT[view];
    document.querySelectorAll('.nav-link[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    if (!contentValidation.ok) {
      main.innerHTML = '<section class="view"><div class="empty-state"><strong>Built-in content validation failed.</strong><p>' + escapeHtml(contentValidation.errors.join(' ')) + '</p></div></section>';
      announce('The built-in content is invalid. Fix the dataset before training.', 'error');
      return;
    }
    if (view === 'home') main.innerHTML = renderHome();
    if (view === 'training') {
      main.innerHTML = renderTraining();
      if (currentSession && trainingViewStage !== currentSession.stage) {
        main.querySelectorAll('input, textarea, select').forEach((control) => {
          if (control.matches('input[type="text"], textarea')) control.readOnly = true;
          else control.disabled = true;
        });
        main.querySelectorAll('form button[type="submit"], .hunt-actions button, [data-action="assessment"], [data-action="to-diagnosis"], [data-action="next-item"]').forEach((button) => { button.disabled = true; });
        if (trainingViewStage === 'hunt' && currentSession.attempt.retrievalResult) {
          const huntActions = main.querySelector('.hunt-actions');
          if (huntActions) huntActions.innerHTML = '';
        }
      }
    }
    if (view === 'progress') main.innerHTML = renderProgress();
    if (view === 'map') main.innerHTML = renderMap();
    if (view === 'miss') main.innerHTML = renderMiss();
    if (view === 'settings') main.innerHTML = renderSettings();
    if (view === 'training' && currentSession && trainingViewStage === 'hunt' && currentSession.stage === 'hunt' && appState.preferences.showTimer) {
      timerInterval = window.setInterval(() => {
        const timer = document.querySelector('[data-timer]');
        if (timer) timer.textContent = formatDuration(Date.now() - currentSession.attempt.searchStartedAt);
      }, 500);
    }
    window.queueMicrotask(() => {
      const returnButton = view === 'map' && mapReturnId && main.querySelector('[data-train-item="' + CSS.escape(mapReturnId) + '"]');
      if (returnButton) {
        returnButton.closest('.map-item').open = true;
        returnButton.closest('.map-family').open = true;
        returnButton.focus();
        mapReturnId = null;
        return;
      }
      const focusTarget = main.querySelector('[autofocus]') || main;
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
      }
    });
  }

  function handleRecognition(form) {
    const value = form.querySelector('#concept-response').value;
    if (!value.trim()) return;
    currentSession = core.transitionStage(currentSession, 'searchPrediction');
    currentSession.attempt = Object.assign({}, currentSession.attempt, { conceptResponse: value });
    trainingViewStage = currentSession.stage;
    persist();
    render();
  }

  function handleSearch(form) {
    const value = form.querySelector('#search-phrase').value;
    if (!value.trim()) return;
    currentSession = core.setSearchStarted(currentSession, value, Date.now());
    trainingViewStage = currentSession.stage;
    persist();
    render();
  }

  function handleDiagnosis(form) {
    const choice = form.querySelector('input[name="failure-reason"]:checked');
    if (!choice) return;
    const note = form.querySelector('#optional-note').value;
    const successfulSearchPhrase = form.querySelector('#successful-search-phrase');
    currentSession = core.recordDiagnosis(currentSession, choice.value, note, currentSession.attempt.conceptSelfAssessment, successfulSearchPhrase ? successfulSearchPhrase.value : '');
    const finalized = core.finalizeAttempt(currentSession);
    const alreadyRecorded = appState.attempts.some((attempt) => attempt.id === finalized.attempt.id);
    if (!alreadyRecorded) appState.attempts.push(finalized.attempt);
    currentSession = finalized;
    trainingViewStage = currentSession.stage;
    persist();
    announce('Attempt recorded. Your next item is ready.', 'success');
    render();
  }

  function handlePersonal(form) {
    const fields = {
      cue: form.querySelector('#personal-cue').value,
      targetConcept: form.querySelector('#personal-target').value,
      searched: form.querySelector('#personal-searched').value,
      eventual: form.querySelector('#personal-eventual').value,
      whyMissed: form.querySelector('#personal-why').value,
      location: form.querySelector('#personal-location').value,
      note: form.querySelector('#personal-note').value
    };
    if (!fields.cue.trim()) return;
    if (editingPersonalId) {
      const existing = appState.personalItems.find((item) => item.id === editingPersonalId);
      if (existing) {
        const updated = core.buildPersonalItem(fields, Date.now());
        Object.assign(existing, updated, { id: editingPersonalId, createdAt: existing.createdAt });
      }
      announce('Personal miss updated.', 'success');
    } else {
      appState.personalItems.push(core.buildPersonalItem(fields, Date.now()));
      announce('Personal miss saved for future practice.', 'success');
    }
    editingPersonalId = null;
    persist();
    render();
  }

  function handleImportFile(file) {
    if (!file) return;
    file.text().then((text) => {
      let parsed;
      try { parsed = JSON.parse(text); } catch (error) { announce('Import rejected: the file is not valid JSON.', 'error'); return; }
      const validation = core.validateBackup(parsed, builtInItems);
      if (!validation.ok) { pendingImport = null; announce('Import rejected: ' + validation.errors[0], 'error'); render(); return; }
      pendingImport = parsed;
      announce('Backup validated. Review the replacement summary before confirming.', 'success');
      render();
    }).catch(() => announce('Import rejected: the file could not be read.', 'error'));
  }

  function confirmImport() {
    if (!pendingImport) return;
    const before = JSON.parse(JSON.stringify(appState));
    appState.attempts = pendingImport.attempts;
    appState.personalItems = pendingImport.personalItems;
    appState.preferences = Object.assign({}, appState.preferences, pendingImport.preferences);
    currentSession = null;
    pendingImport = null;
    if (!persist()) {
      appState = before;
      currentSession = appState.incompleteSession || null;
      persist();
      return;
    }
    announce('Backup imported. Built-in content and version mappings were left unchanged.', 'success');
    render();
  }

  function exportBackup() {
    const backup = core.makeBackup(appState, Date.now());
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pe-wayfinder-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    announce('Backup exported.', 'success');
  }

  function resetProgress() {
    if (!window.confirm('Reset all local attempts, personal items, and incomplete drills? This cannot be undone unless you have an exported backup.')) return;
    const preferences = Object.assign({}, appState.preferences);
    appState.attempts = [];
    appState.personalItems = [];
    appState.preferences = preferences;
    currentSession = null;
    pendingImport = null;
    persist();
    announce('Local progress reset.', 'success');
    nav('home');
  }

  function handleClick(event) {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { nav(viewButton.dataset.view); return; }
    const trainButton = event.target.closest('[data-train-item]');
    if (trainButton) { startTraining(trainButton.dataset.trainItem); return; }
    const editButton = event.target.closest('[data-edit-personal]');
    if (editButton) { editingPersonalId = editButton.dataset.editPersonal; render(); return; }
    const archiveButton = event.target.closest('[data-archive-personal]');
    if (archiveButton) {
      if (window.confirm('Archive this personal item? Its existing attempt history will remain.')) {
        const item = appState.personalItems.find((candidate) => candidate.id === archiveButton.dataset.archivePersonal);
        if (item) item.active = false;
        persist(); announce('Personal item archived. Its history was preserved.', 'success'); render();
      }
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === 'back-step') {
      const index = TRAINING_VIEW_STAGES.indexOf(trainingViewStage || (currentSession && currentSession.stage));
      if (currentSession && index > 0) { trainingViewStage = TRAINING_VIEW_STAGES[index - 1]; render(); }
      return;
    }
    if (action === 'return-to-current-step') {
      if (currentSession) { trainingViewStage = currentSession.stage; render(); }
      return;
    }
    if (action === 'start-training') startTraining();
    if (action === 'start-or-resume') currentSession ? nav('training') : startTraining();
    if (action === 'stop-training') stopTraining();
    if (action === 'next-item') startNextItem();
    if (action === 'complete-hunt') {
      try { currentSession = core.completeHunt(currentSession, actionButton.dataset.result, Date.now()); trainingViewStage = currentSession.stage; persist(); render(); } catch (error) { announce(error.message, 'error'); }
    }
    if (action === 'assessment') {
      currentSession.attempt.conceptSelfAssessment = actionButton.dataset.assessment;
      persist(); render();
    }
    if (action === 'to-diagnosis') { currentSession = core.transitionStage(currentSession, 'diagnosis'); trainingViewStage = currentSession.stage; persist(); render(); }
    if (action === 'cancel-edit') { editingPersonalId = null; render(); }
    if (action === 'export') exportBackup();
    if (action === 'confirm-import') confirmImport();
    if (action === 'cancel-import') { pendingImport = null; render(); }
    if (action === 'reset') resetProgress();
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (currentSession && view === 'training' && trainingViewStage !== currentSession.stage) return;
    if (event.target.id === 'recognition-form') handleRecognition(event.target);
    if (event.target.id === 'search-form') handleSearch(event.target);
    if (event.target.id === 'diagnosis-form') handleDiagnosis(event.target);
    if (event.target.id === 'personal-form') handlePersonal(event.target);
  }

  function handleInput(event) {
    if (!currentSession || view !== 'training' || trainingViewStage !== currentSession.stage) return;
    if (currentSession.stage === 'recognition' && event.target.id === 'concept-response') currentSession.attempt.conceptResponse = event.target.value;
    else if (currentSession.stage === 'searchPrediction' && event.target.id === 'search-phrase') currentSession.attempt.searchPhrase = event.target.value;
    else if (currentSession.stage === 'diagnosis' && event.target.id === 'optional-note') currentSession.attempt.optionalNote = event.target.value;
    else if (currentSession.stage === 'diagnosis' && event.target.id === 'successful-search-phrase') currentSession.attempt.successfulSearchPhrase = event.target.value;
    else return;
    persist();
  }

  function handleChange(event) {
    const preference = event.target.dataset.pref;
    if (preference) {
      updatePreference(preference, event.target.type === 'checkbox' ? event.target.checked : event.target.value);
      return;
    }
    if (event.target.id === 'import-file') handleImportFile(event.target.files[0]);
    if (event.target.name === 'failure-reason' && currentSession && currentSession.stage === 'diagnosis') {
      currentSession.attempt.failureReason = event.target.value;
      if (event.target.value !== 'searchLanguage') currentSession.attempt.successfulSearchPhrase = '';
      persist();
      render();
    }
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
    if (view !== 'training' || !currentSession) return;
    if (trainingViewStage !== currentSession.stage) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (editable) return;
    if (currentSession.stage === 'hunt' && event.key.toLowerCase() === 'f') { event.preventDefault(); currentSession = core.completeHunt(currentSession, 'found', Date.now()); trainingViewStage = currentSession.stage; persist(); render(); }
    if (currentSession.stage === 'hunt' && event.key.toLowerCase() === 'c') { event.preventDefault(); currentSession = core.completeHunt(currentSession, 'missed', Date.now()); trainingViewStage = currentSession.stage; persist(); render(); }
    if (currentSession.stage === 'complete' && event.key.toLowerCase() === 'n') { event.preventDefault(); startNextItem(); }
  });

  if (loadResult.error) announce(loadResult.error, 'error');
  if (!contentValidation.ok) announce('The built-in content is invalid. Fix the dataset before training.', 'error');
  render();

  window.PEWayfinderApp = { getState: () => appState, getCurrentSession: () => currentSession, render };
})();
