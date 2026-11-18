const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const window = {};
const context = { window, console, Date, Math, JSON };
vm.createContext(context);
vm.runInContext(fs.readFileSync('core.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('data/training-items.js', 'utf8'), context);

const core = window.PEWayfinderCore;
const items = window.PEWayfinderItems;
const assertThrows = (fn, text) => assert.throws(fn, new RegExp(text));

function fakeStorage(initial) {
  let value = initial || null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    raw: () => value
  };
}

assert.strictEqual(core.validateTrainingItems(items).ok, true, 'built-in content validates');
assert.strictEqual(items.length, 189, 'released corpus contains 185 survivors and four coverage additions');
const axialItem = items.find((item) => item.id === 'MDM-MECH-AXIAL-001-A');
assert.strictEqual(axialItem.prompt, 'A straight uniform bar is pulled along its centerline. The bar elongates without a transverse load or applied couple.', 'axial cue preserves its physical recognition cues');
assert.deepStrictEqual(Array.from(axialItem.preferredSearchTerms), ['uniaxial loading and deformation'], 'axial reveal shows only the verified learner-usable search phrase');
assert.ok(axialItem.handbookLocationLabel.includes('printed pp. 142–143'), 'axial location covers the complete usable section');
assert.strictEqual(core.validateTrainingItems(items.concat(items[0])).ok, false, 'duplicate IDs are rejected');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], prompt: undefined }]).ok, false, 'missing required fields are rejected');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], contentStatus: 'unknown' }]).ok, false, 'invalid source status is rejected');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], handbookVersion: '1.0' }]).ok, false, 'invalid handbook metadata is rejected');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], sourceVerification: { ...items[0].sourceVerification, status: 'needs_review' } }]).ok, false, 'verification status cannot disagree with content status');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], supportType: 'primarily prior knowledge', preferredSearchTerms: [] }]).ok, true, 'a genuine knowledge boundary does not require a fabricated search phrase');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], supportType: 'partial', preferredSearchTerms: [] }]).ok, false, 'partial retrieval support still requires a useful route');
assert.strictEqual(core.validateTrainingItems([{ ...items[0], supportType: 'primarily prior knowledge', preferredSearchTerms: 'probe' }]).ok, false, 'knowledge boundaries preserve the search-array type');

const transferReport = core.validateTransferFamilies(items);
assert.strictEqual(transferReport.ok, true, 'transfer-family composition validates');
assert.strictEqual(transferReport.groups.find((group) => group.name === 'mec-buck').variants, 3, 'buckling variants remain grouped');
assert.strictEqual(transferReport.groups.find((group) => group.name === 'pwr-gear-simple-trains').variants, 3, 'simple gear variants remain grouped');
assert.strictEqual(transferReport.groups.find((group) => group.name === 'mec-fat').variants, 3, 'fatigue variants are grouped');
assert.strictEqual(transferReport.groups.some((group) => group.name === 'attachment-types'), false, 'attachment categories are not one transfer family');
const invalidTransferItems = items.filter((item) => ['MDM-ATTACH-WELD-001-A', 'MDM-ATTACH-BOLT-001-A'].includes(item.id)).map((item) => ({ ...item, promptVariantGroup: 'invalid-attachment-transfer' }));
assert.strictEqual(core.validateTransferFamilies(invalidTransferItems).ok, false, 'mixed attachment concepts are rejected as a transfer family');

