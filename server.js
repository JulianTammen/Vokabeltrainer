'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Konfiguration (alles ueber Railway-Variablen ueberschreibbar)
// ---------------------------------------------------------------------------

const TOKEN      = process.env.NOTION_TOKEN || '';
const ROOT_PAGE  = process.env.NOTION_ROOT_PAGE || '3ad6ab13-4ee4-8094-ad88-e8943dbfccd9';
const VOCAB_DS   = process.env.NOTION_VOCAB_DB  || '3ad6ab13-4ee4-8073-9e35-000b161e7d55';
const PORT       = process.env.PORT || 3000;

const STALE_AFTER_MS = 10 * 60 * 1000;   // ab wann im Hintergrund neu geladen wird
const MIN_REBUILD_MS = 20 * 1000;        // Schutz gegen zu haeufiges Neuladen
const MAX_DEPTH      = 6;

const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Notion-API
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(endpoint, options = {}, attempt = 0) {
  const res = await fetch('https://api.notion.com/v1' + endpoint, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  // Notion drosselt bei zu vielen Anfragen — kurz warten und erneut versuchen.
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const wait = Number(res.headers.get('retry-after') || 0) * 1000 || (400 * Math.pow(2, attempt));
    await sleep(wait);
    return notion(endpoint, options, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Notion ' + res.status + ': ' + body.slice(0, 300));
  }
  return res.json();
}

// Arbeitet eine Liste mit begrenzter Gleichzeitigkeit ab.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function blockChildren(id) {
  const out = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notion('/blocks/' + id + '/children?' + params);
    out.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Rendering: Notion-Bloecke -> HTML
// ---------------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ESC[c]);

function rich(arr) {
  if (!arr || !arr.length) return '';
  return arr
    .map((t) => {
      let s = esc(t.plain_text);
      const a = t.annotations || {};
      if (a.code) s = '<code>' + s + '</code>';
      if (a.bold) s = '<strong>' + s + '</strong>';
      if (a.italic) s = '<em>' + s + '</em>';
      if (a.strikethrough) s = '<s>' + s + '</s>';
      if (a.underline) s = '<u>' + s + '</u>';
      if (a.color && a.color !== 'default') {
        s = '<span class="nc nc-' + esc(a.color).replace(/_/g, '-') + '">' + s + '</span>';
      }
      if (t.href) {
        s = '<a href="' + esc(t.href) + '" target="_blank" rel="noopener">' + s + '</a>';
      }
      return s;
    })
    .join('');
}

const plain = (arr) => (arr || []).map((t) => t.plain_text).join('');

function navCard(label, attr) {
  return (
    '<button class="nav-card" ' + attr + '>' +
    '<span>' + esc(label) + '</span>' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>' +
    '</button>'
  );
}

// `found` sammelt alle Unterseiten, damit der Crawler weiterlaufen kann.
async function renderBlocks(blocks, found) {
  let html = '';
  let list = null;

  const flush = () => {
    if (list) {
      html += '<' + list.tag + '>' + list.items.join('') + '</' + list.tag + '>';
      list = null;
    }
  };

  for (const b of blocks) {
    const type = b.type;

    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      const tag = type === 'bulleted_list_item' ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flush();
        list = { tag, items: [] };
      }
      let inner = rich(b[type].rich_text);
      if (b.has_children) {
        inner += await renderBlocks(await blockChildren(b.id), found);
      }
      list.items.push('<li>' + inner + '</li>');
      continue;
    }

    flush();

    switch (type) {
      case 'paragraph': {
        const s = rich(b.paragraph.rich_text);
        if (s) html += '<p>' + s + '</p>';
        if (b.has_children) html += await renderBlocks(await blockChildren(b.id), found);
        break;
      }

      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        const level = { heading_1: 'h2', heading_2: 'h3', heading_3: 'h4' }[type];
        html += '<' + level + '>' + rich(b[type].rich_text) + '</' + level + '>';
        if (b.has_children) html += await renderBlocks(await blockChildren(b.id), found);
        break;
      }

      case 'callout': {
        const text = rich(b.callout.rich_text);
        const kids = b.has_children ? await renderBlocks(await blockChildren(b.id), found) : '';
        if (!text && !kids) break;              // nichts drin — nichts anzeigen
        if (!text) { html += kids; break; }     // nur Unterseiten — als reine Karten
        const ic = b.callout.icon;
        const emoji = ic && ic.type === 'emoji' ? ic.emoji : '';
        html +=
          '<aside class="callout">' +
          (emoji ? '<span class="callout-icon">' + esc(emoji) + '</span>' : '') +
          '<div>' + text + kids + '</div></aside>';
        break;
      }

      case 'child_page': {
        found.push({ id: b.id, title: b.child_page.title });
        html += navCard(b.child_page.title, 'data-page="' + esc(b.id) + '"');
        break;
      }

      case 'child_database':
        // Die Vokabeln haben einen eigenen Tab — hier wäre der Block doppelt.
        break;

      case 'table': {
        const rows = await blockChildren(b.id);
        const head = b.table.has_column_header;
        let out = '<div class="table-wrap"><table>';
        rows.forEach((r, i) => {
          const cells = (r.table_row ? r.table_row.cells : []).map(rich);
          const tag = head && i === 0 ? 'th' : 'td';
          out += '<tr>' + cells.map((c) => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>';
        });
        html += out + '</table></div>';
        break;
      }

      case 'toggle': {
        const kids = b.has_children ? await renderBlocks(await blockChildren(b.id), found) : '';
        html +=
          '<details><summary>' + rich(b.toggle.rich_text) + '</summary>' +
          '<div class="toggle-body">' + kids + '</div></details>';
        break;
      }

      case 'quote':
        html += '<blockquote>' + rich(b.quote.rich_text) + '</blockquote>';
        break;

      case 'code':
        html +=
          '<pre><code>' + esc(plain(b.code.rich_text)) + '</code></pre>';
        break;

      case 'to_do':
        html +=
          '<p class="todo' + (b.to_do.checked ? ' done' : '') + '">' +
          (b.to_do.checked ? '&#10003; ' : '&#9633; ') + rich(b.to_do.rich_text) + '</p>';
        break;

      case 'divider':
        html += '<hr>';
        break;

      case 'image': {
        const src = b.image.type === 'external' ? b.image.external.url : b.image.file.url;
        const cap = plain(b.image.caption);
        html +=
          '<figure><img loading="lazy" src="' + esc(src) + '" alt="' + esc(cap) + '">' +
          (cap ? '<figcaption>' + esc(cap) + '</figcaption>' : '') + '</figure>';
        break;
      }

      case 'bookmark':
      case 'embed':
      case 'link_preview': {
        const url = b[type].url;
        if (url) html += '<p><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></p>';
        break;
      }

      default:
        // Unbekannte Blocktypen still ueberspringen, aber Kinder nicht verlieren.
        if (b.has_children) html += await renderBlocks(await blockChildren(b.id), found);
        break;
    }
  }

  flush();
  return html;
}

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

