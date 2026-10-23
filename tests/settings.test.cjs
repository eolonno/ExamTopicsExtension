const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('shared settings save, replace and remove key without displaying saved credentials', async () => {
  const dom = new JSDOM(fs.readFileSync('src/settings.html', 'utf8'), { runScripts: 'outside-only' });
  const { window: w } = dom;
  let key = 'saved-secret';
  w.chrome = { storage: { local: {
    get: async () => ({ openaiApiKey: key }),
    set: async value => { key = value.openaiApiKey; },
    remove: async () => { key = undefined; }
  }, onChanged: { addListener() {} } } };
  w.eval(fs.readFileSync('src/settings.js', 'utf8'));
  await tick();
  const input = w.document.getElementById('openai-api-key');
  assert.equal(input.value, '');
  assert(!w.document.body.innerHTML.includes('saved-secret'));
  input.value = 'replacement-key';
  w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(key, 'replacement-key');
  assert.equal(input.value, '');
  w.document.getElementById('remove-key').click();
  await tick();
  assert.equal(key, undefined);
  assert.match(w.document.getElementById('settings-status').textContent, /removed/);
  dom.window.close();
});

test('on-page settings are always available and use extension-origin iframe', async () => {
  const dom = new JSDOM('<div id="panel-body"></div>', { runScripts: 'outside-only' });
  const { window: w } = dom;
  let configured = false;
  const listeners = [];
  w.extensionApi = { runtime: {
    getURL: path => `chrome-extension://test/${path}`,
    sendMessage: async () => ({ configured }),
    onMessage: { addListener: fn => listeners.push(fn) }
  } };
  w.getActivePanel = () => w.document;
  w.eval(fs.readFileSync('src/ai-content.js', 'utf8'));
  await tick();
  assert.equal(w.document.querySelector('summary').textContent, 'Settings');
  assert.equal(w.document.querySelector('iframe').src, 'chrome-extension://test/src/settings.html');
  assert.equal(w.document.querySelector('.etn-ai-section').hidden, true);
  assert.equal(w.document.querySelector('input[type=password]'), null);
  configured = true;
  listeners[0]({ action: 'refreshAiSettings' }, {}, () => {});
  await tick();
  assert.equal(w.document.querySelector('.etn-ai-section').hidden, false);
  configured = false;
  listeners[0]({ action: 'refreshAiSettings' }, {}, () => {});
  await tick();
  assert.equal(w.document.querySelector('.etn-ai-section').hidden, true);
  assert(w.document.querySelector('.etn-ai-settings'));
  dom.window.close();
});

test('language can be saved without replacing an existing API key', async () => {
  const dom = new JSDOM(fs.readFileSync('src/settings.html', 'utf8'), { runScripts: 'outside-only' });
  const { window: w } = dom;
  const saved = { openaiApiKey: 'existing-secret', answerLanguage: 'english' };
  w.chrome = { storage: { local: {
    get: async () => saved,
    set: async value => { Object.assign(saved, value); }
  }, onChanged: { addListener() {} } } };
  w.eval(fs.readFileSync('src/settings.js', 'utf8'));
  await tick();
  const language = w.document.getElementById('answer-language');
  assert.equal(language.value, 'english');
  language.value = 'russian';
  w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(saved.answerLanguage, 'russian');
  assert.equal(saved.openaiApiKey, 'existing-secret');
  assert.equal(language.value, 'russian');
  dom.window.close();
});

test('Ask ChatGPT sends only extracted question parts and opens a separate answer window', async () => {
  const html = fs.readFileSync('tests/fixtures/discussion.html', 'utf8') + '<div id="panel-body"></div>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://www.examtopics.com/discussions/test/' });
  const { window: w } = dom;
  const requests = [];
  w.extensionApi = { runtime: {
    getURL: path => `chrome-extension://test/${path}`,
    sendMessage: async request => {
      requests.push(request);
      return request.action === 'getAiSettings' ? { configured: true } : { opened: true };
    },
    onMessage: { addListener() {} }
  } };
  w.getActivePanel = () => w.document;
  w.setPanelState = () => {};
  w.eval(fs.readFileSync('src/question.js', 'utf8'));
  w.eval(fs.readFileSync('src/ai-content.js', 'utf8'));
  await tick();
  w.document.querySelector('.etn-ai-section button').click();
  await tick();
  const request = requests.find(item => item.action === 'askChatGPT');
  assert(request);
  assert(!JSON.stringify(request.page).includes('UNRELATED'));
  assert(!JSON.stringify(request.page).includes('Show Suggested Answer'));
  assert.match(request.page.content[0].text, /99\.99 percent/);
  assert.equal(w.document.querySelector('.etn-ai-answer'), null);
  assert.equal(request.mode, 'answer-only');
  assert.equal(w.document.querySelector('.etn-ai-section').textContent, 'Answer onlyAsk ChatGPT');
  w.document.querySelector('.etn-ai-detailed').click();
  await tick();
  assert.equal(requests.filter(item => item.action === 'askChatGPT').at(-1).mode, 'detailed');
  dom.window.close();
});
