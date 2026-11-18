const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the actual registered handler with browser/state collaborators isolated.
const source = fs.readFileSync(process.argv[2] || 'app.js', 'utf8');
const start = source.indexOf("document.addEventListener('keydown',");
const end = source.indexOf('\n  });', start);
assert(start >= 0 && end > start, 'Keyboard handler registration is present');
let handler;
const context = {
  document: { activeElement: { tagName: 'MAIN' }, addEventListener: (_type, callback) => { handler = callback; } },
  view: 'training', currentSession: { stage: 'hunt' }, trainingViewStage: 'hunt',
  core: { completeHunt: (_session, result) => ({ stage: 'feedback', result }) },
  persist: () => {}, render: () => {}, startNextItem: () => { context.nextItems++; }, nextItems: 0,
};
vm.runInNewContext(source.slice(start, end + '\n  });'.length), context);
function press(key, extra = {}) {
  const event = { key, preventDefault() { this.prevented = true; }, ...extra };
  handler(event);
  return event;
}
for (const key of ['f', 'c', 'n']) {
  context.currentSession = { stage: key === 'n' ? 'complete' : 'hunt' };
  context.trainingViewStage = context.currentSession.stage;
  for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented']) {
    const before = context.currentSession;
    const nextBefore = context.nextItems;
    const event = press(key, { [flag]: true });
    assert.equal(context.currentSession, before, `${flag}+${key} must preserve the drill`);
    assert.equal(context.nextItems, nextBefore, `${flag}+${key} must not advance`);
    assert(!event.prevented, `${flag}+${key} must retain native handling`);
  }
}
for (const [key, result] of [['f', 'found'], ['c', 'missed']]) {
  context.currentSession = { stage: 'hunt' };
  context.trainingViewStage = 'hunt';
  assert(press(key).prevented);
  assert.equal(context.currentSession.result, result);
}
context.currentSession = { stage: 'complete' };
context.trainingViewStage = 'complete';
assert(press('n').prevented);
assert.equal(context.nextItems, 1);
for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
  context.document.activeElement = { tagName };
  context.currentSession = { stage: 'hunt' };
  context.trainingViewStage = 'hunt';
  const before = context.currentSession;
  assert(!press('f').prevented);
  assert.equal(context.currentSession, before);
}
console.log('Keyboard shortcut checks passed: native modifiers, repeat/composition and plain drill shortcuts.');
