const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { profiles, getProfile } = require('./profiles');
const { createPairingServer } = require('./pairing-server');

const textTypes = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt', '.map']);
const mimeTypes = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const AUTH_ITERATIONS = 210000;
const AUTH_KEY_LENGTH = 32;
const AUTH_DIGEST = 'sha256';
const DESKTOP_SESSION_COOKIE = 'eitel_desktop_session';
const APP_AUTH_COOKIE = 'eitel_desktop_auth';
const DEFAULT_PAIRING_SERVER_URL = 'http://127.0.0.1:8765';
const DEFAULT_PAIRING_HOST = '127.0.0.1';
const DEFAULT_PAIRING_PORT = 8765;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

function createLogger(userDataDir) {
  const logPath = path.join(userDataDir, 'desktop.log');
  function write(level, message, meta = null) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta } : {}),
    };
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {}
  }
  return {
    path: logPath,
    info(message, meta) { write('info', message, meta); },
    warn(message, meta) { write('warn', message, meta); },
    error(message, meta) { write('error', message, meta); },
  };
}

function hashPassword(password, salt, iterations = AUTH_ITERATIONS) {
  return crypto.pbkdf2Sync(String(password || ''), salt, iterations, AUTH_KEY_LENGTH, AUTH_DIGEST).toString('hex');
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createStore(settingsPath) {
  const data = readJson(settingsPath, { profiles: {}, lastProfileId: profiles[0].id, auth: null, pairing: null, identity: null });
  return {
    getCredentials(profileId) {
      return data.profiles?.[profileId] || {};
    },
    getLastProfileId() {
      return data.lastProfileId || profiles[0].id;
    },
    saveCredentials(profileId, credentials) {
      const base = getProfile(profileId);
      const current = data.profiles?.[profileId] || {};
      data.profiles = data.profiles || {};
      data.profiles[profileId] = {
        ...current,
        apiKey: String(credentials.apiKey || '').trim(),
        localAssetsToken: String(credentials.localAssetsToken || '').trim(),
        remoteOrigin: String(credentials.remoteOrigin || base.remoteOrigin || '').trim().replace(/\/+$/, ''),
        remotePrefix: normalizePrefix(credentials.remotePrefix || base.remotePrefix || ''),
        connectorName: String(credentials.connectorName || base.connectorName || '').trim(),
        dspUrl: String(credentials.dspUrl || base.dspUrl || '').trim(),
      };
      data.lastProfileId = profileId;
      writeJson(settingsPath, data);
    },
    savePeerDescriptor(profileId, descriptor, meta = {}) {
      const base = getProfile(profileId);
      const current = data.profiles?.[profileId] || {};
      const remoteOrigin = String(descriptor.remoteOrigin || current.remoteOrigin || base.remoteOrigin || '').trim().replace(/\/+$/, '');
      const remotePrefix = normalizePrefix(descriptor.remotePrefix || current.remotePrefix || base.remotePrefix || '');
      const connectorName = String(descriptor.connectorName || current.connectorName || base.connectorName || '').trim();
      const dspUrl = String(descriptor.dspUrl || current.dspUrl || base.dspUrl || '').trim();
      data.profiles = data.profiles || {};
      data.profiles[profileId] = {
        ...current,
        remoteOrigin,
        remotePrefix,
        connectorName,
        dspUrl,
        peerName: String(descriptor.name || connectorName || base.name || '').trim(),
        peerNodeId: String(descriptor.nodeId || '').trim(),
        pairedAt: new Date().toISOString(),
        pairingCode: String(meta.code || '').trim(),
      };
      writeJson(settingsPath, data);
    },
    rememberProfile(profileId) {
      data.lastProfileId = profileId;
      writeJson(settingsPath, data);
    },
    isAuthConfigured() {
      return Boolean(data.auth?.passwordHash && data.auth?.salt);
    },
    setupPassword(password) {
      const raw = String(password || '');
      if (raw.length < 8) throw new Error('La contrasena debe tener al menos 8 caracteres.');
      const salt = crypto.randomBytes(16).toString('hex');
      data.auth = {
        version: 1,
        salt,
        iterations: AUTH_ITERATIONS,
        digest: AUTH_DIGEST,
        passwordHash: hashPassword(raw, salt, AUTH_ITERATIONS),
        createdAt: new Date().toISOString(),
      };
      writeJson(settingsPath, data);
    },
    verifyPassword(password) {
      if (!this.isAuthConfigured()) return false;
      const iterations = Number(data.auth.iterations || AUTH_ITERATIONS);
      const candidate = hashPassword(String(password || ''), data.auth.salt, iterations);
      return timingSafeEqualHex(candidate, data.auth.passwordHash);
    },
    getPairingSettings() {
      data.pairing = data.pairing || {};
      return {
        serverUrl: String(data.pairing.serverUrl || DEFAULT_PAIRING_SERVER_URL).trim(),
      };
    },
    savePairingSettings(settings) {
      data.pairing = data.pairing || {};
      data.pairing.serverUrl = String(settings.serverUrl || DEFAULT_PAIRING_SERVER_URL).trim().replace(/\/+$/, '');
      writeJson(settingsPath, data);
      return this.getPairingSettings();
    },
    getIdentity() {
      if (!data.identity?.nodeId) {
        data.identity = {
          nodeId: `node-${crypto.randomBytes(8).toString('hex')}`,
          publicKey: crypto.randomBytes(32).toString('hex'),
          createdAt: new Date().toISOString(),
        };
        writeJson(settingsPath, data);
      }
      return data.identity;
    },
  };
}

function normalizePrefix(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf('=');
      if (index < 0) return acc;
      acc[decodeURIComponent(item.slice(0, index))] = decodeURIComponent(item.slice(index + 1));
      return acc;
    }, {});
}

