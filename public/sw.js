/* Sorgt dafuer, dass die App sofort startet und auch ohne Netz funktioniert. */

var VERSION = 'spanisch-v6';
var SHELL = ['/', '/index.html', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () {})
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === VERSION ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Aktualisieren muss immer frisch sein.
  if (url.pathname === '/api/refresh') return;

  // Inhalte: erst Netz, sonst der letzte bekannte Stand.
  if (url.pathname.indexOf('/api/') === 0) {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () { return caches.match(req); })
    );
    return;
  }

  // Alles andere: sofort aus dem Cache, im Hintergrund erneuern.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req)
        .then(function (res) {
          if (res && res.status === 200 && (url.origin === self.location.origin || res.type === 'cors')) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return hit; });
      return hit || net;
    })
  );
});
