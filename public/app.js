'use strict';

/* ================================================================== */
/* Konstanten                                                         */
/* ================================================================== */

var WORTARTEN = ['Substantiv', 'Verb', 'Adjektiv', 'Präposition', 'Adverb', 'Konjunktion', 'Redewendung'];
var AMOUNTS = [10, 20, 30, 50, 'Alle'];

var ART_DARK = { Substantiv: '#E0A458', Verb: '#5AAEE0', Adjektiv: '#63AF83', 'Präposition': '#C08FD0', Adverb: '#E0836B', Konjunktion: '#8494A6', Redewendung: '#D6C05C' };
var ART_LIGHT = { Substantiv: '#A86A16', Verb: '#26688F', Adjektiv: '#38815A', 'Präposition': '#814D96', Adverb: '#B44E31', Konjunktion: '#586471', Redewendung: '#8B7818' };

var CACHE_KEY = 'spanisch.inhalt.v3';
var BOX_KEY = 'spanisch.boxen.v1';
var THEME_KEY = 'spanisch.theme';

/* ================================================================== */
/* Zustand                                                            */
/* ================================================================== */

var DATA = null;
var stack = [];
var openVocab = null;
var tab = 'grammatik';

var el = {
  title: document.getElementById('title'),
  sub: document.getElementById('sub'),
  back: document.getElementById('back'),
  flagbox: document.getElementById('flagbox'),
  theme: document.getElementById('theme'),
  header: document.querySelector('header'),
  g: document.getElementById('v-grammatik'),
  v: document.getElementById('v-vokabeln'),
  t: document.getElementById('v-trainer'),
};

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function theme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function artColor(art) {
  var map = theme() === 'dark' ? ART_DARK : ART_LIGHT;
  return map[art] || 'var(--muted)';
}

function sortArten(list) {
  return list.slice().sort(function (a, b) {
    var ia = WORTARTEN.indexOf(a), ib = WORTARTEN.indexOf(b);
    if (ia === -1) ia = 99;
    if (ib === -1) ib = 99;
    return ia - ib || a.localeCompare(b, 'de');
  });
}
function artenOf() {
  var found = [];
  DATA.vocab.forEach(function (w) {
    if (w.art && found.indexOf(w.art) === -1) found.push(w.art);
  });
  return sortArten(found);
}
function maxLektion() {
  return DATA.vocab.reduce(function (m, w) { return Math.max(m, w.lektion || 1); }, 1);
}

/* ================================================================== */
/* Hell / dunkel                                                      */
/* ================================================================== */

el.theme.addEventListener('click', function () {
  var next = theme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', next === 'dark' ? '#0B1119' : '#FAF8F5');
  // Wortartfarben hängen am Thema.
  if (tab === 'vokabeln') renderVokabeln();
  if (tab === 'trainer' && !session) renderSetup();
  if (tab === 'trainer' && session) drawCard();
});

/* ================================================================== */
/* Laden                                                              */
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
        el.g.innerHTML = '<div class="state err"><p>Inhalte konnten nicht geladen werden.</p><p><code>' +
          escape(err.message) + '</code></p></div>';
      }
    });
}

var vSig = '';
function renderAll() {
  renderGrammatik();
  var sig = DATA.vocab.length + ':' + DATA.builtAt;
  if (sig !== vSig) { vSig = sig; renderVokabeln(); }
  if (!session) renderSetup();
}

/* ================================================================== */
/* Kopfzeile                                                          */
/* ================================================================== */

var SUBS = { grammatik: 'Gramática', vokabeln: 'Vocabulario', trainer: 'Practicar' };

function syncHeader() {
  var nested = (tab === 'grammatik' && stack.length > 1) || (tab === 'vokabeln' && openVocab);
  el.back.classList.toggle('on', !!nested);
  el.flagbox.style.display = nested ? 'none' : 'grid';

  if (nested) {
    if (tab === 'vokabeln') {
      el.title.textContent = openVocab.ar;
      el.sub.textContent = 'Vocabulario';
    } else {
      var page = DATA.pages[stack[stack.length - 1]];
      var parent = DATA.pages[stack[stack.length - 2]];
      el.title.textContent = page ? page.title : '';
      el.sub.textContent = parent ? parent.title : 'Gramática';
    }
  } else {
    el.title.innerHTML = 'Che, vamos a <span class="g">estudiar</span>';
    el.sub.textContent = SUBS[tab];
  }
}

