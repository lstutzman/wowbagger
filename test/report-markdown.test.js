import test from 'node:test';
import assert from 'node:assert/strict';

test('renders supported Markdown and escapes hostile content', async () => {
  const report = await import('../src/report-markdown.js').catch(() => ({}));
  const markdown = [
    '# Heading <script>alert(1)</script>',
    '',
    '> Quoted **text**',
    '',
    '- first',
    '- second with *emphasis* and `code`',
    '',
    '```js',
    '<img src=x onerror=alert(1)>',
    '```',
    '',
    '[safe](https://example.com/path?q=1&x=2)',
    '',
    '[unsafe](javascript:alert(1))',
  ].join('\n');

  const html = report.renderMarkdown?.(markdown);

  assert.match(html, /<h1>Heading &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
  assert.match(html, /<blockquote><p>Quoted <strong>text<\/strong><\/p><\/blockquote>/);
  assert.match(html, /<ul><li>first<\/li><li>second with <em>emphasis<\/em> and <code>code<\/code><\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-js">&lt;img src=x onerror=alert\(1\)&gt;\n<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example\.com\/path\?q=1&amp;x=2" rel="noopener noreferrer">safe<\/a>/);
  assert.match(html, /<span>unsafe<\/span>/);
  assert.doesNotMatch(html, /<script>|<img|href="javascript:/);
});
