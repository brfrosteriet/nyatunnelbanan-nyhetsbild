#!/usr/bin/env node
// Renders the latest "Aktuellt Liljeholmen" news items from nyatunnelbanan.se
// into dist/nyheter.svg (embedded with a plain <img> tag on the BRF website)
// plus dist/index.html (human-readable check that the data is right).
//
// No dependencies. Run: node build.mjs

import { mkdirSync, writeFileSync } from 'node:fs';

// WordPress REST API, public, no auth. Category 249 = "Aktuellt Liljeholmen",
// the same list shown under "Aktuellt" on
// https://nyatunnelbanan.se/gul-linje/arbeten/liljeholmen/
const API_URL =
  'https://nyatunnelbanan.se/wp-json/wp/v2/posts?categories=249&per_page=4&orderby=date&order=desc&_fields=date,title,link';

const USER_AGENT =
  'brf-nyhetsbild/1.0 (+https://github.com/brfrosteriet/nyatunnelbanan-nyhetsbild)';

const SOURCE_PAGE = 'https://nyatunnelbanan.se/gul-linje/arbeten/liljeholmen/';
const MAX_ITEMS = 4;
const FETCH_TIMEOUT_MS = 20000;

// Typographic characters, kept as code points so this file stays plain ASCII.
const NBSP = String.fromCharCode(0x00a0);
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
const ELLIPSIS = String.fromCharCode(0x2026);

// --- Layout -----------------------------------------------------------------
// Every vertical position is computed, never hard-coded, so the image ends up
// exactly as tall as its content: no dead space, no clipping.

const WIDTH = 660;
const PAD = 28;

const HEADING = `Senaste nytt ${EN_DASH} nya tunnelbanan i Liljeholmen`;
const HEADING_SIZE = 21;
const HEADING_GAP = 18; // heading -> first headline

const TITLE_SIZE = 17;
const TITLE_LINE_HEIGHT = 25;
const TITLE_MAX_LINES = 3;

const DATE_SIZE = 13;
const DATE_GAP = 4; // headline -> its date

const ITEM_GAP = 14; // one item -> the next

const FOOTER = 'Källa: nyatunnelbanan.se';
const FOOTER_SIZE = 12;
const FOOTER_GAP = 20;

// Taken from the BRF site's own theme (templates/uber .../gronwhite) so the
// image sits on https://brfrosteriet.se/mitt-boende/nya-tunnelbanan without
// looking pasted in. The page itself is white, hence the very light card.
const COLORS = {
  background: '#f4f6f7', // theme light surface
  border: '#dadedf', // theme border grey
  accent: '#f5c700', // the metro's yellow line, the one non-site colour
  heading: '#27292e', // theme article-title text
  title: '#3d4045', // theme blog article-title text
  muted: '#96a1a3', // theme muted text
  link: '#339966', // theme brand green, used for links in index.html
};

// Helvetica/Arial average advance width as a fraction of the font size.
// SVG has no text wrapping, so line breaks are computed from this estimate.
const CHAR_WIDTH_RATIO = 0.52;

// Approximate ascent/descent, used to turn "top of a text block" into a
// baseline and to reserve room below the last baseline.
const ascent = (size) => size * 0.8;
const descent = (size) => size * 0.25;

const round1 = (n) => Math.round(n * 10) / 10;

// --- Text handling ----------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: NBSP,
  ndash: EN_DASH,
  mdash: EM_DASH,
};

// Decodes numeric decimal (&#8211;), numeric hex (&#x2013;) and the named set
// above. Unknown named entities are left as they are.
function decodeEntities(text) {
  return text.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body) => {
      if (body[0] === '#') {
        const codePoint =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
    },
  );
}

// Escapes for XML output. Always applied AFTER decoding, never before.
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Control characters would make the SVG invalid XML.
function stripControlChars(text) {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code >= 0x20 || code === 0x09 || code === 0x0a) out += char;
  }
  return out;
}