/* ================================================================== */
/* Grammatik                                                          */
/* ================================================================== */

function renderGrammatik() {
  if (!DATA) return;
  var page = DATA.pages[stack[stack.length - 1]];
  if (!page) { stack = [DATA.root]; page = DATA.pages[DATA.root]; }
  if (!page) return;

  el.g.innerHTML = '<div class="doc">' + page.html + '</div>' + (stack.length === 1 ? footer() : '');
  if (stack.length === 1) bindSync();
  if (tab === 'grammatik') syncHeader();
}

function footer() {
  var d = DATA && DATA.builtAt ? new Date(DATA.builtAt) : null;
  var when = d
    ? d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }) + ' · ' +
      d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';
  return '<div class="foot"><span class="when">Stand ' + when + '</span>' +
    '<button id="sync"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>' +
    'Aus Notion aktualisieren</button></div>';
}

function bindSync() {
  var btn = document.getElementById('sync');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    fetchContent(true).finally(function () {
      var again = document.getElementById('sync');
      if (again) again.classList.remove('busy');
    });
  });
}

function openPage(id) {
  if (!DATA || !DATA.pages[id]) return;
  stack.push(id);
  renderGrammatik();
  window.scrollTo(0, 0);
}

el.back.addEventListener('click', function () {
  if (tab === 'vokabeln' && openVocab) {
    openVocab = null;
    renderVokabeln();
    syncHeader();
    window.scrollTo(0, 0);
    return;
  }
  if (stack.length > 1) {
    stack.pop();
    renderGrammatik();
    window.scrollTo(0, 0);
  }
});

