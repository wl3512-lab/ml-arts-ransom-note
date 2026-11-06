// Ransom Note: the rule, with no drawing and no network, so it can be tested in node.
// A word is a scrap of paper: once it is cut from the page it is gone.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RansomLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  const MAX_CHARS = 6000;
  const MAX_REPLY_WORDS = 24;

  const normalize = (w) => String(w).toLowerCase().replace(/’/g, "'");

  function tokenize(text) {
    return (String(text).slice(0, MAX_CHARS).match(WORD) || []).map((word, index) => ({
      index, word, key: normalize(word),
    }));
  }

  // How many uncut copies of each word are left on the page.
  function remainingCounts(tokens, used) {
    const counts = new Map();
    tokens.forEach((t, i) => {
      if (!used[i]) counts.set(t.key, (counts.get(t.key) || 0) + 1);
    });
    return counts;
  }

  function buildPrompt(question, tokens, used, rejected) {
    const inventory = [...remainingCounts(tokens, used)]
      .map(([w, n]) => (n > 1 ? `${w} x${n}` : w)).join(', ');
    const lines = [
      'You are composing a ransom note. You own no words of your own.',
      'You may ONLY use words from the WORD BANK below, each at most as many times as its count.',
      'Never invent, inflect, or change a word: "run" does not give you "running". No other words at all.',
      `Answer the QUESTION in at most ${MAX_REPLY_WORDS} words, in reading order. Broken grammar is fine if it still means something.`,
      'If the bank cannot answer, say the closest thing it can.',
      '',
      `WORD BANK: ${inventory}`,
      '',
      `QUESTION: ${question}`,
    ];
    if (rejected && rejected.length) {
      lines.push('', `Your last try used words that are not in the bank: ${rejected.join(', ')}. Do not use them.`);
    }
    return lines.join('\n');
  }

  function requestBody(prompt) {
    return {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { words: { type: 'ARRAY', items: { type: 'STRING' } } },
          required: ['words'],
        },
      },
    };
  }

  // Pull the word list out of a Gemini response. Throws if there is none.
  function parseReply(response) {
    const parts = response && response.candidates && response.candidates[0]
      && response.candidates[0].content && response.candidates[0].content.parts;
    const text = (parts || []).map((p) => p.text || '').join('');
    const reason = response && response.candidates && response.candidates[0]
      && response.candidates[0].finishReason;
    if (!text) throw new Error(reason ? `Gemini returned nothing (${reason}).` : 'Gemini returned nothing.');
    const data = JSON.parse(text);
    if (!Array.isArray(data.words)) throw new Error('Gemini reply had no word list.');
    // A model may hand back "two words" as one item, so split them apart here.
    return data.words.flatMap((w) => String(w).match(WORD) || []).slice(0, MAX_REPLY_WORDS * 2);
  }

  // The enforcement. The model is never trusted: each word must claim a real uncut token.
  function matchReply(words, tokens, used) {
    const taken = new Set();
    const picks = [];
    const smuggled = [];
    for (const word of words) {
      const key = normalize(word);
      const i = tokens.findIndex((t, n) => t.key === key && !used[n] && !taken.has(n));
      if (i === -1) smuggled.push(word);
      else { taken.add(i); picks.push(i); }
    }
    return { picks, smuggled };
  }

  return { MAX_CHARS, MAX_REPLY_WORDS, normalize, tokenize, remainingCounts, buildPrompt, requestBody, parseReply, matchReply };
});
