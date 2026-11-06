const test = require('node:test');
const assert = require('node:assert');
const R = require('../sketch/ransom-logic.js');

test('tokenize keeps contractions, drops punctuation, splits dashes', () => {
  assert.deepStrictEqual(R.tokenize("I'm nobody! Who — are-you?").map((t) => t.word),
    ["I'm", 'nobody', 'Who', 'are', 'you']);
});
test('tokenize handles curly apostrophes and non-English letters', () => {
  assert.strictEqual(R.tokenize('don’t 花 café')[0].key, "don't");
  assert.deepStrictEqual(R.tokenize('don’t 花 café').map((t) => t.word).slice(1), ['花', 'café']);
});
test('a word outside the text is refused and reported', () => {
  const t = R.tokenize('hope is the thing');
  assert.deepStrictEqual(R.matchReply(['hope', 'never', 'is'], t, []), { picks: [0, 1], smuggled: ['never'] });
});
test('matching ignores case', () => {
  assert.deepStrictEqual(R.matchReply(['HOPE'], R.tokenize('Hope'), []).picks, [0]);
});
test('inflecting a word does not get it through', () => {
  assert.deepStrictEqual(R.matchReply(['running'], R.tokenize('run'), []).smuggled, ['running']);
});
test('a word can only be cut as many times as it appears', () => {
  assert.deepStrictEqual(R.matchReply(['a', 'a', 'a'], R.tokenize('a b a'), []), { picks: [0, 2], smuggled: ['a'] });
});
test('a word cut in an earlier reply is gone', () => {
  assert.deepStrictEqual(R.matchReply(['a'], R.tokenize('a b'), [true]), { picks: [], smuggled: ['a'] });
});
test('the prompt lists only uncut words, with counts', () => {
  const p = R.buildPrompt('why?', R.tokenize('a a b c'), [false, false, true, false]);
  assert.match(p, /WORD BANK: a x2, c\n/);
});
test('the retry prompt names the refused words', () => {
  assert.match(R.buildPrompt('q', R.tokenize('a'), [], ['ghost']), /not in the bank: ghost/);
});
test('parseReply splits an item holding two words', () => {
  const r = { candidates: [{ content: { parts: [{ text: '{"words":["hope is","the"]}' }] } }] };
  assert.deepStrictEqual(R.parseReply(r), ['hope', 'is', 'the']);
});
test('parseReply names the finish reason when empty', () => {
  assert.throws(() => R.parseReply({ candidates: [{ finishReason: 'SAFETY' }] }), /SAFETY/);
});
test('text past the cap is ignored', () => {
  assert.ok(R.tokenize('a '.repeat(R.MAX_CHARS)).length <= R.MAX_CHARS / 2);
});
