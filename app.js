'use strict';

/* ================================================================== */
/* Zustand                                                            */
/* ================================================================== */

var DATA = null;          // { root, pages, vocab, builtAt }
var stack = [];           // Navigationsverlauf innerhalb "Grammatik"
var tab = 'grammatik';

var CACHE_KEY = 'spanisch.inhalt.v2';
var BOX_KEY = 'spanisch.boxen.v1';

var el = {
  title:  document.getElementById('title'),
  back:   document.getElementById('back'),
  backLabel: document.getElementById('back-label'),
  sync:   document.getElementById('sync'),
  header: document.querySelector('header'),
  g:      document.getElementById('v-grammatik'),
  v:      document.getElementById('v-vokabeln'),
  t:      document.getElementById('v-trainer'),
};

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* ================================================================== */
/* Laden — erst aus dem lokalen Speicher, dann aus dem Netz           */
/* ================================================================== */

function boot() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}

  if (saved && saved.pages) {
    DATA = saved;
    stack = [DATA.root];
    renderAll();
  } else {
    el.g.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }

  fetchContent(false);
}

function fetchContent(force) {
  return fetch(force ? '/api/refresh' : '/api/content', { cache: 'no-store' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Serverfehler');
      if (force) return fetch('/api/content', { cache: 'no-store' }).then(function (r) { return r.json(); });
      return res.body;
    })
    .then(function (data) {
      if (!data || !data.pages) throw new Error('Leere Antwort');
      var first = !DATA;
      DATA = data;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
      if (first || !stack.length) stack = [DATA.root];
      renderAll();
    })
    .catch(function (err) {
      if (!DATA) {
        el.g.innerHTML =
          '<div class="state err"><p>Inhalte konnten nicht geladen werden.</p>' +
          '<p><code>' + escape(err.message) + '</code></p></div>';
      }
    });
}

var vSignature = '';

function renderAll() {
  renderGrammatik();

  // Die Liste nur neu aufbauen, wenn sich die Vokabeln geändert haben —
  // sonst verliert die Suche mitten im Tippen den Fokus.
  var sig = DATA.vocab.length + ':' + DATA.builtAt;
  if (sig !== vSignature) {
    vSignature = sig;
    renderVokabeln();
  }

  if (!session) renderSetup();
}

/* ================================================================== */
/* Grammatik                                                          */
/* ================================================================== */

function renderGrammatik() {
  if (!DATA) return;
  var id = stack[stack.length - 1];
  var page = DATA.pages[id];
  if (!page) { stack = [DATA.root]; page = DATA.pages[DATA.root]; }
  if (!page) return;

  el.g.innerHTML = '<div class="doc">' + page.html + '</div>' +
    (stack.length === 1 ? '<p class="stamp">' + stamp() + '</p>' : '');

  if (tab === 'grammatik') syncHeader();
}

function stamp() {
  if (!DATA || !DATA.builtAt) return '';
  var d = new Date(DATA.builtAt);
  return 'Stand ' + d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }) +
         ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function syncHeader() {
  if (tab !== 'grammatik' || stack.length < 2) {
    el.back.classList.remove('on');
  } else {
    el.back.classList.add('on');
    var parent = DATA.pages[stack[stack.length - 2]];
    el.backLabel.textContent = parent ? parent.title : 'Zurück';
  }

  if (tab === 'grammatik') {
    var page = DATA && DATA.pages[stack[stack.length - 1]];
    el.title.textContent = page ? page.title : 'Spanisch';
  } else if (tab === 'vokabeln') {
    el.title.textContent = 'Vokabeln';
  } else {
    el.title.textContent = 'Üben';
  }
}

function openPage(id) {
  if (!DATA || !DATA.pages[id]) return;
  stack.push(id);
  renderGrammatik();
  window.scrollTo(0, 0);
}

el.back.addEventListener('click', function () {
  if (stack.length > 1) {
    stack.pop();
    renderGrammatik();
    window.scrollTo(0, 0);
  }
});

/* Klicks auf Navigationskarten — egal in welchem Tab */
document.querySelector('main').addEventListener('click', function (e) {
  var card = e.target.closest('.nav-card');
  if (!card) return;
  if (card.dataset.page) openPage(card.dataset.page);
  else if (card.dataset.tab) switchTab(card.dataset.tab);
});

/* ================================================================== */
/* Tabs                                                               */
/* ================================================================== */