async function pageTitle(id) {
  try {
    const p = await notion('/pages/' + id);
    const prop = Object.values(p.properties || {}).find((v) => v.type === 'title');
    return plain(prop && prop.title) || 'Spanisch';
  } catch {
    return 'Spanisch';
  }
}

async function crawl(id, title, parent, depth, store, seen) {
  if (seen.has(id) || depth > MAX_DEPTH) return;
  seen.add(id);

  const found = [];
  const html = await renderBlocks(await blockChildren(id), found);

  store[id] = {
    id,
    title,
    parent,
    html,
    children: found.map((f) => ({ id: f.id, title: f.title })),
  };

  for (const child of found) {
    await crawl(child.id, child.title, id, depth + 1, store, seen);
  }
}

// ---------------------------------------------------------------------------
// Vokabeln
// ---------------------------------------------------------------------------

function readVocab(page) {
  const entry = { id: page.id, ar: '', de: '', art: '', irr: false, ex: '' };
  for (const [name, value] of Object.entries(page.properties || {})) {
    switch (value.type) {
      case 'title':
        entry.ar = plain(value.title);
        break;
      case 'select':
        entry.art = value.select ? value.select.name : '';
        break;
      case 'checkbox':
        entry.irr = !!value.checkbox;
        break;
      case 'rich_text':
        if (/beispiel|example/i.test(name)) entry.ex = plain(value.rich_text);
        else if (!entry.de) entry.de = plain(value.rich_text);
        break;
      default:
        break;
    }
  }
  return entry;
}

const LEKTION_SIZE = 30;

