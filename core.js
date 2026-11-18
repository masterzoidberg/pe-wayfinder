(function (global) {
  'use strict';

  const APP_VERSION = '1.0.2';
  const CONTENT_VERSION = '2026.10.08-r2';
  const STORAGE_SCHEMA_VERSION = 1;
  const HANDBOOK_VERSION = '2.0';
  const EXAM_SPEC_VERSION = 'October 2025';
  const STORAGE_KEY = 'pe-wayfinder-state-v1';

  const EXAM_DOMAINS = [
    'Basic Engineering Practice',
    'Mechanics of Materials',
    'Mechanical Attachments',
    'Power Transmission',
    'Mechanical Components and Assemblies',
    'Supportive Knowledge (Machine Design and Materials)'
  ];

  // Soft curriculum emphasis derived from the supplied October 2025 exam ranges.
  // Midpoints are normalized to a relative weight; these are selection hints, not quotas.
  const DOMAIN_QUESTION_RANGES = [
    { domain: 'Basic Engineering Practice', minQuestions: 11, maxQuestions: 17 },
    { domain: 'Mechanics of Materials', minQuestions: 17, maxQuestions: 26 },
    { domain: 'Mechanical Attachments', minQuestions: 9, maxQuestions: 14 },
    { domain: 'Power Transmission', minQuestions: 9, maxQuestions: 14 },
    { domain: 'Mechanical Components and Assemblies', minQuestions: 16, maxQuestions: 24 },
    { domain: 'Supportive Knowledge (Machine Design and Materials)', minQuestions: 8, maxQuestions: 12 }
  ];
  const DOMAIN_MIDPOINT_TOTAL = DOMAIN_QUESTION_RANGES.reduce((total, range) => total + ((range.minQuestions + range.maxQuestions) / 2), 0);
  const DOMAIN_EMPHASIS = DOMAIN_QUESTION_RANGES.reduce((result, range) => {
    const midpoint = (range.minQuestions + range.maxQuestions) / 2;
    result[range.domain] = Object.freeze(Object.assign({}, range, { midpoint, weight: midpoint / DOMAIN_MIDPOINT_TOTAL }));
    return result;
  }, {});
  Object.freeze(DOMAIN_EMPHASIS);

  const TRAINING_PHASES = ['accuracy', 'strategy', 'speed', 'mixed'];
  const PHASE_CONFIG = Object.freeze({
    accuracy: Object.freeze({
      label: 'Accuracy',
      defaultShowTimer: false,
      description: 'Prioritizes unseen, missed, and foundational concepts while keeping hunt timing quiet.'
    }),
    strategy: Object.freeze({
      label: 'Strategy',
      defaultShowTimer: false,
      description: 'Prioritizes search-language, navigation, and transfer work so the first search gets sharper.'
    }),
    speed: Object.freeze({
      label: 'Speed',
      defaultShowTimer: true,
      description: 'Rehearses concepts you have retrieved successfully with the hunt timer visible by default.'
    }),
    mixed: Object.freeze({
      label: 'Mixed',
      defaultShowTimer: false,
      description: 'Mixes weak, successful, and transfer retrieval across the exam domains.'
    })
  });

  const SELECTOR_WEIGHTS = Object.freeze({
    unseen: 72,
    failure: 20,
    failureReason: 1,
    domainBaseline: 28,
    domainCoverage: 24,
    personal: 4,
    recentItemPenalty: 45,
    recentFamilyPenalty: 28,
    cleanRepeatPenalty: 16,
    successfulRetrieval: 22
  });

  const FAILURE_REASONS = [
    { id: 'concept', label: "Didn't recognize the concept", shortLabel: 'Concept recognition', weight: 8 },
    { id: 'searchLanguage', label: 'Knew the concept, searched the wrong wording', shortLabel: 'Search language', weight: 7 },
    { id: 'navigation', label: "Knew what to search, couldn't locate it", shortLabel: 'Navigation', weight: 6 },
    { id: 'referenceRecognition', label: "Found it, but didn't recognize what I needed", shortLabel: 'Reference recognition', weight: 6 },
    { id: 'speed', label: 'Knew it, but I was too slow', shortLabel: 'Speed', weight: 3 },
    { id: 'knowledgeGap', label: 'This was really a knowledge gap', shortLabel: 'Knowledge gap', weight: 9 },
    { id: 'noProblem', label: 'No problem', shortLabel: 'No problem', weight: 0 }
  ];

  const TRAINING_STAGES = ['idle', 'recognition', 'searchPrediction', 'hunt', 'feedback', 'diagnosis', 'complete'];
  const ALLOWED_TRANSITIONS = {
    idle: ['recognition'],
    recognition: ['searchPrediction'],
    searchPrediction: ['hunt'],
    hunt: ['feedback'],
    feedback: ['diagnosis'],
    diagnosis: ['complete'],
    complete: ['recognition']
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return prefix + '-' + global.crypto.randomUUID();
    }
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createDefaultState() {
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      contentVersion: CONTENT_VERSION,
      handbookVersion: HANDBOOK_VERSION,
      examSpecVersion: EXAM_SPEC_VERSION,
      attempts: [],
      personalItems: [],
      preferences: {
        phase: 'accuracy',
        showTimer: false,
        sessionLength: 10
      },
      incompleteSession: null
    };
  }

  function validateTrainingItems(items) {
    const errors = [];
    const ids = new Set();
    const allowedStatuses = new Set(['verified', 'needs_review', 'demo', 'personal']);
    const allowedSupportTypes = new Set(['strong/direct', 'partial', 'primarily prior knowledge', 'uncertain']);
    const required = ['id', 'contentStatus', 'sourceVerification', 'examDomain', 'examTopic', 'conceptFamily', 'prompt', 'targetConcept', 'supportType', 'preferredSearchTerms', 'recognitionClues', 'briefExplanation'];

    if (!Array.isArray(items)) {
      return { ok: false, errors: ['Training items must be an array.'] };
    }

    items.forEach((item, index) => {
      const path = 'item[' + index + ']';
      if (!isObject(item)) {
        errors.push(path + ' must be an object.');
        return;
      }
      required.forEach((field) => {
        if (item[field] === undefined || item[field] === null || (typeof item[field] === 'string' && !isNonEmptyString(item[field]))) {
          errors.push(path + '.' + field + ' is required.');
        }
      });
      if (!isNonEmptyString(item.id)) {
        errors.push(path + '.id must be a non-empty stable string.');
      } else if (ids.has(item.id)) {
        errors.push('Duplicate training item id: ' + item.id);
      } else {
        ids.add(item.id);
      }
      if (!allowedStatuses.has(item.contentStatus)) {
        errors.push(path + '.contentStatus is invalid: ' + item.contentStatus);
      }
      if (!isObject(item.sourceVerification) || !isNonEmptyString(item.sourceVerification.status)) {
        errors.push(path + '.sourceVerification.status is required.');
      }
      if (!allowedSupportTypes.has(item.supportType)) {
        errors.push(path + '.supportType is invalid: ' + item.supportType);
      }
      if (item.contentStatus !== 'personal' && !EXAM_DOMAINS.includes(item.examDomain)) {
        errors.push(path + '.examDomain is not in the October 2025 MDM specification: ' + item.examDomain);
      }
      if (!Array.isArray(item.preferredSearchTerms) || (item.preferredSearchTerms.length === 0 && item.supportType !== 'primarily prior knowledge')) {
        errors.push(path + '.preferredSearchTerms must contain at least one term unless support is primarily prior knowledge.');
      }
      if (!Array.isArray(item.recognitionClues) || item.recognitionClues.length === 0) {
        errors.push(path + '.recognitionClues must contain at least one clue.');
      }
      if (item.contentStatus === 'personal') {
        if (item.sourceVerification && item.sourceVerification.status !== 'personal') {
          errors.push(path + '.personal items must have sourceVerification.status=personal.');
        }
      } else {
        if (!['verified', 'needs_review', 'demo'].includes(item.sourceVerification && item.sourceVerification.status)) {
          errors.push(path + '.sourceVerification.status is invalid for built-in content.');
        }
        if (item.contentStatus === 'verified' && (!Array.isArray(item.sourceVerification.checkedAgainst) || !item.sourceVerification.checkedAgainst.includes('EXAM_SPEC_2025_10'))) {
          errors.push(path + '.verified items must declare exam-spec verification.');
        }
        if (item.sourceVerification && item.sourceVerification.status !== item.contentStatus) {
          errors.push(path + '.contentStatus and sourceVerification.status must agree.');
        }
        const hasHandbookLocation = item.handbookChapter || item.handbookSection || item.handbookSubsection;
        if (hasHandbookLocation && item.contentStatus === 'verified' && item.handbookVersion !== HANDBOOK_VERSION) {
          errors.push(path + '.verified handbook-specific items must declare handbookVersion=' + HANDBOOK_VERSION + '.');
        }
      }
    });

    errors.push(...validateTransferFamilies(items).errors);

    return { ok: errors.length === 0, errors };
  }

  function transferFamilyGroups(items) {
    const groups = new Map();
    const sourceItems = Array.isArray(items) ? items : [];
    sourceItems.forEach((item) => {
      if (!item || item.contentStatus === 'personal' || !isNonEmptyString(item.promptVariantGroup)) return;
      if (!groups.has(item.promptVariantGroup)) groups.set(item.promptVariantGroup, []);
      groups.get(item.promptVariantGroup).push(item);
    });
    return groups;
  }

  function validateTransferFamilies(items) {
    const errors = [];
    const groups = Array.from(transferFamilyGroups(items).entries()).map(([name, members]) => {
      const conceptFamilies = Array.from(new Set(members.map((item) => item.conceptFamily).filter(Boolean)));
      const valid = members.length < 2 || conceptFamilies.length === 1;
      if (!valid) {
        errors.push('Transfer family ' + name + ' mixes concept families: ' + conceptFamilies.join(', ') + '.');
      }
      return {
        name,
        variants: members.length,
        valid,
        conceptFamilies,
        items: members.map((item) => ({ id: item.id, targetConcept: item.targetConcept, conceptFamily: item.conceptFamily }))
      };
    });
    return { ok: errors.length === 0, errors, groups };
  }

  function validateAttemptShape(attempt) {
    const errors = [];
    if (!isObject(attempt)) return ['Attempt must be an object.'];
    ['id', 'trainingItemId', 'sessionId', 'startedAt', 'conceptResponse', 'searchPhrase', 'retrievalResult'].forEach((field) => {
      if (attempt[field] === undefined || attempt[field] === null) errors.push('Attempt.' + field + ' is required.');
    });
    if (attempt.completedAt !== null && attempt.completedAt !== undefined && !Number.isFinite(attempt.completedAt)) errors.push('Attempt.completedAt must be a timestamp or null.');
    if (attempt.successfulSearchPhrase !== undefined && attempt.successfulSearchPhrase !== null && typeof attempt.successfulSearchPhrase !== 'string') errors.push('Attempt.successfulSearchPhrase must be text when provided.');
    if (!['found', 'missed', 'interrupted'].includes(attempt.retrievalResult)) errors.push('Attempt.retrievalResult is invalid.');
    if (attempt.completedAt !== null && attempt.completedAt !== undefined && attempt.searchStartedAt !== null && attempt.searchStartedAt !== undefined) {
      const elapsed = attempt.completedAt - attempt.searchStartedAt;
      if (elapsed < 0) errors.push('Attempt timestamps are out of order.');
      if (attempt.elapsedMs !== undefined && attempt.elapsedMs !== elapsed) errors.push('Attempt.elapsedMs must be derived from timestamps.');
    }
    return errors;
  }

  function validatePersistedState(candidate) {
    const errors = [];
    if (!isObject(candidate)) return { ok: false, errors: ['Saved state must be an object.'] };
    if (candidate.schemaVersion !== STORAGE_SCHEMA_VERSION) errors.push('Saved state schema version is incompatible.');
    if (!Array.isArray(candidate.attempts)) errors.push('Saved attempts must be an array.');
    if (!Array.isArray(candidate.personalItems)) errors.push('Saved personalItems must be an array.');
    if (!isObject(candidate.preferences)) errors.push('Saved preferences must be an object.');
    if (Array.isArray(candidate.attempts)) candidate.attempts.forEach((attempt) => errors.push(...validateAttemptShape(attempt)));
    if (Array.isArray(candidate.personalItems)) {
      const result = validateTrainingItems(candidate.personalItems);
      errors.push(...result.errors);
    }
    return { ok: errors.length === 0, errors };
  }

  function isRecoverableSession(session) {
    return isObject(session) && TRAINING_STAGES.includes(session.stage) && session.stage !== 'idle' && isNonEmptyString(session.itemId) && isObject(session.attempt) && isNonEmptyString(session.attempt.id);
  }

  function safeLoadState(storage) {
    const fallback = createDefaultState();
    try {
      const serialized = storage.getItem(STORAGE_KEY);
      if (!serialized) return { state: fallback, error: null };
      const parsed = JSON.parse(serialized);
      const validation = validatePersistedState(parsed);
      if (!validation.ok) return { state: fallback, error: 'Saved progress could not be loaded safely: ' + validation.errors[0] };
      const repaired = Object.assign(fallback, parsed);
      if (repaired.incompleteSession !== null && !isRecoverableSession(repaired.incompleteSession)) {
        repaired.incompleteSession = null;
        return { state: repaired, error: 'An incomplete drill was discarded because its saved session data was malformed. Completed history was preserved.' };
      }
      return { state: repaired, error: null };
    } catch (error) {
      return { state: fallback, error: 'Saved progress could not be loaded safely. Storage may be unavailable.' };
    }
  }

  function saveState(storage, state) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: 'Progress could not be saved. Check browser storage permissions or available space.' };
    }
  }

  function createSession(item, preferences, now) {
    const startedAt = Number.isFinite(now) ? now : Date.now();
    return {
      sessionId: makeId('session'),
      sequence: 1,
      targetLength: Number(preferences && preferences.sessionLength) || 10,
      recentItemIds: [],
      stage: 'recognition',
      itemId: item.id,
      attempt: {
        id: makeId('attempt'),
        trainingItemId: item.id,
        sessionId: null,
        startedAt,
        searchStartedAt: null,
        completedAt: null,
        elapsedMs: null,
        conceptResponse: '',
        conceptSelfAssessment: null,
        searchPhrase: '',
        successfulSearchPhrase: '',
        retrievalResult: null,
        failureReason: null,
        optionalNote: '',
        trainingPhase: (preferences && preferences.phase) || 'accuracy',
        contentVersion: CONTENT_VERSION,
        handbookVersion: item.handbookVersion || null
      }
    };
  }

  function beginSession(item, preferences, now) {
    const session = createSession(item, preferences, now);
    session.attempt.sessionId = session.sessionId;
    return session;
  }

  function transitionStage(session, nextStage) {
    if (!session || !TRAINING_STAGES.includes(session.stage)) throw new Error('Unknown training stage.');
    if (!ALLOWED_TRANSITIONS[session.stage] || !ALLOWED_TRANSITIONS[session.stage].includes(nextStage)) {
      throw new Error('Invalid training transition: ' + session.stage + ' -> ' + nextStage);
    }
    return Object.assign({}, session, { stage: nextStage });
  }

  function setSearchStarted(session, searchPhrase, now) {
    if (!session || session.stage !== 'searchPrediction') throw new Error('Search can only be committed from the search prediction stage.');
    if (!isNonEmptyString(searchPhrase)) throw new Error('Search phrase is required.');
    const next = transitionStage(session, 'hunt');
    next.attempt = Object.assign({}, session.attempt, { searchPhrase, searchStartedAt: Number.isFinite(now) ? now : Date.now() });
    return next;
  }

  function completeHunt(session, retrievalResult, now) {
    if (!session) throw new Error('A hunt must be active before it can be completed.');
    if (session.attempt && session.attempt.completedAt) return session;
    if (session.stage !== 'hunt') throw new Error('A hunt must be active before it can be completed.');
    if (!['found', 'missed'].includes(retrievalResult)) throw new Error('Retrieval result is invalid.');
    const completedAt = Number.isFinite(now) ? now : Date.now();
    if (!session.attempt.searchStartedAt || completedAt < session.attempt.searchStartedAt) throw new Error('Hunt timestamps are invalid.');
    const next = transitionStage(session, 'feedback');
    next.attempt = Object.assign({}, session.attempt, {
      completedAt,
      elapsedMs: completedAt - session.attempt.searchStartedAt,
      retrievalResult
    });
    return next;
  }

  function recordDiagnosis(session, failureReason, optionalNote, conceptSelfAssessment, successfulSearchPhrase) {
    if (!session || session.stage !== 'feedback' && session.stage !== 'diagnosis') throw new Error('Diagnosis is only available after the handbook hunt.');
    if (!FAILURE_REASONS.some((reason) => reason.id === failureReason)) throw new Error('Failure reason is invalid.');
    const next = session.stage === 'feedback' ? transitionStage(session, 'diagnosis') : clone(session);
    next.attempt = Object.assign({}, session.attempt, {
      failureReason,
      optionalNote: optionalNote || '',
      conceptSelfAssessment: conceptSelfAssessment || null,
      successfulSearchPhrase: failureReason === 'searchLanguage' ? String(successfulSearchPhrase || '').trim() : ''
    });
    return next;
  }

  function finalizeAttempt(session) {
    if (!session || session.stage !== 'diagnosis') throw new Error('Diagnosis must be recorded before completion.');
    if (!session.attempt.completedAt || !session.attempt.retrievalResult) throw new Error('Attempt is not complete.');
    return transitionStage(session, 'complete');
  }

  function interruptAttempt(session, now) {
    if (!session || !session.attempt || session.stage === 'complete' || session.attempt.completedAt) return null;
    const completedAt = Number.isFinite(now) ? now : Date.now();
    const hasStartedHunt = Number.isFinite(session.attempt.searchStartedAt);
    return Object.assign({}, session.attempt, {
      id: makeId('attempt-interrupted'),
      completedAt,
      elapsedMs: hasStartedHunt ? Math.max(0, completedAt - session.attempt.searchStartedAt) : null,
      retrievalResult: 'interrupted',
      failureReason: null
    });
  }

  function validateBackup(backup, builtInItems) {
    const errors = [];
    if (!isObject(backup)) return { ok: false, errors: ['Backup must contain a JSON object.'] };
    if (backup.schemaVersion !== STORAGE_SCHEMA_VERSION) errors.push('Backup schema version is incompatible with this app.');
    ['appVersion', 'contentVersion', 'exportedAt'].forEach((field) => {
      if (!isNonEmptyString(backup[field])) errors.push('Backup.' + field + ' is required.');
    });
    if (!Array.isArray(backup.attempts)) errors.push('Backup.attempts must be an array.');
    if (!Array.isArray(backup.personalItems)) errors.push('Backup.personalItems must be an array.');
    if (!isObject(backup.preferences)) errors.push('Backup.preferences must be an object.');
    if (Array.isArray(backup.attempts)) backup.attempts.forEach((attempt) => errors.push(...validateAttemptShape(attempt)));
    if (Array.isArray(backup.personalItems)) {
      const personalValidation = validateTrainingItems(backup.personalItems);
      errors.push(...personalValidation.errors);
      const ids = new Set((builtInItems || []).map((item) => item.id));
      backup.personalItems.forEach((item) => {
        if (ids.has(item.id)) errors.push('Personal item id collides with built-in item: ' + item.id);
        ids.add(item.id);
      });
    }
    return { ok: errors.length === 0, errors };
  }

  function makeBackup(state, now) {
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      contentVersion: CONTENT_VERSION,
      handbookVersion: HANDBOOK_VERSION,
      examSpecVersion: EXAM_SPEC_VERSION,
      exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
      attempts: clone(state.attempts || []),
      personalItems: clone(state.personalItems || []),
      preferences: clone(state.preferences || createDefaultState().preferences)
    };
  }

  function buildPersonalItem(fields, now) {
    const timestamp = Number.isFinite(now) ? now : Date.now();
    const cue = String(fields.cue || '').trim();
    const targetConcept = String(fields.targetConcept || '').trim() || 'Concept to review';
    return {
      id: makeId('PERSONAL'), contentStatus: 'personal', active: true,
      sourceVerification: { status: 'personal', checkedAgainst: [], note: 'Created by the learner; not an NCEES-verified mapping.' },
      examDomain: 'Personal / not yet mapped', examTopic: 'Personal miss', conceptFamily: 'personal-miss', promptVariantGroup: 'personal-miss',
      prompt: cue, targetConcept, supportType: 'uncertain', handbookVersion: null, handbookChapter: null, handbookSection: null, handbookSubsection: null,
      handbookLocationLabel: String(fields.location || '').trim() || 'No location recorded',
      preferredSearchTerms: [String(fields.searched || '').trim() || 'Add a search phrase'],
      alternateSearchTerms: String(fields.eventual || '').trim() ? [String(fields.eventual).trim()] : [],
      poorOrTemptingSearchTerms: [], recognitionClues: ['Learner-created cue'],
      briefExplanation: String(fields.whyMissed || '').trim() || 'Review the learner note after the drill.',
      priorKnowledgeNote: String(fields.note || '').trim(), difficulty: 'personal', tags: ['personal'],
      createdAt: new Date(timestamp).toISOString(), updatedAt: new Date(timestamp).toISOString(),
      personalDetails: { searched: String(fields.searched || '').trim(), eventual: String(fields.eventual || '').trim(), whyMissed: String(fields.whyMissed || '').trim(), note: String(fields.note || '').trim() }
    };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  function getFailureReason(id) {
    return FAILURE_REASONS.find((reason) => reason.id === id) || FAILURE_REASONS[FAILURE_REASONS.length - 1];
  }

  function deriveProgress(items, attempts) {
    const completed = (attempts || []).filter((attempt) => attempt && attempt.completedAt && ['found', 'missed'].includes(attempt.retrievalResult));
    const itemById = new Map((items || []).map((item) => [item.id, item]));
    const failureCounts = Object.fromEntries(FAILURE_REASONS.map((reason) => [reason.id, 0]));
    const domainStats = new Map();
    const familyStats = new Map();
    completed.forEach((attempt) => {
      const item = itemById.get(attempt.trainingItemId);
      const failureReason = attempt.failureReason || (attempt.retrievalResult === 'found' ? 'noProblem' : 'navigation');
      if (failureCounts[failureReason] !== undefined) failureCounts[failureReason] += 1;
      const domain = item ? item.examDomain : 'Archived content';
      const family = item ? item.conceptFamily : 'Archived content';
      if (!domainStats.has(domain)) domainStats.set(domain, { name: domain, attempts: 0, misses: 0 });
      if (!familyStats.has(family)) familyStats.set(family, { name: family, attempts: 0, misses: 0, lastAttemptAt: 0 });
      domainStats.get(domain).attempts += 1;
      familyStats.get(family).attempts += 1;
      if (attempt.retrievalResult === 'missed' || !['noProblem'].includes(failureReason)) {
        domainStats.get(domain).misses += 1;
        familyStats.get(family).misses += 1;
      }
      familyStats.get(family).lastAttemptAt = Math.max(familyStats.get(family).lastAttemptAt, attempt.completedAt || 0);
    });
    const elapsed = completed.filter((attempt) => Number.isFinite(attempt.elapsedMs)).map((attempt) => attempt.elapsedMs);
    const areas = Array.from(familyStats.values()).map((area) => Object.assign(area, { primaryIssue: area.misses ? mostCommonFailure(completed, itemById, area.name) : 'No repeated issue' })).sort((a, b) => (b.misses - a.misses) || a.name.localeCompare(b.name));
    const transferFamilies = validateTransferFamilies(items).groups.filter((group) => group.valid && group.variants > 1).map((group) => {
      const familyItems = (items || []).filter((item) => item.promptVariantGroup === group.name);
      const familyAttempts = completed.filter((attempt) => familyItems.some((item) => item.id === attempt.trainingItemId));
      const successful = familyAttempts.filter((attempt) => attempt.retrievalResult === 'found' && attempt.failureReason !== 'concept' && attempt.failureReason !== 'knowledgeGap').length;
      return { name: group.name, variants: familyItems.length, variantsAttempted: new Set(familyAttempts.map((attempt) => attempt.trainingItemId)).size, attempts: familyAttempts.length, successful };
    });
    const searchLanguageLessons = completed.filter((attempt) => attempt.failureReason === 'searchLanguage' && isNonEmptyString(attempt.searchPhrase) && isNonEmptyString(attempt.successfulSearchPhrase))
      .slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 5)
      .map((attempt) => ({ initial: attempt.searchPhrase, successful: attempt.successfulSearchPhrase, completedAt: attempt.completedAt }));
    return {
      total: completed.length,
      retrievalSuccesses: completed.filter((attempt) => attempt.retrievalResult === 'found').length,
      retrievalMisses: completed.filter((attempt) => attempt.retrievalResult === 'missed').length,
      medianElapsedMs: median(elapsed),
      failureCounts,
      domains: Array.from(domainStats.values()).sort((a, b) => a.name.localeCompare(b.name)),
      areas,
      transferFamilies,
      searchLanguageLessons,
      recent: completed.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 8)
    };
  }

  function mostCommonFailure(attempts, itemById, family) {
    const counts = {};
    attempts.filter((attempt) => itemById.get(attempt.trainingItemId)?.conceptFamily === family).forEach((attempt) => {
      const id = attempt.failureReason || 'navigation';
      counts[id] = (counts[id] || 0) + 1;
    });
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return winner ? getFailureReason(winner[0]).shortLabel : 'Review strategy';
  }

  function selectNextItem(items, attempts, options) {
    const candidates = (items || []).filter((item) => item.active !== false);
    if (!candidates.length) return null;
    const opts = options || {};
    const excludedIds = new Set(opts.excludedIds || []);
    const completed = (attempts || []).filter((attempt) => attempt && attempt.completedAt && ['found', 'missed'].includes(attempt.retrievalResult)).slice().sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
    const phase = TRAINING_PHASES.includes(opts.phase) ? opts.phase : (TRAINING_PHASES.includes(opts.trainingPhase) ? opts.trainingPhase : 'accuracy');
    const itemById = new Map(candidates.map((item) => [item.id, item]));
    const lastFive = completed.slice(-5).map((attempt) => attempt.trainingItemId);
    const lastTwoFamilies = completed.slice(-2).map((attempt) => itemById.get(attempt.trainingItemId)?.conceptFamily).filter(Boolean);
    const stats = new Map();
    const domainCounts = {};
    completed.forEach((attempt) => {
      const item = itemById.get(attempt.trainingItemId);
      if (!item) return;
      if (!stats.has(item.id)) stats.set(item.id, { attempts: 0, failures: 0, successfulRetrievals: 0, last: 0, reasonScore: 0, reasons: {} });
      const stat = stats.get(item.id);
      stat.attempts += 1; stat.last = Math.max(stat.last, attempt.completedAt || 0);
      if (attempt.retrievalResult === 'missed' || ['concept', 'searchLanguage', 'navigation', 'referenceRecognition', 'speed', 'knowledgeGap'].includes(attempt.failureReason)) {
        stat.failures += 1; stat.reasonScore += getFailureReason(attempt.failureReason).weight;
      }
      if (attempt.failureReason) stat.reasons[attempt.failureReason] = (stat.reasons[attempt.failureReason] || 0) + 1;
      if (attempt.retrievalResult === 'found' && !['concept', 'knowledgeGap'].includes(attempt.failureReason)) stat.successfulRetrievals += 1;
      domainCounts[item.examDomain] = (domainCounts[item.examDomain] || 0) + 1;
    });
    const totalDomainAttempts = Object.values(domainCounts).reduce((total, count) => total + count, 0);
    const scored = candidates.map((item) => {
      const stat = stats.get(item.id) || { attempts: 0, failures: 0, successfulRetrievals: 0, last: 0, reasonScore: 0, reasons: {} };
      const domain = DOMAIN_EMPHASIS[item.examDomain];
      const observedShare = totalDomainAttempts ? (domainCounts[item.examDomain] || 0) / totalDomainAttempts : 0;
      const domainGap = domain ? domain.weight - observedShare : 0;
      const softCoverage = Math.max(-6, Math.min(6, domainGap * SELECTOR_WEIGHTS.domainCoverage));
      const unseenWeight = phase === 'speed' ? 24 : (phase === 'strategy' ? 62 : SELECTOR_WEIGHTS.unseen);
      let score = stat.attempts === 0 ? unseenWeight : 0;
      score += stat.failures * SELECTOR_WEIGHTS.failure + stat.reasonScore * SELECTOR_WEIGHTS.failureReason;
      score += domain ? domain.weight * SELECTOR_WEIGHTS.domainBaseline + softCoverage : 0;
      score += item.contentStatus === 'personal' ? SELECTOR_WEIGHTS.personal : 0;

      const isTransfer = Array.isArray(item.tags) && item.tags.includes('transfer');
      if (phase === 'accuracy') {
        score += item.difficulty === 'foundation' ? 14 : (item.difficulty === 'core' ? 4 : 0);
        score += (stat.reasons.searchLanguage || 0) * 3;
        if (isTransfer) score -= 10;
      }
      if (phase === 'strategy') {
        score += (stat.reasons.searchLanguage || 0) * 22;
        score += (stat.reasons.navigation || 0) * 18;
        score += (stat.reasons.referenceRecognition || 0) * 8;
        score += isTransfer ? 16 : 0;
        score += Array.isArray(item.alternateSearchTerms) && item.alternateSearchTerms.length ? 2 : 0;
      }
      if (phase === 'speed') {
        score += stat.successfulRetrievals * SELECTOR_WEIGHTS.successfulRetrieval;
        score -= (stat.reasons.knowledgeGap || 0) * 24;
        score -= (stat.reasons.concept || 0) * 12;
        score -= stat.failures * 6;
      }
      if (phase === 'mixed') {
        score += stat.successfulRetrievals * 6;
        score += isTransfer ? 14 : 0;
      }

      if (lastFive.includes(item.id)) score -= SELECTOR_WEIGHTS.recentItemPenalty;
      if (lastTwoFamilies.includes(item.conceptFamily)) score -= SELECTOR_WEIGHTS.recentFamilyPenalty;
      if (excludedIds.has(item.id)) score -= 1000;
      if (stat.attempts >= 2 && stat.failures === 0) score -= phase === 'speed' ? 4 : SELECTOR_WEIGHTS.cleanRepeatPenalty;
      if (stat.last) score += Math.min(12, Math.max(0, (Date.now() - stat.last) / 86400000));
      return { item, score };
    }).sort((a, b) => (b.score - a.score) || a.item.id.localeCompare(b.item.id));
    const usable = scored.find((entry) => !excludedIds.has(entry.item.id)) || scored[0];
    return usable ? usable.item : null;
  }

  global.PEWayfinderCore = {
    APP_VERSION, CONTENT_VERSION, STORAGE_SCHEMA_VERSION, HANDBOOK_VERSION, EXAM_SPEC_VERSION, STORAGE_KEY,
    EXAM_DOMAINS, DOMAIN_QUESTION_RANGES, DOMAIN_EMPHASIS, TRAINING_PHASES, PHASE_CONFIG, FAILURE_REASONS, TRAINING_STAGES,
    createDefaultState, validateTrainingItems, validateTransferFamilies, validateAttemptShape, validatePersistedState, safeLoadState, saveState,
    beginSession, transitionStage, setSearchStarted, completeHunt, recordDiagnosis, finalizeAttempt, interruptAttempt,
    validateBackup, makeBackup, buildPersonalItem, deriveProgress, selectNextItem, getFailureReason, median
  };
})(window);