function switchTab(name) {
  tab = name;
  document.querySelectorAll('nav button').forEach(function (b) {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  document.querySelectorAll('.view').forEach(function (v) {
    v.classList.toggle('on', v.id === 'v-' + name);
  });
  syncHeader();
  window.scrollTo(0, 0);
}

document.querySelectorAll('nav button').forEach(function (b) {
  b.addEventListener('click', function () { switchTab(b.dataset.tab); });
});

/* ================================================================== */
/* Vokabeln                                                           */
/* ================================================================== */

var vFilter = { q: '', art: '' };

function renderVokabeln() {
  if (!DATA) return;
  var arten = [];
  DATA.vocab.forEach(function (w) {
    if (w.art && arten.indexOf(w.art) === -1) arten.push(w.art);
  });
  arten.sort();

  el.v.innerHTML =
    '<div class="search">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="search" id="q" placeholder="Suchen" autocomplete="off" autocorrect="off" spellcheck="false" value="' + escape(vFilter.q) + '">' +
    '</div>' +
    '<div class="chips">' +
      '<button class="chip" data-art="" aria-pressed="' + (vFilter.art === '') + '">Alle</button>' +
      arten.map(function (a) {
        return '<button class="chip" data-art="' + escape(a) + '" aria-pressed="' + (vFilter.art === a) + '">' + escape(a) + '</button>';
      }).join('') +
    '</div>' +
    '<div id="vlist"></div>';

  var input = document.getElementById('q');
  input.addEventListener('input', function () { vFilter.q = input.value; drawList(); });

  el.v.querySelectorAll('.chip').forEach(function (c) {
    c.addEventListener('click', function () {
      vFilter.art = c.dataset.art;
      el.v.querySelectorAll('.chip').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x.dataset.art === vFilter.art));
      });
      drawList();
    });
  });

  drawList();
}

function matches(w) {
  if (vFilter.art && w.art !== vFilter.art) return false;
  var q = vFilter.q.trim().toLowerCase();
  if (!q) return true;
  return (w.ar + ' ' + w.de).toLowerCase().indexOf(q) !== -1;
}

function drawList() {
  var list = document.getElementById('vlist');
  if (!list) return;
  var rows = DATA.vocab.filter(matches);

  if (!rows.length) {
    list.innerHTML = '<div class="state">Keine Treffer. Andere Schreibweise probieren?</div>';
    return;
  }

  list.innerHTML =
    '<p class="count">' + rows.length + (rows.length === 1 ? ' Wort' : ' Wörter') + '</p>' +
    rows.map(function (w) {
      return '<div class="vocab-row">' +
        '<span class="es">' + escape(w.ar) + '</span>' +
        (w.irr ? '<span class="irr" title="unregelmäßig"></span>' : '') +
        '<span class="de">' + escape(w.de) + '</span>' +
      '</div>' +
      (w.ex ? '<div class="vocab-ex">' + escape(w.ex) + '</div>' : '');
    }).join('');
}

/* ================================================================== */
/* Trainer                                                            */
/* ================================================================== */

var opts = { dir: 'ar', art: '', only: 'alle', size: 20 };
var session = null;

function boxes() {
  try { return JSON.parse(localStorage.getItem(BOX_KEY) || '{}'); } catch (e) { return {}; }
}
function setBox(id, n) {
  var b = boxes();
  b[id] = n;
  try { localStorage.setItem(BOX_KEY, JSON.stringify(b)); } catch (e) {}
}

function pool() {
  return DATA.vocab.filter(function (w) {
    if (opts.art && w.art !== opts.art) return false;
    if (opts.only === 'irr' && !w.irr) return false;
    return true;
  });
}

function renderSetup() {
  if (!DATA) return;
  var arten = [];
  DATA.vocab.forEach(function (w) { if (w.art && arten.indexOf(w.art) === -1) arten.push(w.art); });
  arten.sort();

  var available = pool().length;
  var b = boxes();
  var learned = DATA.vocab.filter(function (w) { return (b[w.id] || 1) >= 4; }).length;

  el.t.innerHTML =
    '<div class="setup">' +
      '<h2>Richtung</h2>' +
      '<div class="seg" id="dir">' +
        '<button data-v="ar" aria-selected="' + (opts.dir === 'ar') + '">Spanisch → Deutsch</button>' +
        '<button data-v="de" aria-selected="' + (opts.dir === 'de') + '">Deutsch → Spanisch</button>' +
      '</div>' +

      '<h2>Auswahl</h2>' +
      '<div class="chips">' +
        '<button class="chip" data-art="" aria-pressed="' + (opts.art === '') + '">Alle Wortarten</button>' +
        arten.map(function (a) {
          return '<button class="chip" data-art="' + escape(a) + '" aria-pressed="' + (opts.art === a) + '">' + escape(a) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="seg" id="only">' +
        '<button data-v="alle" aria-selected="' + (opts.only === 'alle') + '">Alle</button>' +
        '<button data-v="irr" aria-selected="' + (opts.only === 'irr') + '">Nur unregelmäßige</button>' +
      '</div>' +

      '<h2>Länge</h2>' +
      '<div class="seg" id="size">' +
        [10, 20, 40].map(function (n) {
          return '<button data-v="' + n + '" aria-selected="' + (opts.size === n) + '">' + n + '</button>';
        }).join('') +
      '</div>' +

      '<button class="start" id="go"' + (available ? '' : ' disabled') + '>' +
        (available ? 'Runde starten' : 'Keine Wörter in dieser Auswahl') +
      '</button>' +
      '<p class="stamp">' + available + ' Wörter verfügbar · ' + learned + ' sitzen bereits</p>' +
    '</div>';

  bindSeg('dir', function (v) { opts.dir = v; renderSetup(); });
  bindSeg('only', function (v) { opts.only = v; renderSetup(); });
  bindSeg('size', function (v) { opts.size = Number(v); renderSetup(); });

  el.t.querySelectorAll('.chip').forEach(function (c) {
    c.addEventListener('click', function () { opts.art = c.dataset.art; renderSetup(); });
  });

  var go = document.getElementById('go');
  if (go) go.addEventListener('click', startSession);
}

function bindSeg(id, fn) {
  var wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () { fn(b.dataset.v); });
  });
}