async function loadVocab() {
  const raw = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notion('/data_sources/' + VOCAB_DS + '/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    for (const page of data.results) {
      const v = readVocab(page);
      if (v.ar && v.de) {
        v.created = page.created_time || '';
        raw.push(v);
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  // Reihenfolge des Hinzufügens in Notion bestimmt die Lektionen.
  raw.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  raw.forEach((v, i) => {
    v.idx = i;
    v.lektion = Math.floor(i / LEKTION_SIZE) + 1;
  });

  // Seiteninhalte (z. B. Konjugationstabellen) nebenläufig nachladen.
  await mapLimit(raw, 4, async (v) => {
    try {
      const blocks = await blockChildren(v.id);
      v.html = blocks.length ? await renderBlocks(blocks, []) : '';
    } catch {
      v.html = '';
    }
    v.detail = !!(v.html || v.ex);
  });

  // Für die Liste alphabetisch, die Lektion steckt in `lektion`.
  const out = raw.slice().sort((a, b) => a.ar.localeCompare(b.ar, 'es'));
  return out;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cache = null;          // { pages, root, vocab, builtAt }
let building = null;
let lastBuildStart = 0;

async function build() {
  if (!TOKEN) throw new Error('NOTION_TOKEN fehlt. In Railway unter Variables setzen.');

  const pages = {};
  const title = await pageTitle(ROOT_PAGE);
  const [, vocab] = await Promise.all([
    crawl(ROOT_PAGE, title, null, 0, pages, new Set()),
    loadVocab(),
  ]);

  markEmptyPages(pages);

  return {
    root: ROOT_PAGE,
    pages,
    vocab,
    builtAt: new Date().toISOString(),
  };
}

// Seiten ohne eigenen Inhalt und ohne Unterseiten grau darstellen —
// so sieht man auf einen Blick, was noch aussteht.
function markEmptyPages(pages) {
  for (const id in pages) {
    const p = pages[id];
    p.empty = !p.html.trim() && p.children.length === 0;
  }
  for (const id in pages) {
    const p = pages[id];
    p.children.forEach((child) => {
      const kid = pages[child.id];
      if (!kid || !kid.empty) return;
      const marker = '<button class="nav-card" data-page="' + child.id + '">';
      const idx = p.html.indexOf(marker);
      if (idx === -1) return;
      const end = p.html.indexOf('</button>', idx);
      if (end === -1) return;
      const inner = p.html.slice(idx + marker.length, end);
      const patched = inner.replace('</span><svg', '</span><span class="soon">bald</span><svg');
      p.html = p.html.slice(0, idx) +
        '<button class="nav-card empty" data-page="' + child.id + '">' +
        patched + p.html.slice(end);
    });
  }
}

function rebuild() {
  if (building) return building;
  if (Date.now() - lastBuildStart < MIN_REBUILD_MS && cache) {
    return Promise.resolve(cache);
  }
  lastBuildStart = Date.now();

  building = build()
    .then((data) => {
      cache = data;
      building = null;
      console.log('[cache] neu geladen:', Object.keys(data.pages).length, 'Seiten,', data.vocab.length, 'Vokabeln');
      return data;
    })
    .catch((err) => {
      building = null;
      console.error('[cache] Fehler:', err.message);
      throw err;
    });

  return building;
}

async function getContent() {
  if (!cache) return rebuild();
  const age = Date.now() - new Date(cache.builtAt).getTime();
  if (age > STALE_AFTER_MS) rebuild().catch(() => {});   // im Hintergrund
  return cache;
}

// ---------------------------------------------------------------------------
// Statische Dateien
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'text/plain', 'Verboten');

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain', 'Nicht gefunden');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const json = (res, status, obj) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/content') {
    try {
      const data = await getContent();
      return json(res, 200, data);
    } catch (err) {
      return json(res, 503, { error: err.message });
    }
  }

  if (url.pathname === '/api/refresh') {
    try {
      const data = await rebuild();
      return json(res, 200, { ok: true, builtAt: data.builtAt, vocab: data.vocab.length });
    } catch (err) {
      return json(res, 503, { ok: false, error: err.message });
    }
  }

  if (url.pathname === '/api/health') {
    return json(res, 200, {
      ok: !!cache,
      token: !!TOKEN,
      builtAt: cache ? cache.builtAt : null,
      pages: cache ? Object.keys(cache.pages).length : 0,
      vocab: cache ? cache.vocab.length : 0,
    });
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log('Server laeuft auf Port ' + PORT);
  rebuild().catch(() => {});   // Cache beim Start vorwaermen
});
