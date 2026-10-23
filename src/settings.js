(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const input = document.getElementById('openai-api-key');
  const language = document.getElementById('answer-language');
  const status = document.getElementById('settings-status');
  async function refresh() {
    try {
      const { openaiApiKey, answerLanguage } = await api.storage.local.get(['openaiApiKey', 'answerLanguage']);
      input.placeholder = openaiApiKey ? 'Key saved — enter a replacement' : 'sk-…';
      language.value = answerLanguage === 'russian' ? 'russian' : 'english';
      status.textContent = openaiApiKey ? 'API key is configured.' : 'No API key configured.';
    } catch {
      status.textContent = 'Could not load settings. Reload the extension and retry.';
    }
  }
  async function save(remove) {
    const key = input.value.trim();
    if (!remove && key && /\s/.test(key)) {
      status.textContent = 'Enter an API key without spaces.';
      return;
    }
    const buttons = [...document.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      if (remove) await api.storage.local.remove('openaiApiKey');
      else await api.storage.local.set({
        answerLanguage: language.value === 'russian' ? 'russian' : 'english',
        ...(key ? { openaiApiKey: key } : {})
      });
      input.value = '';
      await refresh();
      status.textContent = remove ? 'API key removed.' : 'Settings saved.';
    } catch {
      status.textContent = 'Could not save settings. Please retry.';
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }
  document.getElementById('ai-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    save(false);
  });
  document.getElementById('remove-key').addEventListener('click', () => save(true));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.openaiApiKey || changes.answerLanguage)) refresh();
  });
  refresh();
})();
