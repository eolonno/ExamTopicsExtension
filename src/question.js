// Deliberately no document.body fallback: never send comments or the whole page.
function extractExamQuestion(doc = document) {
  const bodies = doc.querySelectorAll('.discussion-header-container .question-body');
  if (bodies.length !== 1) throw new Error('Could not identify a single discussion question. Open a question discussion page and retry.');
  const body = bodies[0];
  const roots = [...body.children].filter(node => node.matches('.card-text, .question-choices-container'));
  if (!roots.some(node => node.matches('.card-text'))) throw new Error('Question content was not found. No data was sent.');
  const content = [];
  const imageUrls = new Set();
  const ignored = 'script, style, noscript, button, input, textarea, select, .btn, .correct-answer, .correct-answer-box, .question-answer, .answer-container, .answer-block, .voting-summary, .badge, .most-voted-answer, .comments-container, [hidden], [aria-hidden="true"]';
  function visit(node) {
    if (node.nodeType === 3) {
      content.push({ type: 'text', text: node.textContent });
      return;
    }
    if (node.nodeType !== 1 || node.matches(ignored)) return;
    const style = doc.defaultView.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    if (node.tagName === 'IMG') {
      // Lazy-loaded images often have a placeholder src and the real URL in data-src.
      const source = node.getAttribute('data-src') || node.getAttribute('data-original') || node.currentSrc || node.getAttribute('src');
      if (!source) throw new Error('A question image has no source. Wait for it to load and retry.');
      const url = new URL(source, doc.baseURI);
      if (!['https:', 'data:'].includes(url.protocol) ||
          (url.protocol === 'data:' && !/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(source))) {
        throw new Error('A question image uses an unsupported format. No question was sent.');
      }
      if (!imageUrls.has(url.href)) {
        imageUrls.add(url.href);
        content.push({ type: 'image', url: url.href });
      }
      return;
    }
    if (node.tagName === 'BR') content.push({ type: 'text', text: '\n' });
    else {
      const block = /^(P|DIV|LI|UL|OL|TABLE|TR|H[1-6])$/.test(node.tagName);
      if (block) content.push({ type: 'text', text: '\n' });
      for (const child of node.childNodes) visit(child);
      if (node.tagName === 'TD' || node.tagName === 'TH') content.push({ type: 'text', text: '\t' });
      if (block) content.push({ type: 'text', text: '\n' });
    }
  }
  for (const root of roots) visit(root);
  // Collapse whitespace while keeping image positions and line breaks in the question.
  const parts = [];
  for (const part of content) {
    if (part.type === 'text' && parts.at(-1)?.type === 'text') parts.at(-1).text += part.text;
    else parts.push({ ...part });
  }
  for (const part of parts) {
    if (part.type === 'text') part.text = part.text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const filtered = parts.filter(part => part.type !== 'text' || part.text);
  const textLength = filtered.reduce((sum, part) => sum + (part.text?.length || 0), 0);
  if (!filtered.length) throw new Error('The question is empty. No data was sent.');
  if (textLength > 60000 || imageUrls.size > 20) throw new Error('This question is too large to send in full. No data was sent.');
  return { content: filtered };
}
