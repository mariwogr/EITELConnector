const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { profiles, getProfile, getProfileByPrefix, getConnectorDirectory } = require('./profiles');

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

function createStore(settingsPath) {
  const data = readJson(settingsPath, { profiles: {}, lastProfileId: profiles[0].id });
  return {
    getCredentials(profileId) {
      return data.profiles?.[profileId] || {};
    },
    getLastProfileId() {
      return data.lastProfileId || profiles[0].id;
    },
    saveCredentials(profileId, credentials) {
      data.profiles = data.profiles || {};
      data.profiles[profileId] = {
        apiKey: String(credentials.apiKey || '').trim(),
        localAssetsToken: String(credentials.localAssetsToken || '').trim(),
      };
      data.lastProfileId = profileId;
      writeJson(settingsPath, data);
    },
    rememberProfile(profileId) {
      data.lastProfileId = profileId;
      writeJson(settingsPath, data);
    },
  };
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

function hasSessionAccess(req, incoming, sessionToken) {
  const queryToken = incoming.searchParams.get('desktopSession') || '';
  const headerToken = req.headers['x-eitel-desktop-session'] || '';
  const cookieToken = parseCookies(req.headers.cookie).eitel_desktop_session || '';
  return [queryToken, headerToken, cookieToken].some((value) => String(value) === sessionToken);
}

function sessionCookie(sessionToken) {
  return `eitel_desktop_session=${encodeURIComponent(sessionToken)}; Path=/; SameSite=Strict; HttpOnly`;
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

function sendJson(res, payload, status = 200) {
  send(res, status, JSON.stringify(payload), 'application/json;charset=utf-8');
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizePath(rawPath) {
  const withoutQuery = String(rawPath || '').split('?')[0] || '/';
  const normalized = path.normalize(decodeURIComponent(withoutQuery)).replace(/^(\.\.[/\\])+/, '');
  return normalized.replace(/^[/\\]+/, '');
}

function renderStartPage({ selectedProfileId }) {
  const selected = getProfile(selectedProfileId);
  const cards = profiles.map((profile) => `
    <button class="profile ${profile.id === selected.id ? 'active' : ''}" data-profile="${profile.id}">
      <strong>${profile.name}</strong>
      <span>${profile.description}</span>
    </button>
  `).join('');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EITEL Connector Desktop</title>
  <style>
    *{box-sizing:border-box} body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#eef2f4;color:#172026}
    .wrap{min-height:100vh;display:grid;grid-template-columns:330px 1fr}
    aside{background:#fff;border-right:1px solid #d8e0e2;padding:26px;display:grid;align-content:start;gap:18px}
    h1{margin:0;font-size:28px}.muted{color:#5f6f77;margin:6px 0 0;line-height:1.4}
    .profile{width:100%;text-align:left;border:1px solid #d8e0e2;background:#fff;border-radius:8px;padding:14px;display:grid;gap:5px;cursor:pointer}
    .profile.active{border-color:#17384b;box-shadow:0 8px 20px rgba(22,52,68,.12)}
    .profile span{color:#65747c}.panel{padding:48px;display:grid;align-content:center}
    .card{max-width:760px;background:#fff;border:1px solid #d8e0e2;border-radius:8px;padding:28px;display:grid;gap:16px}
    label{display:grid;gap:6px;font-weight:700;color:#263840}input{height:42px;border:1px solid #b9c7cb;border-radius:8px;padding:0 12px;font:inherit}
    .actions{display:flex;gap:10px;margin-top:6px}button.primary,button.secondary{height:44px;border-radius:8px;padding:0 18px;font-weight:800;cursor:pointer}
    .primary{background:#15384b;border:1px solid #15384b;color:white}.secondary{background:white;border:1px solid #b9c7cb;color:#263840}
    code{font-family:Cascadia Mono,Consolas,monospace;font-size:.95em}.hint{font-size:13px;color:#5f6f77;line-height:1.45}
  </style>
</head>
<body>
  <div class="wrap">
    <aside>
      <div>
        <h1>EITEL Desktop</h1>
        <p class="muted">Elige participante y abre la consola local embebida.</p>
      </div>
      <div>${cards}</div>
    </aside>
    <main class="panel">
      <section class="card">
        <div>
          <h1 id="profileName">${selected.name}</h1>
          <p class="muted" id="profileDesc">${selected.description}</p>
        </div>
        <label>Management API key
          <input id="apiKey" type="password" autocomplete="off" placeholder="Se guarda solo en tu usuario local" />
        </label>
        <label>Token local-assets/download-sink
          <input id="localAssetsToken" type="password" autocomplete="off" placeholder="Opcional si coincide con la API key" />
        </label>
        <p class="hint">La UI se carga desde <code>127.0.0.1</code>. Las llamadas a APIs remotas pasan por el proxy local de la app para evitar CORS y no navegar al sitio remoto.</p>
        <div class="actions">
          <button class="primary" id="open">Guardar y abrir consola</button>
          <button class="secondary" id="openNoSave">Abrir sin guardar</button>
        </div>
      </section>
    </main>
  </div>
  <script>
    let selectedProfileId = ${JSON.stringify(selected.id)};
    async function loadCredentials() {
      const res = await fetch('/desktop/profiles');
      const data = await res.json();
      const profile = data.items.find((item) => item.id === selectedProfileId) || data.items[0];
      document.getElementById('apiKey').value = profile.apiKey || '';
      document.getElementById('localAssetsToken').value = profile.localAssetsToken || '';
    }
    async function selectProfile(id) {
      selectedProfileId = id;
      document.querySelectorAll('.profile').forEach((node) => node.classList.toggle('active', node.dataset.profile === id));
      const res = await fetch('/desktop/profiles');
      const data = await res.json();
      const profile = data.items.find((item) => item.id === id);
      document.getElementById('profileName').textContent = profile.name;
      document.getElementById('profileDesc').textContent = profile.description;
      document.getElementById('apiKey').value = profile.apiKey || '';
      document.getElementById('localAssetsToken').value = profile.localAssetsToken || '';
    }
    async function saveAndOpen(save) {
      if (save) {
        await fetch('/desktop/credentials', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: selectedProfileId,
            apiKey: document.getElementById('apiKey').value,
            localAssetsToken: document.getElementById('localAssetsToken').value
          })
        });
      }
      window.location.assign('/desktop/open/' + encodeURIComponent(selectedProfileId));
    }
    document.querySelectorAll('.profile').forEach((button) => button.addEventListener('click', () => selectProfile(button.dataset.profile)));
    document.getElementById('open').addEventListener('click', () => saveAndOpen(true));
    document.getElementById('openNoSave').addEventListener('click', () => saveAndOpen(false));
    loadCredentials();
  </script>
</body>
</html>`;
}

function renderConfig(profile, serverOrigin) {
  const config = {
    managementApiUrl: `/${profile.prefix}/api/management`,
    apiKey: '',
    localAssetsAuthToken: '',
    connectorName: profile.connectorName,
    dspUrl: profile.dspUrl,
    connectorCatalogList: profiles.map((item) => item.connectorName).join(','),
    defaultRemoteConnector: profiles.find((item) => item.id !== profile.id)?.connectorName || '',
    connectorDirectory: getConnectorDirectory(),
    uiVariant: profile.uiVariant || 'desktop',
    starMode: 'false',
    starCoordinatorName: '',
    starCoordinatorUrl: '',
    starCoordinatorStatusUrl: '',
    starDidMethod: '',
    starParticipantDid: '',
    starVcPresent: 'false',
    starVcIssuer: '',
    arcgisAuthEnabled: String(Boolean(profile.arcgis?.enabled)),
    arcgisPortalUrl: profile.arcgis?.portalUrl || '',
    arcgisClientId: profile.arcgis?.clientId || '',
    arcgisRedirectUri: profile.arcgis?.redirectUri || `${serverOrigin}/${profile.prefix}/`,
    arcgisRequiredOrgId: profile.arcgis?.requiredOrgId || '',
    arcgisRequiredGroupId: profile.arcgis?.requiredGroupId || '',
    gaiaXComplianceUrl: '',
  };
  return `window.EITEL_UI_CONFIG = ${JSON.stringify(config, null, 2)};`;
}

function renderDesktopBridge(sessionToken) {
  const profileMap = profiles.map((profile) => ({
    prefix: profile.prefix,
    remoteOrigin: profile.remoteOrigin,
    remotePrefix: profile.remotePrefix,
  }));
  return `(function () {
  const profiles = ${JSON.stringify(profileMap)};
  const sessionToken = ${JSON.stringify(sessionToken)};
  const originalFetch = window.fetch.bind(window);
  function isDesktopProxyUrl(value) {
    const raw = typeof value === 'string' ? value : (value && value.url) || '';
    if (!raw) return false;
    let url;
    try { url = new URL(raw, window.location.href); } catch { return false; }
    if (url.origin !== window.location.origin) return false;
    const firstSegment = url.pathname.split('/').filter(Boolean)[0] || '';
    return profiles.some((profile) => profile.prefix.toLowerCase() === firstSegment.toLowerCase());
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
    if (!isDesktopProxyUrl(rewritten)) return originalFetch(rewritten, init);
    const nextInit = Object.assign({}, init || {});
    const headers = new Headers(nextInit.headers || (rewritten instanceof Request ? rewritten.headers : undefined));
    headers.set('x-eitel-desktop-session', sessionToken);
    nextInit.headers = headers;
    return originalFetch(rewritten, nextInit);
  };
  window.EITEL_DESKTOP = true;
})();`;
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

function serveStatic(req, res, uiDir, profile, prefix, serverOrigin, sessionToken) {
  const incoming = new URL(req.url, `http://${req.headers.host}`);
  const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length) || '/';
  if (pathAfterPrefix === '/config.js') return send(res, 200, renderConfig(profile, serverOrigin), 'text/javascript;charset=utf-8');
  if (pathAfterPrefix === '/desktop/desktop-bridge.js') return send(res, 200, renderDesktopBridge(sessionToken), 'text/javascript;charset=utf-8');

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
  const settingsPath = path.join(userDataDir, 'participants.json');
  const store = createStore(settingsPath);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    req.store = store;
    const incoming = new URL(req.url, `http://${req.headers.host}`);
    const serverOrigin = `http://${req.headers.host}`;
    const hasAccess = hasSessionAccess(req, incoming, sessionToken);

    if (incoming.pathname === '/' || incoming.pathname === '/desktop') {
      if (!hasAccess) return send(res, 403, 'Sesion de escritorio no valida');
      return send(
        res,
        200,
        renderStartPage({ selectedProfileId: store.getLastProfileId() }),
        'text/html;charset=utf-8',
        { 'set-cookie': sessionCookie(sessionToken) }
      );
    }
    if (!hasAccess) return send(res, 403, 'Sesion de escritorio no valida');

    if (incoming.pathname === '/desktop/profiles') {
      return sendJson(res, {
        items: profiles.map((profile) => {
          const credentials = store.getCredentials(profile.id);
          return {
            id: profile.id,
            name: profile.name,
            description: profile.description,
            prefix: profile.prefix,
            apiKey: credentials.apiKey || '',
            localAssetsToken: credentials.localAssetsToken || '',
          };
        }),
      });
    }
    if (incoming.pathname === '/desktop/credentials' && req.method === 'POST') {
      const raw = await getRequestBody(req);
      const payload = JSON.parse(raw.toString('utf8') || '{}');
      const profile = getProfile(payload.profileId);
      store.saveCredentials(profile.id, payload);
      return sendJson(res, { ok: true, profileId: profile.id });
    }
    if (incoming.pathname.startsWith('/desktop/open/')) {
      const profileId = decodeURIComponent(incoming.pathname.split('/').pop() || '');
      const profile = getProfile(profileId);
      store.rememberProfile(profile.id);
      res.writeHead(302, { location: `/${profile.prefix}/`, 'set-cookie': sessionCookie(sessionToken) });
      return res.end();
    }

    const [, prefix] = incoming.pathname.split('/');
    const profile = getProfileByPrefix(prefix);
    if (!profile) return send(res, 404, 'Perfil no encontrado');

    const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length);
    if (/^\/(api\/management|api\/v1\/dsp|local-assets|download-sink)/i.test(pathAfterPrefix)) {
      return proxyRequest(req, res, profile, prefix);
    }
    return serveStatic(req, res, uiDir, profile, prefix, serverOrigin, sessionToken);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}/desktop?desktopSession=${sessionToken}`,
    openProfileUrl: (profileId) =>
      `http://127.0.0.1:${port}/desktop/open/${encodeURIComponent(profileId)}?desktopSession=${sessionToken}`,
    close: () => server.close(),
  };
}

module.exports = {
  startServer,
};
