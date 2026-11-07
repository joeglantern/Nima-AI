/**
 * The privacy policy, terms and help pages, served as plain HTML.
 *
 * App stores, sign in providers and the web app all need a privacy policy
 * and a support page at a public address. The documents are markdown in
 * docs/legal so a lawyer can read and edit them without touching code; the
 * API turns them into a page on request and caches the result for a few
 * minutes.
 *
 * They sit at the root, next to health, because the addresses are quoted in
 * store listings and are not ours to version. The web app's catch all only
 * runs for paths with no route, so these never shadow a screen and a screen
 * never shadows these.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';
import { renderMarkdown } from '../../lib/markdown.js';

export interface LegalRoutesOptions {
  /** Where the markdown lives. Defaults to docs/legal at the repository root. */
  docsDir?: string;
  /** Rendered into every page wherever the document says {{SUPPORT_EMAIL}}. */
  supportEmail?: string;
}

/**
 * docs/legal relative to this file, which holds both in the checkout
 * (apps/api/src/modules/legal) and in the image (apps/api/dist/modules/legal,
 * with docs/legal copied to the same relative place).
 */
export const defaultDocsDir = (): string =>
  resolve(fileURLToPath(new URL('../../../../../docs/legal/', import.meta.url)));

const PAGES: Record<string, { file: string; title: string }> = {
  '/privacy': { file: 'privacy.md', title: 'Privacy policy' },
  '/terms': { file: 'terms.md', title: 'Terms of service' },
  '/help': { file: 'help.md', title: 'Help' },
  '/support': { file: 'help.md', title: 'Help' },
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** The date on the "What changed" line, which every document carries. */
export function lastChanged(markdown: string): string | null {
  const match = /\*\*What changed:\*\*\s*([^.\n]+)\./.exec(markdown);
  return match?.[1]?.trim() ?? null;
}

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #FAF8F5; color: #1A1614; font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-text-size-adjust: 100%; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 20px 80px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 40px; }
  header a { color: #1A1614; text-decoration: none; font-family: Georgia, "Times New Roman", serif; font-size: 26px; letter-spacing: 0.01em; }
  header span { color: #6B625C; font-size: 14px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; font-size: 34px; line-height: 1.15; margin: 0 0 8px; }
  h2 { font-size: 22px; font-weight: 600; margin: 40px 0 10px; }
  h3 { font-size: 18px; font-weight: 600; margin: 28px 0 8px; }
  p { margin: 0 0 16px; }
  ul { padding-left: 22px; margin: 0 0 16px; }
  li { margin: 4px 0; }
  a { color: #7A2E2E; }
  hr { border: 0; border-top: 1px solid #E6E0DA; margin: 40px 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 20px; font-size: 15px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; border-bottom: 1px solid #E6E0DA; }
  th { font-weight: 600; }
  footer { margin-top: 56px; color: #6B625C; font-size: 14px; }
  footer a { color: inherit; }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; }
    body { background: #1A1614; color: #F3EEE8; }
    header a, h1 { color: #F3EEE8; }
    header span, footer { color: #A89F97; }
    a { color: #E0A3A3; }
    hr, th, td { border-color: #3A332F; }
  }
`;

export const legalRoutes =
  (options: LegalRoutesOptions = {}): FastifyPluginAsync =>
  async (app) => {
    const docsDir = options.docsDir ?? defaultDocsDir();
    const supportEmail = options.supportEmail ?? app.env?.SUPPORT_EMAIL ?? 'support@nima.africa';

    for (const [path, page] of Object.entries(PAGES)) {
      app.get(path, { schema: { hide: true } }, async (request, reply) => {
        let markdown: string;
        try {
          markdown = await readFile(join(docsDir, page.file), 'utf8');
        } catch (error) {
          request.log.error(
            { err: error, file: page.file },
            'A legal page is missing from the image',
          );
          return reply
            .status(503)
            .type('text/plain; charset=utf-8')
            .send('This page is not available right now.');
        }

        markdown = markdown.replaceAll('{{SUPPORT_EMAIL}}', supportEmail);
        const changed = lastChanged(markdown);
        const body = renderMarkdown(markdown);

        const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} · Nima</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<main>
<header><a href="/">Nima</a>${changed ? `<span>Last changed ${escapeHtml(changed)}</span>` : ''}</header>
${body}
<footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/help">Help</a> · <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a></footer>
</main>
</body>
</html>`;

        reply.header('cache-control', 'public, max-age=300');
        reply.header('x-frame-options', 'DENY');
        return reply.type('text/html; charset=utf-8').send(html);
      });
    }
  };