function cookie(name, value) {
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict; HttpOnly`;
}

function expiredCookie(name) {
  return `${name}=; Path=/; SameSite=Strict; HttpOnly; Max-Age=0`;
}

function hasSessionAccess(req, incoming, sessionToken) {
  const queryToken = incoming.searchParams.get('desktopSession') || '';
  const headerToken = req.headers['x-eitel-desktop-session'] || '';
  const cookieToken = parseCookies(req.headers.cookie)[DESKTOP_SESSION_COOKIE] || '';
  return [queryToken, headerToken, cookieToken].some((value) => String(value) === sessionToken);
}

function send(res, status, body, contentType = 'text/plain;charset=utf-8', extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function sendJson(res, payload, status = 200, extraHeaders = {}) {
  send(res, status, JSON.stringify(payload), 'application/json;charset=utf-8', extraHeaders);
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await getRequestBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8'));
}

function sanitizePath(rawPath) {
  const withoutQuery = String(rawPath || '').split('?')[0] || '/';
  const normalized = path.normalize(decodeURIComponent(withoutQuery)).replace(/^(\.\.[/\\])+/, '');
  return normalized.replace(/^[/\\]+/, '');
}

function resolveProfile(store, profileId) {
  const base = getProfile(profileId);
  const saved = store.getCredentials(base.id);
  const remoteOrigin = String(saved.remoteOrigin || base.remoteOrigin || '').trim().replace(/\/+$/, '');
  const remotePrefix = normalizePrefix(saved.remotePrefix || base.remotePrefix || '');
  const connectorName = String(saved.connectorName || base.connectorName || '').trim();
  const dspUrl = String(saved.dspUrl || base.dspUrl || '').trim();
  return {
    ...base,
    remoteOrigin,
    remotePrefix,
    connectorName,
    dspUrl,
  };
}

function resolveProfiles(store) {
  return profiles.map((profile) => resolveProfile(store, profile.id));
}

function getResolvedProfileByPrefix(store, prefix) {
  const normalized = String(prefix || '').toLowerCase();
  return resolveProfiles(store).find((profile) => String(profile.prefix || '').toLowerCase() === normalized) || null;
}

function getConnectorDirectoryForStore(store) {
  return resolveProfiles(store).reduce((acc, profile) => {
    acc[profile.connectorName] = profile.dspUrl;
    return acc;
  }, {});
}

function profilesForClient(store) {
  return resolveProfiles(store).map((profile) => {
    const credentials = store.getCredentials(profile.id);
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      peerName: credentials.peerName || '',
      peerNodeId: credentials.peerNodeId || '',
      pairedAt: credentials.pairedAt || '',
      prefix: profile.prefix,
      connectorName: profile.connectorName,
      dspUrl: profile.dspUrl,
      remoteOrigin: profile.remoteOrigin,
      remotePrefix: profile.remotePrefix,
      remoteBase: `${profile.remoteOrigin}${profile.remotePrefix}`,
      apiKey: credentials.apiKey || '',
      localAssetsToken: credentials.localAssetsToken || '',
    };
  });
}

function buildPeerDescriptor(store, profileId) {
  const profile = resolveProfile(store, profileId);
  const identity = store.getIdentity();
  return {
    version: 1,
    nodeId: identity.nodeId,
    publicKey: identity.publicKey,
    profileId: profile.id,
    name: profile.name,
    description: profile.description,
    connectorName: profile.connectorName,
    prefix: profile.prefix,
    remoteOrigin: profile.remoteOrigin,
    remotePrefix: profile.remotePrefix,
    dspUrl: profile.dspUrl,
    managementUrl: `${profile.remoteOrigin}${profile.remotePrefix}/api/management`,
    localAssetsUrl: `${profile.remoteOrigin}${profile.remotePrefix}/local-assets`,
    downloadSinkUrl: `${profile.remoteOrigin}${profile.remotePrefix}/download-sink`,
    createdAt: new Date().toISOString(),
  };
}

function normalizePairingServerUrl(value) {
  return String(value || DEFAULT_PAIRING_SERVER_URL).trim().replace(/\/+$/, '');
}

function describePairingRuntime(runtime) {
  if (!runtime) {
    return {
      mode: 'unavailable',
      running: false,
      serverUrl: DEFAULT_PAIRING_SERVER_URL,
      message: 'Rendezvous no iniciado.',
    };
  }
  return {
    mode: runtime.mode,
    running: Boolean(runtime.running),
    serverUrl: runtime.serverUrl || DEFAULT_PAIRING_SERVER_URL,
    message: runtime.message || '',
    error: runtime.error || '',
  };
}

async function startEmbeddedPairingServer(logger) {
  const pairing = createPairingServer();
  try {
    await pairing.listen(DEFAULT_PAIRING_PORT, DEFAULT_PAIRING_HOST);
    logger.info('embedded pairing server started', { serverUrl: DEFAULT_PAIRING_SERVER_URL });
    return {
      mode: 'embedded',
      running: true,
      serverUrl: DEFAULT_PAIRING_SERVER_URL,
      message: 'Rendezvous local embebido activo.',
      close: () => pairing.close(),
    };
  } catch (error) {
    const code = error?.code || '';
    if (code === 'EADDRINUSE') {
      try {
        const res = await fetch(`${DEFAULT_PAIRING_SERVER_URL}/health`, { headers: { accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          logger.info('existing pairing server detected', { serverUrl: DEFAULT_PAIRING_SERVER_URL });
          return {
            mode: 'external',
            running: true,
            serverUrl: DEFAULT_PAIRING_SERVER_URL,
            message: 'Rendezvous local externo activo.',
            close: null,
          };
        }
      } catch {}
    }
    const message = code === 'EADDRINUSE'
      ? 'El puerto rendezvous local esta ocupado por otro proceso no compatible.'
      : 'No se pudo iniciar el rendezvous local embebido.';
    logger.warn('embedded pairing server not started', { code, error: String(error.message || error) });
    return {
      mode: 'unavailable',
      running: false,
      serverUrl: DEFAULT_PAIRING_SERVER_URL,
      message,
      error: String(error.message || error),
      close: null,
    };
  }
}

async function callPairingServer(serverUrl, endpointPath, { method = 'GET', body = null } = {}) {
  const target = `${normalizePairingServerUrl(serverUrl)}${endpointPath}`;
  const res = await fetch(target, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok || data?.ok === false) {
    const message = data?.error || `pairing-http-${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function createPairingCode(store, payload) {
  const serverUrl = normalizePairingServerUrl(payload.serverUrl || store.getPairingSettings().serverUrl);
  store.savePairingSettings({ serverUrl });
  const offer = buildPeerDescriptor(store, payload.profileId);
  const room = await callPairingServer(serverUrl, '/v1/rooms', {
    method: 'POST',
    body: { offer },
  });
  return { ok: true, serverUrl, code: room.code, expiresAt: room.expiresAt, offer };
}

async function checkPairingCode(store, payload) {
  const serverUrl = normalizePairingServerUrl(payload.serverUrl || store.getPairingSettings().serverUrl);
  const code = encodeURIComponent(String(payload.code || '').trim());
  const room = await callPairingServer(serverUrl, `/v1/rooms/${code}`);
  return { ok: true, serverUrl, ...room };
}

async function joinPairingCode(store, payload) {
  const serverUrl = normalizePairingServerUrl(payload.serverUrl || store.getPairingSettings().serverUrl);
  store.savePairingSettings({ serverUrl });
  const rawCode = String(payload.code || '').trim();
  const code = encodeURIComponent(rawCode);
  const room = await callPairingServer(serverUrl, `/v1/rooms/${code}`);
  const targetProfileId = payload.targetProfileId || payload.remoteProfileId || 'peer-a';
  store.savePeerDescriptor(targetProfileId, room.offer, { code: rawCode });
  const answer = buildPeerDescriptor(store, payload.profileId);
  const joined = await callPairingServer(serverUrl, `/v1/rooms/${code}/answer`, {
    method: 'POST',
    body: { answer },
  });
  return { ok: true, serverUrl, code: rawCode, savedProfileId: targetProfileId, offer: room.offer, answer, joined };
}

async function acceptPairingAnswer(store, payload) {
  const serverUrl = normalizePairingServerUrl(payload.serverUrl || store.getPairingSettings().serverUrl);
  const rawCode = String(payload.code || '').trim();
  const code = encodeURIComponent(rawCode);
  const room = await callPairingServer(serverUrl, `/v1/rooms/${code}`);
  if (!room.answer) return { ok: false, waiting: true, error: 'answer-not-ready', code: rawCode };
  const targetProfileId = payload.targetProfileId || payload.remoteProfileId || 'peer-b';
  store.savePeerDescriptor(targetProfileId, room.answer, { code: rawCode });
  return { ok: true, serverUrl, code: rawCode, savedProfileId: targetProfileId, offer: room.offer, answer: room.answer };
}

function renderAuthPage({ mode }) {
  const isSetup = mode === 'setup';
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EITEL Connector Desktop</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,sans-serif;background:#eef2f4;color:#172026;display:grid;place-items:center}
    .dialog{width:min(430px,calc(100vw - 32px));background:#fff;border:1px solid #d8e0e2;border-radius:8px;box-shadow:0 18px 45px rgba(22,52,68,.14)}
    .titlebar{height:38px;background:#f7fafb;border-bottom:1px solid #e2e9eb;border-radius:8px 8px 0 0;display:flex;align-items:center;padding:0 14px;font-size:12px;color:#5f6f77}
    .content{padding:28px;display:grid;gap:16px}
    h1{margin:0;font-size:24px;font-weight:600}
    p{margin:0;color:#666;line-height:1.45}
    label{display:grid;gap:6px;font-size:13px;font-weight:600;color:#3b3b3b}
    input{height:40px;border:1px solid #b9c7cb;border-radius:8px;padding:0 12px;font:inherit;background:#fff}
    input:focus{outline:2px solid #2b7a9f;outline-offset:1px;border-color:#2b7a9f}
    .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
    button{height:40px;border:1px solid #b9c7cb;background:#fff;border-radius:8px;padding:0 16px;font:inherit;font-weight:700;cursor:pointer}
    button.primary{background:#15384b;border-color:#15384b;color:#fff}
    .error{display:none;color:#a80000;background:#fde7e9;border:1px solid #f3b8bd;padding:9px 10px;font-size:13px}
  </style>
</head>
<body>
  <section class="dialog">
    <div class="titlebar">EITEL Connector Desktop</div>
    <form class="content" id="authForm">
      <div>
        <h1>${isSetup ? 'Crear acceso local' : 'Iniciar sesion'}</h1>
        <p>${isSetup ? 'Define una contrasena para proteger esta aplicacion en este equipo.' : 'Introduce la contrasena local para abrir el panel.'}</p>
      </div>
      <label>Contrasena
        <input id="password" type="password" autocomplete="${isSetup ? 'new-password' : 'current-password'}" autofocus />
      </label>
      ${isSetup ? '<label>Repetir contrasena<input id="confirm" type="password" autocomplete="new-password" /></label>' : ''}
      <div class="error" id="error"></div>
      <div class="actions">
        <button class="primary" type="submit">${isSetup ? 'Crear y entrar' : 'Entrar'}</button>
      </div>
    </form>
  </section>
  <script>
    const endpoint = ${JSON.stringify(isSetup ? '/desktop/auth/setup' : '/desktop/auth/login')};
    const form = document.getElementById('authForm');
    const errorBox = document.getElementById('error');
    function showError(message) {
      errorBox.textContent = message;
      errorBox.style.display = 'block';
    }
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm') ? document.getElementById('confirm').value : password;
      if (${JSON.stringify(isSetup)} && password !== confirm) return showError('Las contrasenas no coinciden.');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return showError(data.error || 'No se pudo completar la autenticacion.');
      window.location.assign('/desktop');
    });
  </script>
</body>
</html>`;
}

function renderDashboard({ store, selectedProfileId }) {
  const initialProfiles = profilesForClient(store);
  const selected = resolveProfile(store, selectedProfileId);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EITEL Connector Desktop</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,sans-serif;background:linear-gradient(135deg,#f5f9fb 0%,#eef2f4 46%,#f8fbf7 100%);color:#172026}
    button,input,select{font:inherit}
    .app{min-height:100vh;display:grid;grid-template-rows:58px 1fr}
    .top{height:58px;background:rgba(255,255,255,.92);backdrop-filter:blur(14px);border-bottom:1px solid #d8e0e2;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
    .top-title{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:800;color:#172026}
    .mark{width:20px;height:20px;background:linear-gradient(135deg,#15384b,#2d7b8f);border-radius:6px;box-shadow:0 8px 18px rgba(21,56,75,.22)}
    .top-actions{display:flex;gap:10px;align-items:center}
    .layout{display:grid;grid-template-columns:292px 1fr}
    nav{background:rgba(255,255,255,.86);border-right:1px solid #d8e0e2;padding:18px;display:flex;flex-direction:column;gap:8px}
    .nav-item{height:44px;border:1px solid transparent;background:transparent;border-radius:8px;text-align:left;padding:0 14px;color:#263840;cursor:pointer;font-weight:750}
    .nav-item:hover{background:#f3f8fa;border-color:#dfebef}.nav-item.active{background:#e8f3f6;border-color:#cce1e7;color:#15384b;box-shadow:inset 3px 0 0 #2d7b8f}
    main{padding:30px;display:grid;gap:18px;align-content:start}
    .page-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-end}
    h1{margin:0;font-size:32px;font-weight:850} h2{margin:0;font-size:18px;font-weight:820}
    p{margin:0;color:#5f6f77;line-height:1.45}.muted{color:#5f6f77;font-size:13px}
    .surface{background:rgba(255,255,255,.94);border:1px solid #d8e0e2;border-radius:10px;padding:18px;box-shadow:0 14px 34px rgba(22,52,68,.10)}
    .highlight{background:linear-gradient(135deg,#ffffff 0%,#edf7f8 100%);border-color:#cbe1e6}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:14px}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .field{display:grid;gap:5px;min-width:220px;flex:1}
    label{font-size:12px;font-weight:800;color:#263840}
    input,select{height:40px;border:1px solid #b9c7cb;border-radius:8px;background:#fff;padding:0 12px}
    input:focus,select:focus{outline:2px solid #2b7a9f;outline-offset:1px;border-color:#2b7a9f}
    button{height:40px;border:1px solid #b9c7cb;background:#fff;border-radius:8px;padding:0 14px;font-weight:800;cursor:pointer}
    button:hover{background:#f6fafb}
    button.primary{background:#15384b;color:#fff;border-color:#15384b;box-shadow:0 10px 22px rgba(21,56,75,.18)}
    button.primary:hover{background:#204b60}
    button.subtle{border-color:transparent;background:transparent;box-shadow:none}
    button:disabled{opacity:.58;cursor:default}
    .profile-box{display:grid;gap:10px;border:1px solid #d8e0e2;background:#fbfdfe;padding:14px;border-radius:10px}
    .profile-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
    .pill{display:inline-flex;align-items:center;height:24px;border-radius:12px;background:#eef6fc;color:#15384b;padding:0 10px;font-size:12px;font-weight:800}
    .status{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#4f4f4f}
    .dot{width:8px;height:8px;border-radius:50%;background:#8a8a8a}.dot.ok{background:#107c10}.dot.warn{background:#ffaa44}.dot.bad{background:#d13438}
    table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
    th,td{border-bottom:1px solid #e5e5e5;text-align:left;padding:9px;vertical-align:top}
    th{font-weight:800;color:#263840;background:#f7fafb}
    code{font-family:"Cascadia Mono",Consolas,monospace;font-size:12px}
    pre{margin:0;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;background:#1e1e1e;color:#dcdcdc;padding:12px;border-radius:8px;font-size:12px}
    .split{display:grid;grid-template-columns:repeat(2,minmax(280px,1fr));gap:14px}
    .pairing-card{position:relative;overflow:hidden}
    .pairing-card:before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#15384b,#2d7b8f,#75a857)}
    .pairing-code{font-size:28px;font-weight:900;letter-spacing:0;color:#15384b;background:#eef6fc;border:1px solid #c9dfea;border-radius:8px;padding:12px;text-align:center}
    .result-box{display:grid;gap:10px;margin-top:12px}
    .server-status{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding:10px 12px;border:1px solid #d8e0e2;border-radius:8px;background:#f8fbfc}
    .server-status code{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .view{display:none}.view.active{display:grid;gap:18px}
    @media(max-width:900px){.layout{grid-template-columns:1fr}nav{display:none}.grid,.split{grid-template-columns:1fr}.page-title{align-items:flex-start;flex-direction:column}main{padding:18px}}
  </style>
</head>
<body>
  <div class="app">
    <header class="top">
      <div class="top-title"><span class="mark"></span><span>EITEL Connector Desktop</span></div>
      <div class="top-actions">
        <span class="status"><span class="dot ok"></span>Sesion local</span>
        <button class="subtle" id="logoutBtn">Cerrar sesion</button>
      </div>
    </header>
    <div class="layout">
      <nav>
        <button class="nav-item active" data-view="home">Inicio</button>
        <button class="nav-item" data-view="connectors">Conectores</button>
        <button class="nav-item" data-view="pairing">Emparejamiento</button>
        <button class="nav-item" data-view="lab">Comunicacion</button>
      </nav>
      <main>
        <section class="view active" id="view-home">
          <div class="page-title">
            <div>
              <h1>Panel de control</h1>
              <p>App local con proxy interno, credenciales guardadas en este equipo y consola embebida.</p>
            </div>
            <button class="primary" onclick="openProfile(${JSON.stringify(selected.id)})">Abrir consola ${selected.name}</button>
          </div>
          <section class="surface highlight">
            <h2>Prueba rapida entre participantes</h2>
            <p class="muted">Ejecuta una consulta de catalogo desde un conector consumidor hacia otro proveedor.</p>
            <div class="row" style="margin-top:12px">
              <button class="primary" onclick="activateView('lab')">Ir a Comunicacion</button>
              <button onclick="activateView('pairing')">Emparejar peers</button>
              <button onclick="activateView('connectors')">Configurar credenciales</button>
            </div>
          </section>
        </section>

        <section class="view" id="view-connectors">
          <div class="page-title">
            <div>
              <h1>Conectores</h1>
              <p>Credenciales locales para Management API y servicios auxiliares.</p>
            </div>
          </div>
          <div class="grid" id="profilesGrid"></div>
        </section>

        <section class="view" id="view-pairing">
          <div class="page-title">
            <div>
              <h1>Emparejamiento</h1>
              <p>Intercambia endpoints P2P con codigo corto, estilo croc, sin publicar claves ni tokens.</p>
            </div>
          </div>
          <section class="surface highlight">
            <div class="row">
              <div class="field">
                <label>Servidor rendezvous</label>
                <input id="pairServerUrl" value="${DEFAULT_PAIRING_SERVER_URL}">
              </div>
              <button id="savePairServerBtn">Guardar</button>
            </div>
            <div class="server-status">
              <span class="status" id="pairServerStatus"><span class="dot warn"></span>Comprobando rendezvous</span>
              <code id="pairLogPath"></code>
            </div>
          </section>
          <div class="split">
            <section class="surface pairing-card">
              <h2>Crear codigo</h2>
              <div class="field" style="margin-top:12px">
                <label>Mi nodo</label>
                <select id="pairCreateProfile"></select>
              </div>
              <div class="field" style="margin-top:10px">
                <label>Guardar respuesta en</label>
                <select id="pairAcceptTarget"></select>
              </div>
              <div class="row" style="margin-top:12px">
                <button class="primary" id="createPairBtn">Crear codigo</button>
                <button id="acceptPairBtn">Recoger respuesta</button>
              </div>
              <div id="pairCreateResult" class="result-box"></div>
            </section>
            <section class="surface pairing-card">
              <h2>Unirse a codigo</h2>
              <div class="field" style="margin-top:12px">
                <label>Codigo</label>
                <input id="joinPairCode" placeholder="azul-mesa-rio-1234">
              </div>
              <div class="field" style="margin-top:10px">
                <label>Mi nodo</label>
                <select id="pairJoinProfile"></select>
              </div>
              <div class="field" style="margin-top:10px">
                <label>Guardar peer recibido en</label>
                <select id="pairJoinTarget"></select>
              </div>
              <div class="row" style="margin-top:12px">
                <button class="primary" id="joinPairBtn">Unirme</button>
              </div>
              <div id="pairJoinResult" class="result-box"></div>
            </section>
          </div>
        </section>

        <section class="view" id="view-lab">
          <div class="page-title">
            <div>
              <h1>Comunicacion</h1>
              <p>Comprueba que dos conectores pueden verse y pedir catalogo por DSP.</p>
            </div>
          </div>
          <section class="surface">
            <div class="row">
              <div class="field">
                <label>Consumidor</label>
                <select id="consumerSelect"></select>
              </div>
              <div class="field">
                <label>Proveedor</label>
                <select id="providerSelect"></select>
              </div>
              <button class="primary" id="runLabBtn">Ejecutar prueba</button>
            </div>
          </section>
          <section class="surface" id="labResult" style="display:none"></section>
        </section>
      </main>
    </div>
  </div>
  <script>
    let profileItems = ${JSON.stringify(initialProfiles)};
    let pairingSettings = { serverUrl: ${JSON.stringify(DEFAULT_PAIRING_SERVER_URL)} };
    let activePairCode = '';
    const initialSelected = ${JSON.stringify(selected.id)};

    function byId(id) { return document.getElementById(id); }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[<>&"]/g, function (c) {
        return ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' })[c];
      });
    }

    function activateView(name) {
      document.querySelectorAll('.view').forEach(function (node) { node.classList.toggle('active', node.id === 'view-' + name); });
      document.querySelectorAll('.nav-item').forEach(function (node) { node.classList.toggle('active', node.dataset.view === name); });
    }

    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.addEventListener('click', function () { activateView(button.dataset.view); });
    });

    function setSelectOptions(id, options, selectedValue) {
      const node = byId(id);
      if (!node) return;
      node.innerHTML = options;
      if (selectedValue) node.value = selectedValue;
    }

    function fillSelects() {
      const options = profileItems.map(function (profile) {
        return '<option value="' + escapeHtml(profile.id) + '">' + escapeHtml(profile.name) + '</option>';
      }).join('');
      const provider = profileItems.find(function (profile) { return profile.id !== initialSelected; }) || profileItems[0];
      setSelectOptions('consumerSelect', options, initialSelected);
      setSelectOptions('providerSelect', options, provider.id);
      setSelectOptions('pairCreateProfile', options, initialSelected);
      setSelectOptions('pairAcceptTarget', options, provider.id);
      setSelectOptions('pairJoinProfile', options, provider.id);
      setSelectOptions('pairJoinTarget', options, initialSelected);
    }

    function renderProfiles() {
      const grid = byId('profilesGrid');
      grid.innerHTML = '';
      profileItems.forEach(function (profile) {
        const box = document.createElement('section');
        box.className = 'profile-box';
        box.innerHTML =
          '<div class="profile-head"><div><h2>' + profile.name + '</h2><p class="muted">' + profile.description + '</p></div><span class="pill">' + profile.prefix + '</span></div>' +
          '<div class="field"><label>URL local del nodo</label><input data-origin="' + profile.id + '" value=""></div>' +
          '<div class="field"><label>Prefijo del gateway</label><input data-prefix="' + profile.id + '" value=""></div>' +
          '<div class="field"><label>ID del peer</label><input data-connector="' + profile.id + '" value=""></div>' +
          '<div class="field"><label>Endpoint DSP P2P</label><input data-dsp="' + profile.id + '" value=""></div>' +
          '<div class="field"><label>Management API key</label><input type="password" data-api="' + profile.id + '" value=""></div>' +
          '<div class="field"><label>Token local-assets / download-sink</label><input type="password" data-local="' + profile.id + '" value=""></div>' +
          '<div class="row"><button class="primary" data-save="' + profile.id + '">Guardar</button><button data-open="' + profile.id + '">Abrir consola</button><span class="muted" id="saved-' + profile.id + '"></span></div>' +
          '<code>' + profile.remoteBase + '</code>';
        grid.appendChild(box);
        box.querySelector('[data-origin="' + profile.id + '"]').value = profile.remoteOrigin || '';
        box.querySelector('[data-prefix="' + profile.id + '"]').value = profile.remotePrefix || '';
        box.querySelector('[data-connector="' + profile.id + '"]').value = profile.connectorName || '';
        box.querySelector('[data-dsp="' + profile.id + '"]').value = profile.dspUrl || '';
        box.querySelector('[data-api="' + profile.id + '"]').value = profile.apiKey || '';
        box.querySelector('[data-local="' + profile.id + '"]').value = profile.localAssetsToken || '';
      });
      grid.querySelectorAll('[data-save]').forEach(function (button) {
        button.addEventListener('click', function () { saveProfile(button.dataset.save); });
      });
      grid.querySelectorAll('[data-open]').forEach(function (button) {
        button.addEventListener('click', function () { openProfile(button.dataset.open); });
      });
    }

    async function loadProfiles() {
      const res = await fetch('/desktop/profiles');
      const data = await res.json();
      profileItems = data.items || profileItems;
      renderProfiles();
      fillSelects();
    }

    async function saveProfile(id) {
      const remoteOrigin = document.querySelector('[data-origin="' + id + '"]').value;
      const remotePrefix = document.querySelector('[data-prefix="' + id + '"]').value;
      const connectorName = document.querySelector('[data-connector="' + id + '"]').value;
      const dspUrl = document.querySelector('[data-dsp="' + id + '"]').value;
      const apiKey = document.querySelector('[data-api="' + id + '"]').value;
      const localAssetsToken = document.querySelector('[data-local="' + id + '"]').value;
      const res = await fetch('/desktop/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: id,
          remoteOrigin: remoteOrigin,
          remotePrefix: remotePrefix,
          connectorName: connectorName,
          dspUrl: dspUrl,
          apiKey: apiKey,
          localAssetsToken: localAssetsToken
        })
      });
      const target = byId('saved-' + id);
      target.textContent = res.ok ? 'Guardado' : 'Error';
      await loadProfiles();
    }

    function openProfile(id) {
      window.location.assign('/desktop/open/' + encodeURIComponent(id));
    }

    function renderPairServerStatus(status, logPath) {
      const node = byId('pairServerStatus');
      const logNode = byId('pairLogPath');
      if (!node) return;
      const running = Boolean(status?.running);
      const mode = status?.mode || 'unavailable';
      const dot = running ? 'ok' : 'bad';
      const text = running
        ? (mode === 'embedded' ? 'Rendezvous embebido activo' : 'Rendezvous disponible')
        : 'Rendezvous no disponible';
      node.innerHTML = '<span class="dot ' + dot + '"></span>' + escapeHtml(text);
      if (logNode) logNode.textContent = logPath ? 'log: ' + logPath : '';
    }

    async function loadPairingSettings() {
      const res = await fetch('/desktop/pairing/settings');
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return;
      pairingSettings = { serverUrl: data.serverUrl || pairingSettings.serverUrl };
      byId('pairServerUrl').value = pairingSettings.serverUrl;
      renderPairServerStatus(data.pairingStatus, data.logPath);
    }

    async function savePairServer() {
      const serverUrl = byId('pairServerUrl').value.trim();
      const res = await fetch('/desktop/pairing/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serverUrl: serverUrl })
      });
      const data = await res.json().catch(function () { return {}; });
      pairingSettings = { serverUrl: data.serverUrl || serverUrl || pairingSettings.serverUrl };
      byId('pairServerUrl').value = pairingSettings.serverUrl;
      renderPairServerStatus(data.pairingStatus, data.logPath);
      renderPairingResult('pairCreateResult', data.ok ? { ok: true, summary: 'Servidor guardado.' } : data);
    }

    function currentPairingServerUrl() {
      return byId('pairServerUrl').value.trim() || pairingSettings.serverUrl;
    }

    async function postPairing(path, payload) {
      const res = await fetch('/desktop/pairing/' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, serverUrl: currentPairingServerUrl() })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok && data.ok !== false) data.ok = false;
      if (!res.ok && !data.error) data.error = 'No se pudo completar la operacion.';
      return data;
    }

    function profileName(id) {
      const profile = profileItems.find(function (item) { return item.id === id; });
      return profile ? profile.name : id;
    }

    function renderPairingResult(targetId, data) {
      const box = byId(targetId);
      if (!box) return;
      const statusText = data.waiting ? 'Esperando respuesta' : (data.ok ? 'Listo' : 'Error');
      const dot = data.waiting ? 'warn' : (data.ok ? 'ok' : 'bad');
      const code = data.code ? '<div class="pairing-code">' + escapeHtml(data.code) + '</div>' : '';
      const summary = data.summary || data.error || (data.ok ? 'Operacion completada.' : 'Operacion fallida.');
      const saved = data.savedProfileId ? '<p class="muted">Peer guardado en ' + escapeHtml(profileName(data.savedProfileId)) + '.</p>' : '';
      const peer = data.answer?.name || data.offer?.name || '';
      const peerLine = peer ? '<p class="muted">Peer recibido: ' + escapeHtml(peer) + '.</p>' : '';
      box.innerHTML =
        code +
        '<span class="status"><span class="dot ' + dot + '"></span>' + statusText + '</span>' +
        '<p class="muted">' + escapeHtml(summary) + '</p>' +
        saved +
        peerLine;
    }

    async function createPairCode() {
      const button = byId('createPairBtn');
      button.disabled = true;
      button.textContent = 'Creando...';
      try {
        const data = await postPairing('create', { profileId: byId('pairCreateProfile').value });
        if (data.ok) {
          activePairCode = data.code;
          byId('joinPairCode').value = data.code;
          data.summary = 'Comparte este codigo con el otro participante y despues pulsa Recoger respuesta.';
        }
        renderPairingResult('pairCreateResult', data);
      } finally {
        button.disabled = false;
        button.textContent = 'Crear codigo';
      }
    }

    async function acceptPairAnswer() {
      const button = byId('acceptPairBtn');
      button.disabled = true;
      button.textContent = 'Recogiendo...';
      try {
        const code = activePairCode || byId('joinPairCode').value.trim();
        const data = await postPairing('accept', { code: code, targetProfileId: byId('pairAcceptTarget').value });
        if (data.ok) await loadProfiles();
        if (data.waiting) data.summary = 'El otro participante aun no se ha unido al codigo.';
        renderPairingResult('pairCreateResult', data);
      } finally {
        button.disabled = false;
        button.textContent = 'Recoger respuesta';
      }
    }

    async function joinPairCode() {
      const button = byId('joinPairBtn');
      button.disabled = true;
      button.textContent = 'Uniendo...';
      try {
        const data = await postPairing('join', {
          code: byId('joinPairCode').value.trim(),
          profileId: byId('pairJoinProfile').value,
          targetProfileId: byId('pairJoinTarget').value
        });
        if (data.ok) {
          data.summary = 'Respuesta enviada. El creador ya puede recogerla.';
          await loadProfiles();
        }
        renderPairingResult('pairJoinResult', data);
      } finally {
        button.disabled = false;
        button.textContent = 'Unirme';
      }
    }

    function statusClass(ok, status) {
      if (ok) return 'ok';
      if (Number(status) >= 400) return 'bad';
      return 'warn';
    }

    function renderLabResult(data) {
      const box = byId('labResult');
      box.style.display = '';
      const rows = (data.steps || []).map(function (step) {
        const dot = statusClass(step.ok, step.status);
        return '<tr><td><span class="status"><span class="dot ' + dot + '"></span>' + step.name + '</span></td><td>' + (step.status || '-') + '</td><td>' + (step.count ?? '-') + '</td><td><code>' + (step.url || '') + '</code></td></tr>';
      }).join('');
      box.innerHTML =
        '<div class="row" style="justify-content:space-between"><div><h2>' + (data.ok ? 'Comunicacion correcta' : 'Comunicacion con incidencias') + '</h2><p class="muted">' + (data.summary || '') + '</p></div><span class="status"><span class="dot ' + (data.ok ? 'ok' : 'bad') + '"></span>' + (data.ok ? 'OK' : 'Revisar') + '</span></div>' +
        '<table style="margin-top:12px"><thead><tr><th>Paso</th><th>HTTP</th><th>Elementos</th><th>Endpoint</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div style="margin-top:12px"><pre>' + JSON.stringify(data, null, 2).replace(/[<>&]/g, function (c) { return ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" })[c]; }) + '</pre></div>';
    }

    async function runLab() {
      const button = byId('runLabBtn');
      button.disabled = true;
      button.textContent = 'Probando...';
      try {
        const res = await fetch('/desktop/communication/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ consumerId: byId('consumerSelect').value, providerId: byId('providerSelect').value })
        });
        renderLabResult(await res.json());
      } finally {
        button.disabled = false;
        button.textContent = 'Ejecutar prueba';
      }
    }

    byId('savePairServerBtn').addEventListener('click', savePairServer);
    byId('createPairBtn').addEventListener('click', createPairCode);
    byId('acceptPairBtn').addEventListener('click', acceptPairAnswer);
    byId('joinPairBtn').addEventListener('click', joinPairCode);
    byId('runLabBtn').addEventListener('click', runLab);
    byId('logoutBtn').addEventListener('click', async function () {
      await fetch('/desktop/auth/logout', { method: 'POST' });
      window.location.assign('/desktop');
    });

    renderProfiles();
    fillSelects();
    loadPairingSettings();
    loadProfiles();
  </script>
</body>
</html>`;
}

function renderConfig(store, profile) {
  const allProfiles = resolveProfiles(store);
  const config = {
    managementApiUrl: `/${profile.prefix}/api/management`,
    apiKey: '',
    localAssetsAuthToken: '',
    connectorName: profile.connectorName,
    dspUrl: profile.dspUrl,
    connectorCatalogList: allProfiles.map((item) => item.connectorName).join(','),
    defaultRemoteConnector: allProfiles.find((item) => item.id !== profile.id)?.connectorName || '',
    connectorDirectory: getConnectorDirectoryForStore(store),
    uiVariant: profile.uiVariant || 'desktop',
    starMode: 'false',
    starCoordinatorName: '',
    starCoordinatorUrl: '',
    starCoordinatorStatusUrl: '',
    starDidMethod: '',
    starParticipantDid: '',
    starVcPresent: 'false',
    starVcIssuer: '',
    arcgisAuthEnabled: 'false',
    gaiaXComplianceUrl: '',
  };
  return `window.EITEL_UI_CONFIG = ${JSON.stringify(config, null, 2)};`;
}

function renderDesktopBridge(store, sessionToken, currentProfile) {
  const profileMap = resolveProfiles(store).map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    prefix: profile.prefix,
    remoteOrigin: profile.remoteOrigin,
    remotePrefix: profile.remotePrefix,
  }));
  const current = {
    id: currentProfile.id,
    name: currentProfile.name,
    prefix: currentProfile.prefix,
  };
  return `(function () {
  const profiles = ${JSON.stringify(profileMap)};
  const currentProfile = ${JSON.stringify(current)};
  const sessionToken = ${JSON.stringify(sessionToken)};
  const originalFetch = window.fetch.bind(window);
  let profileItems = [];
  let pairingSettings = { serverUrl: ${JSON.stringify(DEFAULT_PAIRING_SERVER_URL)} };
  let activePairCode = '';

  function byId(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[<>&"]/g, function (c) {
      return ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' })[c];
    });
  }
  function isDesktopProxyUrl(value) {
    const raw = typeof value === 'string' ? value : (value && value.url) || '';
    if (!raw) return false;
    let url;
    try { url = new URL(raw, window.location.href); } catch { return false; }
    if (url.origin !== window.location.origin) return false;
    const firstSegment = url.pathname.split('/').filter(Boolean)[0] || '';
    return profiles.some((profile) => profile.prefix.toLowerCase() === firstSegment.toLowerCase());
  }
  function isDesktopInternalUrl(value) {
    const raw = typeof value === 'string' ? value : (value && value.url) || '';
    if (!raw) return false;
    let url;
    try { url = new URL(raw, window.location.href); } catch { return false; }
    return url.origin === window.location.origin && url.pathname.startsWith('/desktop/');
  }
  function rewriteUrl(input) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (!raw) return input;
    let url;
    try { url = new URL(raw, window.location.href); } catch { return input; }
    const match = profiles.find((profile) =>
      url.origin === profile.remoteOrigin &&
      (url.pathname === profile.remotePrefix || url.pathname.startsWith(profile.remotePrefix + '/'))
    );
    if (!match) return input;
    const tail = url.pathname.slice(match.remotePrefix.length);
    if (!/^\\/(api\\/management|api\\/v1\\/dsp|local-assets|download-sink)/i.test(tail)) return input;
    url.protocol = window.location.protocol;
    url.host = window.location.host;
    url.pathname = '/' + match.prefix + tail;
    if (typeof input === 'string') return url.toString();
    return new Request(url.toString(), input);
  }
  window.fetch = function (input, init) {
    const rewritten = rewriteUrl(input);
    if (!isDesktopProxyUrl(rewritten) && !isDesktopInternalUrl(rewritten)) return originalFetch(rewritten, init);
    const nextInit = Object.assign({}, init || {});
    const headers = new Headers(nextInit.headers || (rewritten instanceof Request ? rewritten.headers : undefined));
    headers.set('x-eitel-desktop-session', sessionToken);
    nextInit.headers = headers;
    return originalFetch(rewritten, nextInit);
  };

  function activateDesktopView() {
    if (typeof window.activateView === 'function') {
      window.activateView('desktop-pairing');
      return;
    }
    document.querySelectorAll('.nav button').forEach(function (button) { button.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function (panel) { panel.classList.remove('active'); });
    document.querySelector('.nav button[data-view="desktop-pairing"]')?.classList.add('active');
    byId('panel-desktop-pairing')?.classList.add('active');
  }

  function setSelectOptions(id, options, selectedValue) {
    const node = byId(id);
    if (!node) return;
    node.innerHTML = options;
    if (selectedValue) node.value = selectedValue;
  }

  async function fetchJson(path, options) {
    const res = await window.fetch(path, options);
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok && data.ok !== false) data.ok = false;
    if (!res.ok && !data.error) data.error = 'No se pudo completar la operacion.';
    return data;
  }

  async function postJson(path, payload) {
    return fetchJson(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }

  function currentPairingServerUrl() {
    return byId('desktopPairServerUrl')?.value.trim() || pairingSettings.serverUrl;
  }

  function fillDesktopSelects() {
    const options = profileItems.map(function (profile) {
      return '<option value="' + escapeHtml(profile.id) + '">' + escapeHtml(profile.name) + '</option>';
    }).join('');
    const peer = profileItems.find(function (profile) { return profile.id !== currentProfile.id; }) || profileItems[0] || {};
    setSelectOptions('desktopPairCreateProfile', options, currentProfile.id);
    setSelectOptions('desktopPairAcceptTarget', options, peer.id);
    setSelectOptions('desktopPairJoinProfile', options, peer.id);
    setSelectOptions('desktopPairJoinTarget', options, currentProfile.id);
    setSelectOptions('desktopLabConsumer', options, currentProfile.id);
    setSelectOptions('desktopLabProvider', options, peer.id);
  }

  async function loadDesktopProfiles() {
    const data = await fetchJson('/desktop/profiles');
    profileItems = data.items || profileItems;
    fillDesktopSelects();
  }

  function profileName(id) {
    const profile = profileItems.find(function (item) { return item.id === id; });
    return profile ? profile.name : id;
  }

  function renderPairServerStatus(status, logPath) {
    const node = byId('desktopPairStatus');
    const logNode = byId('desktopPairLog');
    if (!node) return;
    const running = Boolean(status?.running);
    node.textContent = running
      ? (status.mode === 'embedded' ? 'Rendezvous embebido activo' : 'Rendezvous disponible')
      : 'Rendezvous no disponible';
    node.style.color = running ? 'var(--ok)' : 'var(--danger)';
    if (logNode) logNode.textContent = logPath ? 'Log: ' + logPath : '';
  }

  async function loadPairingSettings() {
    const data = await fetchJson('/desktop/pairing/settings');
    if (!data.ok) return;
    pairingSettings = { serverUrl: data.serverUrl || pairingSettings.serverUrl };
    if (byId('desktopPairServerUrl')) byId('desktopPairServerUrl').value = pairingSettings.serverUrl;
    renderPairServerStatus(data.pairingStatus, data.logPath);
  }

  async function savePairServer() {
    const data = await postJson('/desktop/pairing/settings', { serverUrl: currentPairingServerUrl() });
    pairingSettings = { serverUrl: data.serverUrl || currentPairingServerUrl() };
    renderPairServerStatus(data.pairingStatus, data.logPath);
    renderPairingResult('desktopPairCreateResult', data.ok ? { ok: true, summary: 'Servidor rendezvous guardado.' } : data);
  }

  async function postPairing(path, payload) {
    return postJson('/desktop/pairing/' + path, Object.assign({}, payload || {}, { serverUrl: currentPairingServerUrl() }));
  }

  function renderPairingResult(targetId, data) {
    const box = byId(targetId);
    if (!box) return;
    const ok = Boolean(data.ok);
    const waiting = Boolean(data.waiting);
    const title = waiting ? 'Esperando respuesta' : (ok ? 'Listo' : 'Error');
    const code = data.code ? '<div class="desktop-pair-code">' + escapeHtml(data.code) + '</div>' : '';
    const summary = data.summary || data.error || (ok ? 'Operacion completada.' : 'Operacion fallida.');
    const saved = data.savedProfileId ? '<p class="muted">Peer guardado en ' + escapeHtml(profileName(data.savedProfileId)) + '.</p>' : '';
    const peer = data.answer?.name || data.offer?.name || '';
    const peerLine = peer ? '<p class="muted">Peer recibido: ' + escapeHtml(peer) + '.</p>' : '';
    box.innerHTML =
      code +
      '<div class="chip" style="color:' + (waiting ? 'var(--warn)' : (ok ? 'var(--ok)' : 'var(--danger)')) + '">' + escapeHtml(title) + '</div>' +
      '<p class="muted" style="margin-top:8px">' + escapeHtml(summary) + '</p>' +
      saved +
      peerLine;
  }

  async function createPairCode() {
    const button = byId('desktopCreatePairBtn');
    if (button) { button.disabled = true; button.textContent = 'Creando...'; }
    try {
      const data = await postPairing('create', { profileId: byId('desktopPairCreateProfile')?.value || currentProfile.id });
      if (data.ok) {
        activePairCode = data.code;
        if (byId('desktopJoinPairCode')) byId('desktopJoinPairCode').value = data.code;
        data.summary = 'Comparte este codigo con el otro participante y despues pulsa Recoger respuesta.';
      }
      renderPairingResult('desktopPairCreateResult', data);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Crear codigo'; }
    }
  }

  async function acceptPairAnswer() {
    const button = byId('desktopAcceptPairBtn');
    if (button) { button.disabled = true; button.textContent = 'Recogiendo...'; }
    try {
      const code = activePairCode || byId('desktopJoinPairCode')?.value.trim();
      const data = await postPairing('accept', { code: code, targetProfileId: byId('desktopPairAcceptTarget')?.value });
      if (data.ok) await loadDesktopProfiles();
      if (data.waiting) data.summary = 'El otro participante aun no se ha unido al codigo.';
      renderPairingResult('desktopPairCreateResult', data);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Recoger respuesta'; }
    }
  }

  async function joinPairCode() {
    const button = byId('desktopJoinPairBtn');
    if (button) { button.disabled = true; button.textContent = 'Uniendo...'; }
    try {
      const data = await postPairing('join', {
        code: byId('desktopJoinPairCode')?.value.trim(),
        profileId: byId('desktopPairJoinProfile')?.value,
        targetProfileId: byId('desktopPairJoinTarget')?.value
      });
      if (data.ok) {
        data.summary = 'Respuesta enviada. El creador ya puede recogerla.';
        await loadDesktopProfiles();
      }
      renderPairingResult('desktopPairJoinResult', data);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Unirme'; }
    }
  }

  function statusColor(ok, status) {
    if (ok) return 'var(--ok)';
    if (Number(status) >= 400 || Number(status) === 0) return 'var(--danger)';
    return 'var(--warn)';
  }

  function renderLabResult(data) {
    const box = byId('desktopLabResult');
    if (!box) return;
    const rows = (data.steps || []).map(function (step) {
      return '<tr><td>' + escapeHtml(step.name) + '</td><td style="color:' + statusColor(step.ok, step.status) + ';font-weight:700">' + escapeHtml(step.status || '-') + '</td><td>' + escapeHtml(step.count ?? '-') + '</td><td><code>' + escapeHtml(step.url || '') + '</code></td></tr>';
    }).join('');
    box.innerHTML =
      '<div class="chip" style="color:' + (data.ok ? 'var(--ok)' : 'var(--danger)') + '">' + (data.ok ? 'Comunicacion correcta' : 'Comunicacion con incidencias') + '</div>' +
      '<p class="muted" style="margin-top:8px">' + escapeHtml(data.summary || '') + '</p>' +
      '<table style="margin-top:10px"><thead><tr><th>Paso</th><th>HTTP</th><th>Elementos</th><th>Endpoint</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  async function runLab() {
    const button = byId('desktopRunLabBtn');
    if (button) { button.disabled = true; button.textContent = 'Probando...'; }
    try {
      const data = await postJson('/desktop/communication/test', {
        consumerId: byId('desktopLabConsumer')?.value,
        providerId: byId('desktopLabProvider')?.value
      });
      renderLabResult(data);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Ejecutar prueba'; }
    }
  }

  function mountDesktopPairingPanel() {
    if (window.EITEL_DESKTOP_PAIRING_INSTALLED || byId('panel-desktop-pairing')) return;
    const nav = document.querySelector('.nav');
    const main = document.querySelector('.main');
    if (!nav || !main) return;
    window.EITEL_DESKTOP_PAIRING_INSTALLED = true;

    const group = document.createElement('div');
    group.className = 'nav-group';
    group.innerHTML =
      '<div class="nav-group-title">Escritorio</div>' +
      '<button data-view="desktop-pairing"><svg viewBox="0 0 24 24"><path d="M8 12h8"/><path d="M12 8v8"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/></svg><span>P2P</span></button>';
    nav.appendChild(group);
    group.querySelector('button').onclick = activateDesktopView;

    const style = document.createElement('style');
    style.textContent =
      '.desktop-pair-code{font-size:28px;font-weight:800;color:var(--primary);background:var(--primary-soft);border:1px solid var(--line);border-radius:14px;padding:12px;text-align:center;margin:10px 0}' +
      '.desktop-pair-result{margin-top:12px;min-height:42px}' +
      '#panel-desktop-pairing input,#panel-desktop-pairing select{width:100%}';
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.id = 'panel-desktop-pairing';
    panel.innerHTML =
      '<div class="grid">' +
        '<section class="card wide">' +
          '<h2>Emparejamiento P2P</h2>' +
          '<p class="muted">Intercambia endpoints locales con codigo corto estilo croc. No se publican API keys ni tokens.</p>' +
          '<div class="grid">' +
            '<div><label>Servidor rendezvous</label><input id="desktopPairServerUrl" value="' + escapeHtml(pairingSettings.serverUrl) + '"></div>' +
            '<div><label>Estado</label><div class="row" style="margin:0"><span class="chip" id="desktopPairStatus">Comprobando rendezvous</span><button class="ghost" id="desktopPairSaveServer">Guardar</button></div></div>' +
          '</div>' +
          '<p class="muted" id="desktopPairLog" style="margin-top:8px"></p>' +
        '</section>' +
        '<section class="card">' +
          '<h3 style="margin-top:0">Crear codigo</h3>' +
          '<label>Mi nodo</label><select id="desktopPairCreateProfile"></select>' +
          '<label>Guardar respuesta en</label><select id="desktopPairAcceptTarget"></select>' +
          '<div class="row" style="margin-top:10px"><button class="primary" id="desktopCreatePairBtn">Crear codigo</button><button class="ghost" id="desktopAcceptPairBtn">Recoger respuesta</button></div>' +
          '<div class="desktop-pair-result" id="desktopPairCreateResult"></div>' +
        '</section>' +
        '<section class="card">' +
          '<h3 style="margin-top:0">Unirse a codigo</h3>' +
          '<label>Codigo</label><input id="desktopJoinPairCode" placeholder="azul-mesa-rio-1234">' +
          '<label>Mi nodo</label><select id="desktopPairJoinProfile"></select>' +
          '<label>Guardar peer recibido en</label><select id="desktopPairJoinTarget"></select>' +
          '<div class="row" style="margin-top:10px"><button class="primary" id="desktopJoinPairBtn">Unirme</button></div>' +
          '<div class="desktop-pair-result" id="desktopPairJoinResult"></div>' +
        '</section>' +
        '<section class="card wide">' +
          '<h3 style="margin-top:0">Prueba entre nodos</h3>' +
          '<p class="muted">Comprueba Management API, assets publicos y catalogo DSP entre dos perfiles locales.</p>' +
          '<div class="grid">' +
            '<div><label>Consumidor</label><select id="desktopLabConsumer"></select></div>' +
            '<div><label>Proveedor</label><select id="desktopLabProvider"></select></div>' +
          '</div>' +
          '<div class="row" style="margin-top:10px"><button class="primary" id="desktopRunLabBtn">Ejecutar prueba</button></div>' +
          '<div id="desktopLabResult" style="margin-top:12px"></div>' +
        '</section>' +
      '</div>';
    main.appendChild(panel);

    byId('desktopPairSaveServer')?.addEventListener('click', savePairServer);
    byId('desktopCreatePairBtn')?.addEventListener('click', createPairCode);
    byId('desktopAcceptPairBtn')?.addEventListener('click', acceptPairAnswer);
    byId('desktopJoinPairBtn')?.addEventListener('click', joinPairCode);
    byId('desktopRunLabBtn')?.addEventListener('click', runLab);
    loadPairingSettings();
    loadDesktopProfiles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountDesktopPairingPanel);
  } else {
    mountDesktopPairingPanel();
  }
  window.EITEL_DESKTOP = true;
})();`;
}

function querySpec() {
  return {
    '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
    '@type': 'QuerySpec',
    offset: 0,
    limit: 100,
    sortOrder: 'DESC',
  };
}

function managementUrl(profile, endpointPath) {
  return new URL(`${profile.remoteOrigin}${profile.remotePrefix}/api/management${endpointPath}`);
}

function localAssetsUrl(profile, endpointPath) {
  return new URL(`${profile.remoteOrigin}${profile.remotePrefix}/local-assets${endpointPath}`);
}

function profileAuthHeaders(store, profile, purpose = 'management') {
  const credentials = store.getCredentials(profile.id);
  const token = purpose === 'local-assets'
    ? (credentials.localAssetsToken || credentials.apiKey || '')
    : (credentials.apiKey || '');
  return token ? { 'x-api-key': token } : {};
}

function extractCount(data) {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.items)) return data.items.length;
  const datasets = data?.['dcat:dataset'] || data?.dataset;
  if (Array.isArray(datasets)) return datasets.length;
  if (datasets) return 1;
  return null;
}

function shortData(data) {
  if (typeof data === 'string') return data.slice(0, 800);
  if (data && typeof data === 'object') {
    const copy = Array.isArray(data) ? data.slice(0, 5) : Object.fromEntries(Object.entries(data).slice(0, 12));
    return copy;
  }
  return data;
}

async function fetchJsonStep({ name, url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 }) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return {
      name,
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      elapsedMs: Date.now() - started,
      url: url.toString(),
      count: extractCount(data),
      preview: shortData(data),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      url: url.toString(),
      error: String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runCommunicationTest(store, payload) {
  const consumer = resolveProfile(store, payload.consumerId);
  const provider = resolveProfile(store, payload.providerId);
  const steps = [];
  const q = querySpec();

  const consumerAssets = await fetchJsonStep({
    name: `Management consumidor (${consumer.name})`,
    url: managementUrl(consumer, '/v3/assets/request'),
    method: 'POST',
    headers: profileAuthHeaders(store, consumer),
    body: q,
  });
  steps.push(consumerAssets);

  const providerAssets = await fetchJsonStep({
    name: `Management proveedor (${provider.name})`,
    url: managementUrl(provider, '/v3/assets/request'),
    method: 'POST',
    headers: profileAuthHeaders(store, provider),
    body: q,
  });
  steps.push(providerAssets);

  const providerPublicAssets = await fetchJsonStep({
    name: `Public assets proveedor (${provider.name})`,
    url: localAssetsUrl(provider, '/asset-bundles/public'),
    method: 'GET',
    headers: profileAuthHeaders(store, provider, 'local-assets'),
    timeoutMs: 10000,
  });
  steps.push(providerPublicAssets);

  const catalogRequest = await fetchJsonStep({
    name: `${consumer.name} pide catalogo a ${provider.name}`,
    url: managementUrl(consumer, '/v3/catalog/request'),
    method: 'POST',
    headers: profileAuthHeaders(store, consumer),
    body: {
      '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
      '@type': 'CatalogRequest',
      counterPartyId: provider.connectorName,
      counterPartyAddress: provider.dspUrl,
      protocol: 'dataspace-protocol-http:2025-1',
    },
    timeoutMs: 20000,
  });
  steps.push(catalogRequest);

  const ok = Boolean(catalogRequest.ok);
  const missingCredentials = [consumerAssets, providerAssets].some((step) => step.status === 401 || step.status === 403);
  const unreachable = steps.some((step) => Number(step.status) === 0);
  const summary = ok
    ? `${consumer.name} ha consultado el catalogo DSP de ${provider.name}.`
    : missingCredentials
      ? 'Hay conectores que no aceptan la credencial configurada. Revisa las API keys.'
      : unreachable
        ? 'No hay conexion con uno o ambos nodos locales. Arranca los conectores y revisa los puertos configurados.'
        : 'La prueba no ha conseguido completar el catalogo DSP entre los dos conectores.';

  return {
    ok,
    consumer: { id: consumer.id, name: consumer.name, dspUrl: consumer.dspUrl },
    provider: { id: provider.id, name: provider.name, dspUrl: provider.dspUrl },
    summary,
    steps,
  };
}

async function proxyRequest(req, res, profile, prefix) {
  const incoming = new URL(req.url, `http://${req.headers.host}`);
  const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length);
  const targetUrl = new URL(`${profile.remoteOrigin}${profile.remotePrefix}${pathAfterPrefix}${incoming.search}`);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await getRequestBody(req);
  const credentials = req.store.getCredentials(profile.id);
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    const lower = key.toLowerCase();
    if (['host', 'connection', 'content-length', 'cookie', 'x-eitel-desktop-session'].includes(lower)) return;
    if (Array.isArray(value)) headers.set(key, value.join(','));
    else if (value !== undefined) headers.set(key, String(value));
  });

  if (pathAfterPrefix.startsWith('/api/management') && credentials.apiKey && !headers.get('x-api-key')) {
    headers.set('x-api-key', credentials.apiKey);
  }
  if ((pathAfterPrefix.startsWith('/local-assets') || pathAfterPrefix.startsWith('/download-sink'))) {
    const token = credentials.localAssetsToken || credentials.apiKey || '';
    if (token && !headers.get('x-api-key') && !headers.get('authorization')) headers.set('x-api-key', token);
  }

  try {
    const upstream = await fetch(targetUrl, { method: req.method, headers, body });
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (['content-encoding', 'content-length'].includes(key.toLowerCase())) return;
      responseHeaders[key] = value;
    });
    responseHeaders['access-control-allow-origin'] = '*';
    res.writeHead(upstream.status, responseHeaders);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    sendJson(res, { error: 'No se pudo contactar con el conector remoto.', detail: String(error), target: targetUrl.toString() }, 502);
  }
}

