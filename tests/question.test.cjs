const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const url = 'https://www.examtopics.com/discussions/microsoft/view/56636-exam-az-900-topic-1-question-20-discussion/';
const fixture = fs.readFileSync('tests/fixtures/discussion.html', 'utf8');
function page(html = fixture) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync('src/question.js', 'utf8'));
  return dom;
}

test('reference question includes prompt and choices, excludes the rest of the page', () => {
  const dom = page();
  const result = dom.window.extractExamQuestion();
  const text = result.content.map(part => part.text || '').join('');
  assert.match(text, /guaranteed availability of 99\.99 percent/);
  assert.match(text, /A\. Yes/);
  assert.match(text, /B\. No/);
  assert(!text.includes('UNRELATED'));
  assert(!text.includes('Show Suggested Answer'));
  assert.equal(result.content.filter(part => part.type === 'image').length, 0);
  dom.window.close();
});

test('images inside prompt and choices are sent in order; lazy URLs resolved and duplicates removed', () => {
  const dom = page();
  const body = dom.window.document.querySelector('.question-body');
  body.querySelector('.card-text').innerHTML = 'Exhibit:<img src="/diagram.png"><br>Choose:';
  body.insertAdjacentHTML('beforeend', '<div class="question-choices-container"><div>A. <img src="/placeholder.png" data-src="/choice.png"></div><div>B. <img src="/diagram.png"></div><span class="badge">Most Voted</span></div>');
  const result = dom.window.extractExamQuestion();
  assert.deepEqual(Array.from(result.content.filter(part => part.type === 'image'), part => part.url), [
    'https://www.examtopics.com/diagram.png', 'https://www.examtopics.com/choice.png'
  ]);
  assert.equal(result.content[0].text, 'Exhibit:');
  assert.equal(result.content[1].type, 'image');
  assert(!JSON.stringify(result).includes('Most Voted'));
  dom.window.close();
});

test('correct answers and hidden content inside question roots are excluded', () => {
  const dom = page();
  dom.window.document.querySelector('.card-text').insertAdjacentHTML('beforeend', '<span class="correct-answer">ANSWER SECRET</span><span hidden>HIDDEN SECRET</span><div style="display:none"><img src="/secret.png">CSS SECRET</div><script>SCRIPT SECRET</script>');
  assert(!JSON.stringify(dom.window.extractExamQuestion()).includes('SECRET'));
  assert(!JSON.stringify(dom.window.extractExamQuestion()).includes('secret.png'));
  dom.window.close();
});

test('absent, ambiguous or oversized questions fail without whole-page fallback', () => {
  for (const html of ['<main>Entire page</main>', fixture + fixture, fixture.replace('card-text', 'unknown-markup'), fixture.replace('Does the solution meet the goal?', 'x'.repeat(60001))]) {
    const dom = page(html);
    assert.throws(() => dom.window.extractExamQuestion());
    dom.window.close();
  }
});

test('image-only question and inline image data are retained', () => {
  const dom = page();
  dom.window.document.querySelector('.card-text').innerHTML = '<img src="data:image/png;base64,aGVsbG8=">';
  assert.equal(dom.window.extractExamQuestion().content[0].type, 'image');
  dom.window.close();
});

test('unsupported or missing images stop extraction instead of silently omitting the exhibit', () => {
  for (const src of ['javascript:alert(1)', 'data:image/svg+xml,hello', 'http://example.org/img.png', '']) {
    const dom = page();
    dom.window.document.querySelector('.card-text').innerHTML = `<img src="${src}">`;
    assert.throws(() => dom.window.extractExamQuestion());
    dom.window.close();
  }
});
