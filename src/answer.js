(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const answer = document.getElementById('answer');
  const status = document.getElementById('status');
  const notice = document.getElementById('notice');
  const stop = document.getElementById('stop');
  let finished = false;
  let port;
  function finish(message, error = false) {
    finished = true;
    stop.disabled = true;
    answer.setAttribute('aria-busy', 'false');
    status.textContent = message;
    status.classList.toggle('error', error);
  }
  try {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error('No question session. Click Ask ChatGPT from an ExamTopics question.');
    port = api.runtime.connect({ name: `chatgpt-answer:${id}` });
    port.onMessage.addListener(message => {
      if (finished) return;
      if (message.type === 'language') {
        document.getElementById('language').textContent = `Answer language: ${message.language}`;
        document.documentElement.lang = message.language === 'Russian' ? 'ru' : 'en';
        status.textContent = 'Waiting for the first words…';
      } else if (message.type === 'delta') {
        const follow = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
        answer.append(document.createTextNode(message.text));
        notice.textContent = '';
        status.textContent = 'Generating…';
        if (follow) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      } else if (message.type === 'done') {
        // The final response is authoritative; replace, never append it twice.
        answer.textContent = message.answer;
        notice.textContent = message.incomplete ? 'The answer reached the output limit and may be incomplete.' : '';
        finish(message.incomplete ? 'Incomplete answer' : 'Complete');
      } else if (message.type === 'error') {
        notice.textContent = answer.textContent ? 'The partial answer has been kept. To retry, click Ask ChatGPT on the question page.' : 'Click Ask ChatGPT on the question page to retry.';
        finish(message.message, true);
      }
    });
    port.onDisconnect.addListener(() => {
      // Read lastError to avoid Chrome reporting an unchecked connection failure.
      void api.runtime.lastError;
      if (!finished) {
        notice.textContent = 'The partial answer has been kept. Click Ask ChatGPT on the question page to retry.';
        finish('Connection to the extension was interrupted.', true);
      }
    });
    port.postMessage({ type: 'start' });
  } catch (error) {
    finish(error.message, true);
  }
  stop.addEventListener('click', () => {
    if (finished) return;
    try { port.postMessage({ type: 'cancel' }); } catch { /* The connection has already ended. */ }
    notice.textContent = 'Generation stopped. The partial answer has been kept.';
    finish('Stopped');
  });
  window.addEventListener('pagehide', () => port?.disconnect());
})();
