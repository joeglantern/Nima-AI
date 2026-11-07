/**
 * A small markdown to HTML converter for the legal and help pages.
 *
 * Those documents use a handful of constructs: headings, paragraphs, bullet
 * lists, pipe tables, bold, links, horizontal rules. A full parser would be
 * a dependency carried for three pages, so this covers exactly what the
 * documents use and escapes everything else. Anything it does not recognise
 * comes out as a paragraph, never as raw HTML.
 */

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Bold and links inside a line. Everything else is escaped text. */
export function renderInline(text: string): string {
  let out = '';
  let rest = text;

  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/;
  for (;;) {
    const match = pattern.exec(rest);
    if (!match) {
      out += escapeHtml(rest);
      break;
    }
    out += escapeHtml(rest.slice(0, match.index));
    if (match[1] !== undefined) {
      out += `<strong>${escapeHtml(match[1])}</strong>`;
    } else {
      const href = match[3] ?? '';
      // Only web links and page links. javascript: and the like are not
      // something a document should be able to smuggle in.
      const safe = /^(https?:\/\/|\/|#|mailto:)/.test(href) ? href : '#';
      out += `<a href="${escapeHtml(safe)}">${escapeHtml(match[2] ?? '')}</a>`;
    }
    rest = rest.slice(match.index + match[0].length);
  }

  return out;
}

const isTableRow = (line: string): boolean => /^\|.*\|\s*$/.test(line);
const isTableRule = (line: string): boolean => /^\|(\s*:?-+:?\s*\|)+\s*$/.test(line);

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      list = null;
    }
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flush();
      html.push('<hr>');
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      list ??= [];
      list.push(bullet[1] ?? '');
      continue;
    }

    if (isTableRow(trimmed) && isTableRule(lines[i + 1]?.trim() ?? '')) {
      flush();
      const head = cells(trimmed);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]?.trim() ?? '')) {
        body.push(cells(lines[i] ?? ''));
        i += 1;
      }
      i -= 1;
      html.push(
        '<table><thead><tr>' +
          head.map((cell) => `<th>${renderInline(cell)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body
            .map(
              (row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`,
            )
            .join('') +
          '</tbody></table>',
      );
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flush();
  return html.join('\n');
}