function startSession() {
  var b = boxes();
  var candidates = pool().slice();

  // Woerter in niedrigen Faechern kommen haeufiger dran.
  candidates.forEach(function (w) {
    var box = b[w.id] || 1;
    w._w = Math.random() * box;
  });
  candidates.sort(function (x, y) { return x._w - y._w; });

  var queue = candidates.slice(0, Math.min(opts.size, candidates.length));
  for (var i = queue.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = queue[i]; queue[i] = queue[j]; queue[j] = t;
  }

  session = { queue: queue, total: queue.length, done: 0, open: false };
  drawCard();
}

function drawCard() {
  if (!session.queue.length) return finish();

  var w = session.queue[0];
  var front = opts.dir === 'ar' ? w.ar : w.de;
  var back = opts.dir === 'ar' ? w.de : w.ar;
  var pct = session.total ? (session.done / session.total) * 100 : 0;

  el.t.innerHTML =
    '<div class="progress">' +
      '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div>' +
      '<span class="n">' + session.done + '/' + session.total + '</span>' +
    '</div>' +
    '<button class="card' + (w.irr ? ' irr' : '') + '" id="card">' +
      '<span class="tag">' + escape(w.art || '') + '</span>' +
      '<span class="sun" title="unregelmäßig"></span>' +
      '<span class="front">' + escape(front) + '</span>' +
      '<span class="back">' + escape(back) + '</span>' +
      (w.ex ? '<span class="ex">' + escape(w.ex) + '</span>' : '') +
      '<span class="hint">Tippen zum Aufdecken</span>' +
    '</button>' +
    '<div class="answers" id="answers">' +
      '<button class="ag" data-a="0">Nochmal</button>' +
      '<button class="ok" data-a="1">Gewusst</button>' +
    '</div>';

  var card = document.getElementById('card');
  var answers = document.getElementById('answers');

  card.addEventListener('click', function () {
    if (session.open) return;
    session.open = true;
    card.classList.add('open');
    answers.classList.add('on');
  });

  answers.querySelectorAll('button').forEach(function (btn) {
    btn.addEventListener('click', function () { answer(btn.dataset.a === '1'); });
  });

  session.open = false;
}

function answer(known) {
  var w = session.queue.shift();
  var b = boxes();
  var box = b[w.id] || 1;

  if (known) {
    setBox(w.id, Math.min(5, box + 1));
    session.done++;
  } else {
    setBox(w.id, 1);
    // Nicht gewusste Woerter kommen in derselben Runde noch einmal.
    session.queue.splice(Math.min(4, session.queue.length), 0, w);
  }

  drawCard();
}

function finish() {
  el.t.innerHTML =
    '<div class="done-panel">' +
      '<div class="sol">¡Listo!</div>' +
      '<p>' + session.total + (session.total === 1 ? ' Wort' : ' Wörter') + ' durch.</p>' +
      '<button class="start" id="again">Neue Runde</button>' +
    '</div>';
  document.getElementById('again').addEventListener('click', function () {
    session = null;
    renderSetup();
  });
}

/* ================================================================== */
/* Aktualisieren                                                      */
/* ================================================================== */

el.sync.addEventListener('click', function () {
  if (el.sync.classList.contains('busy')) return;
  el.sync.classList.add('busy');
  fetchContent(true).finally(function () {
    el.sync.classList.remove('busy');
  });
});

/* ================================================================== */
/* Kleinkram                                                          */
/* ================================================================== */

window.addEventListener('scroll', function () {
  el.header.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

boot();