const storage = fakeStorage();
const initial = core.safeLoadState(storage);
assert.strictEqual(initial.error, null, 'empty storage loads without error');
const storageFailure = core.saveState({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, initial.state);
assert.strictEqual(storageFailure.ok, false, 'storage errors are surfaced');
const session = core.beginSession(items[0], initial.state.preferences, 1000);
assert.strictEqual(session.stage, 'recognition', 'training starts at recognition');
assertThrows(() => core.completeHunt(session, 'found', 1200), 'hunt must be active');

let working = core.transitionStage(session, 'searchPrediction');
working.attempt.conceptResponse = 'my concept';
working = core.setSearchStarted(working, 'geometric tolerancing', 2000);
assert.strictEqual(working.stage, 'hunt', 'search prediction advances to hunt');
assert.strictEqual(working.attempt.searchStartedAt, 2000, 'hunt timer starts at search commit');
working = core.completeHunt(working, 'found', 5700);
assert.strictEqual(working.attempt.elapsedMs, 3700, 'elapsed time is derived from timestamps');
const sameAfterDoubleClick = core.completeHunt(working, 'found', 10000);
assert.strictEqual(sameAfterDoubleClick.attempt.completedAt, 5700, 'double completion is idempotent');
working = core.transitionStage(working, 'diagnosis');
working = core.recordDiagnosis(working, 'noProblem', '', 'correct');
working = core.finalizeAttempt(working);
assert.strictEqual(working.stage, 'complete', 'diagnosis completes the attempt');
assertThrows(() => core.finalizeAttempt(working), 'Diagnosis must be recorded');

const searchLessonSession = core.beginSession(items[0], initial.state.preferences, 1000);
let searchLesson = core.transitionStage(searchLessonSession, 'searchPrediction');
searchLesson = core.setSearchStarted(searchLesson, 'shaft failure', 2000);
searchLesson = core.completeHunt(searchLesson, 'missed', 3000);
searchLesson = core.transitionStage(searchLesson, 'diagnosis');
searchLesson = core.recordDiagnosis(searchLesson, 'searchLanguage', '', null, 'failure theories');
assert.strictEqual(searchLesson.attempt.searchPhrase, 'shaft failure', 'initial search phrase remains preserved');
assert.strictEqual(searchLesson.attempt.successfulSearchPhrase, 'failure theories', 'successful search phrase is stored');
const searchProgress = core.deriveProgress(items, [searchLesson.attempt]);
assert.deepStrictEqual(searchProgress.searchLanguageLessons[0].initial, 'shaft failure', 'search-language history preserves the initial phrase');
assert.deepStrictEqual(searchProgress.searchLanguageLessons[0].successful, 'failure theories', 'search-language history exposes the replacement phrase');
const olderAttempt = { ...searchLesson.attempt };
delete olderAttempt.successfulSearchPhrase;
assert.strictEqual(core.makeBackup({ ...initial.state, attempts: [searchLesson.attempt] }, 7000).attempts[0].successfulSearchPhrase, 'failure theories', 'backup export preserves the optional search transition');
const olderBackup = core.makeBackup({ ...initial.state, attempts: [olderAttempt] }, 7000);
assert.strictEqual(core.validateBackup(olderBackup, items).ok, true, 'backups from before the optional field remain valid');
assert.strictEqual(core.safeLoadState(fakeStorage(JSON.stringify({ ...initial.state, attempts: [olderAttempt] }))).state.attempts.length, 1, 'saved state without the optional field loads without migration');
const nonSearchLesson = core.recordDiagnosis(searchLesson, 'concept', '', null, 'should not persist');
assert.strictEqual(nonSearchLesson.attempt.successfulSearchPhrase, '', 'successful search is optional and scoped to search-language diagnosis');

const interruptedSession = core.beginSession(items[1], initial.state.preferences, 1000);
const interruptedAttempt = core.interruptAttempt(interruptedSession, 1800);
assert.strictEqual(interruptedAttempt.retrievalResult, 'interrupted', 'abandoned drills remain distinguishable');
assert.strictEqual(interruptedAttempt.completedAt, 1800, 'interrupted drills get a completion timestamp');
assert.strictEqual(interruptedAttempt.elapsedMs, null, 'interrupted pre-hunt drills have no hunt time');

const completed = [working.attempt];
const backupState = { ...initial.state, attempts: completed };
const backup = core.makeBackup(backupState, 7000);
assert.strictEqual(core.validateBackup(backup, items).ok, true, 'exported backup validates');
assert.strictEqual(core.validateBackup({ ...backup, attempts: 'bad' }, items).ok, false, 'malformed backup is rejected');
assert.strictEqual(core.validateBackup({ ...backup, schemaVersion: 99 }, items).ok, false, 'incompatible backup is rejected');

const corrupt = fakeStorage('{not json');
const safe = core.safeLoadState(corrupt);
assert.ok(safe.error, 'corrupted saved state returns a warning');
assert.strictEqual(safe.state.attempts.length, 0, 'corrupted saved state falls back safely');
const malformedSessionStorage = fakeStorage(JSON.stringify({ ...initial.state, incompleteSession: { stage: 'hunt', attempt: null } }));
const repairedSession = core.safeLoadState(malformedSessionStorage);
assert.strictEqual(repairedSession.state.incompleteSession, null, 'malformed incomplete sessions are repaired safely');
assert.strictEqual(repairedSession.state.attempts.length, 0, 'repair preserves valid attempt history');

const allSeen = items.map((item, index) => ({
  id: 'attempt-' + index, trainingItemId: item.id, sessionId: 's', startedAt: 1,
  searchStartedAt: 2, completedAt: 3, elapsedMs: 1, conceptResponse: '', conceptSelfAssessment: null,
  searchPhrase: '', retrievalResult: index === 0 ? 'missed' : 'found', failureReason: index === 0 ? 'searchLanguage' : 'noProblem'
}));
const nextAfterFailure = core.selectNextItem(items, allSeen, { excludedIds: [] });
assert.strictEqual(nextAfterFailure.id, items[0].id, 'a repeated failure is resurfaced after exposure');
const noImmediate = core.selectNextItem(items, allSeen, { excludedIds: [items[0].id] });
assert.notStrictEqual(noImmediate.id, items[0].id, 'selector avoids an explicitly excluded item');

const phaseItems = [
  { ...items[0], id: 'PHASE-FOUNDATION', examDomain: 'Mechanics of Materials', conceptFamily: 'phase-foundation', promptVariantGroup: 'phase-foundation', difficulty: 'foundation', tags: [] },
  { ...items[1], id: 'PHASE-SEARCH', examDomain: 'Mechanics of Materials', conceptFamily: 'phase-search', promptVariantGroup: 'phase-search', difficulty: 'core', tags: [] },
  { ...items[2], id: 'PHASE-TRANSFER', examDomain: 'Mechanics of Materials', conceptFamily: 'phase-transfer', promptVariantGroup: 'phase-transfer', difficulty: 'core', tags: ['transfer'] }
];
const phaseAttempt = (item, id, completedAt, result, reason) => ({ id, trainingItemId: item.id, sessionId: 'phase-session', startedAt: 1, searchStartedAt: 2, completedAt, elapsedMs: 1, conceptResponse: 'concept', searchPhrase: 'term', retrievalResult: result, failureReason: reason });
const accuracyVsSpeedHistory = [
  phaseAttempt(phaseItems[0], 'phase-a', 1, 'found', 'noProblem'),
  phaseAttempt(phaseItems[1], 'phase-b', 2, 'missed', 'knowledgeGap'),
  phaseAttempt(phaseItems[2], 'phase-transfer-history', 2.5, 'found', 'noProblem'),
  { ...phaseAttempt(items[29], 'phase-unrelated', 3, 'found', 'noProblem'), trainingItemId: 'not-a-candidate' },
  { ...phaseAttempt(items[28], 'phase-unrelated-2', 4, 'found', 'noProblem'), trainingItemId: 'not-a-candidate-2' }
];
assert.notStrictEqual(core.selectNextItem(phaseItems, accuracyVsSpeedHistory, { phase: 'accuracy' }).id, core.selectNextItem(phaseItems, accuracyVsSpeedHistory, { phase: 'speed' }).id, 'Accuracy and Speed select differently');
const strategyHistory = [phaseAttempt(phaseItems[1], 'strategy-a', 1, 'missed', 'searchLanguage'), phaseAttempt(phaseItems[0], 'strategy-b', 2, 'missed', 'navigation')];
assert.strictEqual(core.selectNextItem(phaseItems.slice(0, 2), strategyHistory, { phase: 'strategy' }).id, 'PHASE-SEARCH', 'Strategy prioritizes search-language failures');
assert.strictEqual(core.selectNextItem(phaseItems, [], { phase: 'mixed' }).id, 'PHASE-TRANSFER', 'Mixed gives transfer variants meaningful exposure');

const highDomain = { ...items[3], id: 'DOMAIN-HIGH', examDomain: 'Mechanics of Materials', conceptFamily: 'domain-high', promptVariantGroup: 'domain-high' };
const lowDomain = { ...items[28], id: 'DOMAIN-LOW', examDomain: 'Supportive Knowledge (Machine Design and Materials)', conceptFamily: 'domain-low', promptVariantGroup: 'domain-low' };
const domainBaselineHistory = [phaseAttempt(highDomain, 'domain-a', 1, 'found', 'noProblem'), phaseAttempt(lowDomain, 'domain-b', 2, 'found', 'noProblem')];
assert.strictEqual(core.selectNextItem([highDomain, lowDomain], domainBaselineHistory, { phase: 'mixed' }).id, 'DOMAIN-HIGH', 'baseline exposure follows configured official-spec emphasis');
const weakLowerDomainHistory = domainBaselineHistory.concat([phaseAttempt(lowDomain, 'domain-c', 3, 'missed', 'searchLanguage'), phaseAttempt(lowDomain, 'domain-d', 4, 'missed', 'searchLanguage')]);
assert.strictEqual(core.selectNextItem([highDomain, lowDomain], weakLowerDomainHistory, { phase: 'mixed' }).id, 'DOMAIN-LOW', 'weakness overrides baseline domain emphasis');

const personal = core.buildPersonalItem({ cue: 'A short personal cue', searched: 'wrong term' }, 9000);
assert.strictEqual(personal.contentStatus, 'personal', 'personal content remains distinct');
assert.strictEqual(personal.sourceVerification.status, 'personal', 'personal content never receives built-in verification');
assert.strictEqual(core.validateTrainingItems([personal]).ok, true, 'personal content uses the shared item shape');
const secondPersonal = core.buildPersonalItem({ cue: 'Another personal cue', searched: 'another term' }, 9001);
assert.strictEqual(core.deriveProgress([personal, secondPersonal], []).transferFamilies.length, 0, 'personal items never become transfer families');

const summary = core.deriveProgress(items, completed);
assert.strictEqual(summary.total, 1, 'progress is derived from attempt history');
assert.strictEqual(summary.retrievalSuccesses, 1, 'found result is counted');

console.log('PE Wayfinder core tests passed.');
