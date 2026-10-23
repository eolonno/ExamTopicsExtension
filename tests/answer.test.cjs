const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function setup() {
  const dom = new JSDOM(fs.readFileSync('src/answer.html', 'utf8'), {
    runScripts: 'outside-only', url: 'https://extension.test/answer.html?id=session'
  });
  let onMessage;
  let onDisconnect;
  const sent = [];
  dom.window.scrollTo = () => {};
  dom.window.chrome = { runtime: { connect: () => ({
    postMessage: message => sent.push(message),
    disconnect() {},
    onMessage: { addListener: fn => { onMessage = fn; } },
    onDisconnect: { addListener: fn => { onDisconnect = fn; } }
  }) } };
  dom.window.eval(fs.readFileSync('src/answer.js', 'utf8'));
  return { dom, document: dom.window.document, sent, emit: message => onMessage(message), disconnect: () => onDisconnect() };
}

test('answer window renders incremental text immediately, then reconciles final answer without duplication', () => {
  const app = setup();
  assert.equal(app.sent[0].type, 'start');
  app.emit({ type: 'language', language: 'Russian' });
  app.emit({ type: 'delta', text: 'Привет ' });
  assert.equal(app.document.getElementById('answer').textContent, 'Привет ');
  assert.equal(app.document.getElementById('answer').getAttribute('aria-busy'), 'true');
  app.emit({ type: 'delta', text: '<script>unsafe()</script>' });
  assert.equal(app.document.querySelector('#answer script'), null);
  app.emit({ type: 'done', answer: 'Привет! Готовый ответ.' });
  assert.equal(app.document.getElementById('answer').textContent, 'Привет! Готовый ответ.');
  assert.equal(app.document.getElementById('status').textContent, 'Complete');
  assert.equal(app.document.getElementById('stop').disabled, true);
  assert.equal(app.document.documentElement.lang, 'ru');
  app.dom.window.close();
});

test('stop cancels generation and keeps partial text', () => {
  const app = setup();
  app.emit({ type: 'delta', text: 'Partial answer' });
  app.document.getElementById('stop').click();
  assert.equal(app.sent.at(-1).type, 'cancel');
  assert.equal(app.document.getElementById('status').textContent, 'Stopped');
  app.emit({ type: 'delta', text: 'Too late' });
  assert.equal(app.document.getElementById('answer').textContent, 'Partial answer');
  app.dom.window.close();
});

test('disconnect or API error keeps partial text and reports the failure', () => {
  for (const disconnect of [false, true]) {
    const app = setup();
    app.emit({ type: 'delta', text: 'Partial answer' });
    if (disconnect) app.disconnect();
    else app.emit({ type: 'error', message: 'OpenAI failed' });
    assert.equal(app.document.getElementById('answer').textContent, 'Partial answer');
    assert.equal(app.document.getElementById('status').className, 'error');
    assert.equal(app.document.getElementById('stop').disabled, true);
    app.dom.window.close();
  }
});
