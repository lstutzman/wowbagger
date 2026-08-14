function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeHref(value) {
  return /^https?:\/\//i.test(value) ? value : null;
}

function formatText(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^A-Za-z0-9])_([^_]+)_(?=[^A-Za-z0-9]|$)/g, '$1<em>$2</em>');
}

function renderInline(value) {
  const replacements = [];
  const protect = (html) => {
    replacements.push(html);
    return `\u0000${replacements.length - 1}\u0000`;
  };
  let text = String(value)
    .replace(/`([^`]+)`/g, (_match, code) => protect(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]]+)]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g, (_match, label, url) => {
      const href = safeHref(url);
      return protect(href === null
        ? `<span>${formatText(label)}</span>`
        : `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${formatText(label)}</a>`);
    });
  text = formatText(text);
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index) => replacements[Number(index)]);
}

function isTableSeparator(line) {
  return line.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderTable(lines) {
  const headings = tableCells(lines[0]);
  const rows = lines.slice(2).map(tableCells);
  return `<table><thead><tr>${headings.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function renderMarkdown(markdown) {
  const lines = String(markdown)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .split('\n');
  const output = [];
  const paragraph = [];
  const listStack = [];
  let index = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph.length = 0;
    }
  };
  const closeLists = (indent = -1) => {
    while (listStack.length > 0 && listStack.at(-1).indent >= indent) {
      output.push(listStack.pop().type === 'ol' ? '</ol>' : '</ul>');
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*```(.*)$/);
    if (fence !== null) {
      flushParagraph();
      closeLists();
      const language = fence[1].trim().replace(/[^\w-]/g, '');
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      output.push(`<pre><code${language === '' ? '' : ` class="language-${language}"`}>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      closeLists();
      const table = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        table.push(lines[index]);
        index += 1;
      }
      output.push(renderTable(table));
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      closeLists();
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading !== null) {
      flushParagraph();
      closeLists();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])\1\1[-*_\s]*$/.test(line)) {
      flushParagraph();
      closeLists();
      output.push('<hr>');
      index += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      closeLists();
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      output.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    const listItem = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listItem !== null) {
      flushParagraph();
      const indent = listItem[1].length;
      const type = /\d/.test(listItem[2]) ? 'ol' : 'ul';
      closeLists(indent + 1);
      const top = listStack.at(-1);
      if (top === undefined || top.indent < indent) {
        output.push(`<${type}>`);
        listStack.push({ type, indent });
      } else if (top.indent === indent && top.type !== type) {
        output.push(`</${top.type}>`);
        listStack.pop();
        output.push(`<${type}>`);
        listStack.push({ type, indent });
      }
      output.push(`<li>${renderInline(listItem[3])}</li>`);
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }

  flushParagraph();
  closeLists();
  return output.join('');
}

export function markdownBrowserSource() {
  return `${escapeHtml.toString()}\n${safeHref.toString()}\n${formatText.toString()}\n${renderInline.toString()}\n${isTableSeparator.toString()}\n${tableCells.toString()}\n${renderTable.toString()}\n${renderMarkdown.toString()}\nwindow.renderMarkdown = renderMarkdown;`;
}
