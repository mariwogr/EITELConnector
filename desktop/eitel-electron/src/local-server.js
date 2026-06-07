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

const AUTH_ITERATIONS = 210000;
const AUTH_KEY_LENGTH = 32;
const AUTH_DIGEST = 'sha256';
const DESKTOP_SESSION_COOKIE = 'eitel_desktop_session';
const APP_AUTH_COOKIE = 'eitel_desktop_auth';

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

function hashPassword(password, salt, iterations = AUTH_ITERATIONS) {
  return crypto.pbkdf2Sync(String(password || ''), salt, iterations, AUTH_KEY_LENGTH, AUTH_DIGEST).toString('hex');
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createStore(settingsPath) {
  const data = readJson(settingsPath, { profiles: {}, lastProfileId: profiles[0].id, auth: null });
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

function profilesForClient(store) {
  return profiles.map((profile) => {
    const credentials = store.getCredentials(profile.id);
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      prefix: profile.prefix,
      connectorName: profile.connectorName,
      dspUrl: profile.dspUrl,
      remoteBase: `${profile.remoteOrigin}${profile.remotePrefix}`,
      apiKey: credentials.apiKey || '',
      localAssetsToken: credentials.localAssetsToken || '',
    };
  });
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
    body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,sans-serif;background:#f3f3f3;color:#1f1f1f;display:grid;place-items:center}
    .dialog{width:min(430px,calc(100vw - 32px));background:#fff;border:1px solid #d6d6d6;box-shadow:0 16px 50px rgba(0,0,0,.16)}
    .titlebar{height:34px;background:#f9f9f9;border-bottom:1px solid #e5e5e5;display:flex;align-items:center;padding:0 12px;font-size:12px;color:#4f4f4f}
    .content{padding:28px;display:grid;gap:16px}
    h1{margin:0;font-size:24px;font-weight:600}
    p{margin:0;color:#666;line-height:1.45}
    label{display:grid;gap:6px;font-size:13px;font-weight:600;color:#3b3b3b}
    input{height:34px;border:1px solid #bfbfbf;border-radius:2px;padding:0 10px;font:inherit;background:#fff}
    input:focus{outline:2px solid #0078d4;outline-offset:-1px;border-color:#0078d4}
    .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
    button{height:32px;border:1px solid #b8b8b8;background:#fff;border-radius:2px;padding:0 16px;font:inherit;cursor:pointer}
    button.primary{background:#0078d4;border-color:#0078d4;color:#fff}
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
  const selected = getProfile(selectedProfileId);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EITEL Connector Desktop</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,sans-serif;background:#f3f3f3;color:#1f1f1f}
    button,input,select{font:inherit}
    .app{min-height:100vh;display:grid;grid-template-rows:40px 1fr}
    .top{height:40px;background:#fbfbfb;border-bottom:1px solid #dedede;display:flex;align-items:center;justify-content:space-between;padding:0 12px}
    .top-title{display:flex;align-items:center;gap:10px;font-size:13px;color:#333}
    .mark{width:16px;height:16px;background:#0078d4;border-radius:2px}
    .top-actions{display:flex;gap:8px;align-items:center}
    .layout{display:grid;grid-template-columns:248px 1fr}
    nav{background:#fafafa;border-right:1px solid #dedede;padding:10px;display:flex;flex-direction:column;gap:4px}
    .nav-item{height:36px;border:0;background:transparent;border-radius:4px;text-align:left;padding:0 12px;color:#202020;cursor:pointer}
    .nav-item:hover{background:#eeeeee}.nav-item.active{background:#e8f2fc;color:#003e73}
    main{padding:22px;display:grid;gap:18px;align-content:start}
    .page-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-end}
    h1{margin:0;font-size:28px;font-weight:600} h2{margin:0;font-size:18px;font-weight:600}
    p{margin:0;color:#616161;line-height:1.45}.muted{color:#666;font-size:13px}
    .surface{background:#fff;border:1px solid #dadada;border-radius:4px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .field{display:grid;gap:5px;min-width:220px;flex:1}
    label{font-size:12px;font-weight:600;color:#3f3f3f}
    input,select{height:32px;border:1px solid #bfbfbf;border-radius:2px;background:#fff;padding:0 9px}
    input:focus,select:focus{outline:2px solid #0078d4;outline-offset:-1px;border-color:#0078d4}
    button{height:32px;border:1px solid #b8b8b8;background:#fff;border-radius:2px;padding:0 14px;cursor:pointer}
    button.primary{background:#0078d4;color:#fff;border-color:#0078d4}
    button.subtle{border-color:transparent;background:transparent}
    button:disabled{opacity:.58;cursor:default}
    .profile-box{display:grid;gap:10px;border:1px solid #e5e5e5;background:#fbfbfb;padding:12px;border-radius:4px}
    .profile-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
    .pill{display:inline-flex;align-items:center;height:22px;border-radius:11px;background:#eef6fc;color:#005a9e;padding:0 8px;font-size:12px}
    .status{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#4f4f4f}
    .dot{width:8px;height:8px;border-radius:50%;background:#8a8a8a}.dot.ok{background:#107c10}.dot.warn{background:#ffaa44}.dot.bad{background:#d13438}
    table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
    th,td{border-bottom:1px solid #e5e5e5;text-align:left;padding:9px;vertical-align:top}
    th{font-weight:600;color:#4b4b4b;background:#fafafa}
    code{font-family:"Cascadia Mono",Consolas,monospace;font-size:12px}
    pre{margin:0;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;background:#1e1e1e;color:#dcdcdc;padding:12px;border-radius:3px;font-size:12px}
    .view{display:none}.view.active{display:grid;gap:18px}
    @media(max-width:900px){.layout{grid-template-columns:1fr}nav{display:none}.grid{grid-template-columns:1fr}.page-title{align-items:flex-start;flex-direction:column}}
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
          <section class="surface">
            <h2>Prueba rapida entre participantes</h2>
            <p class="muted">Ejecuta una consulta de catalogo desde un conector consumidor hacia otro proveedor.</p>
            <div class="row" style="margin-top:12px">
              <button class="primary" onclick="activateView('lab')">Ir a Comunicacion</button>
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
    const initialSelected = ${JSON.stringify(selected.id)};

    function byId(id) { return document.getElementById(id); }

    function activateView(name) {
      document.querySelectorAll('.view').forEach(function (node) { node.classList.toggle('active', node.id === 'view-' + name); });
      document.querySelectorAll('.nav-item').forEach(function (node) { node.classList.toggle('active', node.dataset.view === name); });
    }

    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.addEventListener('click', function () { activateView(button.dataset.view); });
    });

    function fillSelects() {
      const options = profileItems.map(function (profile) {
        return '<option value="' + profile.id + '">' + profile.name + '</option>';
      }).join('');
      byId('consumerSelect').innerHTML = options;
      byId('providerSelect').innerHTML = options;
      byId('consumerSelect').value = initialSelected;
      const provider = profileItems.find(function (profile) { return profile.id !== initialSelected; }) || profileItems[0];
      byId('providerSelect').value = provider.id;
    }

    function renderProfiles() {
      const grid = byId('profilesGrid');
      grid.innerHTML = '';
      profileItems.forEach(function (profile) {
        const box = document.createElement('section');
        box.className = 'profile-box';
        box.innerHTML =
          '<div class="profile-head"><div><h2>' + profile.name + '</h2><p class="muted">' + profile.description + '</p></div><span class="pill">' + profile.prefix + '</span></div>' +
          '<div class="field"><label>Management API key</label><input type="password" data-api="' + profile.id + '" value=""></div>' +
          '<div class="field"><label>Token local-assets / download-sink</label><input type="password" data-local="' + profile.id + '" value=""></div>' +
          '<div class="row"><button class="primary" data-save="' + profile.id + '">Guardar</button><button data-open="' + profile.id + '">Abrir consola</button><span class="muted" id="saved-' + profile.id + '"></span></div>' +
          '<code>' + profile.remoteBase + '</code>';
        grid.appendChild(box);
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
      const apiKey = document.querySelector('[data-api="' + id + '"]').value;
      const localAssetsToken = document.querySelector('[data-local="' + id + '"]').value;
      const res = await fetch('/desktop/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: id, apiKey: apiKey, localAssetsToken: localAssetsToken })
      });
      const target = byId('saved-' + id);
      target.textContent = res.ok ? 'Guardado' : 'Error';
      await loadProfiles();
    }

    function openProfile(id) {
      window.location.assign('/desktop/open/' + encodeURIComponent(id));
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

    byId('runLabBtn').addEventListener('click', runLab);
    byId('logoutBtn').addEventListener('click', async function () {
      await fetch('/desktop/auth/logout', { method: 'POST' });
      window.location.assign('/desktop');
    });

    renderProfiles();
    fillSelects();
    loadProfiles();
  </script>
</body>
</html>`;
}

function renderConfig(profile) {
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
    arcgisAuthEnabled: 'false',
    arcgisPortalUrl: '',
    arcgisClientId: '',
    arcgisRedirectUri: '',
    arcgisRequiredOrgId: '',
    arcgisRequiredGroupId: '',
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
  const consumer = getProfile(payload.consumerId);
  const provider = getProfile(payload.providerId);
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
  const summary = ok
    ? `${consumer.name} ha consultado el catalogo DSP de ${provider.name}.`
    : missingCredentials
      ? 'Hay conectores que no aceptan la credencial configurada. Revisa las API keys.'
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

function serveStatic(req, res, uiDir, profile, prefix, sessionToken) {
  const incoming = new URL(req.url, `http://${req.headers.host}`);
  const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length) || '/';
  if (pathAfterPrefix === '/config.js') return send(res, 200, renderConfig(profile), 'text/javascript;charset=utf-8');
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
      const body = !store.isAuthConfigured()
        ? renderAuthPage({ mode: 'setup' })
        : authenticated
          ? renderDashboard({ store, selectedProfileId: store.getLastProfileId() })
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

    if (incoming.pathname === '/desktop/communication/test' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      return sendJson(res, await runCommunicationTest(store, payload));
    }

    if (incoming.pathname.startsWith('/desktop/open/')) {
      const profileId = decodeURIComponent(incoming.pathname.split('/').pop() || '');
      const profile = getProfile(profileId);
      store.rememberProfile(profile.id);
      res.writeHead(302, { location: `/${profile.prefix}/`, 'set-cookie': cookie(DESKTOP_SESSION_COOKIE, sessionToken) });
      return res.end();
    }

    const [, prefix] = incoming.pathname.split('/');
    const profile = getProfileByPrefix(prefix);
    if (!profile) return send(res, 404, 'Perfil no encontrado');

    const pathAfterPrefix = incoming.pathname.slice(`/${prefix}`.length);
    if (/^\/(api\/management|api\/v1\/dsp|local-assets|download-sink)/i.test(pathAfterPrefix)) {
      return proxyRequest(req, res, profile, prefix);
    }
    return serveStatic(req, res, uiDir, profile, prefix, sessionToken);
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
