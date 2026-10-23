const extensionApi = typeof browser !== 'undefined' ? browser : chrome;

function activeTab() {
    if (typeof browser !== 'undefined') {
        return extensionApi.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]);
    }
    return new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0])));
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    statusEl.replaceChildren();
    statusEl.append(document.createTextNode(message));
    statusEl.className = `status active ${type}`;
}

function clearStatus() {
    const statusEl = document.getElementById('status');
    statusEl.className = 'status';
}

async function checkCurrentPage() {
    const tab = await activeTab();
    const url = tab?.url || '';
    let pageUrl;
    try {
        pageUrl = new URL(url);
    } catch {
        return { isExamTopics: false, isExamPage: false };
    }

    const isExamTopics = pageUrl.protocol === 'https:' &&
        (pageUrl.hostname === 'examtopics.com' || pageUrl.hostname === 'www.examtopics.com');
    const match = isExamTopics && pageUrl.pathname.match(/exam-(.+?)-topic-(\d+)-question-(\d+)-discussion/);
    const examView = isExamTopics && pageUrl.pathname.match(/^\/exams\/[^/]+\/([^/]+)\/view\//i);

    if (match) {
        return {
            isExamPage: true,
            isExamTopics: true,
            exam: match[1],
            topic: parseInt(match[2]),
            question: parseInt(match[3])
        };
    }
    return { isExamTopics, isExamPage: false, exam: examView ? examView[1] : null };
}

async function sendMessageToContent(action, data) {
    const tab = await activeTab();
    if (!tab) return { message: 'No active tab found.', status: 'error' };
    try {
        let response;
        if (typeof browser !== 'undefined') {
            response = await extensionApi.tabs.sendMessage(tab.id, { action, ...data });
        } else {
            response = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, { action, ...data }, result => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(result);
                });
            });
        }
        return response || { message: 'Search failed. Please try again.', status: 'error' };
    } catch {
        return { message: 'Cannot reach this page. Reload the ExamTopics tab and try again.', status: 'error' };
    }
}

async function runNavigation(action, data) {
    showStatus('Searching...', 'info');
    const result = await sendMessageToContent(action, data);
    if (result.captchaUrl) {
        showStatus('Captcha detected. Complete it in the opened tab, then retry.', 'error');
    } else {
        showStatus(result.message, result.status);
        if (result.searchUrl) {
            const link = document.createElement('a');
            link.href = result.searchUrl;
            link.textContent = 'View Google results';
            link.target = '_blank';
            document.getElementById('status').append(document.createElement('br'), link);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const pageInfo = await checkCurrentPage();
    const updateAiButton = configured => {
        document.getElementById('ai-actions').classList.toggle('is-hidden', !configured || !pageInfo.isExamTopics);
    };
    async function refreshAiSettings() {
        try {
            const { openaiApiKey } = await extensionApi.storage.local.get('openaiApiKey');
            updateAiButton(Boolean(openaiApiKey?.trim()));
        } catch { updateAiButton(false); }
    }
    extensionApi.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.openaiApiKey) refreshAiSettings();
    });
    await refreshAiSettings();
    for (const [id, mode] of [['ask-chatgpt', 'detailed'], ['answer-only', 'answer-only']]) {
        document.getElementById(id).addEventListener('click', async () => {
            const result = await sendMessageToContent('ask-chatgpt', { mode });
            if (result.message) showStatus(result.message, result.status);
        });
    }

    if (!pageInfo.isExamTopics) {
        document.getElementById('not-on-exam').classList.remove('is-hidden');
        const openExamTopics = document.getElementById('open-examtopics');
        if (openExamTopics) {
            openExamTopics.addEventListener('click', () => {
                extensionApi.tabs.create({ url: 'https://www.examtopics.com' });
            });
        }
        return;
    }

    if (!pageInfo.isExamPage) {
        document.getElementById('exam-input-section').classList.remove('is-hidden');
        if (pageInfo.exam) {
            document.getElementById('exam-code-input').value = pageInfo.exam.toUpperCase();
        }
        document.getElementById('btn-go-exam').addEventListener('click', () => {
            const exam = document.getElementById('exam-code-input').value.trim();
            const topic = Number(document.getElementById('exam-topic-input').value);
            const question = Number(document.getElementById('exam-question-input').value);

            if (!exam || !Number.isInteger(topic) || topic < 1 || !Number.isInteger(question) || question < 1) {
                showStatus('Enter an exam code and valid topic and question numbers', 'error');
                return;
            }

            runNavigation('go-to-exam', { exam, topic, question });
        });
        return;
    }

    document.getElementById('exam-name').textContent = pageInfo.exam.toUpperCase();
    document.getElementById('current-topic').textContent = pageInfo.topic;
    document.getElementById('current-question').textContent = pageInfo.question;
    document.getElementById('topic-input').value = pageInfo.topic;
    document.getElementById('question-input').value = pageInfo.question;

    document.getElementById('info-section').classList.remove('is-hidden');
    document.getElementById('nav-buttons').classList.remove('is-hidden');
    document.getElementById('input-section').classList.remove('is-hidden');

    document.getElementById('btn-next').addEventListener('click', () => {
        runNavigation('next-question', {
            topic: pageInfo.topic,
            question: pageInfo.question
        });
    });

    document.getElementById('btn-prev').addEventListener('click', () => {
        runNavigation('prev-question', {
            topic: pageInfo.topic,
            question: pageInfo.question
        });
    });

    document.getElementById('btn-go').addEventListener('click', () => {
        const topic = parseInt(document.getElementById('topic-input').value);
        const question = parseInt(document.getElementById('question-input').value);

        if (isNaN(topic) || isNaN(question) || topic < 1 || question < 1) {
            showStatus('Invalid input', 'error');
            return;
        }

        runNavigation('go-to-question', { topic, question });
    });

    document.getElementById('topic-input').addEventListener('focus', clearStatus);
    document.getElementById('question-input').addEventListener('focus', clearStatus);
});
extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'status-update') {
        showStatus(request.message, request.status);
    }
});
