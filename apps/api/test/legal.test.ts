/**
 * The legal and help pages: the markdown converter and the routes that
 * serve it. Run with `pnpm --filter @nima/api test`.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown } from '../src/lib/markdown.js';
import { lastChanged, legalRoutes } from '../src/modules/legal/routes.js';

describe('renderMarkdown', () => {
  it('renders headings, paragraphs, lists, bold and links', () => {
    const html = renderMarkdown(
      '# Title\n\nA **bold** word and a [link](https://example.com).\n\n- one\n- two\n\n## Next\n\nText',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain(
      '<p>A <strong>bold</strong> word and a <a href="https://example.com">link</a>.</p>',
    );
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<h2>Next</h2>');
  });

  it('renders pipe tables', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    expect(html).toContain('<table><thead><tr><th>A</th><th>B</th></tr></thead>');
    expect(html).toContain('<tr><td>3</td><td>4</td></tr>');
  });

  it('escapes HTML and refuses script links', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
    expect(renderInline('[x](javascript:alert)')).toBe('<a href="#">x</a>');
  });

  it('joins wrapped lines into one paragraph and keeps rules', () => {
    const html = renderMarkdown('line one\nline two\n\n---\n\nafter');
    expect(html).toContain('<p>line one line two</p>');
    expect(html).toContain('<hr>');
  });
});

describe('legal routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nima-legal-'));
    await writeFile(
      join(dir, 'privacy.md'),
      '# Privacy\n\n**What changed:** 7 November 2026. Test.\n\nWrite to {{SUPPORT_EMAIL}}.',
    );
    await writeFile(join(dir, 'help.md'), '# Help\n\nHello.');
    app = Fastify();
    await app.register(legalRoutes({ docsDir: dir, supportEmail: 'help@example.test' }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the privacy policy as a cached HTML page', async () => {
    const response = await app.inject({ method: 'GET', url: '/privacy' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.body).toContain('<title>Privacy policy · Nima</title>');
    expect(response.body).toContain('Last changed 7 November 2026');
    expect(response.body).toContain('Write to help@example.test.');
    expect(response.body).not.toContain('{{SUPPORT_EMAIL}}');
  });

  it('answers /support with the help page', async () => {
    const response = await app.inject({ method: 'GET', url: '/support' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<h1>Help</h1>');
  });

  it('says so, without crashing, when a document is missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/terms' });
    expect(response.statusCode).toBe(503);
  });

  it('reads the What changed line', () => {
    expect(lastChanged('**What changed:** 3 November 2026. First draft.')).toBe('3 November 2026');
    expect(lastChanged('nothing')).toBeNull();
  });
});
