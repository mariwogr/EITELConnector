const cfg = window.EITEL_UI_CONFIG || {};
    function isPlaceholderConfigValue(value) {
      const txt = String(value || '').trim();
      return !txt || txt === 'CONNECTOR' || /^\$\{[^}]+\}$/.test(txt);
    }

    function deriveConnectorNameFromRuntime() {
      const configuredName = String(cfg.connectorName || '').trim();
      if (!isPlaceholderConfigValue(configuredName)) return configuredName;

      const pathPrefix = (window.location.pathname || '/').split('/').filter(Boolean)[0] || '';
      if (/^conector/i.test(pathPrefix)) return pathPrefix;

      const configuredDsp = String(cfg.dspUrl || '').trim();
      if (!isPlaceholderConfigValue(configuredDsp)) {
        try {
          const url = new URL(configuredDsp, window.location.origin);
          const dspPrefix = (url.pathname || '/').split('/').filter(Boolean)[0] || '';
          if (/^conector/i.test(dspPrefix)) return dspPrefix;
        } catch {}
      }

      return 'connector';
    }

    const connectorName = deriveConnectorNameFromRuntime();
    const configuredRuntimeDsp = String(cfg.dspUrl || '').trim();
    const PROD_DSP_URL = !isPlaceholderConfigValue(configuredRuntimeDsp)
      ? configuredRuntimeDsp
      : `${window.location.origin}/${connectorName}/api/v1/dsp/2025-1`;
    const PROD_CONNECTOR_ID = connectorName.toLowerCase();
    const role = connectorName.toLowerCase().includes('provider') ? 'Provider' : (connectorName.toLowerCase().includes('consumer') ? 'Consumer' : 'Connector');

    const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
    const configuredUiVariant = String(cfg.uiVariant || '').trim().toLowerCase();
    const uiVariant = configuredUiVariant || (isTruthy(cfg.starMode) || connectorName.toLowerCase().includes('star') ? 'star' : 'production');
    const arcgisEnabledRaw = String(cfg.arcgisAuthEnabled || '').trim();
    const normalizePortalUrl = (url) => {
      let normalized = String(url || '').trim();
      normalized = normalized.replace(/\/+$/, '');
      normalized = normalized.replace(/\/home\/index\.html$/i, '');
      normalized = normalized.replace(/\/home$/i, '');
      return normalized;
    };
    const arcgis = {
      enabled: arcgisEnabledRaw ? isTruthy(arcgisEnabledRaw) : uiVariant !== 'star',
      portalUrl: normalizePortalUrl(cfg.arcgisPortalUrl || 'https://gis.eiteldata.eu/arcgis'),
      clientId: (cfg.arcgisClientId || 'arcgisonline').trim(),
      redirectUri: (cfg.arcgisRedirectUri || window.location.href).trim(),
      requiredOrgId: (cfg.arcgisRequiredOrgId || '').trim(),
      requiredGroupId: (cfg.arcgisRequiredGroupId || '').trim(),
      requiresLogin: uiVariant === 'production',
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

        const normalized = normalizeManagementApiBaseUrl(settings.apiBaseUrl || '');
        if (normalized && normalized !== settings.apiBaseUrl) {
          settings.apiBaseUrl = normalized;
          try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch {}
        }
        if (!String(normalized).includes('/api/management')) {
          settings.apiBaseUrl = buildSafeManagementApiBaseUrl();
          try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch {}
        }
      } catch {}
    }

    function persistSettings() {
      try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch {}
    }

    const state = {
      catalogRows: [],
      catalogShowcaseLoaded: false,
      agreementRows: [],
      transferRows: [],
      secretNames: [],
      catalogAutoRequestInFlight: false,
      secretsAvailable: false,
      secretsApi: null,
    };

    function getConnectorPathPrefix() {
      const pathParts = (window.location.pathname || '/').split('/').filter(Boolean);
      const pathPrefix = pathParts[0] || '';
      if (/^conector/i.test(pathPrefix)) return pathPrefix;
      const configuredName = String(cfg.connectorName || '').trim();
      if (/^conector/i.test(configuredName)) return configuredName;
      return pathPrefix;
    }

    function buildPrefixedManagementApiBaseUrl() {
      const pathPrefix = getConnectorPathPrefix();
      return pathPrefix ? `/${pathPrefix}/api/management` : '/api/management';
    }

    function normalizeManagementApiBaseUrl(rawUrl) {
      const raw = String(rawUrl || '').trim();
      if (!raw) return buildPrefixedManagementApiBaseUrl();

      if (raw === '/api/management' && getConnectorPathPrefix()) {
        return buildPrefixedManagementApiBaseUrl();
      }

      // Si tiene protocolo y host, devolverla tal cual
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
          const url = new URL(raw);
          if (url.origin === window.location.origin && url.pathname.replace(/\/+$/, '') === '/api/management' && getConnectorPathPrefix()) {
            return buildPrefixedManagementApiBaseUrl();
          }
        } catch {}
        return raw.replace(/\/+$/, '');
      }

      // Si es relativa y termina en /api/management, es correcta
      if (raw.includes('/api/management')) return raw.replace(/\/+$/, '');

      // Si solo tiene /management, agregar /api/
      if (/\/management\/?$/i.test(raw)) {
        return raw.replace(/\/management\/?$/i, '/api/management').replace(/\/+$/, '');
      }

      return raw.replace(/\/+$/, '');
    }

    function buildSafeManagementApiBaseUrl() {
      // Primero intentar usar la URL del config (NEXT_PUBLIC_MANAGEMENT_API_URL)
      const configured = normalizeManagementApiBaseUrl(cfg.managementApiUrl || '');
      if (configured) return configured;

      // Fallback: extraer del pathname actual
      const prefixed = buildPrefixedManagementApiBaseUrl();
      if (prefixed !== '/api/management') return prefixed;

      // Último recurso: solo /api/management
      return '/api/management';
    }

    const getApiBaseUrl = () => {
      const saved = normalizeManagementApiBaseUrl(settings.apiBaseUrl || '');
      if (saved) return saved;
      const configured = normalizeManagementApiBaseUrl(cfg.managementApiUrl || '');
      if (configured) return configured;
      return buildSafeManagementApiBaseUrl();
    };
    const getApiKey = () => (settings.apiKeyOverride || cfg.apiKey || '').trim();

    const i18n = {
      es: {
        'nav.dashboard': 'Inicio', 'nav.publish': 'Publicar', 'nav.catalog': 'Catalog', 'nav.contracts': 'Contracts', 'nav.transfers': 'Transfers', 'nav.secrets': 'Secrets', 'nav.explorer': 'API',
        'dash.title': 'Dashboard', 'dash.subtitle': 'Vista rápida del conector para operar en producción.', 'dash.contracts': 'Contratos', 'dash.transfers': 'Transferencias', 'dash.refresh': 'Actualizar',
        'publish.title': 'Publicar asset + contract', 'publish.subtitle': 'Control de duplicados y auth opcional enlazada con vault.', 'publish.assetKey': 'Asset key', 'publish.assetId': 'ID interno', 'publish.name': 'Nombre', 'publish.baseUrl': 'Base URL', 'publish.create': 'Crear/Actualizar', 'publish.list': 'Listar', 'publish.delete': 'Borrar',
        'catalog.title': 'Asset catalog', 'catalog.subtitle': 'Consulta assets disponibles, aplica filtros y prepara contract requests.', 'catalog.connector': 'Remote connector', 'catalog.dsp': 'DSP URL', 'catalog.load': 'Ver catalogs', 'catalog.refresh': 'Actualizar', 'catalog.assetToContract': 'Asset a contratar', 'catalog.requestContract': 'Pedir contract por asset', 'catalog.listRequests': 'Ver requests', 'catalog.requests': 'Requests',
        'contracts.title': 'Contracts', 'contracts.subtitle': 'Sin duplicados: control por ID y por Asset+Partner.', 'contracts.list': 'Listar contracts',
        'transfer.title': 'Transfers', 'transfer.partnerAddress': 'Dirección partner', 'transfer.contractSelect': 'Contract', 'transfer.contractId': 'ID contract (opcional)', 'transfer.sinkUrl': 'Sink URL (dummy inbox)', 'transfer.start': 'Iniciar transfer', 'transfer.list': 'Listar transfers', 'transfer.checkInbox': 'Ver dummy inbox', 'transfer.clearInbox': 'Limpiar dummy inbox',
        'secrets.title': 'Secrets', 'secrets.subtitle': 'Gestión rápida del vault de secrets.', 'secrets.name': 'Nombre', 'secrets.value': 'Valor', 'secrets.save': 'Guardar', 'secrets.list': 'Listar', 'secrets.delete': 'Borrar',
        'settings.title': 'Ajustes', 'settings.lang': 'Idioma', 'settings.theme': 'Tema', 'settings.consolePosition': 'Consola', 'settings.consoleFont': 'Fuente consola', 'settings.dummyUrl': 'URL dummy inbox', 'settings.auto': 'Los cambios se aplican al instante.', 'settings.testDummy': 'Probar dummy inbox', 'settings.close': 'Cerrar',
        'table.offer': 'Oferta', 'table.provider': 'Proveedor', 'table.request': 'Solicitud', 'table.state': 'Estado', 'table.contract': 'Contrato', 'table.transfer': 'Transferencia'
      },
      en: {
        'nav.dashboard': 'Home', 'nav.publish': 'Publish', 'nav.catalog': 'Catalogs', 'nav.contracts': 'Contracts', 'nav.transfers': 'Transfers', 'nav.secrets': 'Secrets', 'nav.explorer': 'API',
        'dash.title': 'Dashboard', 'dash.subtitle': 'Quick connector view for production operations.', 'dash.contracts': 'Contracts', 'dash.transfers': 'Transfers', 'dash.refresh': 'Refresh',
        'publish.title': 'Publish asset + contract', 'publish.subtitle': 'Duplicate control and optional auth linked to vault.', 'publish.assetKey': 'Asset key', 'publish.assetId': 'Internal ID', 'publish.name': 'Name', 'publish.baseUrl': 'Base URL', 'publish.create': 'Create/Update', 'publish.list': 'List', 'publish.delete': 'Delete',
        'catalog.title': 'Asset catalog', 'catalog.subtitle': 'Review available assets, apply filters, and prepare contract requests.', 'catalog.connector': 'Remote connector', 'catalog.dsp': 'DSP URL', 'catalog.load': 'Load catalogs', 'catalog.refresh': 'Refresh', 'catalog.assetToContract': 'Asset to contract', 'catalog.requestContract': 'Request contract by asset', 'catalog.listRequests': 'List requests', 'catalog.requests': 'Requests',
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
      const ts = Number.isFinite(n) && n > 0
        ? (n < 1_000_000_000_000 ? n * 1000 : n)
        : NaN;
      const d = Number.isFinite(ts) ? new Date(ts) : new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString();
    };

    function t(k) { return i18n[settings.language]?.[k] || k; }

    function pushStatusAlert(kind, title, message) {
      const stack = document.getElementById('alertStack');
      if (!stack) return;
      const tone = ['success', 'error', 'warn', 'info'].includes(kind) ? kind : 'info';
      const toast = document.createElement('article');
      toast.className = `alert-toast ${tone}`;
      toast.innerHTML = `
        <div class="alert-title">${String(title || 'Aviso')}</div>
        <div class="alert-message">${String(message || '')}</div>
      `;
      stack.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, tone === 'error' ? 9000 : 6500);
    }

    function deriveToastFromPayload(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const status = Number(payload.status || 0);
      if (!Number.isFinite(status) || status <= 0) return null;

      const detail = String(
        payload.message || payload.info || payload.hint || payload.error || payload.detail || ''
      ).trim();

      if (status >= 200 && status < 300) {
        if (!detail && !payload.action && !payload.publish) return null;
        return {
          kind: 'success',
          title: 'Operacion completada',
          message: detail || 'La solicitud se ha ejecutado correctamente.'
        };
      }
      if (status >= 400) {
        return {
          kind: 'error',
          title: `Atencion: incidencia (${status})`,
          message: detail || 'No se pudo completar la accion. Revisa los datos e intenta de nuevo.'
        };
      }
      return {
        kind: 'info',
        title: `Estado ${status}`,
        message: detail || 'Operacion en curso.'
      };
    }

    window.pushStatusAlert = pushStatusAlert;

    function writeOut(payload) {
      out.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      const toast = deriveToastFromPayload(payload);
      if (toast) pushStatusAlert(toast.kind, toast.title, toast.message);
    }

    function getArcgisLoginButtons() {
      return [
        document.getElementById('btnArcgisLogin'),
        document.getElementById('btnArcgisLoginGate'),
      ].filter(Boolean);
    }

    function getArcgisCheckButtons() {
      return [
        document.getElementById('btnArcgisCheck'),
        document.getElementById('btnArcgisCheckGate'),
      ].filter(Boolean);
    }

    function showAuthGate(message = '') {
      const gate = document.getElementById('authGate');
      const errorBox = document.getElementById('authError');
      if (!gate || !errorBox) return;
      const help = gate.querySelector('.auth-help');
      if (help) {
        help.textContent = arcgis.requiresLogin
          ? 'Para acceder a este conector de producción inicia sesión con ArcGIS Enterprise. La consola validará la sesión del portal antes de operar.'
          : 'Esta ventana solo se usa cuando quieres publicar un asset desde ArcGIS o pedir un token del portal. La consola puede funcionar sin iniciar sesión en ArcGIS.';
      }
      gate.classList.add('open');
      getArcgisLoginButtons().forEach((button) => {
        button.style.display = 'inline-flex';
        button.disabled = false;
        button.onclick = startArcgisLogin;
      });
      getArcgisCheckButtons().forEach((button) => {
        button.style.display = 'inline-flex';
        button.disabled = false;
        button.onclick = () => ensureArcgisLogin();
      });
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
      try {
        sessionStorage.removeItem(arcgisTokenStorageKey);
        sessionStorage.removeItem('eitel.arcgis.access_token_expires');
      } catch {}
    }

    async function fetchArcgisJson(path, { token = '', useCookies = true, timeoutMs = 12000 } = {}) {
      const sep = path.includes('?') ? '&' : '?';
      const tokenPart = token ? `&token=${encodeURIComponent(token)}` : '';
      const url = `${arcgis.portalUrl}/sharing/rest/${path}${sep}f=json${tokenPart}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { credentials: useCookies ? 'include' : 'omit', signal: controller.signal });
        const data = await res.json();
        if (!res.ok || data?.error) {
          const msg = data?.error?.message || `ArcGIS HTTP ${res.status}`;
          throw new Error(msg);
        }
        return data;
      } catch (e) {
        if (e?.name === 'AbortError') throw new Error('ArcGIS Enterprise no responde (timeout). Comprueba que el portal está accesible e inténtalo de nuevo.');
        throw e;
      } finally {
        clearTimeout(timer);
      }
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
        arcgis.portalUrl = 'https://gis.eiteldata.eu/arcgis';
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

      getArcgisLoginButtons().forEach((button) => { button.onclick = startArcgisLogin; });
      getArcgisCheckButtons().forEach((button) => { button.onclick = () => ensureArcgisLogin(); });

      try {
        const appHost = window.location.host;
        const portalHost = new URL(arcgis.portalUrl).host;
        const pathParts = (window.location.pathname || '/').split('/').filter(Boolean);
        const connectorPrefix = pathParts[0] || cfg.connectorName || 'conectoruc3m';
        if (appHost !== portalHost) {
          showAuthGate(`Host distinto detectado. Abre la consola en https://${portalHost}/${connectorPrefix}/ para reutilizar la sesion del portal. Host actual: ${appHost}`);
          return false;
        }
      } catch {}

      showAuthGate('Comprobando sesion ArcGIS Enterprise...');

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
        const pathParts = (window.location.pathname || '/').split('/').filter(Boolean);
        const connectorPrefix = pathParts[0] || cfg.connectorName || 'conectoruc3m';
        showAuthGate(`Inicia sesion en ArcGIS Enterprise para acceder.\n${String(e?.message || e)}\nTip: accede siempre por https://gis.eiteldata.eu/${connectorPrefix}/`);
        return false;
      }
    }

