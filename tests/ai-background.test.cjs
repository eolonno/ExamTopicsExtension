const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup({ key = 'test-key', language = 'english', status = 200, result, fetchError } = {}) {
  const listeners = [];
  const calls = [];
  const connections = [];
  const windows = [];
  let removed;
  const apiUrl = path => `chrome-extension://extension/${path}`;
  const api = {
    runtime: { id: 'extension', getURL: apiUrl, onMessage: { addListener: fn => listeners.push(fn) }, onConnect: { addListener: fn => connections.push(fn) } },
    windows: { create: async options => { windows.push(options); return { id: 10 }; }, onRemoved: { addListener: fn => { removed = fn; } } },
    storage: {
      local: { get: async () => ({ openaiApiKey: key, answerLanguage: language }), setAccessLevel: async () => {} },
      onChanged: { addListener() {} }
    }
  };
  const context = {
    chrome: api, URL, crypto: require('node:crypto').webcrypto, AbortController, TextDecoder, setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout, setInterval, clearInterval, console,
    fetch: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (fetchError) throw fetchError;
      const output = result || {
        status: 'completed', output: [
          { type: 'reasoning', content: [] },
          { type: 'message', content: [{ type: 'output_text', text: 'Detailed answer' }] }
        ]
      };
      const event = 'data: {"type":"response.output_text.delta","delta":"Detailed "}\n\n' + `data: ${JSON.stringify({ type: output.status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: output })}\n\n`;
      const chunks = [event.slice(0, 17), event.slice(17)];
      return { ok: status === 200, status, body: { getReader: () => ({
        read: async () => chunks.length ? { value: new TextEncoder().encode(chunks.shift()), done: false } : { done: true },
        cancel: async () => {}, releaseLock() {}
      }) } };
    }
  };
  vm.runInNewContext(readFileSync('src/background.js', 'utf8'), context);
  return {
    calls, windows, connections, removeWindow: () => removed(10), context,
    ask: (question, options) => context.askChatGPT(question, options),
    message: (request, sender = { id: 'extension', tab: { id: 1 }, url: 'https://www.examtopics.com/discussions/test/' }) =>
      new Promise(resolve => {
        const handled = listeners[0](request, sender, resolve);
        if (!handled) resolve(undefined);
      })
  };
}

const page = { content: [{ type: 'text', text: 'Question A: select the correct option.' }], language: 'ru' };

test('settings expose availability without the key', async () => {
  assert.equal((await setup().message({ action: 'getAiSettings' })).configured, true);
  assert.equal((await setup({ key: '' }).message({ action: 'getAiSettings' })).configured, false);
});

