function summarizePolicyTerms(policyObj) {
      const permsRaw = policyObj?.['odrl:permission'] || policyObj?.permission || [];
      const perms = Array.isArray(permsRaw) ? permsRaw : [permsRaw];
      const constraints = perms.flatMap(p => {
        const c = p?.constraint || p?.['odrl:constraint'] || [];
        return Array.isArray(c) ? c : [c];
      }).filter(Boolean);
      if (!constraints.length) return 'Sin restricciones explícitas';
      return constraints.map(c => `${c.leftOperand || c['odrl:leftOperand'] || 'condición'} ${c.operator || c['odrl:operator'] || 'eq'} ${c.rightOperand || c['odrl:rightOperand'] || '-'}`).join(' | ');
    }

    function parseKeywordList(raw) {
      if (Array.isArray(raw)) return raw.map(v => String(v || '').trim()).filter(Boolean);
      if (!raw) return [];
      return String(raw)
        .split(/[;,\n]/g)
        .map(v => v.trim())
        .filter(Boolean);
    }

    function firstNonEmpty(values = []) {
      for (const value of values) {
        if (value === undefined || value === null) continue;
        const txt = String(value).trim();
        if (txt) return txt;
      }
      return '';
    }

    function safeText(value, fallback = '') {
      const txt = value === undefined || value === null ? '' : String(value).trim();
      return txt || fallback;
    }

    function htmlEscape(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function resolveAssetImageUrl(rawImageUrl) {
      const candidate = String(rawImageUrl || '').trim();
      if (candidate) return candidate;
      return 'assets/eitel-logo-brand.png';
    }

    function isDefaultAssetImage(imageUrl) {
      const txt = String(imageUrl || '').trim().toLowerCase();
      return txt.endsWith('/assets/eitel-logo-brand.png') || txt === 'assets/eitel-logo-brand.png';
    }

    function prettyConnectorLabel(rawConnector) {
      const txt = String(rawConnector || '').trim();
      if (!txt) return 'CONNECTOR';
      const lower = txt.toLowerCase();
      if (lower.includes('uc3m')) return 'UC3M';
      if (lower.includes('fuenlabrada')) return 'FUENLABRADA';
      return txt.replace(/^conector/i, '').trim().toUpperCase() || 'CONNECTOR';
    }

    function extractDatasetMetadata(dataset) {
      const d = dataset || {};
      const props = d?.properties || d?.['dct:properties'] || d?.['edc:properties'] || {};

      const title = firstNonEmpty([
        d?.['dct:title'],
        d?.title,
        d?.name,
        props?.['dct:title'],
        props?.title,
        props?.name,
      ]);
      const description = firstNonEmpty([
        d?.['dct:description'],
        d?.description,
        props?.['dct:description'],
        props?.description,
        props?.['eitel:description'],
      ]);
      const imageUrl = firstNonEmpty([
        d?.['schema:image'],
        d?.image,
        props?.['schema:image'],
        props?.['eitel:image'],
        props?.image,
      ]);

      const keywords = [
        ...parseKeywordList(d?.['dcat:keyword']),
        ...parseKeywordList(d?.keyword),
        ...parseKeywordList(props?.['dcat:keyword']),
        ...parseKeywordList(props?.['eitel:keywords']),
        ...parseKeywordList(props?.keywords),
      ];

      return {
        title,
        description,
        imageUrl,
        keywords: [...new Set(keywords)],
      };
    }

    function buildPolicyDcatJsonLd(row) {
      const payload = {
        '@context': {
          dcat: 'https://www.w3.org/ns/dcat#',
          dct: 'http://purl.org/dc/terms/',
          odrl: 'http://www.w3.org/ns/odrl/2/',
          eitel: 'https://w3id.org/eitel/ns/'
        },
        '@type': 'dcat:Dataset',
        '@id': row?.assetId || '',
        'dct:title': row?.assetTitle || clean(row?.assetId || ''),
        'dct:description': row?.assetDescription || '',
        'dcat:keyword': Array.isArray(row?.assetKeywords) ? row.assetKeywords : [],
        'eitel:connectorId': row?.connectorId || '',
        'eitel:connectorAddress': row?.counterPartyAddress || '',
        'odrl:hasPolicy': row?.policyRaw || {},
      };
      return JSON.stringify(payload, null, 2);
    }

    function parseConnectorCandidates() {
      const listRaw = document.getElementById('catalogConnectorsList')?.value || '';
      const values = listRaw
        .split(/[\n,;]+/g)
        .map(v => String(v || '').trim())
        .filter(Boolean)
        .map(v => {
          if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')) return v;
          return canonicalConnectorPrefix(v) || v;
        });
      const single = String(document.getElementById('searchConnectorId')?.value || '').trim();
      if (single) values.unshift(canonicalConnectorPrefix(single) || single);
      if (!values.length) values.push('conectoruc3m', 'conectorFuenlabrada');
      return [...new Set(values)];
    }

    function getPublicConnectorOrigin() {
      try {
        const cfgDsp = String(cfg?.dspUrl || '').trim();
        if (cfgDsp.startsWith('http://') || cfgDsp.startsWith('https://')) {
          return new URL(cfgDsp).origin;
        }
      } catch {}
      return window.location.origin;
    }

    let transferStartInFlight = false;
    const _remoteLocalDownloadInFlightByContract = new Set();
    const localTransferStorageKey = `eitel.ui.localTransfers.${connectorName}`;
    const hiddenTransferStorageKey = `eitel.ui.hiddenTransfers.${connectorName}`;
    const localAssetBundleStorageKey = `eitel.ui.assetBundles.${connectorName}`;
    const arcgisTokenExpiresStorageKey = 'eitel.arcgis.access_token_expires';
    const agreementSourceHints = new Map();
    let arcgisTokenUiTimer = null;

    function normalizeTransferState(raw) {
      if (raw === undefined || raw === null) return '-';
      const txt = String(raw).trim();
      const numericMap = {
        '100': 'INITIAL',
        '200': 'PROVISIONING',
        '300': 'PROVISIONED',
        '400': 'REQUESTED',
        '500': 'STARTED',
        '600': 'SUSPENDED',
        '700': 'COMPLETED',
        '800': 'TERMINATED',
      };
      return numericMap[txt] || txt;
    }

    function isTransferTerminalState(state) {
      const normalized = normalizeTransferState(state);
      return normalized === 'COMPLETED' || normalized === 'TERMINATED' || normalized === 'FAILED';
    }

    function getLocalTransferRecords() {
      try {
        const raw = localStorage.getItem(localTransferStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function saveLocalTransferRecords(records) {
      try {
        localStorage.setItem(localTransferStorageKey, JSON.stringify(records.slice(0, 200)));
      } catch {}
    }

    function addLocalTransferRecord(record) {
      const current = getLocalTransferRecords();
      current.unshift(record);
      saveLocalTransferRecords(current);
      return record;
    }

    function getHiddenTransferIds() {
      try {
        const raw = localStorage.getItem(hiddenTransferStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }

    function saveHiddenTransferIds(ids) {
      try {
        const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean))).slice(-500);
        localStorage.setItem(hiddenTransferStorageKey, JSON.stringify(unique));
      } catch {}
    }

    function removeLocalTransferRecordById(transferId) {
      const current = getLocalTransferRecords();
      const next = current.filter(t => (t['@id'] || t.id || '') !== transferId);
      saveLocalTransferRecords(next);
      return next.length !== current.length;
    }

    function hideTransferRecordById(transferId) {
      const hidden = getHiddenTransferIds();
      if (!hidden.includes(transferId)) hidden.push(transferId);
      saveHiddenTransferIds(hidden);
    }

    function buildLocalTransferRecord(result) {
      const status = Number(result?.status || 0);
      const localTransferId = `local-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const completed = status >= 200 && status < 300;
      return {
        '@id': localTransferId,
        id: localTransferId,
        state: completed ? 'COMPLETED' : 'FAILED',
        contractId: result?.contractId || '',
        assetId: result?.assetId || '',
        createdAt: new Date().toISOString(),
        transferType: 'LOCAL-DOWNLOAD',
        destinationType: 'browser-download',
        filename: result?.filename || '',
        bytes: Number(result?.bytes || 0),
        sourceUrl: result?.sourceUrl || '',
        contentType: result?.contentType || '',
        errorDetail: result?.error || result?.detail || '',
        detail: result,
        localDownload: true,
      };
    }

    function normalizeTransferRow(row) {
      const id = row['@id'] || row.id || '';
      const createdAt = row.createdAt || row['edc:createdAt'] || row.startedAt || row['edc:startedAt'] || '';
      return {
        ...row,
        '@id': id,
        id,
        state: row.state || row['edc:state'] || '-',
        contractId: row.contractId || row['edc:contractId'] || '',
        createdAt,
        localDownload: Boolean(row.localDownload),
      };
    }

    function getAllTransferRows(remoteRows = []) {
      const localRows = getLocalTransferRecords().map(normalizeTransferRow);
      const normalizedRemote = (Array.isArray(remoteRows) ? remoteRows : []).map(normalizeTransferRow);
      const hidden = new Set(getHiddenTransferIds());
      return [...localRows, ...normalizedRemote]
      .filter(r => !hidden.has(r['@id'] || r.id || ''))
      .sort((a, b) => {
        const aTime = Date.parse(a.createdAt || 0) || 0;
        const bTime = Date.parse(b.createdAt || 0) || 0;
        return bTime - aTime;
      });
    }

    function getUiPrefixPath() {
      const parts = (window.location.pathname || '/').split('/').filter(Boolean);
      if (!parts.length) return '/';
      return `/${parts[0]}/`;
    }

    function getLocalAssetsApiBaseUrl() {
      const prefix = getUiPrefixPath().replace(/\/+$/, '');
      return `${window.location.origin}${prefix}/local-assets`;
    }

    function getAssetBundleBackups() {
      try {
        const raw = localStorage.getItem(localAssetBundleStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function saveAssetBundleBackups(rows) {
      try {
        const safeRows = Array.isArray(rows) ? rows.slice(0, 120) : [];
        localStorage.setItem(localAssetBundleStorageKey, JSON.stringify(safeRows));
      } catch {}
    }

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
    }

    function removeAssetBundleBackup(assetId) {
      const target = String(assetId || '').trim();
      if (!target) return;
      const next = getAssetBundleBackups().filter(row => String(row?.assetId || '') !== target);
      saveAssetBundleBackups(next);
    }

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

    function formatRemainingTimeMs(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }

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
        return;
      }
      if (!expiresAt) {
        value.textContent = 'token activo';
        return;
      }
      if (remainingMs <= 0) {
        value.textContent = 'expirado';
        value.classList.add('danger');
        return;
      }

      value.textContent = formatRemainingTimeMs(remainingMs);
      if (remainingMs < 5 * 60 * 1000) {
        value.classList.add('danger');
      } else if (remainingMs < 30 * 60 * 1000) {
        value.classList.add('warn');
      }
    }

    function ensureArcgisTokenIndicatorTimer() {
      if (arcgisTokenUiTimer) return;
      arcgisTokenUiTimer = setInterval(() => {
        try { refreshArcgisTokenIndicator(); } catch {}
      }, 1000);
    }

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
          clearTimeout(timeout);
          let text = await res.text();

          // Some deployments return 502 on one connector-prefix variant; try alternates for catalog calls.
          if (res.status === 502 && path === '/v3/catalog/request' && !options.noAutoBaseFallback) {
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
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            continue;
          }
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

    function updateSecretsStatus(kind, message) {
      const el = document.getElementById('secretsStatus');
      if (!el) return;
      el.className = `status-pill ${kind}`;
      el.textContent = message;
    }

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

    function applyI18n() {
      document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
      document.getElementById('brandTitle').textContent = settings.language === 'en' ? 'EITEL Connector' : 'Conector EITEL';
      document.getElementById('brandSub').textContent = settings.language === 'en' ? 'Operations console' : 'Consola de operación';
      document.getElementById('consoleTitle').textContent = settings.language === 'en' ? 'Console' : 'Consola';
    }

    function updateConsoleButtons(hidden = app.classList.contains('console-hidden')) {
      const toggle = document.getElementById('btnConsoleToggle');
      const expand = document.getElementById('btnConsoleExpand');
      const show = document.getElementById('btnConsoleShow');
      toggle.textContent = settings.consolePos === 'bottom' ? '⮟' : '⮞';
      expand.textContent = settings.consoleExpanded ? '⤡' : '⤢';
      show.textContent = settings.consolePos === 'bottom' ? '⮝ Consola' : '⮜ Consola';
      show.style.display = hidden ? 'inline-flex' : 'none';
    }

    function showInfoPopup(title, payload, options = {}) {
      document.getElementById('infoTitle').textContent = title || 'Detalle';
      if (options && options.plainText) {
        document.getElementById('infoBody').textContent = typeof payload === 'string' ? payload : String(payload ?? '');
      } else {
        document.getElementById('infoBody').textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      }
      const actionBtn = document.getElementById('btnInfoAction');
      if (options && options.actionLabel && typeof options.onAction === 'function') {
        infoActionHandler = options.onAction;
        actionBtn.textContent = options.actionLabel;
        actionBtn.style.display = 'inline-flex';
      } else {
        infoActionHandler = null;
        actionBtn.style.display = 'none';
      }
      infoModal.classList.add('open');
    }
    function closeInfoPopup() {
      infoModal.classList.remove('open');
      infoActionHandler = null;
      const actionBtn = document.getElementById('btnInfoAction');
      actionBtn.style.display = 'none';
    }

    function applySettings() {
      document.body.dataset.theme = settings.theme;
      app.classList.toggle('console-bottom', settings.consolePos === 'bottom');
      app.classList.toggle('console-expanded', settings.consoleExpanded);
      out.style.fontSize = `${settings.consoleFont}px`;

      document.getElementById('consoleState').textContent = `${settings.consolePos}${settings.consoleExpanded ? ' + expanded' : ''}`;
      document.getElementById('setLanguage').value = settings.language;
      document.getElementById('setTheme').value = settings.theme;
      document.getElementById('setConsolePos').value = settings.consolePos;
      document.getElementById('setConsoleFont').value = String(settings.consoleFont);
      if (document.getElementById('setApiBaseUrl')) document.getElementById('setApiBaseUrl').value = settings.apiBaseUrl;
      if (document.getElementById('setApiKey')) document.getElementById('setApiKey').value = settings.apiKeyOverride;
      if (document.getElementById('setApiTimeout')) document.getElementById('setApiTimeout').value = String(settings.apiTimeoutMs);
      if (document.getElementById('setApiRetries')) document.getElementById('setApiRetries').value = String(settings.apiRetries);
      if (document.getElementById('setDummyUrl')) document.getElementById('setDummyUrl').value = settings.dummyUrl || '';
      applyI18n();
      updateConsoleButtons();
      persistSettings();
    }

    function activateView(view) {
      const resolved = view;
      document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelector(`.nav button[data-view="${view}"]`)?.classList.add('active');
      document.getElementById(`panel-${resolved}`)?.classList.add('active');
        if (resolved === 'catalog') {
          if (state.catalogShowcaseLoaded && Array.isArray(state.catalogRows) && state.catalogRows.length) {
            renderCatalogShowcase(state.catalogRows || []);
          } else {
            loadCatalogShowcase(false);
          }
        }
      if (resolved === 'asset') {
        loadPublishedAssets(false);
      }
      if (resolved === 'secrets') {
        discoverSecretsApi(false).then((r) => {
          if (!(r.status >= 200 && r.status < 300)) {
            showInfoPopup('Secretos no disponibles', {
              message: 'Este runtime no expone un endpoint de secretos compatible en management API. El resto del flujo sigue operativo.',
              attempts: ['/v3/secrets/request', '/v3/secret/request', '/v3/secrets']
            });
          }
        });
      }
    }

    function updateAssetPreview() {
      const key = slug(document.getElementById('assetKey').value || '');
      document.getElementById('assetIdPreview').value = `asset-${key}`;
      const p = document.getElementById('policyIdPreview');
      const c = document.getElementById('contractDefIdPreview');
      if (p) p.value = `policy-${key}`;
      if (c) c.value = `contractdef-${key}`;
      const assetId = document.getElementById('assetIdPreview').value;
      const policyId = document.getElementById('policyIdPreview').value;
      const contractDefId = document.getElementById('contractDefIdPreview').value;
      const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
      setVal('policyAssetPreview', assetId);
      setVal('policyIdMirror', policyId);
      setVal('contractDefIdMirror', contractDefId);
      setVal('contractAssetPreview', assetId);
      setVal('contractAccessPolicyId', policyId);
      setVal('contractContractPolicyId', policyId);
    }

    function applyPolicyMode() {
      const mode = document.getElementById('policyMode')?.value || 'form';
      const form = document.getElementById('policyFormBlock');
      const json = document.getElementById('policyJsonBlock');
      if (!form || !json) return;
      form.style.display = mode === 'jsonld' ? 'none' : 'block';
      json.style.display = mode === 'jsonld' ? 'block' : 'none';
    }

    function refreshCatalogAssetOptions() {
      const sel = document.getElementById('catalogAssetId');
      const terms = document.getElementById('catalogPolicyTerms');
      const policyJsonLd = document.getElementById('catalogPolicyJsonLd');
      const accept = document.getElementById('catalogAcceptTerms');
      if (!sel) return;

      sel.innerHTML = '<option value="">Selecciona un data-offer</option>';
      state.catalogRows.forEach((r, idx) => {
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = `${safeText(r.assetTitle, clean(r.assetId))} · ${safeText(r.connectorId, r.assigner || '-')}`;
        sel.appendChild(o);
      });

      if (terms) terms.value = '';
      if (policyJsonLd) policyJsonLd.value = '';
      if (accept) accept.checked = false;
    }

    function renderCatalogShowcase(rows = []) {
      const wrap = document.getElementById('catalogShowcase');
      if (!wrap) return;
      const query = String(document.getElementById('catalogSearchText')?.value || '').trim().toLowerCase();
      const connectorFilter = String(document.getElementById('catalogFilterConnector')?.value || '').trim().toLowerCase();

      const indexed = state.catalogRows.map((row, idx) => ({ row, idx }));
      const filtered = indexed.filter(({ row }) => {
        if (connectorFilter) {
          const connectorText = String(row.connectorId || row.assigner || '').toLowerCase();
          if (!connectorText.includes(connectorFilter)) return false;
        }
        if (!query) return true;
        const haystack = [
          row.assetTitle,
          row.assetDescription,
          row.assetId,
          row.offerId,
          row.connectorId,
          ...(Array.isArray(row.assetKeywords) ? row.assetKeywords : []),
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });

      if (!rows.length || !filtered.length) {
        wrap.innerHTML = '<div class="card" style="box-shadow:none"><p class="muted" style="margin:0">No hay assets para mostrar con el filtro actual.</p></div>';
        const contractBox = document.getElementById('catalogContractBox');
        if (contractBox) contractBox.style.display = 'none';
        return;
      }

      wrap.innerHTML = filtered.map(({ row, idx }) => {
        const title = htmlEscape(safeText(row.assetTitle, clean(row.assetId)));
        const connector = htmlEscape(safeText(row.connectorId, row.assigner || '-'));
        const connectorBadge = htmlEscape(prettyConnectorLabel(safeText(row.connectorId, row.assigner || '-')));
        const desc = htmlEscape(safeText(row.assetDescription, 'Sin descripción publicada.'));
        const image = resolveAssetImageUrl(row.assetImageUrl);
        const defaultImageClass = isDefaultAssetImage(image) ? ' is-default' : '';
        const keywords = Array.isArray(row.assetKeywords) ? row.assetKeywords.slice(0, 8) : [];
        const delayMs = Math.min(idx * 55, 550);
        const canContract = Boolean(row.offerId);
        const media = `<div class="asset-card-media${defaultImageClass}"><img src="${htmlEscape(image)}" alt="Imagen del asset ${title}" /><span class="asset-card-badge">${connectorBadge}</span><div class="asset-card-media-overlay"><span class="asset-card-media-title">${title}</span></div></div>`;
        const chips = keywords.length
          ? `<div class="asset-card-keywords">${keywords.map(k => `<span class="asset-chip">${htmlEscape(k)}</span>`).join('')}</div>`
          : '<div class="asset-card-meta">Sin keywords</div>';

        return `
          <article class="asset-card" style="--delay:${delayMs}ms">
            ${media}
            <div class="asset-card-body">
              <div class="asset-card-title">${title}</div>
              <div class="asset-card-meta">${connector}</div>
              <details>
                <summary>Detalles</summary>
                <div class="asset-card-desc">${desc}</div>
                ${chips}
              </details>
              <div class="row">
                <button class="primary" onclick="window.useCatalogAssetByIndex(${idx})" ${canContract ? '' : 'disabled'}>${canContract ? 'Iniciar contratacion' : 'Solo visualizacion local'}</button>
              </div>
            </div>
          </article>
        `;
      }).join('');
    }

    function syncCatalogSelectionState() {
      const sel = document.getElementById('catalogAssetId');
      const terms = document.getElementById('catalogPolicyTerms');
      const policyJsonLd = document.getElementById('catalogPolicyJsonLd');
      const accept = document.getElementById('catalogAcceptTerms');
      if (!sel || !accept) return;

      const idx = Number(sel.value);
      const selected = Number.isInteger(idx) && idx >= 0 ? state.catalogRows[idx] : null;
      if (terms) terms.value = selected?.policySummary || '';
      if (policyJsonLd) policyJsonLd.value = selected ? buildPolicyDcatJsonLd(selected) : '';

      const contractBox = document.getElementById('catalogContractBox');
      if (contractBox) contractBox.style.display = selected ? 'block' : 'none';

      const selectedConnector = document.getElementById('catalogSelectedConnector');
      if (selectedConnector) selectedConnector.value = selected?.connectorId || '';
      const selectedDsp = document.getElementById('catalogSelectedDsp');
      if (selectedDsp) selectedDsp.value = selected?.counterPartyAddress || '';
      if (selected?.counterPartyAddress) {
        const resolved = document.getElementById('resolvedAddress');
        const transferAddress = document.getElementById('transferAddress');
        const connectorInput = document.getElementById('searchConnectorId');
        if (resolved) resolved.value = selected.counterPartyAddress;
        if (transferAddress) transferAddress.value = selected.counterPartyAddress;
        if (connectorInput && selected.connectorId) connectorInput.value = selected.connectorId;
      }

      // Explicit flow: contract is only requested when user clicks "Realizar contrato".
    }

    function mapPublishedAssetRows(rawAssets = []) {
      return (Array.isArray(rawAssets) ? rawAssets : []).map((a) => {
        const props = a?.properties || a?.['edc:properties'] || {};
        const id = a?.['@id'] || a?.id || '';
        const title = firstNonEmpty([
          props?.name,
          props?.['dct:title'],
          props?.title,
          id,
        ]);
        const description = firstNonEmpty([
          props?.['dct:description'],
          props?.['eitel:description'],
          props?.description,
        ]);
        const imageUrl = firstNonEmpty([
          props?.['schema:image'],
          props?.['eitel:image'],
          props?.image,
        ]);
        const keywords = [
          ...parseKeywordList(props?.['dcat:keyword']),
          ...parseKeywordList(props?.['eitel:keywords']),
          ...parseKeywordList(props?.keywords),
        ];
        return {
          id,
          title,
          description,
          imageUrl,
          keywords: [...new Set(keywords)],
        };
      });
    }

    function mapPublishedAssetsToCatalogVisualRows(rawAssets = []) {
      return mapPublishedAssetRows(rawAssets).map((row) => ({
        offerId: '',
        assetId: row.id || '',
        policyTarget: row.id || '',
        assigner: PROD_CONNECTOR_ID,
        connectorId: PROD_CONNECTOR_ID,
        counterPartyAddress: '',
        policySummary: 'Visualización local. Este asset no tiene una oferta remota de catálogo activa.',
        policyRaw: null,
        sourceHintUrl: '',
        assetTitle: row.title,
        assetDescription: row.description,
        assetKeywords: row.keywords,
        assetImageUrl: row.imageUrl,
      }));
    }

    function renderPublishedAssets(rows = []) {
      const wrap = document.getElementById('publishedAssetsGrid');
      if (!wrap) return;
      if (!rows.length) {
        wrap.innerHTML = '<div class="card" style="box-shadow:none"><p class="muted" style="margin:0">No hay assets publicados todavía en este conector.</p></div>';
        return;
      }

      wrap.innerHTML = rows.map((row, idx) => {
        const title = htmlEscape(safeText(row.title, clean(row.id)));
        const desc = htmlEscape(safeText(row.description, 'Sin descripción.'));
        const id = htmlEscape(row.id || '');
        const image = resolveAssetImageUrl(row.imageUrl);
        const defaultImageClass = isDefaultAssetImage(image) ? ' is-default' : '';
        const delayMs = Math.min(idx * 40, 480);
        const media = `<div class="asset-card-media${defaultImageClass}"><img src="${htmlEscape(image)}" alt="Imagen del asset ${title}" /><span class="asset-card-badge">MI ASSET</span><div class="asset-card-media-overlay"><span class="asset-card-media-title">${title}</span></div></div>`;
        const chips = row.keywords.length
          ? `<div class="asset-card-keywords">${row.keywords.slice(0, 8).map(k => `<span class="asset-chip">${htmlEscape(k)}</span>`).join('')}</div>`
          : '<div class="asset-card-meta">Sin keywords</div>';

        return `
          <article class="asset-card" style="--delay:${delayMs}ms">
            ${media}
            <div class="asset-card-body">
              <div class="asset-card-title">${title}</div>
              <div class="asset-card-meta">${id}</div>
              <details>
                <summary>Detalles</summary>
                <div class="asset-card-desc">${desc}</div>
                ${chips}
              </details>
            </div>
          </article>
        `;
      }).join('');
    }

    async function loadPublishedAssets(showOutput = false) {
      const r = await callApi('POST', '/v3/assets/request', q());
      const rows = mapPublishedAssetRows(unwrap(r));
      renderPublishedAssets(rows);
      if (showOutput) writeOut({ ...r, totalPublishedAssets: rows.length });
      return r;
    }

    async function refreshOverview() {
      const [a, p, ags, tps] = await Promise.all([
        callApi('POST', '/v3/assets/request', q()),
        callApi('POST', '/v3/policydefinitions/request', q()),
        callApi('POST', '/v3/contractagreements/request', q()),
        callApi('POST', '/v3/transferprocesses/request', q()),
      ]);
      const assets = unwrap(a);
      const policies = unwrap(p);
      const agreements = unwrap(ags);
      const transfers = getAllTransferRows(unwrap(tps));

      document.getElementById('kpiAssets').textContent = assets.length;
      document.getElementById('kpiPolicies').textContent = policies.length;
      document.getElementById('kpiContracts').textContent = agreements.length;
      document.getElementById('kpiTransfers').textContent = transfers.length;

      const assetsBody = document.getElementById('dashAssetsBody');
      const policiesBody = document.getElementById('dashPoliciesBody');
      const contractsBody = document.getElementById('dashContractsBody');
      const transfersBody = document.getElementById('dashTransfersBody');

      if (assetsBody) {
        if (!assets.length) {
          assetsBody.innerHTML = '<tr><td colspan="3" class="muted">No hay assets publicados.</td></tr>';
        } else {
          assetsBody.innerHTML = assets.slice(0, 10).map((asset) => {
            const id = asset?.['@id'] || asset?.id || '';
            const props = asset?.properties || asset?.['edc:properties'] || {};
            const name = props?.name || props?.title || clean(id);
            const type = props?.contenttype || asset?.dataAddress?.type || '-';
            return `<tr><td class="title-cell" title="${htmlEscape(name)}">${htmlEscape(name)}</td><td title="${htmlEscape(id)}">${htmlEscape(clean(id))}</td><td>${htmlEscape(String(type || '-'))}</td></tr>`;
          }).join('');
        }
      }

      if (policiesBody) {
        if (!policies.length) {
          policiesBody.innerHTML = '<tr><td colspan="3" class="muted">No hay policies activas.</td></tr>';
        } else {
          policiesBody.innerHTML = policies.slice(0, 10).map((policyDef) => {
            const pid = policyDef?.['@id'] || policyDef?.id || '';
            const policy = policyDef?.policy || {};
            const permsRaw = policy?.permission || policy?.['odrl:permission'] || [];
            const perms = Array.isArray(permsRaw) ? permsRaw : [permsRaw];
            const assetId = perms.find(p => p?.target || p?.['odrl:target'])?.target || perms.find(p => p?.target || p?.['odrl:target'])?.['odrl:target'] || '-';
            const constraints = perms.flatMap(p => {
              const c = p?.constraint || p?.['odrl:constraint'] || [];
              return Array.isArray(c) ? c : [c];
            }).filter(Boolean);
            const expiration = constraints.find(c => {
              const left = String(c?.leftOperand || c?.['odrl:leftOperand'] || '').toLowerCase();
              return left.includes('datetime') || left.includes('validuntil') || left.includes('expiration');
            })?.rightOperand || policy?.['dct:validUntil'] || '-';
            return `<tr><td class="title-cell" title="${htmlEscape(pid)}">${htmlEscape(clean(pid))}</td><td title="${htmlEscape(assetId)}">${htmlEscape(clean(assetId))}</td><td>${htmlEscape(expiration === '-' ? '-' : fmtDate(expiration))}</td></tr>`;
          }).join('');
        }
      }

      if (contractsBody) {
        if (!agreements.length) {
          contractsBody.innerHTML = '<tr><td colspan="3" class="muted">No hay contratos vigentes.</td></tr>';
        } else {
          contractsBody.innerHTML = agreements.slice(0, 10).map((agreement) => {
            const id = agreement?.['@id'] || agreement?.id || '';
            const assetId = agreement?.assetId || agreement?.['edc:assetId'] || '-';
            const publishedAt = agreement?.contractSigningDate || agreement?.['edc:contractSigningDate'] || agreement?.createdAt || agreement?.['edc:createdAt'] || '';
            return `<tr><td class="title-cell" title="${htmlEscape(id)}">${htmlEscape(clean(id))}</td><td title="${htmlEscape(assetId)}">${htmlEscape(clean(assetId))}</td><td>${htmlEscape(fmtDate(publishedAt))}</td></tr>`;
          }).join('');
        }
      }

      if (transfersBody) {
        if (!transfers.length) {
          transfersBody.innerHTML = '<tr><td colspan="3" class="muted">No hay transferencias.</td></tr>';
        } else {
          transfersBody.innerHTML = transfers.slice(0, 10).map((transfer) => {
            const id = transfer?.['@id'] || transfer?.id || '';
            const state = normalizeTransferState(transfer?.state || transfer?.['edc:state'] || '-');
            const contract = transfer?.contractId || transfer?.['edc:contractId'] || '-';
            return `<tr><td class="title-cell" title="${htmlEscape(id)}">${htmlEscape(clean(id))}</td><td>${htmlEscape(state)}</td><td title="${htmlEscape(contract)}">${htmlEscape(clean(contract))}</td></tr>`;
          }).join('');
        }
      }
    }

    let lastArcgisPublishToken = '';

    function getArcgisAccessTokenForPublish() {
      try {
        if (typeof getStoredArcgisToken === 'function') {
          const token = (getStoredArcgisToken() || '').trim();
          if (token) {
            lastArcgisPublishToken = token;
            return token;
          }
        }
      } catch {}
      try {
        const token = (sessionStorage.getItem('eitel.arcgis.access_token') || '').trim();
        if (token) {
          lastArcgisPublishToken = token;
          return token;
        }
        return lastArcgisPublishToken;
      } catch {
        return lastArcgisPublishToken;
      }
    }

    async function fetchArcgisAccessTokenFromPortalSession() {
      if (!arcgis?.portalUrl) return '';
      try {
        // Use window.location.origin (stable base URL, e.g. https://gis.eiteldata.eu) so the token's
        // referer is a prefix that both the browser validation fetch AND the EDC connector request match.
        const stableReferer = window.location.origin;
        const body = new URLSearchParams({
          f: 'json',
          client: 'referer',
          referer: stableReferer,
          expiration: '20160'
        });
        const res = await fetch(`${arcgis.portalUrl}/sharing/rest/generateToken`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: body.toString(),
          credentials: 'include',
        });
        const data = await res.json();
        const token = (data?.token || '').trim();
        const expiresAt = Number(data?.expires || 0);
        if (token) {
          lastArcgisPublishToken = token;
          try { sessionStorage.setItem('eitel.arcgis.access_token', token); } catch {}
          if (Number.isFinite(expiresAt) && expiresAt > 0) setStoredArcgisTokenExpiresAt(expiresAt);
          refreshArcgisTokenIndicator();
        }
        return token;
      } catch {
        return '';
      }
    }

    async function resolveArcgisTokenForPublish() {
      // Prefer a fresh token from ArcGIS session to avoid stale-token transfers.
      const fresh = await fetchArcgisAccessTokenFromPortalSession();
      if (fresh) return fresh;
      return getArcgisAccessTokenForPublish();
    }

    function resolveAuthTokenForPublish(authType) {
      if (authType === 'arcgis-login') {
        return getArcgisAccessTokenForPublish() || lastArcgisPublishToken;
      }
      return (document.getElementById('pubAuthToken')?.value || '').trim();
    }

    function buildAuthHeaders(baseHeaders = {}) {
      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const authHeader = (document.getElementById('pubAuthHeader')?.value || 'Authorization').trim();
      const authPrefix = (document.getElementById('pubAuthPrefix')?.value || '').trim();
      const authToken = resolveAuthTokenForPublish(authType);
      const authSecret = (document.getElementById('pubAuthSecret')?.value || '').trim();
      const headers = { ...baseHeaders };

      if (authType === 'none') return headers;
      if (authType === 'arcgis-login') {
        if (authToken) {
          headers.token = authToken;
        }
        return headers;
      }

      let authValue = '';
      if (authToken) {
        // token provided directly in the form (useful for OAuth2 or API tokens)
        if (authType === 'apikey') {
          authValue = authToken;
        } else {
          const prefix = authPrefix || 'Bearer ';
          authValue = `${prefix}${authToken}`;
        }
      } else if (authSecret) {
        const secretRef = `{{vault:${authSecret}}}`;
        authValue = authType === 'apikey' ? secretRef : `${authPrefix || 'Bearer '}${secretRef}`;
      }

      if (authValue) headers[authHeader] = authValue;
      return headers;
    }

    function appendQueryParams(path, params) {
      const basePath = String(path || '').trim();
      const [rawPath, rawQuery = ''] = basePath.split('?', 2);
      const qs = new URLSearchParams(rawQuery);
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        if (!qs.has(k)) qs.set(k, String(v));
      });
      const query = qs.toString();
      return query ? `${rawPath}?${query}` : rawPath;
    }

    function buildArcgisPathWithToken(path, token) {
      const withFormat = setQueryParams(path, { f: 'json' });
      return setQueryParams(withFormat, { token });
    }

    function setQueryParams(path, params) {
      const basePath = String(path || '').trim();
      const [rawPath, rawQuery = ''] = basePath.split('?', 2);
      const qs = new URLSearchParams(rawQuery);
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        qs.set(k, String(v));
      });
      const query = qs.toString();
      return query ? `${rawPath}?${query}` : rawPath;
    }

    function removeQueryParams(path, keys = []) {
      const basePath = String(path || '').trim();
      const [rawPath, rawQuery = ''] = basePath.split('?', 2);
      const qs = new URLSearchParams(rawQuery);
      keys.forEach(key => qs.delete(key));
      const query = qs.toString();
      return query ? `${rawPath}?${query}` : rawPath;
    }

    function normalizeHttpDataUrlParts(rawBaseUrl, rawPath) {
      let baseUrl = String(rawBaseUrl || '').trim();
      let path = String(rawPath || '').trim();

      // Accept full URL pasted in path field.
      if (/^https?:\/\//i.test(path)) {
        try {
          const u = new URL(path);
          baseUrl = `${u.origin}${u.pathname}`;
          const q = u.search ? u.search.replace(/^\?/, '') : '';
          path = q ? `?${q}` : '';
        } catch {}
      }

      // If baseUrl already contains query, move it to path query to avoid double '?'.
      const qIndex = baseUrl.indexOf('?');
      if (qIndex >= 0) {
        const baseQuery = baseUrl.slice(qIndex + 1);
        baseUrl = baseUrl.slice(0, qIndex);
        path = appendQueryParams(path, Object.fromEntries(new URLSearchParams(baseQuery).entries()));
      }

      if (path && !path.startsWith('/') && !path.startsWith('?')) {
        path = `/${path}`;
      }

      return { baseUrl: baseUrl.trim(), path: path.trim() };
    }

    function getSelectedTransferMode() {
      return (document.getElementById('transferMode')?.value || 'push').trim();
    }

    function getSelectedAssetSourceMode() {
      return (document.getElementById('assetSourceMode')?.value || 'remote-url').trim();
    }

    function syncAssetSourceModeUi() {
      const mode = getSelectedAssetSourceMode();
      const baseUrlWrap = document.getElementById('assetRemoteBaseUrlWrap');
      const pathWrap = document.getElementById('assetRemotePathWrap');
      const localFileWrap = document.getElementById('assetLocalFileWrap');
      if (baseUrlWrap) baseUrlWrap.style.display = mode === 'local-file' ? 'none' : '';
      if (pathWrap) pathWrap.style.display = mode === 'local-file' ? 'none' : '';
      if (localFileWrap) localFileWrap.style.display = mode === 'local-file' ? '' : 'none';
    }

    function syncTransferModeUi() {
      const mode = getSelectedTransferMode();
      const sinkWrap = document.getElementById('sinkBaseUrlWrap');
      const arcgisWrap = document.getElementById('arcgisUploadWrap');
      const startBtn = document.getElementById('btnStartTransfer');
      if (sinkWrap) sinkWrap.style.display = mode === 'push' ? '' : 'none';
      if (arcgisWrap) arcgisWrap.style.display = mode === 'arcgis-upload' ? '' : 'none';
      if (startBtn && !transferStartInFlight) {
        startBtn.textContent = mode === 'local-download'
          ? 'Descargar en local'
          : (mode === 'arcgis-upload' ? 'Subir a ArcGIS' : 'Iniciar transferencia');
      }
    }

    function guessFileExtension(contentType, fallback = 'json') {
      const lower = String(contentType || '').toLowerCase();
      if (lower.includes('application/json')) return 'json';
      if (lower.includes('geo+json')) return 'geojson';
      if (lower.includes('text/csv')) return 'csv';
      if (lower.includes('application/zip')) return 'zip';
      if (lower.includes('application/pdf')) return 'pdf';
      if (lower.includes('text/plain')) return 'txt';
      if (lower.includes('text/html')) return 'html';
      return fallback;
    }

    function inferDownloadFilename(assetId, sourceUrl, contentType, contentDisposition) {
      const cd = String(contentDisposition || '');
      const matchUtf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (matchUtf8?.[1]) {
        try { return decodeURIComponent(matchUtf8[1]); } catch {}
      }
      const matchSimple = cd.match(/filename="?([^";]+)"?/i);
      if (matchSimple?.[1]) return matchSimple[1];

      try {
        const url = new URL(sourceUrl, window.location.origin);
        const lastSegment = (url.pathname.split('/').filter(Boolean).pop() || '').trim();
        if (lastSegment && lastSegment.includes('.')) return lastSegment;
      } catch {}

      const safeAssetId = String(assetId || 'dataset').trim().replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'dataset';
      return `${safeAssetId}.${guessFileExtension(contentType)}`;
    }

    async function downloadAssetLocally(contractId, assetId) {
      if (!assetId) {
        return { status: 404, error: 'No se pudo resolver el asset asociado al contrato seleccionado.' };
      }

      const assetsResp = await callApi('POST', '/v3/assets/request', q(), { retries: 0, timeoutMs: 5000 });
      const assets = unwrap(assetsResp);
      const asset = assets.find(a => (a['@id'] || a.id || '') === assetId);
      if (!asset) {
        return { status: 404, error: 'El asset del contrato no existe en este conector.', contractId, assetId };
      }

      const props = asset.properties || {};
      const dataAddress = asset.dataAddress || asset['edc:dataAddress'] || {};
      const sourceMode = String(props['eitel:sourceMode'] || '').trim();
      const baseUrl = String(dataAddress.baseUrl || '').trim();
      let path = String(dataAddress.path || '').trim();
      let headers = { ...(dataAddress.headers || {}) };
      const authType = String(props['eitel:authType'] || '').trim();

      if (!baseUrl || String(dataAddress.type || '').trim() !== 'HttpData') {
        return { status: 400, error: 'El asset seleccionado no usa un origen HttpData descargable.', contractId, assetId, dataAddress };
      }

      if (authType === 'arcgis-login') {
        const authToken = await resolveArcgisTokenForPublish();
        if (!authToken) {
          return { status: 401, error: 'No se pudo obtener un token ArcGIS válido para la descarga local.' };
        }
        path = buildArcgisPathWithToken(removeQueryParams(path, ['token']), authToken);
        headers = { ...headers, token: authToken };
      }

      const sourceUrl = sourceMode === 'local-file' && props['eitel:localAssetPublicUrl']
        ? String(props['eitel:localAssetPublicUrl']).trim()
        : `${baseUrl.replace(/\/+$/, '')}${path || ''}`;
      try {
        const response = await fetch(sourceUrl, {
          method: 'GET',
          headers,
          credentials: 'include',
        });
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        if (!response.ok) {
          const detail = await response.text();
          return {
            status: response.status,
            error: 'La descarga local devolvió error HTTP.',
            contractId,
            assetId,
            sourceUrl,
            contentType,
            detail: detail.slice(0, 1000)
          };
        }

        const blob = await response.blob();
        const filename = inferDownloadFilename(
          assetId,
          sourceUrl,
          contentType,
          response.headers.get('content-disposition') || ''
        );
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

        return {
          status: 200,
          downloaded: true,
          contractId,
          assetId,
          sourceUrl,
          filename,
          contentType,
          bytes: blob.size,
        };
      } catch (error) {
        return {
          status: 500,
          error: 'No se pudo descargar el recurso en el navegador.',
          contractId,
          assetId,
          sourceUrl,
          detail: String(error),
        };
      }
    }

    function canonicalConnectorPrefix(input) {
      const raw = String(input || '').trim();
      if (!raw) return '';
      const lower = raw.toLowerCase();
      if (lower === 'conectorfuenlabrada' || lower === 'fuenlabrada') return 'conectorFuenlabrada';
      if (lower === 'conectoruc3m' || lower === 'uc3m') return 'conectoruc3m';
      return lower.startsWith('conector') ? raw : `conector${raw}`;
    }

    function extractConnectorIdHint(rawValue) {
      const raw = String(rawValue || '').trim();
      if (!raw) return '';

      const direct = raw.match(/conector[a-z0-9-]+/i);
      if (direct?.[0]) return canonicalConnectorPrefix(direct[0]);

      const short = raw.toLowerCase();
      if (short === 'uc3m' || short === 'fuenlabrada' || short === 'provider' || short === 'consumer') return short;

      return '';
    }

    function resolveAgreementPartnerConnector(agreementId) {
      const row = (state.agreementRows || []).find(a => a.id === agreementId);
      if (!row) return '';
      const candidates = [row.provider, row.consumer, row.cp, row.asset];
      for (const candidate of candidates) {
        const hint = extractConnectorIdHint(candidate);
        if (hint) return hint;
      }
      return '';
    }

    function syncTransferAddressFromAgreement(agreementId) {
      const contractId = String(agreementId || '').trim();
      if (!contractId) return;
      const partnerConnector = resolveAgreementPartnerConnector(contractId);
      if (!partnerConnector) return;

      const resolved = buildDspUrl(partnerConnector);
      if (!resolved) return;
      const transferInput = document.getElementById('transferAddress');
      if (transferInput) transferInput.value = resolved;
    }

    function resolveTransferParty(contractId, selectedAgreement = null) {
      const currentTransferAddress = (document.getElementById('transferAddress')?.value || '').trim();
      const row = selectedAgreement || (state.agreementRows || []).find(a => a.id === contractId) || null;

      const providerRaw = row?.providerId || row?.['edc:providerId'] || row?.provider || row?.cp || '';
      const hint = extractConnectorIdHint(providerRaw);
      const resolvedAddress = hint ? buildDspUrl(hint) : currentTransferAddress;

      let counterPartyId = String(providerRaw || '').trim();
      if (!counterPartyId && hint) {
        counterPartyId = String(hint).trim();
      }

      // If provider is a URL path/host alias, use connector hint as participant id fallback.
      if (counterPartyId.startsWith('http://') || counterPartyId.startsWith('https://') || counterPartyId.startsWith('/')) {
        counterPartyId = String(hint || '').trim();
      }

      return {
        address: resolvedAddress,
        counterPartyId,
        providerRaw,
      };
    }

    function getUiPrefix() {
      const configured = canonicalConnectorPrefix(cfg.connectorName || '');
      if (configured) return `/${configured}`;
      const first = (window.location.pathname || '/').split('/').filter(Boolean)[0] || '';
      return first ? `/${canonicalConnectorPrefix(first) || first}` : '';
    }

    function buildLocalDownloadSinkPublicBaseUrl() {
      return `${window.location.origin}${getUiPrefix()}/download-sink`;
    }

    function buildLocalDownloadSinkInternalBaseUrl() {
      const connector = String(cfg.connectorName || '').trim().toLowerCase();
      const normalized = connector ? connector.replace(/[^a-z0-9-]/g, '') : 'conectoruc3m';
      return `http://${normalized}-download-sink:8082`;
    }

    function shouldUsePublicSinkForRemoteTransfer(transferAddress) {
      const addr = String(transferAddress || '').trim().toLowerCase();
      // Si el partner viene por URL pública, el sink también debe ser público para que sea alcanzable entre máquinas.
      return addr.startsWith('http://') || addr.startsWith('https://');
    }

    function sleepMs(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitTransferToFinish(transferId, maxWaitMs = 120000) {
      const started = Date.now();
      while (Date.now() - started < maxWaitMs) {
        await sleepMs(2500);
        const stateResp = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}/state`, undefined, { silent: true, retries: 0 });
        const st = normalizeTransferState(stateResp?.data?.state || stateResp?.data?.['edc:state'] || '');
        if (st === 'COMPLETED') return { ok: true, state: st };
        if (st === 'FAILED' || st === 'TERMINATED') {
          const detailResp = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}`, undefined, { silent: true, retries: 0 });
          const err = detailResp?.data?.errorDetail || detailResp?.data?.['edc:errorDetail'] || 'Sin detalle de error.';
          return { ok: false, state: st, error: err };
        }
      }
      return { ok: false, state: 'TIMEOUT', error: 'La transferencia no finalizó a tiempo.' };
    }

    async function getLatestDownloadSinkRecord(contractId) {
      const sinkBaseUrl = buildLocalDownloadSinkPublicBaseUrl();
      const recordsRes = await fetch(`${sinkBaseUrl}/records?contractId=${encodeURIComponent(contractId)}`);
      const recordsData = await recordsRes.json();
      const records = Array.isArray(recordsData?.items) ? recordsData.items : [];
      return records[0] || null;
    }

    function triggerBrowserDownload(url, filename = '') {
      const anchor = document.createElement('a');
      anchor.href = url;
      if (filename) anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    function collectUrlCandidatesFromObject(obj, out = []) {
      if (!obj) return out;
      if (Array.isArray(obj)) {
        obj.forEach(item => collectUrlCandidatesFromObject(item, out));
        return out;
      }
      if (typeof obj !== 'object') return out;

      Object.entries(obj).forEach(([k, v]) => {
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          const key = String(k || '').toLowerCase();
          if (
            key.includes('endpointurl') ||
            key.includes('download') ||
            key.includes('publicurl') ||
            key.includes('baseurl') ||
            key.includes('accessurl') ||
            key.includes('localassetpublicurl') ||
            key.includes('url')
          ) {
            out.push(v);
          }
        } else if (typeof v === 'object' && v) {
          collectUrlCandidatesFromObject(v, out);
        }
      });
      return out;
    }

    function pickBestSourceUrl(urls = []) {
      const unique = [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean))];
      const filtered = unique.filter(u => {
        const s = String(u).toLowerCase();
        return !s.includes('/api/management') && !s.includes('/api/v1/dsp');
      });
      return filtered[0] || unique[0] || '';
    }

    async function downloadFromSourceHint(contractId, assetId, sourceUrl) {
      const url = String(sourceUrl || '').trim();
      if (!url) return { status: 404, error: 'Sin URL de origen alternativa para descarga directa.', contractId, assetId };
      try {
        const response = await fetch(url, { method: 'GET', credentials: 'include' });
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        if (!response.ok) {
          const detail = await response.text();
          return {
            status: response.status,
            error: 'La descarga directa desde catálogo devolvió error HTTP.',
            contractId,
            assetId,
            sourceUrl: url,
            detail: String(detail || '').slice(0, 1000),
          };
        }
        const blob = await response.blob();
        const filename = inferDownloadFilename(assetId, url, contentType, response.headers.get('content-disposition') || '');
        const objectUrl = URL.createObjectURL(blob);
        triggerBrowserDownload(objectUrl, filename);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        return {
          status: 200,
          downloaded: true,
          contractId,
          assetId,
          sourceUrl: url,
          filename,
          contentType,
          bytes: blob.size,
          via: 'catalog-source-hint',
        };
      } catch (error) {
        return {
          status: 500,
          error: 'No se pudo descargar desde URL alternativa de catálogo.',
          contractId,
          assetId,
          sourceUrl: url,
          detail: String(error),
        };
      }
    }

    function mapContentTypeToArcgisType(contentType, fallback = 'File') {
      const txt = String(contentType || '').toLowerCase();
      if (txt.includes('csv')) return 'CSV';
      if (txt.includes('json')) return 'GeoJson';
      if (txt.includes('zip')) return 'Shapefile';
      if (txt.includes('pdf')) return 'PDF';
      if (txt.includes('xml')) return 'File Geodatabase';
      return fallback;
    }

    async function fetchAssetBlobForArcgisUpload(contractId, assetId) {
      if (!assetId) return { status: 404, error: 'No se pudo resolver el asset asociado al contrato.' };

      const assetsResp = await callApi('POST', '/v3/assets/request', q(), { silent: true, retries: 0 });
      const assets = unwrap(assetsResp);
      const asset = assets.find(a => (a['@id'] || a.id || '') === assetId);
      if (!asset) {
        const hintedUrl = agreementSourceHints.get(contractId) || '';
        if (!hintedUrl) {
          return { status: 404, error: 'El asset no está localmente y no hay URL alternativa para ArcGIS.' };
        }
        try {
          const hintedRes = await fetch(hintedUrl, { method: 'GET', credentials: 'include' });
          if (!hintedRes.ok) return { status: hintedRes.status, error: 'No se pudo descargar el asset remoto para subir a ArcGIS.' };
          const hintedBlob = await hintedRes.blob();
          return {
            status: 200,
            blob: hintedBlob,
            filename: inferDownloadFilename(assetId, hintedUrl, hintedRes.headers.get('content-type') || hintedBlob.type, hintedRes.headers.get('content-disposition') || ''),
            contentType: hintedRes.headers.get('content-type') || hintedBlob.type || 'application/octet-stream',
            sourceUrl: hintedUrl,
          };
        } catch (error) {
          return { status: 500, error: `Error descargando asset remoto: ${String(error)}` };
        }
      }

      const props = asset.properties || {};
      const dataAddress = asset.dataAddress || asset['edc:dataAddress'] || {};
      const sourceMode = String(props['eitel:sourceMode'] || '').trim();
      const baseUrl = String(dataAddress.baseUrl || '').trim();
      let path = String(dataAddress.path || '').trim();
      let headers = { ...(dataAddress.headers || {}) };
      const authType = String(props['eitel:authType'] || '').trim();
      if (!baseUrl || String(dataAddress.type || '').trim() !== 'HttpData') {
        return { status: 400, error: 'El asset seleccionado no usa un origen HttpData válido.' };
      }

      if (authType === 'arcgis-login') {
        const authToken = await resolveArcgisTokenForPublish();
        if (!authToken) return { status: 401, error: 'No se pudo obtener token ArcGIS para leer el asset.' };
        path = buildArcgisPathWithToken(removeQueryParams(path, ['token']), authToken);
        headers = { ...headers, token: authToken };
      }

      const sourceUrl = sourceMode === 'local-file' && props['eitel:localAssetPublicUrl']
        ? String(props['eitel:localAssetPublicUrl']).trim()
        : `${baseUrl.replace(/\/+$/, '')}${path || ''}`;

      try {
        const response = await fetch(sourceUrl, { method: 'GET', headers, credentials: 'include' });
        if (!response.ok) return { status: response.status, error: 'No se pudo descargar el asset para ArcGIS.' };
        const blob = await response.blob();
        const contentType = response.headers.get('content-type') || blob.type || 'application/octet-stream';
        const filename = inferDownloadFilename(assetId, sourceUrl, contentType, response.headers.get('content-disposition') || '');
        return { status: 200, blob, filename, contentType, sourceUrl };
      } catch (error) {
        return { status: 500, error: `Error descargando asset para ArcGIS: ${String(error)}` };
      }
    }

    async function uploadTransferToArcgis(contractId, assetId) {
      const title = String(document.getElementById('arcgisUploadTitle')?.value || '').trim();
      const typeInput = String(document.getElementById('arcgisUploadType')?.value || '').trim();
      const tags = String(document.getElementById('arcgisUploadTags')?.value || '').trim();
      const description = String(document.getElementById('arcgisUploadDescription')?.value || '').trim();

      if (!title) return { status: 400, error: 'El título del item ArcGIS es obligatorio.' };
      if (!arcgis?.portalUrl) return { status: 400, error: 'Falta ARCGIS_PORTAL_URL en configuración.' };
      if (!authState?.username) return { status: 401, error: 'No hay sesión ArcGIS activa para subir el item.' };

      const token = await resolveArcgisTokenForPublish();
      if (!token) return { status: 401, error: 'No se pudo obtener token ArcGIS para subida.' };

      const blobResult = await fetchAssetBlobForArcgisUpload(contractId, assetId);
      if (!(blobResult.status >= 200 && blobResult.status < 300)) return blobResult;

      const form = new FormData();
      form.append('f', 'json');
      form.append('token', token);
      form.append('title', title);
      form.append('type', typeInput || mapContentTypeToArcgisType(blobResult.contentType));
      form.append('tags', tags || 'eitel,edc');
      form.append('description', description || 'Item generado desde transferencia del conector EITEL');
      form.append('file', blobResult.blob, blobResult.filename || `${assetId || 'asset'}.bin`);

      try {
        const endpoint = `${arcgis.portalUrl}/sharing/rest/content/users/${encodeURIComponent(authState.username)}/addItem`;
        const response = await fetch(endpoint, { method: 'POST', body: form, credentials: 'include' });
        const data = await response.json();
        if (!response.ok || data?.error || data?.success === false) {
          return {
            status: response.status || 500,
            error: data?.error?.message || data?.error || 'ArcGIS no aceptó la subida del item.',
            detail: data,
          };
        }
        return {
          status: 200,
          uploaded: true,
          contractId,
          assetId,
          itemId: data?.id || '',
          title,
          filename: blobResult.filename,
          contentType: blobResult.contentType,
          sourceUrl: blobResult.sourceUrl,
          arcgisResponse: data,
        };
      } catch (error) {
        return { status: 500, error: `Error subiendo item a ArcGIS: ${String(error)}` };
      }
    }

    async function monitorRemoteDownloadAndFetch(contractId, transferId, assetId) {
      try {
        const started = Date.now();
        const maxWaitMs = 600000; // 10 minutos
        let loops = 0;

        while (Date.now() - started < maxWaitMs) {
          // 1) Prioridad: si el sink ya recibió archivo, descargar inmediatamente.
          const latest = await getLatestDownloadSinkRecord(contractId).catch(() => null);
          if (latest && latest.downloadPath) {
            const fileUrl = `${buildLocalDownloadSinkPublicBaseUrl()}${latest.downloadPath || ''}`;
            triggerBrowserDownload(fileUrl, latest.filename || 'download.bin');
            writeOut({
              status: 200,
              downloaded: true,
              remoteTransfer: true,
              transferId,
              contractId,
              assetId,
              filename: latest.filename,
              bytes: latest.bytes,
              sourceUrl: fileUrl,
            });
            return;
          }

          // 2) Cada pocas iteraciones, revisar estado de transferencia para detectar fallo terminal.
          if (loops % 3 === 0) {
            const stateResp = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}/state`, undefined, { silent: true, retries: 0 });
            const st = normalizeTransferState(stateResp?.data?.state || stateResp?.data?.['edc:state'] || '');
            if (st === 'FAILED' || st === 'TERMINATED') {
              const detailResp = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}`, undefined, { silent: true, retries: 0 });
              const err = detailResp?.data?.errorDetail || detailResp?.data?.['edc:errorDetail'] || 'Sin detalle de error.';
              writeOut({
                status: 502,
                error: 'La transferencia remota para descarga local no finalizó correctamente.',
                transferId,
                state: st,
                detail: err,
              });
              return;
            }
          }

          loops += 1;
          await sleepMs(3000);
        }

        writeOut({
          status: 504,
          error: 'La descarga remota sigue en curso y no llegó archivo al sink a tiempo.',
          transferId,
          contractId,
          assetId,
          hint: 'Comprueba /download-sink/records y conectividad entre conectores hacia el sink.',
        });
      } finally {
        _remoteLocalDownloadInFlightByContract.delete(contractId);
      }
    }

    async function downloadRemoteAssetViaTransfer(contractId, assetId, transferParty = null) {
      if (_remoteLocalDownloadInFlightByContract.has(contractId)) {
        return { status: 409, error: 'Ya hay una descarga remota en curso para este contrato.', contractId, assetId };
      }
      _remoteLocalDownloadInFlightByContract.add(contractId);

      const sinkPublicBaseUrl = buildLocalDownloadSinkPublicBaseUrl();
      const sinkInternalBaseUrl = buildLocalDownloadSinkInternalBaseUrl();
      const transferAddress = String(transferParty?.address || '').trim() || (document.getElementById('transferAddress').value || '').trim();
      const counterPartyId = String(transferParty?.counterPartyId || '').trim();
      if (!transferAddress) {
        _remoteLocalDownloadInFlightByContract.delete(contractId);
        return { status: 400, error: 'Falta dirección DSP del partner para la transferencia remota.' };
      }

      // Limpiar registros previos del sink para evitar descargar archivos antiguos por error.
      try { await fetch(`${sinkPublicBaseUrl}/records`, { method: 'DELETE' }); } catch {}

      const dataplanesResp = await callApi('GET', '/v3/dataplanes', undefined, { silent: true, retries: 0 });
      const dataplanes = Array.isArray(dataplanesResp?.data) ? dataplanesResp.data : [];
      if (dataplanesResp.status >= 200 && dataplanesResp.status < 300 && dataplanes.length === 0) {
        _remoteLocalDownloadInFlightByContract.delete(contractId);
        return {
          status: 503,
          error: 'No hay dataplanes registrados en este conector para ejecutar la descarga remota.',
          transferAddress,
        };
      }

      const sinkBaseUrlForTransfer = shouldUsePublicSinkForRemoteTransfer(transferAddress)
        ? sinkPublicBaseUrl
        : sinkInternalBaseUrl;

      const path = `/ingest?contractId=${encodeURIComponent(contractId)}&assetId=${encodeURIComponent(assetId || '')}`;
      const transferReq = {
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'TransferRequest',
        protocol: 'dataspace-protocol-http:2025-1',
        counterPartyAddress: transferAddress,
        ...(counterPartyId ? { counterPartyId } : {}),
        contractId,
        transferType: 'HttpData-PUSH',
        dataDestination: {
          type: 'HttpData',
          baseUrl: sinkBaseUrlForTransfer,
          method: 'POST',
          path,
        }
      };

      const startResp = await callApi('POST', '/v3/transferprocesses', JSON.stringify(transferReq), { retries: 0 });
      const transferId = startResp?.data?.['@id'] || startResp?.data?.id || '';
      if (!(startResp.status >= 200 && startResp.status < 300) || !transferId) {
        _remoteLocalDownloadInFlightByContract.delete(contractId);
        return {
          status: startResp.status || 500,
          error: 'No se pudo iniciar la transferencia remota para descarga local.',
          transferRequest: transferReq,
          response: startResp,
        };
      }

      writeOut({
        status: 202,
        info: 'Transferencia remota iniciada para descarga local.',
        transferId,
        contractId,
        assetId,
      });

      // No bloquear la UI: continuar en segundo plano y devolver control inmediato.
      monitorRemoteDownloadAndFetch(contractId, transferId, assetId);
      return {
        status: 202,
        pendingRemoteTransfer: true,
        transferId,
        contractId,
        assetId,
        message: 'Transferencia remota iniciada en segundo plano. El archivo se descargará al completarse.',
        sinkBaseUrl: sinkBaseUrlForTransfer,
      };
    }

    function looksLikeSourceErrorPayload(text, contentType) {
      const sample = String(text || '').slice(0, 5000);
      const lower = sample.toLowerCase();
      if (String(contentType || '').toLowerCase().includes('text/html')) return true;
      if (lower.includes('<html') || lower.includes('sign in') || lower.includes('arcgis login')) return true;
      try {
        const parsed = JSON.parse(sample);
        if (parsed?.error) return true;
        if (typeof parsed?.message === 'string' && parsed.message.toLowerCase().includes('error')) return true;
      } catch {}
      return false;
    }

    async function validateSourcePayloadPreview(baseUrl, path, headers) {
      const url = `${String(baseUrl || '').replace(/\/+$/, '')}${path || ''}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: headers || {},
          signal: controller.signal,
        });
        const text = await res.text();
        const contentType = res.headers.get('content-type') || '';
        const badPayload = looksLikeSourceErrorPayload(text, contentType);
        return {
          ok: res.ok && !badPayload,
          status: res.status,
          contentType,
          preview: text.slice(0, 240),
          url,
          badPayload,
        };
      } catch (e) {
        return {
          ok: true,
          inconclusive: true,
          url,
          error: String(e),
        };
      } finally {
        clearTimeout(timer);
      }
    }

    async function uploadLocalAssetSource(assetId) {
      const fileInput = document.getElementById('assetLocalFile');
      const file = fileInput?.files?.[0];
      if (!file) {
        return { status: 400, error: 'Selecciona un archivo local antes de publicar el asset.' };
      }

      const filename = file.name || `${assetId || 'asset'}.bin`;

      // First try raw upload to avoid multipart/proxy edge cases.
      try {
        const rawUrl = `${getLocalAssetsApiBaseUrl()}/upload-raw?filename=${encodeURIComponent(filename)}`;
        const rawRes = await fetch(rawUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Filename': filename,
          },
          body: file,
        });
        const rawText = await rawRes.text();
        let rawData = rawText;
        try { rawData = JSON.parse(rawText); } catch {}
        if (rawRes.status >= 200 && rawRes.status < 300) {
          return { status: rawRes.status, data: rawData };
        }
      } catch {}

      const formData = new FormData();
      formData.append('file', file, filename);

      try {
        const res = await fetch(`${getLocalAssetsApiBaseUrl()}/upload`, {
          method: 'POST',
          body: formData,
        });
        const text = await res.text();
        let data = text;
        try { data = JSON.parse(text); } catch {}
        return { status: res.status, data };
      } catch (error) {
        return { status: 500, error: `No se pudo subir el archivo local: ${String(error)}` };
      }
    }

    async function uploadLocalAssetImage(assetId) {
      const fileInput = document.getElementById('assetImageFile');
      const file = fileInput?.files?.[0];
      if (!file) return { status: 204, skipped: true };

      const formData = new FormData();
      formData.append('file', file, file.name || `${assetId || 'asset'}-image.png`);

      try {
        const res = await fetch(`${getLocalAssetsApiBaseUrl()}/upload`, {
          method: 'POST',
          body: formData,
        });
        const text = await res.text();
        let data = text;
        try { data = JSON.parse(text); } catch {}
        return { status: res.status, data };
      } catch (error) {
        return { status: 500, error: `No se pudo subir la imagen local: ${String(error)}` };
      }
    }

    function syncAuthHeadersJson() {
      // Prevent recursive re-entry (e.g. if input events trigger sync again).
      if (syncAuthHeadersJson._running) return;
      syncAuthHeadersJson._running = true;
      try {
        const headersEl = document.getElementById('assetHeadersJson');
        if (!headersEl) return;
        const headers = buildAuthHeaders({});
        try {
          headersEl.value = JSON.stringify(headers, null, 2);
        } catch {
          // ignore if JSON can't be stringified
        }
      } finally {
        syncAuthHeadersJson._running = false;
      }
    }

    function applyAuthTypeForm() {
      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const clientFields = document.getElementById('pubAuthClientFields');
      const tokenRow = document.getElementById('pubAuthTokenRow');
      const headerRow = document.getElementById('pubAuthHeaderRow');
      const tokenLabel = document.getElementById('pubAuthTokenLabel');
      const tokenInput = document.getElementById('pubAuthToken');
      const headerInput = document.getElementById('pubAuthHeader');
      const prefixInput = document.getElementById('pubAuthPrefix');
      const authSecretSelect = document.getElementById('pubAuthSecret');

      if (!clientFields || !tokenRow || !headerRow || !tokenLabel || !headerInput || !prefixInput || !tokenInput) return;

      if (authType === 'none') {
        clientFields.style.display = 'none';
        tokenRow.style.display = 'none';
        headerRow.style.display = 'none';
        tokenInput.readOnly = false;
        if (authSecretSelect) authSecretSelect.disabled = false;
      } else if (authType === 'oauth2') {
        clientFields.style.display = '';
        tokenRow.style.display = '';
        headerRow.style.display = '';
        tokenLabel.textContent = 'Token temporal';
        headerInput.placeholder = 'Authorization';
        prefixInput.placeholder = 'Bearer ';
        tokenInput.readOnly = false;
        if (authSecretSelect) authSecretSelect.disabled = false;
      } else if (authType === 'arcgis-login') {
        clientFields.style.display = 'none';
        tokenRow.style.display = 'none';
        headerRow.style.display = 'none';
        tokenLabel.textContent = 'Access token (login ArcGIS)';
        if (!headerInput.value) headerInput.value = 'Authorization';
        if (!prefixInput.value) prefixInput.value = 'Bearer ';
        headerInput.placeholder = 'Authorization';
        prefixInput.placeholder = 'Bearer ';
        tokenInput.value = getArcgisAccessTokenForPublish();
        tokenInput.readOnly = true;
        if (authSecretSelect) {
          authSecretSelect.value = '';
          authSecretSelect.disabled = true;
        }
      } else if (authType === 'apikey') {
        clientFields.style.display = 'none';
        tokenRow.style.display = '';
        headerRow.style.display = '';
        tokenLabel.textContent = 'API token';
        headerInput.placeholder = 'X-API-Key';
        prefixInput.placeholder = '';
        tokenInput.readOnly = false;
        if (authSecretSelect) authSecretSelect.disabled = false;
      } else {
        clientFields.style.display = 'none';
        tokenRow.style.display = '';
        headerRow.style.display = '';
        tokenLabel.textContent = 'Token';
        headerInput.placeholder = 'Authorization';
        prefixInput.placeholder = 'Bearer ';
        tokenInput.readOnly = false;
        if (authSecretSelect) authSecretSelect.disabled = false;
      }

      syncAuthHeadersJson();
      refreshArcgisTokenIndicator();
    }

    function parseJsonSafe(text, fallback = null) {
      try { return JSON.parse(text); } catch { return fallback; }
    }

    function buildPolicyFromTemplate(assetId, policyId) {
      const mode = document.getElementById('policyMode')?.value || 'form';
      if (mode === 'jsonld') {
        const custom = parseJsonSafe(document.getElementById('policyCustomJson')?.value || '', null);
        if (!custom) throw new Error('Policy JSON-LD inválido');
        return custom;
      }

      const accessLevel = (document.getElementById('policyAccessLevel')?.value || 'public').trim();
      const purpose = (document.getElementById('policyUsagePurpose')?.value || 'analytics').trim();
      const geography = (document.getElementById('policyGeography')?.value || 'local').trim();
      const dataCategory = (document.getElementById('policyDataCategory')?.value || 'energy').trim();
      const commercialUse = (document.getElementById('policyCommercialUse')?.value || 'no').trim();
      const expirationRaw = (document.getElementById('policyExpiration')?.value || '').trim();
      let expirationIso = '';
      if (expirationRaw) {
        const parsedDate = new Date(expirationRaw);
        if (!Number.isNaN(parsedDate.getTime())) expirationIso = parsedDate.toISOString();
      }

      const constraints = [];
      constraints.push({ leftOperand: 'dct:accessRights', operator: 'eq', rightOperand: accessLevel });
      constraints.push({ leftOperand: 'dct:purpose', operator: 'eq', rightOperand: purpose });
      constraints.push({ leftOperand: 'dct:spatial', operator: 'eq', rightOperand: geography });
      constraints.push({ leftOperand: 'dcat:theme', operator: 'eq', rightOperand: dataCategory });
      constraints.push({ leftOperand: 'eitel:commercialUse', operator: 'eq', rightOperand: commercialUse });
      if (expirationIso) constraints.push({ leftOperand: 'odrl:dateTime', operator: 'lteq', rightOperand: expirationIso });

      return {
        '@context': {
          odrl: 'http://www.w3.org/ns/odrl/2/',
          dcat: 'https://www.w3.org/ns/dcat#',
          dct: 'http://purl.org/dc/terms/',
          eitel: 'https://w3id.org/eitel/ns/'
        },
        '@id': policyId,
        '@type': 'http://www.w3.org/ns/odrl/2/Set',
        'dct:accessRights': accessLevel,
        'dct:purpose': purpose,
        'dct:spatial': geography,
        'dcat:theme': dataCategory,
        ...(expirationIso ? { 'dct:validUntil': expirationIso } : {}),
        permission: [{
          action: 'use',
          target: assetId,
          ...(constraints.length ? { constraint: constraints } : {})
        }],
        prohibition: [],
        obligation: []
      };
    }

    async function createOrUpdatePolicy() {
      const policyId = document.getElementById('policyIdPreview')?.value;
      const assetId = document.getElementById('assetIdPreview')?.value;
      if (!policyId || !assetId) { writeOut({ status: 400, error: 'Falta policyId o assetId.' }); return { status: 400 }; }
      let policy;
      try { policy = buildPolicyFromTemplate(assetId, policyId); } catch (e) { writeOut({ status: 400, error: String(e) }); return { status: 400 }; }

      const body = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        '@id': policyId,
        '@type': 'PolicyDefinition',
        policy
      };
      const response = await callApi('POST', '/v3/policydefinitions', JSON.stringify(body));
      if (response.status >= 200 && response.status < 300) {
        upsertAssetBundleBackup({ assetId, policyId, policyBody: body });
      }
      return response;
    }

    async function listPolicies() {
      const r = await callApi('POST', '/v3/policydefinitions/request', q());
      writeOut(r);
      return r;
    }

    async function deletePolicy() {
      const policyId = document.getElementById('policyIdPreview')?.value;
      if (!policyId) { writeOut({ status: 400, error: 'Policy ID requerido.' }); return; }
      writeOut(await callApi('DELETE', `/v3/policydefinitions/${encodeURIComponent(policyId)}`));
    }

    async function createContractDefinition() {
      const contractDefId = document.getElementById('contractDefIdPreview')?.value;
      const assetId = document.getElementById('assetIdPreview')?.value;
      const policyId = document.getElementById('policyIdPreview')?.value;
      if (!contractDefId || !assetId || !policyId) {
        writeOut({ status: 400, error: 'Faltan IDs de contractDef, asset o policy.' });
        return { status: 400 };
      }
      const body = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        '@id': contractDefId,
        '@type': 'ContractDefinition',
        accessPolicyId: policyId,
        contractPolicyId: policyId,
        assetsSelector: [[{ '@type': 'Criterion', operandLeft: 'https://w3id.org/edc/v0.0.1/ns/id', operator: '=', operandRight: assetId }]]
      };
      const response = await callApi('POST', '/v3/contractdefinitions', JSON.stringify(body));
      if (response.status >= 200 && response.status < 300) {
        upsertAssetBundleBackup({ assetId, contractDefId, contractBody: body, policyId });
      }
      return response;
    }

    async function listContractDefinitions() {
      const r = await callApi('POST', '/v3/contractdefinitions/request', q());
      writeOut(r);
      return r;
    }

    async function deleteContractDefinition() {
      const id = document.getElementById('contractDefIdPreview')?.value;
      if (!id) { writeOut({ status: 400, error: 'ContractDefinition ID requerido.' }); return; }
      writeOut(await callApi('DELETE', `/v3/contractdefinitions/${encodeURIComponent(id)}`));
    }

    async function purgeConnectorArtifacts() {
      const removed = { contractDefinitions: 0, policyDefinitions: 0, assets: 0 };
      const contractDefs = unwrap(await callApi('POST', '/v3/contractdefinitions/request', q()));
      for (const c of contractDefs) {
        const id = c['@id'] || c.id;
        if (!id) continue;
        const d = await callApi('DELETE', `/v3/contractdefinitions/${encodeURIComponent(id)}`);
        if (d.status >= 200 && d.status < 300) removed.contractDefinitions++;
      }

      const policies = unwrap(await callApi('POST', '/v3/policydefinitions/request', q()));
      for (const p of policies) {
        const id = p['@id'] || p.id;
        if (!id) continue;
        const d = await callApi('DELETE', `/v3/policydefinitions/${encodeURIComponent(id)}`);
        if (d.status >= 200 && d.status < 300) removed.policyDefinitions++;
      }

      const assets = unwrap(await callApi('POST', '/v3/assets/request', q()));
      for (const a of assets) {
        const id = a['@id'] || a.id;
        if (!id) continue;
        const d = await callApi('DELETE', `/v3/assets/${encodeURIComponent(id)}`);
        if (d.status >= 200 && d.status < 300) removed.assets++;
      }

      await refreshOverview();
      writeOut({ purged: removed });
      showInfoPopup('Conector vaciado', { removed, note: 'Se eliminaron assets, policies y contract definitions del conector actual.' });
    }

    async function createOrUpdateAsset() {
      const id = document.getElementById('assetIdPreview').value;
      const assetName = (document.getElementById('assetName').value || '').trim();
      const assetDescription = (document.getElementById('assetDescription')?.value || '').trim();
      const assetKeywords = parseKeywordList(document.getElementById('assetKeywords')?.value || '');
      let assetImageUrl = '';
      const sourceMode = getSelectedAssetSourceMode();

      const authType = sourceMode === 'local-file'
        ? 'none'
        : (document.getElementById('pubAuthType')?.value || 'none');
      let authToken = authType === 'arcgis-login'
        ? await resolveArcgisTokenForPublish()
        : resolveAuthTokenForPublish(authType);
      const authHeader = (document.getElementById('pubAuthHeader')?.value || '').trim();
      const authClientId = (document.getElementById('pubAuthClientId')?.value || '').trim();
      const authClientSecret = (document.getElementById('pubAuthClientSecret')?.value || '').trim();

      if (authType !== 'none') {
        if (!authHeader && authType !== 'arcgis-login') {
          writeOut({ status: 400, error: 'El campo "Header auth" es obligatorio para el tipo de autenticación seleccionado.' });
          return { status: 400 };
        }
        if (!authToken) {
          if (authType === 'arcgis-login' && typeof ensureArcgisLogin === 'function') {
            // Re-validate ArcGIS login and retry token retrieval one more time.
            await ensureArcgisLogin();
            authToken = await resolveArcgisTokenForPublish();
          }

          if (authToken) {
            // continue with publish
          } else {
          const msg = authType === 'arcgis-login'
            ? 'No se detectó access token de ArcGIS. Inicia sesión de nuevo y vuelve a intentarlo.'
            : 'El token/api token es obligatorio para el tipo de autenticación seleccionado.';
          writeOut({ status: 400, error: msg });
          return { status: 400 };
          }
        }
        if (authType === 'oauth2' && (!authClientId || !authClientSecret)) {
          writeOut({ status: 400, error: 'clientId y clientSecret son obligatorios para OAuth2.' });
          return { status: 400 };
        }
      }

      let headers = {};
      try { headers = JSON.parse(document.getElementById('assetHeadersJson').value || '{}'); } catch { writeOut({ status: 400, error: 'Headers JSON inválido.' }); return { status: 400 }; }

      let baseUrl = document.getElementById('assetBaseUrl').value.trim();
      let path = document.getElementById('assetPath').value.trim();
      let contentType = 'application/json';
      let localUploadInfo = null;

      if (sourceMode === 'local-file') {
        const uploadResp = await uploadLocalAssetSource(id);
        if (uploadResp.status < 200 || uploadResp.status >= 300) {
          writeOut(uploadResp);
          showInfoPopup('Error subiendo archivo local', uploadResp);
          return uploadResp;
        }
        localUploadInfo = uploadResp.data || {};
        baseUrl = String(localUploadInfo.internalBaseUrl || '').trim();
        path = String(localUploadInfo.path || '').trim();
        headers = {};
        contentType = String(localUploadInfo.contentType || 'application/octet-stream').trim();
      }

      const normalizedUrlParts = normalizeHttpDataUrlParts(baseUrl, path);
      baseUrl = normalizedUrlParts.baseUrl;
      path = normalizedUrlParts.path;

      if (authType === 'arcgis-login') {
        headers = {
          token: authToken
        };
        path = buildArcgisPathWithToken(path, authToken);
      } else {
        headers = buildAuthHeaders(headers);
      }

      if (authType !== 'none' && sourceMode !== 'local-file') {
        const sourcePreview = await validateSourcePayloadPreview(baseUrl, path, headers);
        if (!sourcePreview.ok) {
          showInfoPopup('Origen con error', {
            message: 'El endpoint origen devuelve una respuesta de error/login. No se publica el asset para evitar transferir errores al destino.',
            sourcePreview
          });
          writeOut({ status: 400, error: 'Endpoint origen no válido para transferencia', sourcePreview });
          return { status: 400, data: { sourcePreview } };
        }
      }

      const imageUploadResp = await uploadLocalAssetImage(id);
      if (imageUploadResp.status >= 400) {
        writeOut(imageUploadResp);
        showInfoPopup('Error subiendo imagen local', imageUploadResp);
        return imageUploadResp;
      }
      if (imageUploadResp.status >= 200 && imageUploadResp.status < 300) {
        const data = imageUploadResp.data || {};
        assetImageUrl = String(data.publicUrl || '').trim();
      }

      const body = {
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@id': id,
        '@type': 'Asset',
        properties: {
          name: assetName,
          title: assetName,
          description: assetDescription,
          keywords: assetKeywords.join(', '),
          image: assetImageUrl,
          contenttype: contentType,
          'eitel:authType': authType,
          'eitel:sourceMode': sourceMode,
          'eitel:localAssetPublicUrl': localUploadInfo?.publicUrl || '',
          'eitel:localAssetFilename': localUploadInfo?.filename || '',
          'eitel:authSecret': document.getElementById('pubAuthSecret')?.value || '',
          'eitel:authClientId': document.getElementById('pubAuthClientId')?.value.trim() || '',
          'eitel:authClientSecret': document.getElementById('pubAuthClientSecret')?.value.trim() || '',
          'eitel:authToken': authType === 'arcgis-login' ? '' : (document.getElementById('pubAuthToken')?.value.trim() || ''),
          'eitel:authTokenSource': authType === 'arcgis-login' ? 'arcgis-login' : ''
        },
        dataAddress: {
          '@type': 'DataAddress',
          type: 'HttpData',
          baseUrl,
          method: 'GET',
          path,
          headers,
          // For ArcGIS token (client=referer), the EDC connector must send the Referer header.
          // EDC's HttpData extension forwards DataAddress properties with the 'header:' prefix as HTTP headers.
          ...(authType === 'arcgis-login' ? { 'header:Referer': window.location.origin } : {})
        }
      };
      const publishResp = await callApi('POST', '/v3/assets', JSON.stringify(body));
      if (publishResp.status >= 200 && publishResp.status < 300) {
        upsertAssetBundleBackup({
          assetId: id,
          assetName,
          authType,
          sourceMode,
          assetBody: body,
        });
        showInfoPopup('Asset publicado', {
          status: publishResp.status,
          assetId: id,
          name: assetName,
          description: assetDescription,
          keywords: assetKeywords,
          image: assetImageUrl,
          sourceMode,
          baseUrl,
          path,
          authType,
          localUpload: localUploadInfo,
          hint: 'El asset se ha creado/actualizado correctamente en Management API.'
        });
      }
      if (authType === 'arcgis-login') {
        return {
          ...publishResp,
          requestPreview: {
            authMode: 'arcgis-header-token',
            baseUrl,
            path,
            headers: {
              token: authToken
            }
          },
        };
      }
      return publishResp;
    }

    async function deleteAssetAndCleanupBackup() {
      const assetId = String(document.getElementById('assetIdPreview')?.value || '').trim();
      if (!assetId) return { status: 400, error: 'Asset ID requerido.' };
      const response = await callApi('DELETE', `/v3/assets/${encodeURIComponent(assetId)}`);
      if (response.status >= 200 && response.status < 300) {
        removeAssetBundleBackup(assetId);
      }
      return response;
    }

    async function restoreAssetsFromBackup(options = {}) {
      const onlyIfEmpty = options.onlyIfEmpty !== false;
      const backups = getAssetBundleBackups();
      if (!backups.length) {
        const response = { status: 404, action: 'restore-from-backup', restored: 0, skipped: 0, message: 'No hay backups locales de assets en este navegador.' };
        if (!options.silent) writeOut(response);
        return response;
      }

      const assetsResp = await callApi('POST', '/v3/assets/request', q(), { silent: true, retries: 0 });
      const existingAssets = new Set(unwrap(assetsResp).map(a => a['@id'] || a.id).filter(Boolean));
      if (onlyIfEmpty && existingAssets.size > 0) {
        const response = { status: 200, action: 'restore-from-backup', restored: 0, skipped: backups.length, message: 'No se restaura porque el conector ya tiene assets publicados.' };
        if (!options.silent) writeOut(response);
        return response;
      }

      const policiesResp = await callApi('POST', '/v3/policydefinitions/request', q(), { silent: true, retries: 0 });
      const contractsResp = await callApi('POST', '/v3/contractdefinitions/request', q(), { silent: true, retries: 0 });
      const existingPolicies = new Set(unwrap(policiesResp).map(p => p['@id'] || p.id).filter(Boolean));
      const existingContracts = new Set(unwrap(contractsResp).map(c => c['@id'] || c.id).filter(Boolean));

      let restored = 0;
      const errors = [];

      for (const bundle of backups.slice(0, 80)) {
        const assetId = String(bundle?.assetId || '').trim();
        if (!assetId || !bundle?.assetBody) continue;

        if (!existingAssets.has(assetId)) {
          const assetResp = await callApi('POST', '/v3/assets', JSON.stringify(bundle.assetBody), { silent: true, retries: 0 });
          if (assetResp.status >= 200 && assetResp.status < 300) {
            existingAssets.add(assetId);
            restored += 1;
          } else {
            errors.push({ assetId, stage: 'asset', status: assetResp.status, detail: assetResp.error || assetResp.message || '' });
            continue;
          }
        }

        const policyId = String(bundle?.policyId || bundle?.policyBody?.['@id'] || '').trim();
        if (policyId && bundle?.policyBody && !existingPolicies.has(policyId)) {
          const policyResp = await callApi('POST', '/v3/policydefinitions', JSON.stringify(bundle.policyBody), { silent: true, retries: 0 });
          if (policyResp.status >= 200 && policyResp.status < 300) existingPolicies.add(policyId);
        }

        const contractDefId = String(bundle?.contractDefId || bundle?.contractBody?.['@id'] || '').trim();
        if (contractDefId && bundle?.contractBody && !existingContracts.has(contractDefId)) {
          const contractResp = await callApi('POST', '/v3/contractdefinitions', JSON.stringify(bundle.contractBody), { silent: true, retries: 0 });
          if (contractResp.status >= 200 && contractResp.status < 300) existingContracts.add(contractDefId);
        }
      }

      await refreshOverview();
      await loadPublishedAssets(false);
      const response = {
        status: errors.length ? 207 : 200,
        action: 'restore-from-backup',
        restored,
        skipped: Math.max(0, backups.length - restored),
        errors,
      };
      if (!options.silent) {
        writeOut(response);
        showInfoPopup('Restauración de assets', response);
      }
      return response;
    }

    async function ensurePolicyAndContractDefinition() {
      const assetId = document.getElementById('assetIdPreview').value;
      const policyId = document.getElementById('policyIdPreview')?.value;
      const contractDefId = document.getElementById('contractDefIdPreview')?.value;
      if (!policyId || !contractDefId) return { skipped: true };

      const existingPolicies = unwrap(await callApi('POST', '/v3/policydefinitions/request', q()));
      const policyExists = existingPolicies.some(p => (p['@id'] || p.id) === policyId);
      const policyResult = policyExists ? { status: 200, data: { message: 'Policy existente', id: policyId } } : await createOrUpdatePolicy();

      const contractDefs = unwrap(await callApi('POST', '/v3/contractdefinitions/request', q()));
      const duplicateById = contractDefs.find(c => (c['@id'] || c.id) === contractDefId);
      const duplicateByAsset = contractDefs.find(c => {
        const ac = c.assetsSelector?.[0]?.[0]?.rightValue || c.assetsSelector?.[0]?.[0]?.rightOperand;
        const cp = c.contractPolicyId || c['edc:contractPolicyId'];
        return ac === assetId && cp === policyId;
      });

      let contractResult;
      if (duplicateById || duplicateByAsset) {
        contractResult = { status: 200, data: { message: 'ContractDefinition existente', id: (duplicateById || duplicateByAsset)['@id'] || (duplicateById || duplicateByAsset).id } };
      } else {
        contractResult = await createContractDefinition();
      }
      return { policyResult, contractResult };
    }

    async function publishBundle() {
      const asset = await createOrUpdateAsset();
      const linked = await ensurePolicyAndContractDefinition();
      writeOut({ publish: 'bundle', asset, ...linked });
      await refreshOverview();
    }

    function mapCatalogRowsFromResponse(root, connectorId, address) {
      const datasets = root?.['dcat:dataset'] || root?.dataset || [];
      const list = Array.isArray(datasets) ? datasets : [datasets];
      const rows = list.flatMap(d => {
        const policiesRaw = d?.['odrl:hasPolicy'] || d?.hasPolicy || [];
        const policies = Array.isArray(policiesRaw) ? policiesRaw : [policiesRaw];
        const datasetId = d?.['@id'] || d?.id || '';
        const sourceHintUrl = pickBestSourceUrl(collectUrlCandidatesFromObject(d));
        const meta = extractDatasetMetadata(d);

        return policies.map(pol => {
          const permsRaw = pol?.['odrl:permission'] || pol?.permission || [];
          const perms = Array.isArray(permsRaw) ? permsRaw : [permsRaw];
          const target = perms.find(p => p?.['odrl:target'] || p?.target)?.['odrl:target'] || perms.find(p => p?.['odrl:target'] || p?.target)?.target || datasetId;
          return {
            offerId: pol?.['@id'] || pol?.id || '',
            assetId: datasetId || target,
            policyTarget: target || '',
            assigner: pol?.assigner || pol?.['odrl:assigner'] || connectorId,
            connectorId,
            counterPartyAddress: address,
            policySummary: summarizePolicyTerms(pol),
            policyRaw: pol,
            sourceHintUrl,
            assetTitle: meta.title,
            assetDescription: meta.description,
            assetKeywords: meta.keywords,
            assetImageUrl: meta.imageUrl,
          };
        });
      }).filter(x => x.offerId || x.assetId);

      return rows;
    }

    async function fetchCatalogRowsForConnector(connectorId) {
      const normalizedConnector = String(connectorId || '').trim() || 'provider';
      const address = buildDspUrl(normalizedConnector);
      const counterPartyId = resolveCounterPartyId(normalizedConnector, address);
      const response = await callApi('POST', '/v3/catalog/request', JSON.stringify({
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'CatalogRequest',
        counterPartyId,
        counterPartyAddress: address,
        protocol: 'dataspace-protocol-http:2025-1'
      }));
      const rows = mapCatalogRowsFromResponse(response?.data || {}, normalizedConnector, address);
      return { response, rows, connectorId: normalizedConnector, address };
    }

    function ensureDspVersion(url) {
      const trimmed = String(url || '').replace(/\/+$/, '');
      if (!trimmed) return trimmed;
      if (/\/api\/v1\/dsp\/2025-1$/i.test(trimmed)) return trimmed;
      if (/\/api\/v1\/dsp$/i.test(trimmed)) return `${trimmed}/2025-1`;
      return trimmed;
    }

    // Construir URL DSP absoluta en base al conector remoto indicado por el usuario.
    function buildDspUrl(connectorId) {
      const raw = String(connectorId || 'provider').trim();
      if (!raw) return 'http://provider-connector:19103/api/v1/dsp/2025-1';

      const currentConnectorRaw = String(cfg?.connectorName || '').trim();
      const currentCanonical = canonicalConnectorPrefix(currentConnectorRaw).toLowerCase();
      const targetCanonical = canonicalConnectorPrefix(raw).toLowerCase();

      // Si el usuario consulta el mismo conector que aloja esta UI, usar DSP interno
      // para evitar pasar por WAF/proxy publico y reducir 502 intermitentes.
      if (currentCanonical && targetCanonical && currentCanonical === targetCanonical) {
        const internalHost = currentConnectorRaw.toLowerCase();
        if (internalHost) {
          return ensureDspVersion(`http://${internalHost}:11003/api/v1/dsp/2025-1`);
        }
      }

      // Si llega URL absoluta, normalizarla.
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        return ensureDspVersion(raw);
      }

      // Si llega ruta relativa (/conectorX/...), convertirla a absoluta en el host actual.
      if (raw.startsWith('/')) {
        return ensureDspVersion(`${window.location.origin}${raw}`);
      }

      const connectorIdLower = raw.toLowerCase();
      if (connectorIdLower === 'provider') return 'http://provider-connector:19103/api/v1/dsp/2025-1';
      if (connectorIdLower === 'consumer') return 'http://consumer-connector:19203/api/v1/dsp/2025-1';

      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname.startsWith('127.');
      if (isLocalHost) {
        return ensureDspVersion(`http://${raw}-connector:19103/api/v1/dsp/2025-1`);
      }

      // Producción: resolver por mismo dominio público y prefijo canónico del conector remoto.
      const connectorPrefix = canonicalConnectorPrefix(raw);
      const publicOrigin = getPublicConnectorOrigin();
      return ensureDspVersion(`${publicOrigin}/${connectorPrefix}/api/v1/dsp/2025-1`);
    }

    function resolveCounterPartyId(connectorId, address) {
      const raw = String(connectorId || '').trim();
      if (raw && !raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('/')) return raw;
      try {
        const url = new URL(address);
        const segment = (url.pathname || '/').split('/').filter(Boolean)[0] || '';
        return segment || PROD_CONNECTOR_ID;
      } catch {
        return PROD_CONNECTOR_ID;
      }
    }

    async function loadCatalogs(showOutput = true) {
      const connectorId = (document.getElementById('searchConnectorId').value || 'provider').trim() || 'provider';
      const { response, rows, address } = await fetchCatalogRowsForConnector(connectorId);
      document.getElementById('resolvedAddress').value = address;
      document.getElementById('transferAddress').value = address;
      state.catalogRows = rows;
      renderCatalogShowcase(state.catalogRows);
      refreshCatalogAssetOptions();
      syncCatalogSelectionState();
      if (showOutput) writeOut(response);
    }

    async function loadCatalogShowcase(showOutput = true) {
      const connectors = parseConnectorCandidates();
      const allRows = [];
      const connectorSummaries = [];

      for (const connectorId of connectors) {
        const result = await fetchCatalogRowsForConnector(connectorId);
        if (result?.response?.status >= 200 && result?.response?.status < 300) {
          allRows.push(...(result.rows || []));
        }
        connectorSummaries.push({
          connectorId,
          status: result?.response?.status || 0,
          assets: (result.rows || []).length,
          dspUrl: result?.address || ''
        });
      }

      const dedupe = new Map();
      allRows.forEach(row => {
        const key = `${row.connectorId}::${row.assetId}::${row.offerId}`;
        if (!dedupe.has(key)) dedupe.set(key, row);
      });
      state.catalogRows = [...dedupe.values()];
      if (!state.catalogRows.length) {
        const localAssetsResp = await callApi('POST', '/v3/assets/request', q(), { silent: true, retries: 0 });
        const localAssets = unwrap(localAssetsResp);
        state.catalogRows = mapPublishedAssetsToCatalogVisualRows(localAssets);
      }

      renderCatalogShowcase(state.catalogRows);
      refreshCatalogAssetOptions();
      syncCatalogSelectionState();

      if (showOutput) {
        writeOut({
          status: 200,
          action: 'catalog-showcase',
          connectors: connectorSummaries,
          totalAssets: state.catalogRows.length,
        });
      }
      state.catalogShowcaseLoaded = state.catalogRows.length > 0;
    }

    async function requestContractByAsset() {
      const actionBtn = document.getElementById('btnRequestContract');
      if (actionBtn) {
        actionBtn.disabled = true;
        actionBtn.textContent = 'Procesando...';
      }
      const acceptedTerms = document.getElementById('catalogAcceptTerms')?.checked;
      if (!acceptedTerms) {
        writeOut({ status: 400, error: 'Debes aceptar los términos de uso de la política antes de solicitar contrato.' });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      const selectedIdxRaw = document.getElementById('catalogAssetId').value;
      if (selectedIdxRaw === '') {
        writeOut({ status: 400, error: 'Selecciona un data-offer del desplegable.' });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }
      if (!state.catalogRows.length) await loadCatalogShowcase(false);

      const selected = state.catalogRows[Number(selectedIdxRaw)];
      if (!selected) {
        writeOut({ status: 404, error: 'No se encontró ese asset en el catálogo.' });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      if (!selected.offerId) {
        writeOut({
          status: 400,
          error: 'La oferta del catálogo no tiene policy/@id. Recarga catálogos y selecciona otro asset.',
          selected
        });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      if (selected.counterPartyAddress) {
        const resolvedAddressInput = document.getElementById('resolvedAddress');
        const transferAddressInput = document.getElementById('transferAddress');
        const connectorInput = document.getElementById('searchConnectorId');
        const selectedConnector = document.getElementById('catalogSelectedConnector');
        if (resolvedAddressInput) resolvedAddressInput.value = selected.counterPartyAddress;
        if (transferAddressInput) transferAddressInput.value = selected.counterPartyAddress;
        if (connectorInput) connectorInput.value = selected.connectorId || connectorInput.value;
        if (selectedConnector) selectedConnector.value = selected.connectorId || '';
      }

      const policy = selected.policyRaw
        ? JSON.parse(JSON.stringify(selected.policyRaw))
        : {};

      // Para ContractRequest, EDC espera los términos ODRL compactados (assigner/target)
      // con el contexto oficial ODRL JSON-LD.
      policy['@context'] = 'http://www.w3.org/ns/odrl.jsonld';
      policy['@type'] = 'odrl:Offer';
      policy['@id'] = policy['@id'] || selected.offerId;
      const resolvedAssigner = (policy.assigner || policy['odrl:assigner'] || selected.assigner || 'provider').toString().trim();
      policy.assigner = resolvedAssigner || 'provider';
      // Forzar el asset real del dataset seleccionado; algunas policies publicadas traen target placeholder.
      const resolvedTarget = (selected.assetId || policy.target || policy['odrl:target'] || selected.policyTarget || '').toString().trim();
      policy.target = resolvedTarget;
      policy['odrl:target'] = resolvedTarget;

      const normalizeRuleTarget = (rule) => {
        if (!rule || typeof rule !== 'object') return rule;
        const resolved = (selected.assetId || rule.target || rule['odrl:target'] || selected.policyTarget || '').toString().trim();
        return { ...rule, target: resolved, 'odrl:target': resolved };
      };

      if (!resolvedTarget) {
        writeOut({ status: 400, error: 'No se pudo determinar el target del asset para la negociación.' });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      if (!Array.isArray(policy.permission)) policy.permission = policy.permission ? [policy.permission] : [];
      if (!Array.isArray(policy.prohibition)) policy.prohibition = policy.prohibition ? [policy.prohibition] : [];
      if (!Array.isArray(policy.obligation)) policy.obligation = policy.obligation ? [policy.obligation] : [];
      policy.permission = policy.permission.map(normalizeRuleTarget);
      policy.prohibition = policy.prohibition.map(normalizeRuleTarget);
      policy.obligation = policy.obligation.map(normalizeRuleTarget);

      const beforeAgreementsResp = await callApi('POST', '/v3/contractagreements/request', q());
      const beforeAgreementIds = new Set(unwrap(beforeAgreementsResp).map(a => a['@id'] || a.id).filter(Boolean));

      const r = await callApi('POST', '/v3/contractnegotiations', JSON.stringify({
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'ContractRequest',
        protocol: 'dataspace-protocol-http:2025-1',
        counterPartyAddress: document.getElementById('resolvedAddress').value,
        policy
      }));
      writeOut(r);

      if (r.status < 200 || r.status >= 300) {
        const detail = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {}, null, 2);
        showInfoPopup(
          'Aviso',
          `No se pudo iniciar el contrato.\nEstado HTTP: ${r.status}.\nDetalle: ${detail}`,
          { plainText: true }
        );
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      const negotiationId = r.data?.['@id'] || r.data?.id || '-';
      showInfoPopup(
        'Aviso',
        `Solicitud enviada correctamente.\nNegotiation ID: ${negotiationId}\nEstamos comprobando automáticamente cuándo aparece el contrato en la pestaña Contratos.`,
        { plainText: true }
      );

      if (actionBtn) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'Realizar contrato';
      }

      // Espera corta para que el agreement aparezca si la negociación finaliza rápido.
      let createdAgreement = null;
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const agreementsResp = await callApi('POST', '/v3/contractagreements/request', q());
        const agreements = unwrap(agreementsResp);
        const fresh = agreements.find(a => {
          const id = a['@id'] || a.id;
          return id && !beforeAgreementIds.has(id);
        });
        if (fresh) {
          createdAgreement = fresh;
          break;
        }
      }

      await listAgreements();

      if (createdAgreement) {
        const agreementId = createdAgreement['@id'] || createdAgreement.id;
        const assetId = createdAgreement.assetId || createdAgreement['edc:assetId'] || selected.assetId;
        const providerId = createdAgreement.providerId || createdAgreement['edc:providerId'] || selected.assigner;
        const consumerId = createdAgreement.consumerId || createdAgreement['edc:consumerId'] || connectorName;
        if (agreementId) {
          const hint = String(selected.sourceHintUrl || '').trim();
          if (hint) agreementSourceHints.set(agreementId, hint);
        }
        showInfoPopup('Aviso', `Contrato concretado correctamente.\nAgreement ID: ${agreementId}\nNegotiation ID: ${negotiationId}\nAsset: ${assetId}\nProvider: ${providerId}\nConsumer: ${consumerId}`, {
          plainText: true,
          actionLabel: 'Ir al contrato',
          onAction: () => window.useAgreement(agreementId)
        });
      } else {
        showInfoPopup(
          'Aviso',
          `Negociación iniciada correctamente (ID: ${negotiationId}), pero el contrato todavía no aparece en la lista. Espera unos segundos y revisa la pestaña Contratos.`,
          { plainText: true }
        );
      }
    }

    async function listAgreements() {
      const r = await callApi('POST', '/v3/contractagreements/request', q());
      const raw = unwrap(r).map(a => ({
        id: a['@id'] || a.id || '',
        asset: a.assetId || a['edc:assetId'] || a.asset || '',
        provider: a.providerId || a['edc:providerId'] || a.provider || '',
        consumer: a.consumerId || a['edc:consumerId'] || a.consumer || '',
        publishedAt: a.contractSigningDate || a['edc:contractSigningDate'] || a.createdAt || a.created || a['edc:createdAt'] || '',
        cp: a.counterPartyId || ''
      })).filter(x => x.id);

      const seenId = new Set();
      const seenTuple = new Set();
      state.agreementRows = raw.filter(a => {
        if (seenId.has(a.id)) return false;
        const tuple = `${a.asset}::${a.provider}::${a.consumer}`;
        if (seenTuple.has(tuple)) return false;
        seenId.add(a.id);
        seenTuple.add(tuple);
        return true;
      });

      const tbody = document.getElementById('tblAgreements');
      const sel = document.getElementById('agreementSelect');
      sel.innerHTML = state.agreementRows.length ? '' : '<option value="">No hay contratos</option>';

      if (!state.agreementRows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No hay contratos.</td></tr>';
      } else {
        tbody.innerHTML = state.agreementRows.map((a, i) => {
          const alias = `Contrato ${i + 1} · ${clean(a.asset || 'asset')}`;
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = `${alias} · ${fmtDate(a.publishedAt)}`;
          sel.appendChild(opt);
          return `
            <tr>
              <td class="title-cell" title="${a.id}">${alias}</td>
              <td class="title-cell" title="${a.asset}">${clean(a.asset)}</td>
              <td>${a.provider || '-'}</td>
              <td>${a.consumer || (a.cp || '-')}</td>
              <td>${fmtDate(a.publishedAt)}</td>
              <td>
                <button class="ghost" onclick="window.showAgreementDetail(${i})">Detalle</button>
                <button class="ghost" onclick="window.useAgreement('${a.id.replace(/'/g, "\\'")}')">Usar</button>
              </td>
            </tr>
          `;
        }).join('');
      }
      const deduplicated = raw.length - state.agreementRows.length;
      const selectedNow = (document.getElementById('agreementSelect')?.value || '').trim();
      if (selectedNow) syncTransferAddressFromAgreement(selectedNow);
      writeOut({ ...r, deduplicated });
      showInfoPopup('Contratos cargados', {
        total: state.agreementRows.length,
        deduplicated,
        preview: state.agreementRows.slice(0, 5)
      });
    }

    async function startTransfer() {
      if (transferStartInFlight) {
        writeOut({ status: 409, error: 'Ya hay una transferencia iniciándose. Espera unos segundos.' });
        return;
      }

      const startBtn = document.getElementById('btnStartTransfer');
      transferStartInFlight = true;
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Iniciando...';
      }

      try {
      const typedContractId = (document.getElementById('agreementId').value || '').trim();
      const selectedContractId = (document.getElementById('agreementSelect').value || '').trim();
      const contractId = (typedContractId || selectedContractId || '').trim();
      const transferMode = getSelectedTransferMode();
      const sinkBaseUrl = (document.getElementById('sinkBaseUrl').value || '').trim();
      if (!contractId) { writeOut({ status: 400, error: 'Selecciona un contrato.' }); return; }
      if (transferMode === 'push' && (!sinkBaseUrl || !/^https?:\/\//i.test(sinkBaseUrl))) {
        writeOut({ status: 400, error: 'Destination URL inválida. Debe empezar por http:// o https://.' });
        return;
      }

      // Validación fuerte: solo permitir contratos vigentes del conector
      const agreementsResp = await callApi('POST', '/v3/contractagreements/request', q());
      const validAgreementIds = new Set(
        unwrap(agreementsResp)
          .map(a => a['@id'] || a.id)
          .filter(Boolean)
      );
      const selectedAgreement = unwrap(agreementsResp).find(a => (a['@id'] || a.id || '') === contractId) || null;
      const agreementAssetId = selectedAgreement?.assetId || selectedAgreement?.['edc:assetId'] || state.agreementRows.find(a => a.id === contractId)?.asset || '';
      const transferParty = resolveTransferParty(contractId, selectedAgreement);
      if (transferParty?.address) {
        const transferAddressInput = document.getElementById('transferAddress');
        if (transferAddressInput) transferAddressInput.value = transferParty.address;
      }

      if (!validAgreementIds.has(contractId)) {
        showInfoPopup('Contrato no reconocido', {
          message: 'Ese contrato no existe o ya no es válido en este conector. Carga contratos y selecciona uno del desplegable.',
          selectedOrTypedContractId: contractId,
          availableContracts: state.agreementRows.slice(0, 10).map(a => ({
            id: a.id,
            asset: a.asset,
            provider: a.provider,
            consumer: a.consumer,
            publishedAt: a.publishedAt
          }))
        });
        writeOut({ status: 400, error: 'Contract agreement not found/valid for transfer', contractId });
        return;
      }

      const activeTransfersResp = await callApi('POST', '/v3/transferprocesses/request', q(), { retries: 0 });
      const activeByContract = unwrap(activeTransfersResp).find(tp => {
        const tpContractId = tp.contractId || tp['edc:contractId'] || '';
        const tpState = tp.state || tp['edc:state'] || '';
        return tpContractId === contractId && !isTransferTerminalState(tpState);
      });
      if (activeByContract || _remoteLocalDownloadInFlightByContract.has(contractId)) {
        const activeState = normalizeTransferState(activeByContract?.state || activeByContract?.['edc:state'] || '-');
        showInfoPopup('Transferencia ya en curso', {
          message: 'Ya existe una transferencia activa para este contrato. Espera a que termine antes de crear otra.',
          contractId,
          activeTransferId: activeByContract?.['@id'] || activeByContract?.id || '',
          activeState
        });
        writeOut({ status: 409, error: 'Ya hay una transferencia activa para este contrato.', contractId, activeState });
        return;
      }

      if (transferMode === 'local-download') {
        let downloadResp = await downloadAssetLocally(contractId, agreementAssetId);
        if (downloadResp?.status === 404) {
          const hintedUrl = agreementSourceHints.get(contractId) || '';
          if (hintedUrl) {
            const hintedResp = await downloadFromSourceHint(contractId, agreementAssetId, hintedUrl);
            if (hintedResp?.status >= 200 && hintedResp?.status < 300) {
              downloadResp = hintedResp;
            }
          }
        }
        // Si el asset no existe localmente (contrato remoto), usar transferencia EDC al sink local.
        if (downloadResp?.status === 404) {
          downloadResp = await downloadRemoteAssetViaTransfer(contractId, agreementAssetId, transferParty);
        }
        const localTransfer = addLocalTransferRecord(buildLocalTransferRecord(downloadResp));
        writeOut(downloadResp);
        await refreshOverview();
        await listTransfers();
        if (downloadResp.status >= 200 && downloadResp.status < 300) {
          showInfoPopup('Descarga iniciada', {
            transferId: localTransfer.id,
            contractId,
            assetId: agreementAssetId,
            filename: downloadResp.filename,
            bytes: downloadResp.bytes,
            sourceUrl: downloadResp.sourceUrl,
            message: 'El navegador ha iniciado la descarga local. Normalmente se guardará en Descargas según tu configuración del navegador.'
          });
        } else {
          showInfoPopup('Error en descarga local', downloadResp);
        }
        return;
      }

      if (transferMode === 'arcgis-upload') {
        const uploadResp = await uploadTransferToArcgis(contractId, agreementAssetId);
        const localTransfer = addLocalTransferRecord(buildLocalTransferRecord(uploadResp));
        writeOut(uploadResp);
        await refreshOverview();
        await listTransfers();
        if (uploadResp.status >= 200 && uploadResp.status < 300) {
          showInfoPopup('Subida a ArcGIS completada', {
            transferId: localTransfer.id,
            contractId,
            assetId: agreementAssetId,
            itemId: uploadResp.itemId,
            title: uploadResp.title,
            filename: uploadResp.filename,
          });
        } else {
          showInfoPopup('Error subiendo a ArcGIS', uploadResp);
        }
        return;
      }

      const dataplanesResp = await callApi('GET', '/v3/dataplanes', undefined, { silent: true, retries: 0 });
      const dataplanes = Array.isArray(dataplanesResp?.data) ? dataplanesResp.data : [];
      if (dataplanesResp.status >= 200 && dataplanesResp.status < 300 && dataplanes.length === 0) {
        showInfoPopup('Transferencia bloqueada: sin dataplane', {
          message: 'Este conector no tiene dataplanes registrados. Si inicias la transferencia se quedará en STARTED.',
          transferId: null,
          hint: 'Despliega/activa dataplane y vuelve a intentar. Puedes usar el botón "⚙️ Dataplanes" para verificarlo.'
        });
        writeOut({ status: 503, error: 'No hay dataplanes registrados en este conector.' });
        return;
      }

      const body = {
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'TransferRequest',
        protocol: 'dataspace-protocol-http:2025-1',
        counterPartyAddress: transferParty?.address || document.getElementById('transferAddress').value.trim(),
        ...(transferParty?.counterPartyId ? { counterPartyId: transferParty.counterPartyId } : {}),
        contractId,
        transferType: 'HttpData-PUSH',
        dataDestination: {
          type: 'HttpData',
          baseUrl: sinkBaseUrl,
          method: 'POST',
          path: '/'
        }
      };

      const r = await callApi('POST', '/v3/transferprocesses', JSON.stringify(body));
      writeOut(r);

      const transferId = r?.data?.['@id'] || r?.data?.id || '';
      if (r.status >= 200 && r.status < 300) {
        showInfoPopup('Transferencia iniciada', {
          status: r.status,
          transferId,
          contractId,
          message: 'La transferencia se ha enviado. Se refresca la lista automáticamente. Monitorizando estado...'
        });
        await listTransfers();
        if (transferId) {
          // Iniciar polling de estado hasta que la transferencia sea terminal
          pollTransferUntilDone(transferId);
        }
      } else {
        await listTransfers();
      }
      } finally {
        transferStartInFlight = false;
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = getSelectedTransferMode() === 'local-download'
            ? 'Descargar en local'
            : (getSelectedTransferMode() === 'arcgis-upload' ? 'Subir a ArcGIS' : 'Iniciar transferencia');
        }
      }
    }

    const TRANSFER_STATE_COLORS = {
      INITIAL: 'color:#888',
      PROVISIONING: 'color:#f5a623',
      PROVISIONED: 'color:#f5a623',
      REQUESTED: 'color:#4a90e2',
      STARTED: 'color:#2ac37a;font-weight:bold',
      SUSPENDED: 'color:#e67e22',
      COMPLETED: 'color:#27ae60;font-weight:bold',
      TERMINATED: 'color:#c0392b;font-weight:bold',
      FAILED: 'color:#c0392b;font-weight:bold',
    };

    async function listTransfers() {
      const r = await callApi('POST', '/v3/transferprocesses/request', q());
      const rows = getAllTransferRows(unwrap(r));
      const tbody = document.getElementById('tblTransfers');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No hay transferencias.</td></tr>';
      } else {
        tbody.innerHTML = rows.map((t, i) => {
          const id = t['@id'] || t.id || '';
          const st = normalizeTransferState(t.state || t['edc:state'] || '-');
          const style = TRANSFER_STATE_COLORS[st] || '';
          const contract = t.contractId || t['edc:contractId'] || '';
          const errorDetail = t.errorDetail || t['edc:errorDetail'] || '';
          const errorTip = errorDetail ? ` title="${errorDetail.replace(/"/g, '&quot;')}"` : '';
          const isTerminal = isTransferTerminalState(t.state || t['edc:state'] || '');
          const title = t.localDownload ? `Descarga local · ${clean(t.filename || id)}` : `Transferencia ${i + 1}`;
          return `
            <tr>
              <td class="title-cell" title="${id}">${title}</td>
              <td><span style="${style}"${errorTip}>${st}${errorDetail ? ' ⚠️' : ''}</span></td>
              <td class="title-cell" title="${contract}">${clean(contract)}</td>
              <td>
                <button class="ghost" onclick="window.showTransferDetail(${i})">Detalle</button>
                <button class="ghost" onclick="window.retryTransferMonitor('${id.replace(/'/g, "\\'")}')">Estado</button>
                ${!isTerminal && !t.localDownload ? `<button class="danger" onclick="window.terminateTransfer('${id.replace(/'/g, "\\'")}')">Terminar</button>` : ''}
                <button class="danger" onclick="window.deleteTransferRecord('${id.replace(/'/g, "\\'")}', ${t.localDownload ? 'true' : 'false'})">Borrar</button>
              </td>
            </tr>
          `;
        }).join('');
      }
      state.transferRows = rows;
      writeOut(r);
    }

    async function checkTransfer(transferId) {
      const localTransfer = getLocalTransferRecords().find(t => (t['@id'] || t.id || '') === transferId);
      if (localTransfer) {
        const st = normalizeTransferState(localTransfer.state || '-');
        showInfoPopup(`Estado: ${st}`, {
          transferId,
          state: st,
          contractId: localTransfer.contractId || '',
          assetId: localTransfer.assetId || '',
          transferType: localTransfer.transferType || 'LOCAL-DOWNLOAD',
          destinationType: localTransfer.destinationType || 'browser-download',
          filename: localTransfer.filename || '',
          bytes: localTransfer.bytes || 0,
          sourceUrl: localTransfer.sourceUrl || '',
          contentType: localTransfer.contentType || '',
          createdAt: fmtDate(localTransfer.createdAt || ''),
          errorDetail: localTransfer.errorDetail || '',
        });
        writeOut({ status: 200, data: localTransfer, localDownload: true });
        return;
      }

      // Obtener detalle completo (no solo estado) para ver errorDetail
      const full = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}`);
      const st = normalizeTransferState(full?.data?.state || full?.data?.['edc:state'] || '-');
      const errorDetail = full?.data?.errorDetail || full?.data?.['edc:errorDetail'] || '';
      showInfoPopup(`Estado: ${st}`, {
        transferId,
        state: st,
        errorDetail: errorDetail || '(sin detalle)',
        type: full?.data?.type || full?.data?.['edc:type'] || '',
        assetId: full?.data?.assetId || full?.data?.['edc:assetId'] || '',
        contractId: full?.data?.contractId || full?.data?.['edc:contractId'] || '',
        dataDestination: full?.data?.dataDestination || full?.data?.['edc:dataDestination'] || {},
        stateTimestamp: fmtDate(full?.data?.stateTimestamp || full?.data?.['edc:stateTimestamp'] || ''),
        dataplaneMetadata: full?.data?.['edc:dataplaneMetadata'] || full?.data?.dataplaneMetadata || {},
        diagnosisHint: st === 'STARTED'
          ? 'STARTED significa que el dataplane arrancó la transferencia pero no completó el PUSH. Causas más comunes: (1) token ArcGIS expirado en el asset origen, (2) webhook.site/destino no alcanzable desde dentro del contenedor Docker del servidor, (3) URL origen inaccesible desde el servidor.'
          : ''
      });
      writeOut(full);
    }

    async function terminateTransfer(transferId) {
      if (!transferId) return;
      const r = await callApi('POST', `/v3/transferprocesses/${encodeURIComponent(transferId)}/terminate`, JSON.stringify({
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        reason: 'Terminado manualmente desde la UI'
      }));
      if (r.status >= 200 && r.status < 300) {
        showInfoPopup('Transferencia terminada', { transferId, message: 'La transferencia fue terminada. Ahora puedes iniciar una nueva.' });
      } else {
        showInfoPopup('Error al terminar', { transferId, status: r.status, detail: r.data });
      }
      writeOut(r);
      await listTransfers();
    }
    window.terminateTransfer = terminateTransfer;

    async function deleteTransferRecord(transferId, isLocal = false) {
      if (!transferId) return;

      const localDeleted = removeLocalTransferRecordById(transferId);
      if (!localDeleted && !isLocal) {
        hideTransferRecordById(transferId);
      }

      writeOut({
        status: 200,
        action: 'delete-transfer-record',
        transferId,
        localDeleted,
        hidden: !localDeleted,
        note: localDeleted
          ? 'Registro local eliminado.'
          : 'Transferencia remota ocultada de la tabla (no se puede borrar del historial del runtime EDC).'
      });

      await listTransfers();
    }
    window.deleteTransferRecord = deleteTransferRecord;

    async function checkDataplanes() {
      const r = await callApi('GET', '/v3/dataplanes');
      const planes = Array.isArray(r?.data) ? r.data : [];
      if (!planes.length) {
        showInfoPopup('Sin Dataplanes registrados ⚠️', {
          message: 'No hay ningún dataplane registrado en este conector. Eso explica por qué las transferencias se quedan en STARTED: no hay motor de transferencia activo.',
          hint: 'Necesitas añadir un componente EDC Data Plane en docker-compose o que el conector tenga embedded dataplane activado. Revisa la configuración del runtime.'
        });
      } else {
        showInfoPopup(`Dataplanes (${planes.length})`, planes.map(p => ({
          id: p['@id'] || p.id,
          url: p.url || p['edc:url'] || '',
          state: p.state || p['edc:state'] || '',
          allowedSourceTypes: p.allowedSourceTypes || p['edc:allowedSourceTypes'] || [],
          allowedTransferTypes: p.allowedTransferTypes || p['edc:allowedTransferTypes'] || []
        })));
      }
      writeOut(r);
    }
    window.checkDataplanes = checkDataplanes;

    const _transferPollingActive = new Set();

    async function pollTransferUntilDone(transferId, maxWaitMs = 120000) {
      if (_transferPollingActive.has(transferId)) return;
      _transferPollingActive.add(transferId);
      const started = Date.now();
      const intervals = [2000, 3000, 5000, 5000, 10000];
      let step = 0;

      try {
        while (true) {
          const elapsed = Date.now() - started;
          if (elapsed > maxWaitMs) {
            const detail = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}`, undefined, { silent: true, retries: 0 });
            const dp = await callApi('GET', '/v3/dataplanes', undefined, { silent: true, retries: 0 });
            const dataplanes = Array.isArray(dp?.data) ? dp.data : [];
            const errorDetail = detail?.data?.errorDetail || detail?.data?.['edc:errorDetail'] || '(sin errorDetail)';
            const stateRaw = detail?.data?.state || detail?.data?.['edc:state'] || 'STARTED';
            const stateNow = normalizeTransferState(stateRaw);
            const dpMeta = detail?.data?.['edc:dataplaneMetadata'] || detail?.data?.dataplaneMetadata || {};

            showInfoPopup('Transferencia estancada ⚠️', {
              message: `La transferencia lleva más de ${Math.round(maxWaitMs / 1000)}s en estado no terminal. Posibles causas: el origen no es accesible desde el conector (comprueba que la URL y autenticación son válidas desde el servidor, no solo desde el navegador), o el destino (sinkBaseUrl) no acepta la conexión del conector. El estado quedó en STARTED porque el conector no pudo completar el PUSH.`,
              transferId,
              state: stateNow,
              elapsed: `${Math.round(elapsed / 1000)}s`,
              errorDetail,
              dataplanesCount: dataplanes.length,
              dataplaneMetadata: dpMeta,
              hint: dataplanes.length === 0
                ? 'No hay dataplanes registrados en Management API. Sin dataplane activo las transferencias quedan en STARTED.'
                : 'Hay dataplane registrado. Revisa token ArcGIS (caducidad) y conectividad saliente desde el contenedor hacia origen y destino.'
            });
            writeOut({ warning: 'Transfer stalled', transferId, elapsed, stateNow, errorDetail, dataplanesCount: dataplanes.length, dataplaneMetadata: dpMeta });
            break;
          }

          const waitMs = intervals[Math.min(step, intervals.length - 1)];
          await new Promise(res => setTimeout(res, waitMs));
          step++;

          const r = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}/state`, undefined, { silent: true });
          const stateRaw = r?.data?.state || r?.data?.['edc:state'] || '';
          const st = normalizeTransferState(stateRaw);

          await listTransfers();

          if (st === 'COMPLETED') {
            showInfoPopup('Transferencia completada ✅', {
              message: 'La transferencia finalizó con éxito. Revisa webhook.site (o tu destino) para ver los datos recibidos.',
              transferId
            });
            writeOut({ info: 'Transfer COMPLETED', transferId });
            break;
          }
          if (st === 'TERMINATED' || st === 'FAILED') {
            const err = r?.data?.errorDetail || r?.data?.['edc:errorDetail'] || 'Sin detalle de error.';
            showInfoPopup('Transferencia terminada con error ❌', {
              message: `La transferencia terminó en estado ${st}. Revisa el errorDetail.`,
              transferId,
              errorDetail: err,
              hint: 'Causas comunes: token de ArcGIS expirado, URL origen errónea, host destino inaccesible desde el contenedor Docker, o política rechazada.'
            });
            writeOut({ error: `Transfer ${st}`, transferId, errorDetail: err });
            break;
          }
        }
      } finally {
        _transferPollingActive.delete(transferId);
      }
    }

    window.retryTransferMonitor = (transferId) => {
      if (!transferId) return;
      const localTransfer = getLocalTransferRecords().find(t => (t['@id'] || t.id || '') === transferId);
      if (localTransfer) {
        window.checkTransfer(transferId);
        writeOut({ info: `Transferencia local ${transferId} registrada en historial.` });
        return;
      }
      pollTransferUntilDone(transferId, 120000);
      writeOut({ info: `Monitoreando transferencia ${transferId}...` });
    };

    async function checkDummy() {
      try {
        const res = await fetch(`${settings.dummyUrl}/v1/dummy-sink/records`);
        const data = await res.json();
        writeOut({ status: res.status, data });
      } catch (e) {
        writeOut({ step: 'Dummy inbox error', error: String(e), hint: `${settings.dummyUrl}/health` });
      }
    }

    async function clearDummy() {
      try {
        const res = await fetch(`${settings.dummyUrl}/v1/dummy-sink/records`, { method: 'DELETE' });
        const data = await res.json();
        writeOut({ status: res.status, data });
      } catch (e) {
        writeOut({ error: String(e) });
      }
    }