function serveStatic(req, res, uiDir, store, profile, prefix, sessionToken) {
  const incoming = new URL(req.url, `http://${req.headers.host}`);
  const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length) || '/';
  if (pathAfterPrefix === '/config.js') return send(res, 200, renderConfig(store, profile), 'text/javascript;charset=utf-8');
  if (pathAfterPrefix === '/desktop/desktop-bridge.js') return send(res, 200, renderDesktopBridge(store, sessionToken, profile), 'text/javascript;charset=utf-8');

  const fileName = pathAfterPrefix === '/' ? 'index.final.html' : sanitizePath(pathAfterPrefix);
  let filePath = path.resolve(uiDir, fileName);
  const rootPath = path.resolve(uiDir);
  if (!filePath.startsWith(rootPath)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(uiDir, 'index.final.html');
  if (!fs.existsSync(filePath)) return send(res, 404, 'UI no encontrada');

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  let payload = fs.readFileSync(filePath);
  if (path.basename(filePath) === 'index.final.html') {
    const html = payload.toString('utf8').replace(
      /<script src="config\.js[^"]*"><\/script>/,
      '<script src="config.js"></script><script src="/' + prefix + '/desktop/desktop-bridge.js"></script>'
    );
    payload = Buffer.from(html, 'utf8');
  } else if (textTypes.has(ext)) {
    payload = Buffer.from(payload.toString('utf8'), 'utf8');
  }
  send(res, 200, payload, contentType);
}

