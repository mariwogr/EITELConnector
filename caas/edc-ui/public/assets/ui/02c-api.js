    /**
     * Gets the base URL for local assets API from configuration.
     * Constructs URL using current window origin and connector prefix.
     * 
     * @returns {string} Base URL for local assets API
     * 
     * @example
     * const baseUrl = getLocalAssetsApiBaseUrl();
     * // Returns: 'http://localhost:3000/conectoruc3m/local-assets'
     */
    function getLocalAssetsApiBaseUrl() {
      const prefix = getUiPrefixPath().replace(/\/+$/, '');
      return `${window.location.origin}${prefix}/local-assets`;
    }

    function isLocalAssetsPlaceholderToken(value) {
      const text = String(value || '').trim();
      return !text || /^\$\{[^}]+\}$/.test(text);
    }

    function getLocalAssetsAuthToken() {
      const configured = String(cfg?.localAssetsAuthToken || '').trim();
      return isLocalAssetsPlaceholderToken(configured) ? '' : configured;
    }

    function getLocalAssetsArcgisToken() {
      try {
        if (typeof getArcgisAccessTokenForPublish === 'function') {
          const token = String(getArcgisAccessTokenForPublish() || '').trim();
          if (token) return token;
        }
      } catch {}
      try {
        if (typeof getStoredArcgisToken === 'function') {
          const token = String(getStoredArcgisToken() || '').trim();
          if (token) return token;
        }
      } catch {}
      try {
        return String(sessionStorage.getItem('eitel.arcgis.access_token') || '').trim();
      } catch {
        return '';
      }
    }

    function getLocalAssetsAuthHeaders(baseHeaders = {}) {
      const headers = { ...(baseHeaders || {}) };
      const arcgisToken = getLocalAssetsArcgisToken();
      if (arcgisToken && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${arcgisToken}`;
        return headers;
      }
      const token = getLocalAssetsAuthToken();
      if (token && !headers['x-api-key'] && !headers['X-Api-Key']) {
        headers['x-api-key'] = token;
      }
      return headers;
    }

    function getLocalAssetsAuthHeadersForUrl(url, baseHeaders = {}) {
      const text = String(url || '').toLowerCase();
      return text.includes('/local-assets/') || text.includes('/download-sink/')
        ? getLocalAssetsAuthHeaders(baseHeaders)
        : { ...(baseHeaders || {}) };
    }

    /**
     * Extracts connector prefix from the management API URL.
     * Identifies which connector this UI is managing (e.g., 'conectoruc3m').
     * 
     * @returns {string} Connector prefix identifier
     * 
     * @example
     * const prefix = getConnectorPrefixFromManagementApiUrl();
     * // Returns: 'conectoruc3m' if API is at '/conectoruc3m/api/management'
     */
    function getConnectorPrefixFromManagementApiUrl() {
      const apiBase = String(getApiBaseUrl() || '').trim();
      if (!apiBase) return '';
      try {
        const url = apiBase.startsWith('http://') || apiBase.startsWith('https://')
          ? new URL(apiBase)
          : new URL(apiBase, window.location.origin);
        const parts = (url.pathname || '').split('/').filter(Boolean);
        if (parts.length >= 3 && String(parts[1]).toLowerCase() === 'api' && String(parts[2]).toLowerCase() === 'management') {
          const prefix = String(parts[0] || '').trim();
          if (prefix.toLowerCase().startsWith('conector')) return prefix;
        }
      } catch {}
      return '';
    }

    /**
     * Gets candidate base URLs for local assets API with fallback routing.
     * Tries multiple URL patterns to support different deployment scenarios.
     * 
     * @returns {string[]} Array of candidate base URLs in priority order
     * 
     * @example
     * const candidates = getLocalAssetsApiBaseUrlCandidates();
     * // Returns: ['http://localhost:3000/...', 'http://localhost/...', ...]
     */
    function getLocalAssetsApiBaseUrlCandidates() {
      const candidates = [];
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname.startsWith('127.');
      const hasConnectorPrefixInPath = (window.location.pathname || '/').toLowerCase().split('/').filter(Boolean)[0]?.startsWith('conector');
      const pushIfValid = (value) => {
        const txt = String(value || '').trim();
        if (!txt) return;
        if (!candidates.includes(txt)) candidates.push(txt);
      };

      pushIfValid(getLocalAssetsApiBaseUrl());

      const fromApiBase = getConnectorPrefixFromManagementApiUrl();
      if (fromApiBase) {
        pushIfValid(`${window.location.origin}/${fromApiBase}/local-assets`);
      }

      const configuredName = String(cfg?.connectorName || '').trim();
      const configuredPrefix = /^conector/i.test(configuredName) ? canonicalConnectorPrefix(configuredName) : '';
      if (configuredPrefix) {
        pushIfValid(`${window.location.origin}/${configuredPrefix}/local-assets`);
        pushIfValid(`${window.location.origin}/${configuredPrefix.toLowerCase()}/local-assets`);
      }

      // Compatibilidad: algunos despliegues publican local-assets en raíz.
      // Evitar este fallback cuando la UI ya está bajo un prefijo /conector*,
      // porque en producción suele devolver páginas 404/ArcGIS engañosas.
      if (isLocalHost || !hasConnectorPrefixInPath) {
        pushIfValid(`${window.location.origin}/local-assets`);
      }

      return candidates;
    }

    /**
     * Prioritizes healthy local asset API candidates by performing health checks.
     * Sorts candidates into healthy and unhealthy groups based on /health endpoint responses.
     * Healthy candidates are returned first for preference in API calls.
     * 
     * @param {string[]} [baseCandidates=[]] - Array of candidate base URLs to check
     * @returns {Promise<string[]>} Sorted array with healthy candidates first
     * 
     * @example
     * const prioritized = await prioritizeHealthyLocalAssetsCandidates(candidates);
     */
    async function prioritizeHealthyLocalAssetsCandidates(baseCandidates = []) {
      const normalized = Array.isArray(baseCandidates) ? [...new Set(baseCandidates.filter(Boolean))] : [];
      if (normalized.length <= 1) return normalized;

      const healthy = [];
      const unhealthy = [];
      for (const base of normalized) {
        const healthUrl = String(base).replace(/\/local-assets\/?$/i, '/health');
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const response = await fetch(healthUrl, {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'include',
          });
          clearTimeout(timer);
          if (response.ok) {
            healthy.push(base);
          } else {
            unhealthy.push(base);
          }
        } catch {
          unhealthy.push(base);
        }
      }

      return [...healthy, ...unhealthy];
    }

    /**
     * Retrieves asset bundle backups from local storage.
     * Asset bundles contain complete asset definitions for offline access and cached editing.
     * 
     * @returns {Object[]} Array of asset bundle backup objects
     * 
     * @example
     * const bundles = getAssetBundleBackups();
     */
    function getAssetBundleBackups() {
      try {
        const raw = localStorage.getItem(localAssetBundleStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    /**
     * Makes authenticated API calls to local assets service.
     * Handles request/response formatting and error management for asset operations.
     * 
     * @async
     * @param {string} method - HTTP method ('GET', 'POST', 'PUT', 'DELETE')
     * @param {string} path - API endpoint path
     * @param {Object} [options={}] - Request options (headers, body, etc.)
     * @returns {Promise<Object>} API response object with status and data
     * 
     * @example
     * const result = await callLocalAssetsApi('POST', '/upload', { body: formData });
     */
    async function callLocalAssetsApi(method, path, options = {}) {
      const candidates = await prioritizeHealthyLocalAssetsCandidates(getLocalAssetsApiBaseUrlCandidates());
      const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
      let lastFailure = null;
      for (const base of candidates) {
        const url = `${base}${normalizedPath}`;
        try {
          const headers = { ...(options.headers || {}) };
          const body = options.body;
          const hasJsonBody = body && typeof body === 'string' && headers['content-type']?.includes('application/json');
          if (body && !headers['content-type'] && typeof body === 'string') headers['content-type'] = 'application/json';
          const response = await fetch(url, {
            method: String(method || 'GET').toUpperCase(),
            headers: getLocalAssetsAuthHeaders(headers),
            body,
            credentials: 'include',
            cache: 'no-store',
          });
          const text = await response.text();
          let data = text;
          try { data = JSON.parse(text); } catch {}
          if (response.status >= 200 && response.status < 300) return { status: response.status, data, endpoint: url };
          lastFailure = { status: response.status, data, endpoint: url };
          if (response.status >= 400 && response.status < 500 && !hasJsonBody) continue;
        } catch (error) {
          lastFailure = { status: 0, error: String(error), endpoint: url };
        }
      }
      return lastFailure || { status: 502, error: 'local-assets API no accesible.' };
    }

    /**
     * Lists asset bundle backups stored on server/connector.
     * Retrieves persisted asset definitions from server storage.
     * 
     * @async
     * @returns {Promise<Object[]>} Array of asset bundle objects from server
     * 
     * @example
     * const bundles = await listServerAssetBundleBackups();
     */
    async function listServerAssetBundleBackups() {
      const r = await callLocalAssetsApi('GET', '/asset-bundles');
      if (!(r.status >= 200 && r.status < 300)) return [];
      const rows = Array.isArray(r?.data?.items) ? r.data.items : [];
      return rows.filter(row => row && typeof row === 'object' && row.assetId);
    }

    /**
     * Creates or updates asset bundle backup on server.
     * Persists asset definition to server storage for later retrieval.
     * 
     * @async
     * @param {Object} [partialBundle={}] - Partial bundle data to save
     * @returns {Promise<Object>} Server response with updated bundle info
     * 
     * @example
     * const result = await upsertServerAssetBundleBackup({ assetId, assetBody });
     */
    async function upsertServerAssetBundleBackup(partialBundle = {}) {
      const assetId = String(partialBundle?.assetId || '').trim();
      if (!assetId) return { status: 400 };
      return callLocalAssetsApi('POST', '/asset-bundles', { body: JSON.stringify({ ...partialBundle, assetId }) });
    }

    /**
     * Deletes asset bundle backup from server storage.
     * 
     * @async
     * @param {string} assetId - Asset identifier to delete backup for
     * @returns {Promise<Object>} Server response confirming deletion
     * 
     * @example
     * const result = await deleteServerAssetBundleBackup('asset-123');
     */
    async function deleteServerAssetBundleBackup(assetId) {
      const target = String(assetId || '').trim();
      if (!target) return { status: 400 };
      return callLocalAssetsApi('DELETE', `/asset-bundles/${encodeURIComponent(target)}`);
    }

    /**
     * Saves asset bundle backups to local storage.
     * Maintains up to 300 bundle records for offline editing capability.
     * 
     * @param {Object[]} rows - Array of asset bundle objects to save
     * 
     * @example
     * saveAssetBundleBackups([{assetId: 'asset-1', assetName: 'My Asset', ...}]);
     */
    function saveAssetBundleBackups(rows) {
      try {
        const safeRows = Array.isArray(rows) ? rows.slice(0, 120) : [];
        localStorage.setItem(localAssetBundleStorageKey, JSON.stringify(safeRows));
      } catch {}
    }

    /**
     * Creates or updates an asset bundle backup in local storage.
     * Merges partial bundle data with existing record or creates new entry.
     * 
     * @param {Object} [partialBundle={}] - Partial asset bundle data to merge
     * @param {string} partialBundle.assetId - Asset identifier (required for merge)
     * 
     * @example
     * upsertAssetBundleBackup({
     *   assetId: 'asset-123',
     *   assetName: 'Updated Name',
     *   assetBody: {...}
     * });
     */
    function upsertAssetBundleBackup(partialBundle = {}) {
      const assetId = String(partialBundle?.assetId || '').trim();
      if (!assetId) return;
      const existing = getAssetBundleBackups();
      const idx = existing.findIndex(row => String(row?.assetId || '') === assetId);
      const merged = {
        ...(idx >= 0 ? existing[idx] : {}),
        ...partialBundle,
        assetId,
        updatedAt: new Date().toISOString(),
      };
      if (idx >= 0) existing.splice(idx, 1);
      existing.unshift(merged);
      saveAssetBundleBackups(existing);
      upsertServerAssetBundleBackup(merged).catch(() => {});
    }

    /**
     * Removes an asset bundle backup from local storage by asset ID.
     * 
     * @param {string} assetId - Asset identifier to remove backup for
     * 
     * @example
     * removeAssetBundleBackup('asset-123');
     */
    function removeAssetBundleBackup(assetId) {
      const target = String(assetId || '').trim();
      if (!target) return;
      const next = getAssetBundleBackups().filter(row => String(row?.assetId || '') !== target);
      saveAssetBundleBackups(next);
      deleteServerAssetBundleBackup(target).catch(() => {});
    }

    /**
     * Retrieves stored ArcGIS access token expiration time from local storage.
     * Returns current timestamp if no expiration time was previously saved.
     * 
     * @returns {number} ArcGIS token expiration timestamp in milliseconds
     * 
     * @example
     * const expiresAt = getStoredArcgisTokenExpiresAt();
     */
    function getStoredArcgisTokenExpiresAt() {
      try {
        const raw = sessionStorage.getItem(arcgisTokenExpiresStorageKey) || '';
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) return 0;
        return parsed;
      } catch {
        return 0;
      }
    }

    /**
     * Stores ArcGIS access token expiration time in local storage.
     * 
     * @param {number} expiresAtMs - Token expiration timestamp in milliseconds
     * 
     * @example
     * setStoredArcgisTokenExpiresAt(Date.now() + 3600000); // 1 hour from now
     */
    function setStoredArcgisTokenExpiresAt(expiresAtMs) {
      try {
        const parsed = Number(expiresAtMs || 0);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          sessionStorage.removeItem(arcgisTokenExpiresStorageKey);
          return;
        }
        sessionStorage.setItem(arcgisTokenExpiresStorageKey, String(Math.floor(parsed)));
      } catch {}
    }

    /**
     * Formats milliseconds as human-readable time remaining.
     * Returns negative values with absolute time if already expired.
     * 
     * @param {number} ms - Milliseconds to format
     * @returns {string} Human-readable time string (e.g., '59m 30s', 'expired for 5m 20s')
     * 
     * @example
     * formatRemainingTimeMs(3661000); // Returns: '1h 1m 1s'
     * formatRemainingTimeMs(-300000); // Returns: 'expired for 5m'
     */
    function formatRemainingTimeMs(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }

    /**
     * Refreshes UI indicator showing ArcGIS token expiration status.
     * Updates visual feedback based on remaining time until token expiration.
     * 
     * @example
     * refreshArcgisTokenIndicator(); // Updates UI with current token status
     */
    function refreshArcgisTokenIndicator() {
      const widget = document.getElementById('arcgisTokenWidget');
      const value = document.getElementById('arcgisTokenRemaining');
      if (!widget || !value) return;

      const enabled = Boolean(arcgis?.enabled);
      widget.style.display = enabled ? 'inline-flex' : 'none';
      if (!enabled) return;

      const token = getArcgisAccessTokenForPublish();
      const expiresAt = getStoredArcgisTokenExpiresAt();
      const remainingMs = expiresAt ? (expiresAt - Date.now()) : 0;
      value.classList.remove('warn', 'danger');

      if (!token) {
        value.textContent = 'sin token';
        value.classList.add('danger');
        try { refreshArcgisPublishAssist(); } catch {}
        try { refreshStarTrustPanel(); } catch {}
        return;
      }
      if (!expiresAt) {
        value.textContent = 'token activo';
        try { refreshArcgisPublishAssist(); } catch {}
        try { refreshStarTrustPanel(); } catch {}
        return;
      }
      if (remainingMs <= 0) {
        value.textContent = 'expirado';
        value.classList.add('danger');
        try { refreshArcgisPublishAssist(); } catch {}
        try { refreshStarTrustPanel(); } catch {}
        return;
      }

      value.textContent = formatRemainingTimeMs(remainingMs);
      if (remainingMs < 5 * 60 * 1000) {
        value.classList.add('danger');
      } else if (remainingMs < 30 * 60 * 1000) {
        value.classList.add('warn');
      }
      try { refreshArcgisPublishAssist(); } catch {}
      try { refreshStarTrustPanel(); } catch {}
    }

    /**
     * Ensures an interval timer exists for periodic ArcGIS token indicator updates.
     * Creates timer if not already running to keep token expiration display current.
     * 
     * @example
     * ensureArcgisTokenIndicatorTimer(); // Starts update timer if needed
     */
    function ensureArcgisTokenIndicatorTimer() {
      if (arcgisTokenUiTimer) return;
      arcgisTokenUiTimer = setInterval(() => {
        try { refreshArcgisTokenIndicator(); } catch {}
      }, 1000);
    }

    /**
     * Automatically detects and fixes the API base URL configuration.
     * Attempts to resolve correct API URL through various detection methods,
     * with fallback to manual user input if automatic detection fails.
     * Updates UI with detected configuration and displays status messages.
     * 
     * @returns {Promise<string>} Resolved API base URL
     * 
     * @example
     * const apiUrl = await getAutoFixedApiBaseUrl();
     * console.log('API configured at:', apiUrl);
     */
    function getAutoFixedApiBaseUrl() {
      const current = String(getApiBaseUrl() || '').trim();
      if (!current) return '';
      if (current.includes('/api/management')) return current;
      if (!current.endsWith('/management')) return '';
      if (cfg?.managementApiUrl && String(cfg.managementApiUrl).includes('/api/management')) {
        return String(cfg.managementApiUrl).trim().replace(/\/+$/, '');
      }
      try {
        const url = new URL(current, window.location.origin);
        const prefix = getUiPrefixPath();
        return `${url.origin}${prefix}api/management`;
      } catch {
        return '';
      }
    }

    /**
     * Makes authenticated API calls to EDC Management API.
     * Handles request formatting, authentication headers, and response parsing.
     * Supports optional output logging to console panel for debugging.
     * 
     * @async
     * @param {string} method - HTTP method ('GET', 'POST', 'PUT', 'DELETE')
     * @param {string} path - API endpoint path (e.g., '/v3/assets')
     * @param {string|Object} body - Request body (JSON string or object)
     * @param {Object} [options={}] - Additional options (silent, retries, etc.)
     * @returns {Promise<Object>} API response with status and data properties
     * 
     * @example
     * const result = await callApi('POST', '/v3/assets', assetJson);
     */
    async function callApi(method, path, body, options = {}) {
      const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : Number(settings.apiRetries || 0);
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : Number(settings.apiTimeoutMs || 15000);
      const silent = Boolean(options.silent);
      const normalizedMethod = String(method || 'GET').toUpperCase();
      const allowRetry = options.retryUnsafe === true || normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'DELETE';
      const effectiveRetries = allowRetry ? retries : 0;
      let attempt = 0;
      let lastError = null;

      while (attempt <= effectiveRetries) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          let primaryBase = String(getApiBaseUrl() || '').trim();
          // Hard fix for common wrong base persisted in settings: .../management -> .../<prefix>/api/management
          if (/\/management\/?$/i.test(primaryBase) && !/\/api\/management\/?$/i.test(primaryBase)) {
            const forcedBase = getAutoFixedApiBaseUrl();
            if (forcedBase) primaryBase = forcedBase;
          }
          const primaryUrl = `${primaryBase}${path}`;
          let res = await fetch(primaryUrl, {
            method,
            headers: {
              'x-api-key': getApiKey(),
              'content-type': 'application/json',
              ...(options.headers || {}),
            },
            body: method === 'GET' || method === 'DELETE' ? undefined : body,
            signal: controller.signal,
          });
          let text = await res.text();

          // Some deployments return 502 on one connector-prefix variant; try alternates for catalog calls.
          if (res.status === 502 && isCatalogRequestPath(path) && !options.noAutoBaseFallback) {
            const candidates = [];
            const fixed = getAutoFixedApiBaseUrl();
            if (fixed) candidates.push(fixed);
            if (primaryBase.includes('/conectorFuenlabrada/')) candidates.push(primaryBase.replace('/conectorFuenlabrada/', '/conectorfuenlabrada/'));
            if (primaryBase.includes('/conectorfuenlabrada/')) candidates.push(primaryBase.replace('/conectorfuenlabrada/', '/conectorFuenlabrada/'));
            const uiPrefix = getUiPrefixPath().replace(/\/+$/, '');
            if (uiPrefix) candidates.push(`${window.location.origin}${uiPrefix}/api/management`);

            for (const candidateBase of [...new Set(candidates)].filter(x => x && x !== primaryBase)) {
              try {
                const fallbackUrl = `${candidateBase}${path}`;
                const fallbackRes = await fetch(fallbackUrl, {
                  method,
                  headers: {
                    'x-api-key': getApiKey(),
                    'content-type': 'application/json',
                    ...(options.headers || {}),
                  },
                  body: method === 'GET' || method === 'DELETE' ? undefined : body,
                  signal: controller.signal,
                });
                const fallbackText = await fallbackRes.text();
                if (fallbackRes.status >= 200 && fallbackRes.status < 300) {
                  res = fallbackRes;
                  text = fallbackText;
                  break;
                }
              } catch {}
            }
          }

          if ((res.status === 404 || res.status === 405) && !options.noAutoBaseFallback) {
            const fallbackBase = getAutoFixedApiBaseUrl();
            if (fallbackBase && fallbackBase !== primaryBase) {
              const fallbackUrl = `${fallbackBase}${path}`;
              const fallbackRes = await fetch(fallbackUrl, {
                method,
                headers: {
                  'x-api-key': getApiKey(),
                  'content-type': 'application/json',
                  ...(options.headers || {}),
                },
                body: method === 'GET' || method === 'DELETE' ? undefined : body,
                signal: controller.signal,
              });
              const fallbackText = await fallbackRes.text();
              if (fallbackRes.status >= 200 && fallbackRes.status < 300) {
                res = fallbackRes;
                text = fallbackText;
              }
            }
          }

          let data = text;
          try { data = JSON.parse(text); } catch {}
          const result = { status: res.status, data, attempt };
          if (res.status >= 500 && attempt < effectiveRetries) {
            clearTimeout(timeout);
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            continue;
          }
          clearTimeout(timeout);
          return result;
        } catch (e) {
          clearTimeout(timeout);
          lastError = e;
          if (attempt < effectiveRetries) {
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            continue;
          }
        }
      }

      const err = {
        status: 0,
        error: String(lastError || 'Error HTTP desconocido'),
        method,
        path,
        hint: 'Revisa managementApiUrl/config.js y proxy reverse para evitar CORS/preflight fallidos.'
      };
      if (!silent) writeOut(err);
      return err;
    }

    /**
     * Updates UI status indicator for vault secrets configuration.
     * Displays current state of secrets availability (configured/missing).
     * Updates visual feedback and info messages in the console.
     * 
     * @param {string} kind - Type of secret ('client-id', 'client-secret', etc.)
     * @param {string} message - Status message to display
     * 
     * @example
     * updateSecretsStatus('oauth2', 'Client credentials configured');
     */
    function updateSecretsStatus(kind, message) {
      const el = document.getElementById('secretsStatus');
      if (!el) return;
      el.className = `status-pill ${kind}`;
      el.textContent = message;
    }

    /**
     * Discovers available secrets from vault API.
     * Queries vault service to list available secret keys for authentication.
     * Optionally logs results to console for debugging.
     * 
     * @async
     * @param {boolean} [showOutput=false] - Whether to log results to console
     * @returns {Promise<string[]>} Array of available secret names/keys
     * 
     * @example
     * const secrets = await discoverSecretsApi(true); // Show results in console
     */
    async function discoverSecretsApi(showOutput = false) {
      const candidates = [
        { method: 'POST', path: '/v3/secrets/request', body: q(), parser: (r) => unwrap(r).map(s => s['@id'] || s.id).filter(Boolean) },
        { method: 'POST', path: '/v3/secret/request', body: q(), parser: (r) => unwrap(r).map(s => s['@id'] || s.id).filter(Boolean) },
        { method: 'GET', path: '/v3/secrets', body: undefined, parser: (r) => {
          const raw = Array.isArray(r?.data) ? r.data : (Array.isArray(r?.data?.content) ? r.data.content : []);
          return raw.map(s => s?.['@id'] || s?.id || s?.key || s?.name).filter(Boolean);
        } },
      ];

      for (const c of candidates) {
        const resp = await callApi(c.method, c.path, c.body, { silent: true, retries: 0 });
        if (resp.status >= 200 && resp.status < 300) {
          state.secretsApi = c;
          state.secretsAvailable = true;
          state.secretNames = c.parser(resp);
          refreshSecretSelect();
          updateSecretsStatus('ok', `Secrets API activa: ${c.method} ${c.path}`);
          const outSecrets = document.getElementById('secretsOut');
          if (outSecrets) outSecrets.textContent = JSON.stringify(resp.data, null, 2);
          if (showOutput) writeOut({ secretsApi: `${c.method} ${c.path}`, probe: resp });
          return resp;
        }
      }

      state.secretsApi = null;
      state.secretsAvailable = false;
      updateSecretsStatus('danger', 'Secrets API no disponible en este runtime');
      const failure = { status: 404, error: 'No se detecto endpoint de secretos compatible.' };
      if (showOutput) writeOut(failure);
      return failure;
    }

