(() => {
  let busy = false;
  let section;
  let button;
  let shortButton;

  async function refreshSettings() {
    try {
      const settings = await extensionApi.runtime.sendMessage({ action: 'getAiSettings' });
      section.hidden = !settings?.configured;
    } catch {
      section.hidden = true;
    }
  }

  async function ask(mode = 'detailed') {
    if (busy) return;
    busy = true;
    button.disabled = true;
    shortButton.disabled = true;
    const activeButton = mode === 'answer-only' ? shortButton : button;
    activeButton.textContent = 'Opening…';
    activeButton.removeAttribute('title');
    try {
      const page = extractExamQuestion();
      const result = await extensionApi.runtime.sendMessage({ action: 'askChatGPT', page, mode });
      if (!result || result.error) throw new Error(result?.error || 'No response received. Please retry.');
      return { message: '', status: 'info' };
    } catch (error) {
      const message = error.message || 'Ask ChatGPT failed. Reload the page and retry.';
      activeButton.title = message;
      return { message, status: 'error' };
    } finally {
      busy = false;
      button.disabled = false;
      shortButton.disabled = false;
      button.textContent = 'Ask ChatGPT';
      shortButton.textContent = 'Answer only';
    }
  }

  function init() {
    const body = getActivePanel()?.querySelector('#panel-body');
    if (!body || section) return;
    const settings = document.createElement('details');
    settings.className = 'etn-ai-settings';
    const summary = document.createElement('summary');
    summary.textContent = 'Settings';
    const frame = document.createElement('iframe');
    frame.src = extensionApi.runtime.getURL('src/settings.html');
    frame.title = 'OpenAI settings';
    frame.className = 'etn-settings-frame';
    settings.append(summary, frame);
    body.append(settings);
    section = document.createElement('section');
    section.className = 'etn-ai-section';
    section.hidden = true;
    button = document.createElement('button');
    button.className = 'etn-btn etn-btn-primary etn-ai-detailed';
    button.textContent = 'Ask ChatGPT';
    button.addEventListener('click', () => ask('detailed'));
    shortButton = document.createElement('button');
    shortButton.className = 'etn-btn etn-ai-short';
    shortButton.textContent = 'Answer only';
    shortButton.addEventListener('click', () => ask('answer-only'));
    const actions = document.createElement('div');
    actions.className = 'etn-ai-buttons';
    actions.append(shortButton, button);
    section.append(actions);
    body.append(section);
    refreshSettings();
  }

  extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshAiSettings') {
      if (section) refreshSettings();
    }
    if (request.action === 'ask-chatgpt') {
      if (!section) init();
      if (!section) {
        sendResponse({ message: 'Reload the ExamTopics page and retry.', status: 'error' });
        return;
      }
      refreshSettings().then(() => {
        if (section.hidden) {
          sendResponse({ message: 'Set your OpenAI API key in settings first.', status: 'error' });
          return;
        }
        ask(request.mode === 'answer-only' ? 'answer-only' : 'detailed').then(result => sendResponse(result || { message: '', status: 'info' }));
      });
      return true;
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
})();
