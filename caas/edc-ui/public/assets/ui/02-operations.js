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

    async function callApi(method, path, body, options = {}) {
      const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : Number(settings.apiRetries || 0);
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : Number(settings.apiTimeoutMs || 15000);
      const silent = Boolean(options.silent);
      let attempt = 0;
      let lastError = null;

      while (attempt <= retries) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${getApiBaseUrl()}${path}`, {
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
          const text = await res.text();
          let data = text;
          try { data = JSON.parse(text); } catch {}
          const result = { status: res.status, data, attempt };
          if (res.status >= 500 && attempt < retries) {
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            continue;
          }
          return result;
        } catch (e) {
          clearTimeout(timeout);
          lastError = e;
          if (attempt < retries) {
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
      if (resolved === 'catalog') loadCatalogs(false);
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
      const accept = document.getElementById('catalogAcceptTerms');
      if (!sel) return;

      sel.innerHTML = '<option value="">Selecciona un data-offer</option>';
      state.catalogRows.forEach((r, idx) => {
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = `${clean(r.assetId)} · ${clean(r.offerId)} · ${r.assigner || '-'}`;
        sel.appendChild(o);
      });

      if (terms) terms.value = '';
      if (accept) accept.checked = false;
    }

    function syncCatalogSelectionState() {
      const sel = document.getElementById('catalogAssetId');
      const terms = document.getElementById('catalogPolicyTerms');
      const accept = document.getElementById('catalogAcceptTerms');
      if (!sel || !accept) return;

      const idx = Number(sel.value);
      const selected = Number.isInteger(idx) && idx >= 0 ? state.catalogRows[idx] : null;
      if (terms) terms.value = selected?.policySummary || '';

      // Explicit flow: contract is only requested when user clicks "Realizar contrato".
    }

    async function refreshOverview() {
      const [a, p, ags, tps] = await Promise.all([
        callApi('POST', '/v3/assets/request', q()),
        callApi('POST', '/v3/policydefinitions/request', q()),
        callApi('POST', '/v3/contractagreements/request', q()),
        callApi('POST', '/v3/transferprocesses/request', q()),
      ]);
      document.getElementById('kpiAssets').textContent = unwrap(a).length;
      document.getElementById('kpiPolicies').textContent = unwrap(p).length;
      document.getElementById('kpiContracts').textContent = unwrap(ags).length;
      document.getElementById('kpiTransfers').textContent = unwrap(tps).length;
    }

    function buildAuthHeaders(baseHeaders = {}) {
      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const authHeader = (document.getElementById('pubAuthHeader')?.value || 'Authorization').trim();
      const authPrefix = (document.getElementById('pubAuthPrefix')?.value || '').trim();
      const authToken = (document.getElementById('pubAuthToken')?.value || '').trim();
      const authSecret = (document.getElementById('pubAuthSecret')?.value || '').trim();
      const headers = { ...baseHeaders };

      // Keep headers JSON in sync with the form.
      syncAuthHeadersJson();

      if (authType === 'none') return headers;

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

    function syncAuthHeadersJson() {
      const headersEl = document.getElementById('assetHeadersJson');
      if (!headersEl) return;
      const headers = buildAuthHeaders({});
      try {
        headersEl.value = JSON.stringify(headers, null, 2);
      } catch {
        // ignore if JSON can't be stringified
      }
    }

    function applyAuthTypeForm() {
      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const clientFields = document.getElementById('pubAuthClientFields');
      const tokenRow = document.getElementById('pubAuthTokenRow');
      const headerRow = document.getElementById('pubAuthHeaderRow');
      const tokenLabel = document.getElementById('pubAuthTokenLabel');
      const headerInput = document.getElementById('pubAuthHeader');
      const prefixInput = document.getElementById('pubAuthPrefix');

      if (!clientFields || !tokenRow || !headerRow || !tokenLabel || !headerInput || !prefixInput) return;

      if (authType === 'none') {
        clientFields.style.display = 'none';
        tokenRow.style.display = 'none';
        headerRow.style.display = 'none';
      } else if (authType === 'oauth2') {
        clientFields.style.display = '';
        tokenRow.style.display = '';
        headerRow.style.display = '';
        tokenLabel.textContent = 'Token temporal';
        headerInput.placeholder = 'Authorization';
        prefixInput.placeholder = 'Bearer ';
      } else if (authType === 'apikey') {
        clientFields.style.display = 'none';
        tokenRow.style.display = '';
        headerRow.style.display = '';
        tokenLabel.textContent = 'API token';
        headerInput.placeholder = 'X-API-Key';
        prefixInput.placeholder = '';
      } else {
        clientFields.style.display = 'none';
        tokenRow.style.display = '';
        headerRow.style.display = '';
        tokenLabel.textContent = 'Token';
        headerInput.placeholder = 'Authorization';
        prefixInput.placeholder = 'Bearer ';
      }

      syncAuthHeadersJson();
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

      const tpl = document.getElementById('policyTemplate')?.value || 'gaiax-open';
      const participantId = (document.getElementById('policyParticipantId')?.value || '').trim();
      const purpose = (document.getElementById('policyPurpose')?.value || '').trim();
      const geography = (document.getElementById('policyGeography')?.value || '').trim();

      const constraints = [];
      if (tpl === 'gaiax-participant' || tpl === 'gaiax-participant-purpose') {
        constraints.push({ leftOperand: 'gx:participantId', operator: 'eq', rightOperand: participantId || 'did:web:participant.example' });
      }
      if (tpl === 'gaiax-purpose' || tpl === 'gaiax-participant-purpose') {
        constraints.push({ leftOperand: 'gx:purpose', operator: 'eq', rightOperand: purpose || 'analytics' });
      }
      if (geography) {
        constraints.push({ leftOperand: 'gx:location', operator: 'eq', rightOperand: geography });
      }

      return {
        '@context': 'http://www.w3.org/ns/odrl.jsonld',
        '@id': policyId,
        '@type': 'http://www.w3.org/ns/odrl/2/Set',
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
      return callApi('POST', '/v3/policydefinitions', JSON.stringify(body));
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
      return callApi('POST', '/v3/contractdefinitions', JSON.stringify({
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        '@id': contractDefId,
        '@type': 'ContractDefinition',
        accessPolicyId: policyId,
        contractPolicyId: policyId,
        assetsSelector: [[{ '@type': 'Criterion', operandLeft: 'https://w3id.org/edc/v0.0.1/ns/id', operator: '=', operandRight: assetId }]]
      }));
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

      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const authToken = (document.getElementById('pubAuthToken')?.value || '').trim();
      const authHeader = (document.getElementById('pubAuthHeader')?.value || '').trim();
      const authClientId = (document.getElementById('pubAuthClientId')?.value || '').trim();
      const authClientSecret = (document.getElementById('pubAuthClientSecret')?.value || '').trim();

      if (authType !== 'none') {
        if (!authHeader) {
          writeOut({ status: 400, error: 'El campo "Header auth" es obligatorio para el tipo de autenticación seleccionado.' });
          return { status: 400 };
        }
        if (!authToken) {
          writeOut({ status: 400, error: 'El token/api token es obligatorio para el tipo de autenticación seleccionado.' });
          return { status: 400 };
        }
        if (authType === 'oauth2' && (!authClientId || !authClientSecret)) {
          writeOut({ status: 400, error: 'clientId y clientSecret son obligatorios para OAuth2.' });
          return { status: 400 };
        }
      }

      let headers = {};
      try { headers = JSON.parse(document.getElementById('assetHeadersJson').value || '{}'); } catch { writeOut({ status: 400, error: 'Headers JSON inválido.' }); return { status: 400 }; }
      headers = buildAuthHeaders(headers);

      const body = {
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@id': id,
        '@type': 'Asset',
        properties: {
          name: document.getElementById('assetName').value.trim(),
          contenttype: 'application/json',
          'eitel:authType': document.getElementById('pubAuthType')?.value || 'none',
          'eitel:authSecret': document.getElementById('pubAuthSecret')?.value || '',
          'eitel:authClientId': document.getElementById('pubAuthClientId')?.value.trim() || '',
          'eitel:authClientSecret': document.getElementById('pubAuthClientSecret')?.value.trim() || '',
          'eitel:authToken': document.getElementById('pubAuthToken')?.value.trim() || ''
        },
        dataAddress: {
          '@type': 'DataAddress',
          type: 'HttpData',
          baseUrl: document.getElementById('assetBaseUrl').value.trim(),
          method: 'GET',
          path: document.getElementById('assetPath').value.trim(),
          headers
        }
      };
      return callApi('POST', '/v3/assets', JSON.stringify(body));
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

    function renderCatalogRows(targetId, rows, withUseButton = false) {
      const tbody = document.getElementById(targetId);
      if (!tbody) return;
      if (!rows.length) {
        const colspan = withUseButton ? 4 : 3;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="muted">No hay resultados.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r, i) => `
        <tr>
          <td class="title-cell" title="${r.offerId}">Oferta ${i + 1} · ${clean(r.offerId)}</td>
          <td class="title-cell" title="${r.assetId}">Asset · ${clean(r.assetId)}</td>
          <td>${r.assigner}</td>
          ${withUseButton ? `<td><button class="ghost" onclick="window.useCatalogAsset('${(r.assetId || '').replace(/'/g, "\\'")}')">Usar</button></td>` : `<td class="title-cell" title="${(r.policySummary || '').replace(/"/g, '&quot;')}">${r.policySummary || '-'}</td>`}
        </tr>
      `).join('');
    }

    async function loadCatalogs(showOutput = true) {
      const connectorId = (document.getElementById('searchConnectorId').value || 'provider').trim() || 'provider';
      const address = connectorId.startsWith('http://') || connectorId.startsWith('https://')
        ? connectorId
        : connectorId === 'provider'
        ? 'http://provider-connector:19103/api/v1/dsp/2025-1'
        : connectorId === 'consumer'
          ? 'http://consumer-connector:19203/api/v1/dsp/2025-1'
          : connectorId === 'conectoruc3m'
            ? PROD_DSP_URL
            : `http://${connectorId}-connector:19103/api/v1/dsp/2025-1`;
      document.getElementById('resolvedAddress').value = address;
      document.getElementById('transferAddress').value = address;

      const r = await callApi('POST', '/v3/catalog/request', JSON.stringify({
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'CatalogRequest',
        counterPartyId: connectorId.startsWith('http://') || connectorId.startsWith('https://') ? PROD_CONNECTOR_ID : connectorId,
        counterPartyAddress: address,
        protocol: 'dataspace-protocol-http:2025-1'
      }));

      const root = r?.data || {};
      const datasets = root?.['dcat:dataset'] || root?.dataset || [];
      const list = Array.isArray(datasets) ? datasets : [datasets];
      state.catalogRows = list.flatMap(d => {
        const policiesRaw = d?.['odrl:hasPolicy'] || d?.hasPolicy || [];
        const policies = Array.isArray(policiesRaw) ? policiesRaw : [policiesRaw];
        const datasetId = d?.['@id'] || d?.id || '';

        return policies.map(pol => {
          const permsRaw = pol?.['odrl:permission'] || pol?.permission || [];
          const perms = Array.isArray(permsRaw) ? permsRaw : [permsRaw];
          const target = perms.find(p => p?.['odrl:target'] || p?.target)?.['odrl:target'] || perms.find(p => p?.['odrl:target'] || p?.target)?.target || datasetId;
          return {
            offerId: pol?.['@id'] || pol?.id || '',
            assetId: target || datasetId,
            assigner: pol?.assigner || pol?.['odrl:assigner'] || connectorId,
            policySummary: summarizePolicyTerms(pol),
            policyRaw: pol,
          };
        });
      }).filter(x => x.offerId || x.assetId);

      renderCatalogRows('tblOffers', state.catalogRows, false);
      refreshCatalogAssetOptions();
      syncCatalogSelectionState();
      if (showOutput) writeOut(r);
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
      if (!state.catalogRows.length) await loadCatalogs(false);

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

      const policy = selected.policyRaw
        ? JSON.parse(JSON.stringify(selected.policyRaw))
        : {};

      policy['@context'] = 'http://www.w3.org/ns/odrl.jsonld';
      policy['@type'] = 'odrl:Offer';
      policy['@id'] = policy['@id'] || selected.offerId;
      policy.assigner = policy.assigner || policy['odrl:assigner'] || selected.assigner || 'provider';
      policy.target = policy.target || policy['odrl:target'] || selected.assetId;
      if (!Array.isArray(policy.permission)) policy.permission = policy.permission ? [policy.permission] : [];
      if (!Array.isArray(policy.prohibition)) policy.prohibition = policy.prohibition ? [policy.prohibition] : [];
      if (!Array.isArray(policy.obligation)) policy.obligation = policy.obligation ? [policy.obligation] : [];

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
      writeOut({ ...r, deduplicated });
      showInfoPopup('Contratos cargados', {
        total: state.agreementRows.length,
        deduplicated,
        preview: state.agreementRows.slice(0, 5)
      });
    }

    async function startTransfer() {
      const typedContractId = (document.getElementById('agreementId').value || '').trim();
      const selectedContractId = (document.getElementById('agreementSelect').value || '').trim();
      const contractId = (typedContractId || selectedContractId || '').trim();
      if (!contractId) { writeOut({ status: 400, error: 'Selecciona un contrato.' }); return; }

      // Validación fuerte: solo permitir contratos vigentes del conector
      const agreementsResp = await callApi('POST', '/v3/contractagreements/request', q());
      const validAgreementIds = new Set(
        unwrap(agreementsResp)
          .map(a => a['@id'] || a.id)
          .filter(Boolean)
      );

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

      const body = {
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'TransferRequest',
        protocol: 'dataspace-protocol-http:2025-1',
        counterPartyAddress: document.getElementById('transferAddress').value.trim(),
        contractId,
        transferType: 'HttpData-PUSH',
        dataDestination: {
          type: 'HttpData',
          baseUrl: document.getElementById('sinkBaseUrl').value.trim(),
          method: 'POST',
          path: '/'
        }
      };

      const r = await callApi('POST', '/v3/transferprocesses', JSON.stringify(body));
      writeOut(r);

      await listTransfers();
    }

    async function listTransfers() {
      const r = await callApi('POST', '/v3/transferprocesses/request', q());
      const rows = unwrap(r);
      const tbody = document.getElementById('tblTransfers');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No hay transferencias.</td></tr>';
      } else {
        tbody.innerHTML = rows.map((t, i) => {
          const id = t['@id'] || t.id || '';
          const st = t.state || t['edc:state'] || '-';
          const contract = t.contractId || t['edc:contractId'] || '';
          return `
            <tr>
              <td class="title-cell" title="${id}">Transferencia ${i + 1}</td>
              <td>${st}</td>
              <td class="title-cell" title="${contract}">${clean(contract)}</td>
              <td>
                <button class="ghost" onclick="window.showTransferDetail(${i})">Detalle</button>
                <button class="ghost" onclick="window.checkTransfer('${id.replace(/'/g, "\\'")}')">Ver estado</button>
              </td>
            </tr>
          `;
        }).join('');
      }
      state.transferRows = rows;
      writeOut(r);
    }

    async function checkTransfer(transferId) {
      const r = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}/state`);
      writeOut(r);
    }

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

