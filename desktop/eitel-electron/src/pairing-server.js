const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const wordsA = ['azul', 'rio', 'luna', 'norte', 'pino', 'sol', 'mapa', 'valle', 'bruma', 'faro'];
const wordsB = ['mesa', 'cable', 'nube', 'puente', 'llave', 'puerto', 'dato', 'red', 'cobre', 'viento'];

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json;charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function createCode(existingCodes) {
  for (let i = 0; i < 100; i++) {
    const code = [
      wordsA[crypto.randomInt(wordsA.length)],
      wordsB[crypto.randomInt(wordsB.length)],
      wordsA[crypto.randomInt(wordsA.length)],
      String(crypto.randomInt(1000, 10000)),
    ].join('-');
    if (!existingCodes.has(code)) return code;
  }
  return crypto.randomBytes(5).toString('hex');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function pruneRooms(rooms, now = Date.now()) {
  for (const [code, room] of rooms.entries()) {
    if (room.expiresAtMs <= now) rooms.delete(code);
  }
}

function createPairingServer({ ttlMs = 10 * 60 * 1000 } = {}) {
  const rooms = new Map();

  const server = http.createServer(async (req, res) => {
    const incoming = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    pruneRooms(rooms);

    if (req.method === 'OPTIONS') return sendJson(res, { ok: true });

    try {
      if (incoming.pathname === '/health') {
        return sendJson(res, { ok: true, rooms: rooms.size });
      }

      if (incoming.pathname === '/v1/rooms' && req.method === 'POST') {
        const payload = await readBody(req);
        const offer = payload.offer || payload.descriptor || null;
        if (!offer || typeof offer !== 'object') return sendJson(res, { ok: false, error: 'offer-required' }, 400);
        const code = createCode(rooms);
        const expiresAtMs = Date.now() + ttlMs;
        rooms.set(code, {
          code,
          offer,
          answer: null,
          createdAt: new Date().toISOString(),
          expiresAtMs,
        });
        return sendJson(res, { ok: true, code, expiresAt: new Date(expiresAtMs).toISOString() });
      }

      const roomMatch = incoming.pathname.match(/^\/v1\/rooms\/([^/]+)$/);
      if (roomMatch && req.method === 'GET') {
        const code = decodeURIComponent(roomMatch[1]);
        const room = rooms.get(code);
        if (!room) return sendJson(res, { ok: false, error: 'room-not-found' }, 404);
        return sendJson(res, {
          ok: true,
          code,
          offer: room.offer,
          answer: room.answer,
          expiresAt: new Date(room.expiresAtMs).toISOString(),
        });
      }

      const answerMatch = incoming.pathname.match(/^\/v1\/rooms\/([^/]+)\/answer$/);
      if (answerMatch && req.method === 'POST') {
        const code = decodeURIComponent(answerMatch[1]);
        const room = rooms.get(code);
        if (!room) return sendJson(res, { ok: false, error: 'room-not-found' }, 404);
        const payload = await readBody(req);
        const answer = payload.answer || payload.descriptor || null;
        if (!answer || typeof answer !== 'object') return sendJson(res, { ok: false, error: 'answer-required' }, 400);
        room.answer = answer;
        room.answeredAt = new Date().toISOString();
        return sendJson(res, { ok: true, code, offer: room.offer, answer: room.answer });
      }

      if (roomMatch && req.method === 'DELETE') {
        rooms.delete(decodeURIComponent(roomMatch[1]));
        return sendJson(res, { ok: true });
      }

      return sendJson(res, { ok: false, error: 'not-found' }, 404);
    } catch (error) {
      return sendJson(res, { ok: false, error: String(error.message || error) }, 500);
    }
  });

  return {
    server,
    rooms,
    listen(port = 8765, host = '127.0.0.1') {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  createPairingServer,
};