document.querySelector('main').addEventListener('click', function (e) {
  var card = e.target.closest('.nav-card');
  if (card && card.dataset.page) { openPage(card.dataset.page); return; }
  var row = e.target.closest('button.vrow');
  if (row && row.dataset.id) showVocab(row.dataset.id);
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

var vFilter = { q: '', art: '', irr: false };

function renderVokabeln() {
  if (!DATA) return;
  if (openVocab) { renderEntry(); return; }

  var arten = artenOf();

  el.v.innerHTML =
    '<div class="search">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input type="search" id="q" placeholder="Suchen" autocomplete="off" autocorrect="off" spellcheck="false" value="' + escape(vFilter.q) + '">' +
    '</div>' +
    '<div class="chips scroll">' +
      '<button class="chip" data-art="" data-on="' + (vFilter.art === '' && !vFilter.irr ? '1' : '0') + '">Alle</button>' +
      arten.map(function (a) {
        var on = vFilter.art === a;
        return '<button class="chip dot" data-art="' + escape(a) + '" data-on="' + (on ? '1' : '0') + '"' +
          (on ? '' : ' style="color:' + artColor(a) + '"') + '>' + escape(a) + '</button>';
      }).join('') +
      '<button class="chip" id="irr-chip" data-on="' + (vFilter.irr ? '1' : '0') + '">Unregelmäßig</button>' +
    '</div>' +
    '<div class="vlist" id="vlist"></div>';

  var input = document.getElementById('q');
  input.addEventListener('input', function () { vFilter.q = input.value; drawList(); });

  el.v.querySelectorAll('.chip[data-art]').forEach(function (c) {
    c.addEventListener('click', function () {
      vFilter.art = c.dataset.art;
      if (c.dataset.art === '') vFilter.irr = false;
      renderVokabeln();
    });
  });
  document.getElementById('irr-chip').addEventListener('click', function () {
    vFilter.irr = !vFilter.irr;
    renderVokabeln();
  });

  drawList();
}

function matches(w) {
  if (vFilter.art && w.art !== vFilter.art) return false;
  if (vFilter.irr && !w.irr) return false;
  var q = vFilter.q.trim().toLowerCase();
  if (!q) return true;
  return (w.ar + ' ' + w.de).toLowerCase().indexOf(q) !== -1;
}

function drawList() {
  var list = document.getElementById('vlist');
  if (!list) return;
  var rows = DATA.vocab.filter(matches);

  if (!rows.length) {
    list.innerHTML = '<div class="state">Keine Treffer.</div>';
    return;
  }

  list.innerHTML =
    '<p class="listcount">' + rows.length + (rows.length === 1 ? ' Wort' : ' Wörter') + '</p>' +
    rows.map(function (w) {
      var inner =
        '<span class="es">' + escape(w.ar) + '</span>' +
        (w.irr ? '<span class="irr" title="unregelmäßig"></span>' : '') +
        '<span class="de">' + escape(w.de) + '</span>' +
        (w.detail ? '<span class="dot"></span>' : '<span class="gap"></span>');
      return w.detail
        ? '<button class="vrow" data-id="' + escape(w.id) + '">' + inner + '</button>'
        : '<div class="vrow">' + inner + '</div>';
    }).join('');
}

function showVocab(id) {
  var w = DATA.vocab.find(function (x) { return x.id === id; });
  if (!w) return;
  openVocab = w;
  renderEntry();
  syncHeader();
  window.scrollTo(0, 0);
}

function renderEntry() {
  var w = openVocab;
  el.v.innerHTML =
    '<div class="entry">' +
      '<div class="es">' + escape(w.ar) + '</div>' +
      '<div class="de">' + escape(w.de) + '</div>' +
      '<div class="entry-meta">' +
        (w.art ? '<span class="tagpill" style="color:' + artColor(w.art) + '">' + escape(w.art) + '</span>' : '') +
        (w.irr ? '<span class="tagpill" style="color:var(--gold)">unregelmäßig</span>' : '') +
        (w.lektion ? '<span class="tagpill" style="color:var(--muted-dim)">Lektion ' + w.lektion + '</span>' : '') +
      '</div>' +
    '</div>' +
    (w.ex ? '<div class="entry-ex">' + escape(w.ex) + '</div>' : '') +
    (w.html ? '<hr class="entry-sep"><div class="doc">' + w.html + '</div>' : '');
}

/* ================================================================== */
/* Trainer                                                            */
/* ================================================================== */

var opts = { dir: 'ar2de', arten: null, lekt: null, irr: false, amount: 'Alle' };
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
    if (opts.arten && opts.arten.size && !opts.arten.has(w.art)) return false;
    if (opts.lekt && opts.lekt.size && !opts.lekt.has(w.lektion)) return false;
    if (opts.irr && !w.irr) return false;
    return true;
  });
}

