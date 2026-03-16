const cfg = window.EITEL_UI_CONFIG || {};
    const PROD_DSP_URL = cfg.dspUrl || 'http://conectoruc3m:11003/api/v1/dsp/2025-1';
    const PROD_CONNECTOR_ID = (cfg.connectorName || 'conectoruc3m').toLowerCase();
    const connectorName = cfg.connectorName || 'CONNECTOR';
    const role = connectorName.toLowerCase().includes('provider') ? 'Provider' : (connectorName.toLowerCase().includes('consumer') ? 'Consumer' : 'Connector');

    const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
    const normalizePortalUrl = (url) => {
      let normalized = String(url || '').trim();
      normalized = normalized.replace(/\/+$/, '');
      normalized = normalized.replace(/\/home\/index\.html$/i, '');
      normalized = normalized.replace(/\/home$/i, '');
      return normalized;
    };
    const arcgis = {
      enabled: isTruthy(cfg.arcgisAuthEnabled || 'true'),
      portalUrl: normalizePortalUrl(cfg.arcgisPortalUrl),
      clientId: (cfg.arcgisClientId || '').trim(),
      redirectUri: (cfg.arcgisRedirectUri || '').trim(),
      requiredOrgId: (cfg.arcgisRequiredOrgId || '').trim(),
      requiredGroupId: (cfg.arcgisRequiredGroupId || '').trim(),
    };
    const authState = { username: '', orgId: '' };
    const arcgisTokenStorageKey = 'eitel.arcgis.access_token';

    const app = document.getElementById('app');
    const out = document.getElementById('out');
    const settingsModal = document.getElementById('settingsModal');
    const infoModal = document.getElementById('infoModal');

    const settings = {
      language: 'es',
      theme: 'light',
      consolePos: 'right',
      consoleFont: 13,
      consoleExpanded: false,
      apiBaseUrl: cfg.managementApiUrl || '/api/management',
      apiKeyOverride: '',
      apiTimeoutMs: 15000,
      apiRetries: 1,
    };
    const settingsKey = `eitel.ui.settings.${connectorName}`;
    let infoActionHandler = null;

    function loadSettings() {
      try {
        const raw = localStorage.getItem(settingsKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') Object.assign(settings, parsed);
      } catch {}
    }

    function persistSettings() {
      try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch {}
    }

    const state = {
      catalogRows: [],
      agreementRows: [],
      transferRows: [],
      secretNames: [],
      catalogAutoRequestInFlight: false,
      secretsAvailable: false,
      secretsApi: null,
    };

    const getApiBaseUrl = () => (settings.apiBaseUrl || cfg.managementApiUrl || '/api/management').trim();
    const getApiKey = () => (settings.apiKeyOverride || cfg.apiKey || '').trim();

    const i18n = {
      es: {
        'nav.dashboard': 'Inicio', 'nav.publish': 'Publicar', 'nav.catalog': 'Catálogos', 'nav.contracts': 'Contratos', 'nav.transfers': 'Transferencias', 'nav.secrets': 'Secretos', 'nav.explorer': 'API',
        'dash.title': 'Dashboard', 'dash.subtitle': 'Vista rápida del conector para operar en producción.', 'dash.contracts': 'Contratos', 'dash.transfers': 'Transferencias', 'dash.refresh': 'Actualizar',
        'publish.title': 'Publicar asset + contrato', 'publish.subtitle': 'Control de duplicados y autenticación opcional enlazada con vault.', 'publish.assetKey': 'Asset key', 'publish.assetId': 'ID interno', 'publish.name': 'Nombre', 'publish.baseUrl': 'Base URL', 'publish.create': 'Crear/Actualizar', 'publish.list': 'Listar', 'publish.delete': 'Borrar',
        'catalog.title': 'Catálogos del proveedor', 'catalog.subtitle': 'No hace falta ID de oferta. Solo selecciona asset y acepta términos para generar el contrato.', 'catalog.connector': 'Conector remoto', 'catalog.dsp': 'URL DSP', 'catalog.load': 'Ver catálogos', 'catalog.refresh': 'Actualizar', 'catalog.assetToContract': 'Asset a contratar', 'catalog.requestContract': 'Pedir contrato por asset', 'catalog.listRequests': 'Ver solicitudes', 'catalog.requests': 'Solicitudes',
        'contracts.title': 'Contratos', 'contracts.subtitle': 'Sin repetidos: control por ID y por Asset+Partner.', 'contracts.list': 'Listar contratos',
        'transfer.title': 'Transferencias', 'transfer.partnerAddress': 'Dirección partner', 'transfer.contractSelect': 'Contrato', 'transfer.contractId': 'ID contrato (opcional)', 'transfer.sinkUrl': 'Sink URL (dummy inbox)', 'transfer.start': 'Iniciar transferencia', 'transfer.list': 'Listar transferencias', 'transfer.checkInbox': 'Ver dummy inbox', 'transfer.clearInbox': 'Limpiar dummy inbox',
        'secrets.title': 'Secretos', 'secrets.subtitle': 'Gestión rápida del vault de secretos.', 'secrets.name': 'Nombre', 'secrets.value': 'Valor', 'secrets.save': 'Guardar', 'secrets.list': 'Listar', 'secrets.delete': 'Borrar',
        'settings.title': 'Ajustes', 'settings.lang': 'Idioma', 'settings.theme': 'Tema', 'settings.consolePosition': 'Consola', 'settings.consoleFont': 'Fuente consola', 'settings.dummyUrl': 'URL dummy inbox', 'settings.auto': 'Los cambios se aplican al instante.', 'settings.testDummy': 'Probar dummy inbox', 'settings.close': 'Cerrar',
        'table.offer': 'Oferta', 'table.provider': 'Proveedor', 'table.request': 'Solicitud', 'table.state': 'Estado', 'table.contract': 'Contrato', 'table.transfer': 'Transferencia'
      },
      en: {
        'nav.dashboard': 'Home', 'nav.publish': 'Publish', 'nav.catalog': 'Catalogs', 'nav.contracts': 'Contracts', 'nav.transfers': 'Transfers', 'nav.secrets': 'Secrets', 'nav.explorer': 'API',
        'dash.title': 'Dashboard', 'dash.subtitle': 'Quick connector view for production operations.', 'dash.contracts': 'Contracts', 'dash.transfers': 'Transfers', 'dash.refresh': 'Refresh',
        'publish.title': 'Publish asset + contract', 'publish.subtitle': 'Duplicate control and optional auth linked to vault.', 'publish.assetKey': 'Asset key', 'publish.assetId': 'Internal ID', 'publish.name': 'Name', 'publish.baseUrl': 'Base URL', 'publish.create': 'Create/Update', 'publish.list': 'List', 'publish.delete': 'Delete',
        'catalog.title': 'Provider catalogs', 'catalog.subtitle': 'No offer ID needed. Select an asset and accept terms to generate the contract.', 'catalog.connector': 'Remote connector', 'catalog.dsp': 'DSP URL', 'catalog.load': 'Load catalogs', 'catalog.refresh': 'Refresh', 'catalog.assetToContract': 'Asset to contract', 'catalog.requestContract': 'Request contract by asset', 'catalog.listRequests': 'List requests', 'catalog.requests': 'Requests',
        'contracts.title': 'Contracts', 'contracts.subtitle': 'No duplicates: check by ID and Asset+Partner.', 'contracts.list': 'List contracts',
        'transfer.title': 'Transfers', 'transfer.partnerAddress': 'Partner address', 'transfer.contractSelect': 'Contract', 'transfer.contractId': 'Contract ID (optional)', 'transfer.sinkUrl': 'Sink URL (dummy inbox)', 'transfer.start': 'Start transfer', 'transfer.list': 'List transfers', 'transfer.checkInbox': 'Check dummy inbox', 'transfer.clearInbox': 'Clear dummy inbox',
        'secrets.title': 'Secrets', 'secrets.subtitle': 'Quick secret vault management.', 'secrets.name': 'Name', 'secrets.value': 'Value', 'secrets.save': 'Save', 'secrets.list': 'List', 'secrets.delete': 'Delete',
        'settings.title': 'Settings', 'settings.lang': 'Language', 'settings.theme': 'Theme', 'settings.consolePosition': 'Console', 'settings.consoleFont': 'Console font', 'settings.dummyUrl': 'Dummy inbox URL', 'settings.auto': 'Changes are applied instantly.', 'settings.testDummy': 'Test dummy inbox', 'settings.close': 'Close',
        'table.offer': 'Offer', 'table.provider': 'Provider', 'table.request': 'Request', 'table.state': 'State', 'table.contract': 'Contract', 'table.transfer': 'Transfer'
      }
    };

    const q = () => JSON.stringify({ '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' }, '@type': 'QuerySpec', offset: 0, limit: 100, sortOrder: 'DESC' });
    const unwrap = (p) => Array.isArray(p?.data) ? p.data : (Array.isArray(p?.data?.value) ? p.data.value : (Array.isArray(p?.data?.content) ? p.data.content : []));
    const clean = (v) => ((v || '').toString().split('/').pop().split(':').pop().replace(/[-_]+/g, ' ').trim() || (v || '').toString());
    const slug = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
    const fmtDate = (v) => {
      if (!v) return '-';
      const n = Number(v);
      const d = Number.isFinite(n) && n > 0 ? new Date(n) : new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString();
    };

    function t(k) { return i18n[settings.language]?.[k] || k; }
    function writeOut(payload) { out.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2); }

    function showAuthGate(message = '', canLogin = true) {
      const gate = document.getElementById('authGate');
      const loginBtn = document.getElementById('btnArcgisLogin');
      const errorBox = document.getElementById('authError');
      if (!gate || !loginBtn || !errorBox) return;
      gate.classList.add('open');
      loginBtn.style.display = canLogin ? 'inline-flex' : 'none';
      if (message) {
        errorBox.textContent = message;
        errorBox.style.display = 'block';
      } else {
        errorBox.style.display = 'none';
      }
    }

    function hideAuthGate() {
      const gate = document.getElementById('authGate');
      if (gate) gate.classList.remove('open');
    }

    function extractArcgisTokenFromHash() {
      const hash = String(window.location.hash || '');
      if (!hash || !hash.includes('access_token=')) return '';
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const token = (params.get('access_token') || '').trim();
      if (!token) return '';
      try { sessionStorage.setItem(arcgisTokenStorageKey, token); } catch {}
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }

    function getStoredArcgisToken() {
      try { return (sessionStorage.getItem(arcgisTokenStorageKey) || '').trim(); } catch { return ''; }
    }

    function clearStoredArcgisToken() {
      try { sessionStorage.removeItem(arcgisTokenStorageKey); } catch {}
    }

    async function fetchArcgisJson(path, { token = '', useCookies = true } = {}) {
      const sep = path.includes('?') ? '&' : '?';
      const tokenPart = token ? `&token=${encodeURIComponent(token)}` : '';
      const url = `${arcgis.portalUrl}/sharing/rest/${path}${sep}f=json${tokenPart}`;
      const res = await fetch(url, { credentials: useCookies ? 'include' : 'omit' });
      const data = await res.json();
      if (!res.ok || data?.error) {
        const msg = data?.error?.message || `ArcGIS HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    }

    async function userIsInRequiredGroup(username, options = {}) {
      if (!arcgis.requiredGroupId) return true;
      const groupId = encodeURIComponent(arcgis.requiredGroupId);
      try {
        const list = await fetchArcgisJson(`community/groups/${groupId}/userList`, options);
        const members = new Set([
          ...(list?.users || []),
          ...(list?.admins || []),
          ...(list?.owner ? [list.owner] : []),
        ]);
        if (members.has(username)) return true;
      } catch {}

      const userData = await fetchArcgisJson(`community/users/${encodeURIComponent(username)}`, options);
      const groups = Array.isArray(userData?.groups) ? userData.groups : [];
      return groups.some(g => (g?.id || '') === arcgis.requiredGroupId);
    }

    function startArcgisLogin() {
      if (!arcgis.portalUrl) {
        showAuthGate('Falta configurar ARCGIS_PORTAL_URL.', false);
        return;
      }
      const clientId = arcgis.clientId || 'arcgisonline';
      const redirectUri = arcgis.redirectUri || window.location.href;
      const authorizeUrl = `${arcgis.portalUrl}/sharing/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token&expiration=20160&redirect_uri=${encodeURIComponent(redirectUri)}`;
      window.location.assign(authorizeUrl);
    }

    function arcgisLogout() {
      // Only clear the stored token locally; keep the ArcGIS session intact.
      clearStoredArcgisToken();
      authState.username = '';
      authState.orgId = '';
      hideAuthGate();
      window.location.reload();
    }

    async function ensureArcgisLogin() {
      if (!arcgis.enabled) return true;

      const loginBtn = document.getElementById('btnArcgisLogin');
      const checkBtn = document.getElementById('btnArcgisCheck');
      if (loginBtn) loginBtn.onclick = startArcgisLogin;
      if (checkBtn) checkBtn.onclick = () => ensureArcgisLogin();

      if (!arcgis.portalUrl) {
        showAuthGate('ArcGIS login activo pero falta configurar ARCGIS_PORTAL_URL en el entorno.', false);
        return false;
      }

      try {
        const appHost = window.location.host;
        const portalHost = new URL(arcgis.portalUrl).host;
        if (appHost !== portalHost) {
          showAuthGate(`Host distinto detectado. Abre la consola en https://${portalHost}/conectoruc3m/ para reutilizar la sesion del portal. Host actual: ${appHost}`, true);
          return false;
        }
      } catch {}

      showAuthGate('Comprobando sesion ArcGIS Enterprise...', false);

      const tokenFromHash = extractArcgisTokenFromHash();
      const accessToken = tokenFromHash || getStoredArcgisToken();

      try {
        const self = await fetchArcgisJson('community/self', accessToken
          ? { token: accessToken, useCookies: false }
          : { useCookies: true });
        const username = self?.username || self?.user?.username || '';
        const orgId = self?.orgId || self?.user?.orgId || '';
        if (!username) throw new Error('No se pudo obtener el usuario autenticado de ArcGIS.');

        if (arcgis.requiredOrgId && orgId !== arcgis.requiredOrgId) {
          throw new Error(`Usuario fuera de la organizacion permitida. orgId actual: ${orgId || '(vacio)'}`);
        }

        const inGroup = await userIsInRequiredGroup(username, accessToken
          ? { token: accessToken, useCookies: false }
          : { useCookies: true });
        if (!inGroup) {
          throw new Error(`Usuario '${username}' no pertenece al grupo permitido (${arcgis.requiredGroupId}).`);
        }

        authState.username = username;
        authState.orgId = orgId;
        hideAuthGate();
        return true;
      } catch (e) {
        clearStoredArcgisToken();
        showAuthGate(`Inicia sesion en ArcGIS Enterprise para acceder.\n${String(e?.message || e)}\nTip: accede siempre por https://gis.eiteldata.eu/conectoruc3m/`, true);
        return false;
      }
    }