test('request authenticates only to OpenAI and combines text output after reasoning', async () => {
  const app = setup();
  const response = await app.ask(page);
  assert.equal(response.answer, 'Detailed answer');
  assert.equal(app.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(app.calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(app.calls[0].body.store, false);
  assert.equal(app.calls[0].body.stream, true);
  assert.match(app.calls[0].body.instructions, /Answer in English\.$/);
  assert.equal(app.calls[0].body.input[0].content[0].type, 'input_text');
  assert.ok(!JSON.stringify(response).includes('test-key'));
});

test('missing key and empty content do not call the API', async () => {
  for (const [app, content] of [[setup({ key: '' }), page], [setup(), { content: [] }]]) {
    await assert.rejects(() => app.ask(content));
    assert.equal(app.calls.length, 0);
  }
});

test('rejects pages outside ExamTopics and messages from other extensions', async () => {
  const app = setup();
  const response = await app.message({ action: 'askChatGPT', page }, {
    id: 'extension', tab: { id: 1 }, url: 'https://examtopics.com.evil.test/'
  });
  assert.match(response.error, /only available/);
  assert.equal(await app.message({ action: 'askChatGPT', page }, { id: 'other' }), undefined);
  assert.equal(app.calls.length, 0);
});

test('large questions are rejected rather than truncated', async () => {
  const app = setup();
  await assert.rejects(() => app.ask({ content: [{ type: 'text', text: 'x'.repeat(70000) }] }), /too large/);
  assert.equal(app.calls.length, 0);
});

test('images are multimodal inputs, preserving their position in the question', async () => {
  const app = setup();
  await app.ask({ content: [
    { type: 'text', text: 'Look at this diagram:' },
    { type: 'image', url: 'https://www.examtopics.com/assets/question.png' },
    { type: 'text', text: 'A. Yes B. No' }
  ] });
  const content = app.calls[0].body.input[0].content;
  assert.equal(content[1].type, 'input_image');
  assert.equal(content[1].image_url, 'https://www.examtopics.com/assets/question.png');
  assert.equal(content[2].text, 'A. Yes B. No');
});

test('invalid image sources and legacy whole-page payloads are rejected', async () => {
  for (const question of [
    { text: 'Entire page content' },
    { content: [{ type: 'image', url: 'javascript:alert(1)' }] },
    { content: [{ type: 'image', url: 'https://user:password@example.org/img.png' }] }
  ]) {
    const app = setup();
    await assert.rejects(() => app.ask(question));
    assert.equal(app.calls.length, 0);
  }
});

for (const [status, expected] of [[401, /Invalid/], [403, /access/], [404, /unavailable/], [429, /quota/], [500, /HTTP 500/]]) {
  test(`HTTP ${status} produces an actionable error`, async () => {
    const app = setup({ status });
    await assert.rejects(() => app.ask(page), expected);
  });
}

test('empty model response is an error', async () => {
  const app = setup({ result: { output: [] } });
  await assert.rejects(() => app.ask(page), /no text/);
});

test('partial answers are flagged', async () => {
  const app = setup({ result: { status: 'incomplete', output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Partial' }] }
  ] } });
  assert.equal((await app.ask(page)).incomplete, true);
});

test('saved answer language overrides question/browser language', async () => {
  const app = setup({ language: 'russian' });
  await app.ask({ ...page, language: 'en-US' });
  assert.match(app.calls[0].body.instructions, /Answer in Russian\.$/);
});

test('answer-only requests use a concise prompt and smaller budget without changing the next request', async () => {
  const app = setup({ language: 'russian' });
  await app.ask(page, { mode: 'answer-only' });
  const short = app.calls[0].body;
  assert.match(short.instructions, /Return only the correct option/);
  assert.match(short.instructions, /multiple answers/);
  assert.match(short.instructions, /rather than guessing/);
  assert.match(short.instructions, /Answer in Russian\.$/);
  assert.equal(short.max_output_tokens, 1024);
  assert.equal(short.stream, true);
  await app.ask(page);
  const detailed = app.calls[1].body;
  assert.match(detailed.instructions, /explain the relevant concepts/);
  assert.equal(detailed.max_output_tokens, 8000);
});

function makePort(url) {
  const messages = [];
  let receive;
  let disconnect;
  const port = {
    name: `chatgpt-answer:${new URL(url).searchParams.get('id')}`,
    sender: { id: 'extension', url },
    postMessage: message => messages.push(message),
    disconnect: () => disconnect?.(),
    onMessage: { addListener: fn => { receive = fn; } },
    onDisconnect: { addListener: fn => { disconnect = fn; } }
  };
  return { port, messages, send: message => receive(message) };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('opens a large popup; streaming starts only after its port is ready', async () => {
  const app = setup();
  const result = await app.message({ action: 'askChatGPT', page });
  assert.equal(result.opened, true);
  assert.equal(app.windows[0].type, 'popup');
  assert.equal(app.windows[0].width, 1000);
  assert.equal(app.windows[0].height, 800);
  assert.equal(app.calls.length, 0);
  const client = makePort(app.windows[0].url);
  app.connections[0](client.port);
  client.send({ type: 'start' });
  client.send({ type: 'start' });
  await tick();
  assert.equal(app.calls.length, 1);
  assert.equal(client.messages[0].type, 'language');
  assert.equal(client.messages[1].type, 'delta');
  assert.equal(client.messages.at(-1).type, 'done');
  assert.equal(client.messages.at(-1).answer, 'Detailed answer');
  assert(!JSON.stringify(client.messages).includes('test-key'));
});

test('closing the answer connection aborts its API request', async () => {
  const app = setup();
  let activeSignal;
  app.context.fetch = async (_, options) => {
    activeSignal = options.signal;
    return new Promise((resolve, reject) => activeSignal.addEventListener('abort', () => reject(new Error('cancelled'))));
  };
  await app.message({ action: 'askChatGPT', page });
  const client = makePort(app.windows[0].url);
  app.connections[0](client.port);
  client.send({ type: 'start' });
  await tick();
  client.port.disconnect();
  await tick();
  assert.equal(activeSignal.aborted, true);
  assert.equal(client.messages.filter(item => item.type === 'done').length, 0);
});

test('answer-only mode reaches the API through the separate-window session', async () => {
  const app = setup();
  await app.message({ action: 'askChatGPT', page, mode: 'answer-only' });
  const client = makePort(app.windows[0].url);
  app.connections[0](client.port);
  client.send({ type: 'start' });
  await tick();
  assert.equal(app.calls[0].body.max_output_tokens, 1024);
  assert.match(app.calls[0].body.instructions, /Return only the correct option/);
  assert.equal(client.messages.at(-1).type, 'done');
});

test('expired answer sessions fail instead of running an unbound request', () => {
  const app = setup();
  const client = makePort('chrome-extension://extension/src/answer.html?id=missing');
  app.connections[0](client.port);
  assert.equal(client.messages[0].type, 'error');
  assert.equal(app.calls.length, 0);
});

test('SSE delivers split UTF-8 deltas before the completion event arrives', async () => {
  const app = setup();
  const encoder = new TextEncoder();
  const chunks = [...encoder.encode('data: {"type":"response.output_text.delta","delta":"Привет"}\r\n\r\n')]
    .map(byte => Uint8Array.of(byte));
  let release;
  const final = new Promise(resolve => { release = resolve; });
  const reader = {
    read: async () => chunks.length ? { value: chunks.shift(), done: false } : { value: await final, done: false },
    cancel: async () => {}, releaseLock() {}
  };
  const deltas = [];
  let complete = false;
  const pending = app.context.readOpenAIStream({ body: { getReader: () => reader } }, delta => deltas.push(delta))
    .then(() => { complete = true; });
  await tick();
  assert.deepEqual(deltas, ['Привет']);
  assert.equal(complete, false);
  release(encoder.encode('data: {"type":"response.completed","response":{"output":[]}}\n\n'));
  await pending;
  assert.equal(complete, true);
});

test('broken stream is an error after delivering any available partial text', async () => {
  const app = setup();
  const chunks = [new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n')];
  const deltas = [];
  await assert.rejects(() => app.context.readOpenAIStream({ body: { getReader: () => ({
    read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
    cancel: async () => {}, releaseLock() {}
  }) } }, delta => deltas.push(delta)), /ended before/);
  assert.deepEqual(deltas, ['Partial']);
});