function renderSetup() {
  if (!DATA) return;
  if (!opts.arten) opts.arten = new Set();
  if (!opts.lekt) opts.lekt = new Set();

  var arten = artenOf();
  var lektionen = [];
  for (var i = 1; i <= maxLektion(); i++) lektionen.push(i);

  var avail = pool().length;
  var eff = opts.amount === 'Alle' ? avail : Math.min(opts.amount, avail);

  el.t.innerHTML =
    '<div class="panel">' +
      '<div class="field">' +
        '<span class="flabel">Richtung</span>' +
        '<button class="dirtoggle" id="dir">' +
          '<span class="lang"><span class="fl">🇦🇷</span>Spanisch</span>' +
          '<span class="arrow" data-rev="' + (opts.dir === 'de2ar' ? '1' : '0') + '">' +
            '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
          '</span>' +
          '<span class="lang"><span class="fl">🇩🇪</span>Deutsch</span>' +
        '</button>' +
      '</div>' +

      '<div class="field">' +
        '<span class="flabel">Lektionen</span>' +
        '<div class="chips">' +
          '<button class="chip" data-lek="" data-on="' + (opts.lekt.size === 0 ? '1' : '0') + '">Alle</button>' +
          lektionen.map(function (l) {
            var n = DATA.vocab.filter(function (w) { return w.lektion === l; }).length;
            return '<button class="chip" data-lek="' + l + '" data-on="' + (opts.lekt.has(l) ? '1' : '0') + '">' +
              l + '<span class="n">' + n + '</span></button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="field">' +
        '<span class="flabel">Wortarten</span>' +
        '<div class="chips">' +
          '<button class="chip" data-art="" data-on="' + (opts.arten.size === 0 ? '1' : '0') + '">Alle</button>' +
          arten.map(function (a) {
            var on = opts.arten.has(a);
            var n = DATA.vocab.filter(function (w) { return w.art === a; }).length;
            return '<button class="chip dot" data-art="' + escape(a) + '" data-on="' + (on ? '1' : '0') + '"' +
              (on ? '' : ' style="color:' + artColor(a) + '"') + '>' + escape(a) +
              '<span class="n">' + n + '</span></button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="field">' +
        '<span class="flabel">Nur unregelmäßige</span>' +
        '<div class="chips">' +
          '<button class="chip" id="t-irr" data-on="' + (opts.irr ? '1' : '0') + '">Unregelmäßig' +
          '<span class="n">' + DATA.vocab.filter(function (w) { return w.irr; }).length + '</span></button>' +
        '</div>' +
      '</div>' +

      '<div class="field">' +
        '<span class="flabel">Anzahl</span>' +
        '<div class="amtrow">' +
          AMOUNTS.map(function (a) {
            var dis = a !== 'Alle' && a > avail;
            return '<button class="amt" data-amt="' + a + '" data-on="' + (String(opts.amount) === String(a) ? '1' : '0') + '"' +
              (dis ? ' disabled' : '') + '>' + a + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="panel-foot">' +
        '<span class="count">' + eff + ' von ' + avail + ' Wörtern</span>' +
        '<button class="start" id="go"' + (eff ? '' : ' disabled') + '>Los</button>' +
      '</div>' +
    '</div>';

  document.getElementById('dir').addEventListener('click', function () {
    opts.dir = opts.dir === 'ar2de' ? 'de2ar' : 'ar2de';
    renderSetup();
  });

  el.t.querySelectorAll('.chip[data-lek]').forEach(function (c) {
    c.addEventListener('click', function () {
      var v = c.dataset.lek;
      if (v === '') opts.lekt = new Set();
      else {
        var n = Number(v);
        if (opts.lekt.has(n)) opts.lekt.delete(n); else opts.lekt.add(n);
      }
      renderSetup();
    });
  });

  el.t.querySelectorAll('.chip[data-art]').forEach(function (c) {
    c.addEventListener('click', function () {
      var v = c.dataset.art;
      if (v === '') opts.arten = new Set();
      else if (opts.arten.has(v)) opts.arten.delete(v);
      else opts.arten.add(v);
      renderSetup();
    });
  });

  document.getElementById('t-irr').addEventListener('click', function () {
    opts.irr = !opts.irr;
    renderSetup();
  });

  el.t.querySelectorAll('.amt').forEach(function (b) {
    b.addEventListener('click', function () {
      opts.amount = b.dataset.amt === 'Alle' ? 'Alle' : Number(b.dataset.amt);
      renderSetup();
    });
  });

  var go = document.getElementById('go');
  if (go) go.addEventListener('click', startSession);
}

function shuffle(a0) {
  var a = a0.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function startSession() {
  var b = boxes();
  var candidates = pool().slice();

  // Wörter in niedrigen Fächern kommen häufiger dran.
  candidates.forEach(function (w) { w._w = Math.random() * (b[w.id] || 1); });
  candidates.sort(function (x, y) { return x._w - y._w; });

  var n = opts.amount === 'Alle' ? candidates.length : Math.min(opts.amount, candidates.length);
  var queue = shuffle(candidates.slice(0, n));

  session = { queue: queue, total: queue.length, done: 0, misses: {}, open: false, history: [] };
  drawCard();
}

function drawCard() {
  if (!session.queue.length) return finish();

  var w = session.queue[0];
  var front = opts.dir === 'ar2de' ? w.ar : w.de;
  var back = opts.dir === 'ar2de' ? w.de : w.ar;
  var missCount = Object.keys(session.misses).length;

  var ticks = '';
  for (var i = 0; i < session.total; i++) {
    var s = i < session.done ? 'done' : (i === session.done ? 'now' : '');
    ticks += '<span class="tick" data-s="' + s + '"></span>';
  }

  el.t.innerHTML =
    '<div class="study">' +
      '<div class="ticks">' + ticks + '</div>' +
      '<div class="meta">' +
        '<span class="l"><b>' + session.done + '</b> / ' + session.total + '</span>' +
        '<span class="r">' + (missCount ? '<span class="miss">' + missCount + ' offen</span>' : 'ohne Fehler') + '</span>' +
      '</div>' +
      '<div class="vcard" id="card" data-solved="0">' +
        '<span class="badge" style="color:' + artColor(w.art) + '">' + escape(w.art || 'Wort') + '</span>' +
        '<p class="word" id="word">' + escape(front) + '</p>' +
        '<p class="ex" id="ex" style="visibility:hidden">' + escape(w.ex || '') + '</p>' +
        '<span class="hint" id="hint">Tippen zum Aufdecken</span>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="navback" id="undo"' + (session.history.length ? '' : ' disabled') + ' aria-label="Zurück">' +
          '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>' +
        '</button>' +
        '<button class="judge no" id="no">Nochmal</button>' +
        '<button class="judge yes" id="yes">Gewusst</button>' +
      '</div>' +
    '</div>';

  var card = document.getElementById('card');
  session.open = false;

  card.addEventListener('click', function () {
    if (session.open) return;
    session.open = true;
    card.dataset.solved = '1';
    document.getElementById('word').textContent = back;
    document.getElementById('hint').style.visibility = 'hidden';
    if (w.ex) document.getElementById('ex').style.visibility = 'visible';
  });

  document.getElementById('no').addEventListener('click', function () { answer(false); });
  document.getElementById('yes').addEventListener('click', function () { answer(true); });

  var undo = document.getElementById('undo');
  if (undo && session.history.length) {
    undo.addEventListener('click', function () {
      var prev = session.history.pop();
      session.queue = prev.queue;
      session.done = prev.done;
      session.misses = prev.misses;
      drawCard();
    });
  }
}

function answer(known) {
  session.history.push({
    queue: session.queue.slice(),
    done: session.done,
    misses: Object.assign({}, session.misses),
  });
  if (session.history.length > 20) session.history.shift();

  var w = session.queue.shift();
  var box = boxes()[w.id] || 1;

  if (known) {
    setBox(w.id, Math.min(5, box + 1));
    session.done++;
    delete session.misses[w.id];
  } else {
    setBox(w.id, 1);
    session.misses[w.id] = (session.misses[w.id] || 0) + 1;
    session.queue.splice(Math.min(4, session.queue.length), 0, w);
  }
  drawCard();
}

function finish() {
  var tough = Object.keys(session.misses)
    .map(function (id) {
      return { w: DATA.vocab.find(function (x) { return x.id === id; }), n: session.misses[id] };
    })
    .filter(function (x) { return x.w; })
    .sort(function (a, b) { return b.n - a.n; })
    .slice(0, 5);

  el.t.innerHTML =
    '<div class="done">' +
      '<div class="mark">¡Listo!</div>' +
      '<h2>' + session.total + (session.total === 1 ? ' Wort' : ' Wörter') + ' durch</h2>' +
      '<p>' + (tough.length ? 'Ein paar sitzen noch nicht ganz.' : 'Alles auf Anhieb gewusst.') + '</p>' +
      (tough.length
        ? '<div class="tough"><h3>Noch üben</h3><ul>' +
          tough.map(function (t) {
            return '<li><span class="es">' + escape(t.w.ar) + '</span>' +
              '<span class="de">' + escape(t.w.de) + '</span>' +
              '<span class="n">' + t.n + '×</span></li>';
          }).join('') + '</ul></div>'
        : '') +
      '<div class="again">' +
        '<button id="same">Nochmal</button>' +
        '<button class="primary" id="new">Neue Auswahl</button>' +
      '</div>' +
    '</div>';

  document.getElementById('same').addEventListener('click', startSession);
  document.getElementById('new').addEventListener('click', function () {
    session = null;
    renderSetup();
  });
}

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