async function startServer({ uiDir, userDataDir }) {
  const logger = createLogger(userDataDir);
  logger.info('desktop local server starting', { uiDir });
  const settingsPath = path.join(userDataDir, 'participants.json');
  const store = createStore(settingsPath);
  const pairingRuntime = await startEmbeddedPairingServer(logger);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const appAuthSessions = new Set();

  function createAppAuthSession() {
    const token = crypto.randomBytes(32).toString('hex');
    appAuthSessions.add(token);
    return token;
  }

  function hasAppAuth(req) {
    const token = parseCookies(req.headers.cookie)[APP_AUTH_COOKIE] || '';
    return appAuthSessions.has(token);
  }

  const server = http.createServer(async (req, res) => {
    req.store = store;
    const incoming = new URL(req.url, `http://${req.headers.host}`);
    const hasAccess = hasSessionAccess(req, incoming, sessionToken);

    if (!hasAccess) return send(res, 403, 'Sesion de escritorio no valida');

    if (incoming.pathname === '/' || incoming.pathname === '/desktop') {
      const authenticated = hasAppAuth(req);
      if (store.isAuthConfigured() && authenticated) {
        const profile = resolveProfile(store, store.getLastProfileId());
        res.writeHead(302, {
          location: `/${profile.prefix}/`,
          'set-cookie': cookie(DESKTOP_SESSION_COOKIE, sessionToken),
        });
        return res.end();
      }
      const body = !store.isAuthConfigured()
        ? renderAuthPage({ mode: 'setup' })
        : renderAuthPage({ mode: 'login' });
      return send(res, 200, body, 'text/html;charset=utf-8', { 'set-cookie': cookie(DESKTOP_SESSION_COOKIE, sessionToken) });
    }

    if (incoming.pathname === '/desktop/auth/setup' && req.method === 'POST') {
      if (store.isAuthConfigured()) return sendJson(res, { ok: false, error: 'La autenticacion ya esta configurada.' }, 409);
      try {
        const payload = await readJsonBody(req);
        store.setupPassword(payload.password);
        const authToken = createAppAuthSession();
        return sendJson(res, { ok: true }, 200, { 'set-cookie': [cookie(DESKTOP_SESSION_COOKIE, sessionToken), cookie(APP_AUTH_COOKIE, authToken)] });
      } catch (error) {
        return sendJson(res, { ok: false, error: String(error.message || error) }, 400);
      }
    }

    if (incoming.pathname === '/desktop/auth/login' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      if (!store.verifyPassword(payload.password)) return sendJson(res, { ok: false, error: 'Contrasena incorrecta.' }, 401);
      const authToken = createAppAuthSession();
      return sendJson(res, { ok: true }, 200, { 'set-cookie': [cookie(DESKTOP_SESSION_COOKIE, sessionToken), cookie(APP_AUTH_COOKIE, authToken)] });
    }

    if (incoming.pathname === '/desktop/auth/logout' && req.method === 'POST') {
      const authToken = parseCookies(req.headers.cookie)[APP_AUTH_COOKIE] || '';
      if (authToken) appAuthSessions.delete(authToken);
      return sendJson(res, { ok: true }, 200, { 'set-cookie': expiredCookie(APP_AUTH_COOKIE) });
    }

    if (!hasAppAuth(req)) return sendJson(res, { ok: false, error: 'No autenticado.' }, 401);

    if (incoming.pathname === '/desktop/profiles') {
      return sendJson(res, { items: profilesForClient(store) });
    }

    if (incoming.pathname === '/desktop/credentials' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      const profile = getProfile(payload.profileId);
      store.saveCredentials(profile.id, payload);
      return sendJson(res, { ok: true, profileId: profile.id });
    }

    if (incoming.pathname === '/desktop/pairing/settings') {
      if (req.method === 'GET') {
        return sendJson(res, {
          ok: true,
          ...store.getPairingSettings(),
          identity: store.getIdentity(),
          pairingStatus: describePairingRuntime(pairingRuntime),
          logPath: logger.path,
        });
      }
      if (req.method === 'POST') {
        const payload = await readJsonBody(req);
        logger.info('pairing settings updated', { serverUrl: normalizePairingServerUrl(payload.serverUrl) });
        return sendJson(res, {
          ok: true,
          ...store.savePairingSettings(payload),
          pairingStatus: describePairingRuntime(pairingRuntime),
          logPath: logger.path,
        });
      }
    }

    const pairingActions = {
      '/desktop/pairing/create': createPairingCode,
      '/desktop/pairing/check': checkPairingCode,
      '/desktop/pairing/join': joinPairingCode,
      '/desktop/pairing/accept': acceptPairingAnswer,
    };
    if (pairingActions[incoming.pathname] && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const result = await pairingActions[incoming.pathname](store, payload);
        return sendJson(res, result, result.ok === false && !result.waiting ? 400 : 200);
      } catch (error) {
        logger.error('pairing action failed', {
          path: incoming.pathname,
          status: Number(error.status || 502),
          error: String(error.message || error),
        });
        return sendJson(res, {
          ok: false,
          error: String(error.message || error),
          detail: error.data || null,
        }, Number(error.status || 502));
      }
    }

    if (incoming.pathname === '/desktop/communication/test' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      return sendJson(res, await runCommunicationTest(store, payload));
    }

    if (incoming.pathname.startsWith('/desktop/open/')) {
      const profileId = decodeURIComponent(incoming.pathname.split('/').pop() || '');
      const profile = resolveProfile(store, profileId);
      store.rememberProfile(profile.id);
      res.writeHead(302, { location: `/${profile.prefix}/`, 'set-cookie': cookie(DESKTOP_SESSION_COOKIE, sessionToken) });
      return res.end();
    }

    const [, prefix] = incoming.pathname.split('/');
    const profile = getResolvedProfileByPrefix(store, prefix);
    if (!profile) return send(res, 404, 'Perfil no encontrado');

    const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length);
    if (/^\/(api\/management|api\/v1\/dsp|local-assets|download-sink)/i.test(pathAfterPrefix)) {
      return proxyRequest(req, res, profile, prefix);
    }
    return serveStatic(req, res, uiDir, store, profile, prefix, sessionToken);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  logger.info('desktop local server started', { port });
  return {
    port,
    url: `http://127.0.0.1:${port}/desktop?desktopSession=${sessionToken}`,
    openProfileUrl: (profileId) =>
      `http://127.0.0.1:${port}/desktop/open/${encodeURIComponent(profileId)}?desktopSession=${sessionToken}`,
    pairingStatus: describePairingRuntime(pairingRuntime),
    logPath: logger.path,
    close: async () => {
      await Promise.allSettled([
        new Promise((resolve) => server.close(resolve)),
        pairingRuntime?.close ? pairingRuntime.close() : Promise.resolve(),
      ]);
    },
  };
}

module.exports = {
  startServer,
};
