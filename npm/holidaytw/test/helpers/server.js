'use strict';

const http = require('http');

/**
 * Minimal fake HTTP server for exercising the downloader against local
 * fixtures: normal 200 responses, redirects, HTTP error statuses, and
 * abrupt connection resets, all without any external dependency.
 *
 * @param {Record<string, Buffer|string|{redirect: string}|{status: number, body?: string}|{reset: true}|((req, res) => void)>} routes
 *   keyed by request pathname (e.g. "/checksums.txt")
 * @returns {Promise<{baseUrl: string, close: () => Promise<void>, server: http.Server}>}
 */
function createFakeServer(routes) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const route = routes[url.pathname];

      if (route === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }

      if (typeof route === 'function') {
        route(req, res);
        return;
      }

      if (Buffer.isBuffer(route) || typeof route === 'string') {
        const body = Buffer.isBuffer(route) ? route : Buffer.from(route);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
        res.end(body);
        return;
      }

      if (route.redirect) {
        res.writeHead(302, { location: route.redirect });
        res.end();
        return;
      }

      if (route.reset) {
        req.socket.destroy();
        return;
      }

      if (typeof route.status === 'number') {
        res.writeHead(route.status, { 'content-type': 'text/plain' });
        res.end(route.body || `status ${route.status}`);
        return;
      }

      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('unrecognized fake route');
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/`,
        server,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

module.exports = { createFakeServer };