// title.rendered may carry inline markup; strip that, then decode entities,
// then collapse whitespace.
function normalizeTitle(rendered) {
  const decoded = decodeEntities(String(rendered).replace(/<[^>]*>/g, ''));
  return stripControlChars(decoded).replace(/\s+/g, ' ').trim();
}

// Greedy wrap on whitespace. A single word longer than a whole line is split
// so it cannot overflow the image; real headlines never reach that.
function greedyWrap(words, maxChars) {
  const lines = [];
  let current = '';

  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Trailing characters that should not sit directly before the ellipsis.
const TRAILING_JUNK = new RegExp(`[\\s${EN_DASH}${EM_DASH},.;:-]+$`);

// Wraps a headline to at most maxLines, truncating the last line with an
// ellipsis when the text does not fit.
function wrapTitle(text, fontSize, maxWidth, maxLines) {
  const maxChars = Math.max(4, Math.floor(maxWidth / (fontSize * CHAR_WIDTH_RATIO)));
  const lines = greedyWrap(text.split(' ').filter(Boolean), maxChars);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines - 1);
  const remaining = lines.slice(maxLines - 1).join(' ').split(' ').filter(Boolean);
  const budget = maxChars - 1; // leave room for the ellipsis

  let last = '';
  for (const word of remaining) {
    const candidate = last ? last + ' ' + word : word;
    if (candidate.length <= budget) last = candidate;
    else {
      if (!last) last = word.slice(0, budget);
      break;
    }
  }

  kept.push(last.replace(TRAILING_JUNK, '') + ELLIPSIS);
  return kept;
}

const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});

// WordPress returns site-local wall time with no offset ("2026-08-10T14:36:06").
// Anchoring the calendar date at 12:00 UTC keeps the formatted day correct no
// matter which timezone the build runs in.
function formatDate(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter.format(date);
}

// --- Fetch ------------------------------------------------------------------
// Any failure exits non-zero BEFORE anything is written, so the workflow stops
// before the deploy step and Pages keeps serving the last good image.

function fail(message) {
  console.error(`build.mjs: ${message}`);
  process.exit(1);
}

async function fetchPosts() {
  let response;
  try {
    response = await fetch(API_URL, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    fail(`could not reach ${API_URL}: ${error.message}`);
  }

  if (!response.ok) {
    fail(`${API_URL} returned HTTP ${response.status} ${response.statusText}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    fail(`response from ${API_URL} was not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(payload)) {
    const detail =
      payload && typeof payload === 'object' && payload.code
        ? `API error "${payload.code}"`
        : typeof payload;
    fail(`expected a JSON array of posts, got ${detail}`);
  }

  const posts = payload
    .filter((post) => post && post.title && typeof post.title.rendered === 'string')
    .slice(0, MAX_ITEMS)
    .map((post) => ({
      title: normalizeTitle(post.title.rendered),
      date: formatDate(post.date),
      link: typeof post.link === 'string' ? post.link : SOURCE_PAGE,
    }))
    .filter((post) => post.title.length > 0);

  if (posts.length === 0) {
    fail('the API returned no usable posts, refusing to render an empty image');
  }

  return posts;
}

// --- Render -----------------------------------------------------------------

function buildSvg(posts) {
  const textWidth = WIDTH - PAD * 2;
  const parts = [];

  // Walk down the image with `y` on the baseline of the last line drawn and
  // `lastSize` the font size of that line, so each gap allows for its descent.
  let y = PAD + ascent(HEADING_SIZE);
  let lastSize = HEADING_SIZE;
  parts.push(
    `  <text class="heading" x="${PAD}" y="${round1(y)}">${escapeXml(HEADING)}</text>`,
  );

  posts.forEach((post, index) => {
    y += descent(lastSize) + (index === 0 ? HEADING_GAP : ITEM_GAP) + ascent(TITLE_SIZE);

    const lines = wrapTitle(post.title, TITLE_SIZE, textWidth, TITLE_MAX_LINES);
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) y += TITLE_LINE_HEIGHT;
      parts.push(
        `  <text class="title" x="${PAD}" y="${round1(y)}">${escapeXml(line)}</text>`,
      );
    });
    lastSize = TITLE_SIZE;

    if (post.date) {
      y += descent(TITLE_SIZE) + DATE_GAP + ascent(DATE_SIZE);
      parts.push(
        `  <text class="date" x="${PAD}" y="${round1(y)}">${escapeXml(post.date)}</text>`,
      );
      lastSize = DATE_SIZE;
    }
  });

  y += descent(lastSize) + FOOTER_GAP + ascent(FOOTER_SIZE);
  parts.push(
    `  <text class="footer" x="${PAD}" y="${round1(y)}">${escapeXml(FOOTER)}</text>`,
  );

  const height = Math.ceil(y + descent(FOOTER_SIZE) + PAD);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img">
  <title>${escapeXml(HEADING)}</title>
  <style>
    text { font-family: Helvetica, Arial, sans-serif; }
    .heading { font-size: ${HEADING_SIZE}px; font-weight: bold; fill: ${COLORS.heading}; }
    .title { font-size: ${TITLE_SIZE}px; fill: ${COLORS.title}; }
    .date { font-size: ${DATE_SIZE}px; fill: ${COLORS.muted}; }
    .footer { font-size: ${FOOTER_SIZE}px; fill: ${COLORS.muted}; }
  </style>
  <defs>
    <clipPath id="card">
      <rect x="0" y="0" width="${WIDTH}" height="${height}" rx="10" ry="10"/>
    </clipPath>
  </defs>
  <rect x="0" y="0" width="${WIDTH}" height="${height}" rx="10" ry="10" fill="${COLORS.background}"/>
  <g clip-path="url(#card)">
    <rect x="0" y="0" width="6" height="${height}" fill="${COLORS.accent}"/>
  </g>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="9.5" ry="9.5" fill="none" stroke="${COLORS.border}" stroke-width="1"/>
${parts.join('\n')}
</svg>
`;
}

function buildHtml(posts) {
  const items = posts
    .map(
      (post) =>
        `      <li><a href="${escapeXml(post.link)}">${escapeXml(post.title)}</a> ` +
        `<span class="date">${escapeXml(post.date)}</span></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeXml(HEADING)}</title>
  <style>
    body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 2rem auto;
           max-width: 700px; padding: 0 1rem; color: ${COLORS.title};
           background: #ffffff; }
    h1 { font-size: 1.25rem; color: ${COLORS.heading}; }
    h2 { font-size: 1rem; color: ${COLORS.heading}; }
    a { color: ${COLORS.link}; }
    a:hover { color: #206040; }
    img { max-width: 100%; height: auto; }
    ul { padding-left: 1.2rem; line-height: 1.6; }
    .date { color: ${COLORS.muted}; font-size: 0.85rem; white-space: nowrap; }
    footer { margin-top: 2rem; font-size: 0.85rem; color: ${COLORS.muted}; }
  </style>
</head>
<body>
  <h1>${escapeXml(HEADING)}</h1>

  <p>
    <a href="${escapeXml(SOURCE_PAGE)}">
      <img src="nyheter.svg" alt="${escapeXml(HEADING)}">
    </a>
  </p>

  <h2>Samma rubriker som länkar</h2>
  <ul>
${items}
  </ul>

  <footer>
    <p>${escapeXml(FOOTER)} ${EN_DASH}
      <a href="${escapeXml(SOURCE_PAGE)}">arbeten i Liljeholmen</a></p>
  </footer>
</body>
</html>
`;
}

// --- Main -------------------------------------------------------------------

const posts = await fetchPosts();

mkdirSync('dist', { recursive: true });
writeFileSync('dist/nyheter.svg', buildSvg(posts), 'utf8');
writeFileSync('dist/index.html', buildHtml(posts), 'utf8');

console.log(`build.mjs: rendered ${posts.length} posts to dist/nyheter.svg`);
for (const post of posts) console.log(`  - ${post.date}: ${post.title}`);
