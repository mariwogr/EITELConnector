    function parseJsonSafe(text, fallback = null) {
      try { return JSON.parse(text); } catch { return fallback; }
    }

    function buildPolicyFromTemplate(assetId, policyId) {
      const mode = document.getElementById('policyMode')?.value || 'form';
      // Visibility/access level applies in both modes: the selector stays available in JSON-LD mode.
      const accessLevel = (document.getElementById('policyAccessLevel')?.value || 'public').trim();
      if (mode === 'jsonld') {
        const custom = parseJsonSafe(document.getElementById('policyCustomJson')?.value || '', null);
        if (!custom) throw new Error('Policy JSON-LD inválido');
        const policy = sanitizePolicyForStorage(custom, assetId, policyId);
        // Preserve the chosen availability even when the ODRL body is authored as raw JSON-LD.
        policy._meta = { accessLevel };
        return policy;
      }

      // Collect rich ODRL metadata (informational; stored in bundle backup but not sent to EDC).
      // The EDC runtime (dsp-tck-connector-under-test) has no custom PolicyScopeExtractor
      // registered, so any leftOperand or prohibition action outside the built-in set is rejected.
      const purpose = (document.getElementById('policyUsagePurpose')?.value || 'analytics').trim();
      const accessDuration = (document.getElementById('policyAccessDuration')?.value || 'always').trim();

      const prohibitionActionMap = {
        policyProhibNoCopy:         'http://www.w3.org/ns/odrl/2/distribute',
        policyProhibNoIdentify:     'https://w3id.org/eitel/ns/identifyThirdParties',
        policyProhibNoRedistribute: 'http://www.w3.org/ns/odrl/2/sell',
        policyProhibNoCombine:      'http://www.w3.org/ns/odrl/2/derive',
      };
      const prohibitionMeta = Object.entries(prohibitionActionMap)
        .filter(([id]) => document.getElementById(id)?.checked)
        .map(([, action]) => action);

      const obligationMeta = [];
      if (document.getElementById('policyObligCiteSource')?.checked)
        obligationMeta.push('http://www.w3.org/ns/odrl/2/attribute');
      if (document.getElementById('policyObligPermitAudit')?.checked)
        obligationMeta.push('http://www.w3.org/ns/odrl/2/inform');

      // Build minimal EDC-compatible policy: plain "use" permission, no custom constraints.
      // The EDC engine only enforces transfer authorization (use = allow); richer ODRL semantics
      // are stored in policyMeta within the asset bundle backup.
      const policy = sanitizePolicyForStorage({
        '@id': policyId,
        '@type': 'Set',
        permission: [{ action: 'use', target: assetId, constraint: [] }],
        prohibition: [],
        obligation: []
      }, assetId, policyId);

      // Attach metadata as a non-enumerable-but-accessible property (not sent to EDC via JSON.stringify).
      policy._meta = { accessLevel, purpose, accessDuration, prohibition: prohibitionMeta, obligation: obligationMeta };

      return policy;
    }

    /**
     * Creates or updates a policy definition in the connector.
     * Parses policy JSON from UI input and posts to Management API.
     * Handles validation and displays success/error messages.
     * 
     * @async
     * @returns {Promise<Object>} API response with creation status
     * 
     * @example
     * await createOrUpdatePolicy(); // Creates policy from UI input
     */
    async function createOrUpdatePolicy() {
      const policyId = (document.getElementById('policyIdPreview')?.value || document.getElementById('policyIdMirror')?.value || '').trim();
      const assetId = (document.getElementById('assetIdPreview')?.value || document.getElementById('policyAssetPreview')?.value || '').trim();
      if (!policyId || !assetId) { writeOut({ status: 400, error: 'Falta policyId o assetId.' }); return { status: 400 }; }
      let policy;
      try { policy = buildPolicyFromTemplate(assetId, policyId); } catch (e) { writeOut({ status: 400, error: String(e) }); return { status: 400 }; }

      const policyMeta = policy._meta;
      delete policy._meta;
      const body = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        '@id': policyId,
        '@type': 'PolicyDefinition',
        policy: Object.assign({ '@context': 'http://www.w3.org/ns/odrl.jsonld' }, policy),
        privateProperties: {
          'eitel:accessLevel':    policyMeta?.accessLevel    || '',
          'eitel:purpose':        policyMeta?.purpose        || '',
          'eitel:accessDuration': policyMeta?.accessDuration || 'always',
          'eitel:prohibition':    JSON.stringify(policyMeta?.prohibition  || []),
          'eitel:obligation':     JSON.stringify(policyMeta?.obligation   || []),
        }
      };
      let response = await callApi('POST', '/v3/policydefinitions', JSON.stringify(body));
      if (response.status === 409) {
        response = await callApi('PUT', `/v3/policydefinitions/${encodeURIComponent(policyId)}`, JSON.stringify(body));
      }
      if (response.status >= 200 && response.status < 300) {
        upsertAssetBundleBackup({ assetId, policyId, policyBody: body, policyMeta });
        const policyInfo = { assetId, policyId, status: response.status, accessLevel: policyMeta?.accessLevel || '' };
        showInfoPopup('Policy creada/actualizada', policyInfo, { html: renderPolicyCreatedCard(policyInfo) });
      } else {
        showInfoPopup('Error creando policy', response);
      }
      return response;
    }

    /**
     * Retrieves all policy definitions from the connector.
     * Fetches policy list from Management API and displays in UI.
     * 
     * @async
     * @returns {Promise<Object>} API response with policy list
     * 
     * @example
     * await listPolicies(); // Reload and display all policies
     */
    async function listPolicies() {
      const r = await callApi('POST', '/v3/policydefinitions/request', q());
      writeOut(r);
      return r;
    }

    /**
     * Deletes a policy definition from the connector.
     * Removes selected policy by ID from Management API.
     * Refreshes policy list after deletion.
     * 
     * @async
     * @returns {Promise<Object>} API response with deletion status
     * 
     * @example
     * await deletePolicy(); // Delete selected policy from UI
     */
    async function deletePolicy() {
      const policyId = (document.getElementById('policyIdPreview')?.value || document.getElementById('policyIdMirror')?.value || '').trim();
      if (!policyId) { writeOut({ status: 400, error: 'Policy ID requerido.' }); return; }
      writeOut(await callApi('DELETE', `/v3/policydefinitions/${encodeURIComponent(policyId)}`));
    }

    /**
     * Creates a new contract definition in the connector.
     * Generates contract definition linking asset and policy.
     * Posts definition to Management API for connector activation.
     * 
     * @async
     * @returns {Promise<Object>} API response with contract creation status
     * 
     * @example
     * await createContractDefinition(); // Create contract from UI selections
     */
    async function createContractDefinition() {
      const contractDefId = (document.getElementById('contractDefIdPreview')?.value || document.getElementById('contractDefIdMirror')?.value || '').trim();
      const assetId = (document.getElementById('assetIdPreview')?.value || document.getElementById('contractAssetPreview')?.value || '').trim();
      const policyId = (document.getElementById('policyIdPreview')?.value || document.getElementById('contractAccessPolicyId')?.value || document.getElementById('contractContractPolicyId')?.value || '').trim();
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
        assetsSelector: [{ '@type': 'Criterion', operandLeft: 'https://w3id.org/edc/v0.0.1/ns/id', operator: '=', operandRight: assetId }]
      };
      let response = await callApi('POST', '/v3/contractdefinitions', JSON.stringify(body));
      if (response.status === 409) {
        response = await callApi('PUT', `/v3/contractdefinitions/${encodeURIComponent(contractDefId)}`, JSON.stringify(body));
      }
      if (response.status >= 200 && response.status < 300) {
        upsertAssetBundleBackup({ assetId, contractDefId, contractBody: body, policyId });
        showInfoPopup('Contract Definition creada/actualizada', { assetId, contractDefId, policyId, status: response.status });
      } else {
        showInfoPopup('Error creando Contract Definition', response);
      }
      return response;
    }

    /**
     * Extracts the asset id targeted by a ContractDefinition assetsSelector.
     * Prefers the EDC `id` criterion; falls back to the first operandRight.
     *
     * @param {Array} assetsSelector - Array of ODRL Criterion objects.
     * @returns {string} The asset id, or '' when not resolvable.
     */
    function extractContractDefAssetId(assetsSelector) {
      if (!Array.isArray(assetsSelector)) return '';
      const idCriterion = assetsSelector.find((c) => {
        const left = String(c?.operandLeft || '');
        return left === 'id' || left.endsWith('/id') || left.endsWith('#id');
      });
      const chosen = idCriterion || assetsSelector[0];
      return String(chosen?.operandRight || '');
    }

    /**
     * Builds a friendly HTML summary of a ContractDefinitions list response.
     * Handles empty and error states.
     *
     * @param {Object} resp - API response ({ status, data: [...] }).
     * @returns {string} HTML markup for the results panel.
     */
    function buildContractDefinitionsHtml(resp) {
      const status = Number(resp?.status) || 0;
      if (status && (status < 200 || status >= 300)) {
        const detail = htmlEscape(String(resp?.data?.detail || resp?.data?.error || resp?.error || `HTTP ${status}`));
        return `<div class="cdef-empty cdef-error">No se pudieron cargar las ContractDefinitions (HTTP ${status}). ${detail}</div>`;
      }
      const list = unwrap(resp);
      if (!list.length) {
        return '<div class="cdef-empty">No hay ContractDefinitions publicadas en este conector.</div>';
      }
      const head = `<div class="cdef-head"><span class="cdef-count">${list.length} ContractDefinition${list.length === 1 ? '' : 's'}</span>${status ? `<span class="cdef-status">HTTP ${status}</span>` : ''}</div>`;
      const row = (key, value) => `<div class="cdef-row"><span class="cdef-key">${htmlEscape(key)}</span><span class="cdef-val">${value ? htmlEscape(value) : '<span class="cdef-muted">—</span>'}</span></div>`;
      const cards = list.map((item) => {
        const id = String(item?.['@id'] || item?.id || '—');
        const assetId = extractContractDefAssetId(item?.assetsSelector);
        const accessPolicy = String(item?.accessPolicyId || '');
        const contractPolicy = String(item?.contractPolicyId || '');
        const policyRows = accessPolicy && accessPolicy === contractPolicy
          ? row('Policy', accessPolicy)
          : row('Access policy', accessPolicy) + row('Contract policy', contractPolicy);
        return `
          <div class="cdef-card">
            <div class="cdef-card-head">
              <span class="cdef-card-id">${htmlEscape(id)}</span>
              <span class="cdef-card-badge">ContractDefinition</span>
            </div>
            <div class="cdef-rows">
              ${row('Asset', assetId)}
              ${policyRows}
            </div>
          </div>`;
      }).join('');
      return head + `<div class="cdef-grid">${cards}</div>`;
    }

    /**
     * Retrieves all contract definitions from the connector.
     * Writes the raw response to the console and renders a formatted
     * summary panel below the action buttons.
     *
     * @async
     * @returns {Promise<Object>} API response with contract list
     *
     * @example
     * await listContractDefinitions(); // Reload and display contracts
     */
    async function listContractDefinitions() {
      const r = await callApi('POST', '/v3/contractdefinitions/request', q());
      writeOut(r);
      const box = document.getElementById('contractDefsResult');
      if (box) {
        box.innerHTML = buildContractDefinitionsHtml(r);
        box.style.display = 'block';
      }
      return r;
    }

    /**
     * Deletes a contract definition from the connector.
     * Removes selected contract definition from Management API.
     * Refreshes contract list after deletion.
     * 
     * @async
     * @returns {Promise<Object>} API response with deletion status
     * 
     * @example
     * await deleteContractDefinition(); // Delete selected contract
     */
    async function deleteContractDefinition() {
      const id = (document.getElementById('contractDefIdPreview')?.value || document.getElementById('contractDefIdMirror')?.value || '').trim();
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

    /**
     * Creates or updates an asset in the connector.
     * Handles local file uploads, metadata input, and publishes asset to Management API.
     * Supports multiple source types and authentication methods.
     * Triggers asset backup and handles various error scenarios.
     * 
     * @async
     * @returns {Promise<Object>} API response with asset creation/update status
     * 
     * @example
     * await createOrUpdateAsset(); // Create/update asset from UI input
     */
    async function createOrUpdateAsset() {
      const id = document.getElementById('assetIdPreview').value;
      const assetName = (document.getElementById('assetName').value || '').trim();
      const assetDescription = (document.getElementById('assetDescription')?.value || '').trim();
      const assetKeywords = parseKeywordList(document.getElementById('assetKeywords')?.value || '');
      const ownerName = (document.getElementById('assetOwnerName')?.value || '').trim();
      const ownerEmail = (document.getElementById('assetOwnerEmail')?.value || '').trim().toLowerCase();
      const accessLevel = normalizeAccessLevel(document.getElementById('policyAccessLevel')?.value || 'public');
      const managedConnector = String(connectorName || '').trim();
      if (accessLevel === 'private' && !ownerEmail) {
        writeOut({ status: 400, error: 'Los assets privados necesitan Owner email para gestionar solicitudes de acceso.' });
        showInfoPopup('Falta email del owner', {
          assetId: id,
          visibility: accessLevel,
          message: 'Introduce Owner email antes de publicar un asset privado. Ese correo se usa para notificaciones SMTP y trazabilidad de permisos.',
        });
        return { status: 400 };
      }
      if (!managedConnector || managedConnector.toLowerCase() === 'connector') {
        writeOut({
          status: 400,
          error: 'No se ha podido resolver el conector local. Revisa config.js/NEXT_PUBLIC_CONNECTOR_NAME antes de publicar el asset.'
        });
        return { status: 400 };
      }
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
        if (authType === 'arcgis-login') {
          pushStarTrustEvent('ArcGIS listo para asset', `Se ha resuelto un token ArcGIS para publicar el asset ${clean(id || assetName || 'sin-id')}.`, 'ok');
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

      if (sourceMode === 'arcgis-feature-layer') {
        const arcgisLayerUrl = (document.getElementById('assetArcgisUrl')?.value || '').trim();
        const arcgisExportFmt = (document.getElementById('assetArcgisExportFormat')?.value || 'geojson').trim();
        if (!arcgisLayerUrl) {
          writeOut({ status: 400, error: 'Introduce la URL del FeatureLayer ArcGIS.' });
          return { status: 400 };
        }
        baseUrl = normalizeArcgisFeatureLayerBaseUrl(arcgisLayerUrl);
        path = buildArcgisFeatureLayerQueryPath(arcgisExportFmt);
        contentType = getArcgisExportContentType(arcgisExportFmt);
      }

      const normalizedUrlParts = normalizeHttpDataUrlParts(baseUrl, path);
      baseUrl = normalizedUrlParts.baseUrl;
      path = normalizedUrlParts.path;

      if (authType === 'arcgis-login') {
        headers = {
          token: authToken
        };
        if (sourceMode === 'arcgis-feature-layer') {
          // Do NOT use setQueryParams here — URLSearchParams.toString() encodes '='
          // in values (e.g. where=1=1 → where=1%3D1), which ArcGIS rejects.
          path = buildArcgisFeatureLayerQueryPath(document.getElementById('assetArcgisExportFormat')?.value || 'geojson', authToken);
        } else {
          path = buildArcgisPathWithToken(path, authToken);
        }
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
          'dct:accessRights': accessLevel,
          keywords: assetKeywords.join(', '),
          'eitel:managedByConnector': managedConnector,
          'eitel:visibility': accessLevel,
          'eitel:ownerName': ownerName,
          'eitel:ownerEmail': ownerEmail,
          image: assetImageUrl,
          contenttype: contentType,
          'eitel:authType': authType,
          'eitel:sourceMode': sourceMode,
          'eitel:localAssetPublicUrl': accessLevel === 'private' ? '' : (localUploadInfo?.publicUrl || ''),
          'eitel:localAssetFilename': localUploadInfo?.filename || '',
          'eitel:authSecret': document.getElementById('pubAuthSecret')?.value || '',
          'eitel:authClientId': document.getElementById('pubAuthClientId')?.value.trim() || '',
          'eitel:authClientSecret': document.getElementById('pubAuthClientSecret')?.value.trim() || '',
          'eitel:authToken': authType === 'arcgis-login' ? '' : (document.getElementById('pubAuthToken')?.value.trim() || ''),
          'eitel:authTokenSource': authType === 'arcgis-login' ? 'arcgis-login' : '',
          'eitel:arcgisExportFormat': sourceMode === 'arcgis-feature-layer' ? (document.getElementById('assetArcgisExportFormat')?.value || 'geojson') : ''
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
      let publishResp = await callApi('POST', '/v3/assets', JSON.stringify(body));
      if (publishResp.status === 409) {
        publishResp = await callApi('PUT', `/v3/assets/${encodeURIComponent(id)}`, JSON.stringify(body));
      }
      if (publishResp.status >= 200 && publishResp.status < 300) {
        upsertAssetBundleBackup({
          assetId: id,
          assetName,
          authType,
          sourceMode,
          assetBody: body,
        });
        const publishedInfo = {
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
        };
        showInfoPopup('Asset publicado', publishedInfo, { html: renderAssetPublishedCard(publishedInfo) });
        if (starTrustConfig.enabled) {
          pushStarTrustEvent(
            'Asset preparado en nodo Star',
            `Asset ${clean(id || assetName || 'sin-id')} publicado con origen ${sourceMode === 'local-file' ? 'local y soberano' : 'remoto'}${authType === 'arcgis-login' ? ' usando token ArcGIS' : ''}.`,
            'ok'
          );
        }
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

    /**
     * Deletes a published asset and cleans up associated local backups.
     * Removes asset from connector and deletes offline backup copy.
     * 
     * @async
     * @returns {Promise<Object>} API response with deletion status
     * 
     * @example
     * await deleteAssetAndCleanupBackup(); // Delete selected asset entirely
     */
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
      const localBackups = getAssetBundleBackups();
      const serverBackups = await listServerAssetBundleBackups();
      const merged = [...serverBackups, ...localBackups];
      const dedup = new Map();
      merged.forEach(row => {
        const id = String(row?.assetId || '').trim();
        if (!id) return;
        if (!dedup.has(id)) dedup.set(id, row);
      });
      const backups = [...dedup.values()];
      if (!backups.length) {
        const response = { status: 404, action: 'restore-from-backup', restored: 0, skipped: 0, message: 'No hay backups de assets ni en navegador ni en almacenamiento local persistente del conector.' };
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
          const sanitizedPolicyBody = {
            ...bundle.policyBody,
            policy: sanitizePolicyForStorage(bundle?.policyBody?.policy || bundle?.policyBody?.['edc:policy'] || {}, assetId, policyId)
          };
          const policyResp = await callApi('POST', '/v3/policydefinitions', JSON.stringify(sanitizedPolicyBody), { silent: true, retries: 0 });
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

    async function editPublishedAsset(assetId) {
      const id = String(assetId || '').trim();
      if (!id) return;
      const assetsResp = await callApi('POST', '/v3/assets/request', q(), { silent: true, retries: 0 });
      const assets = unwrap(assetsResp);
      const asset = assets.find(a => (a['@id'] || a.id || '') === id);
      if (!asset) {
        showInfoPopup('Asset no encontrado', { assetId: id });
        return;
      }
      const props = asset.properties || asset['edc:properties'] || {};
      const dataAddress = asset.dataAddress || asset['edc:dataAddress'] || {};
      const bundle = await getPublicationBundleByAssetId(id);
      const keyGuess = String(id || '').replace(/^asset-/, '');
      const setVal = (elId, value) => { const el = document.getElementById(elId); if (el) el.value = value; };
      setVal('assetKey', keyGuess);
      if (typeof updateAssetPreview === 'function') updateAssetPreview();
      setVal('assetName', firstNonEmpty([props?.name, props?.title, clean(id)]));
      setVal('assetDescription', firstNonEmpty([props?.description, props?.['eitel:description'], '']));
      setVal('assetKeywords', parseKeywordList(props?.keywords || '').join(', '));
      setVal('assetOwnerName', firstNonEmpty([props?.['eitel:ownerName'], '']));
      setVal('assetOwnerEmail', firstNonEmpty([props?.['eitel:ownerEmail'], '']));
      const accessLevel = resolvePublicationAccessLevel({ visibility: firstNonEmpty([props?.['eitel:visibility'], props?.['dct:accessRights'], 'public']) }, bundle);
      const policyAccessSelect = document.getElementById('policyAccessLevel');
      if (policyAccessSelect) policyAccessSelect.value = accessLevel;
      if (bundle?.policyId) {
        setVal('policyIdPreview', bundle.policyId);
        setVal('policyIdMirror', bundle.policyId);
        setVal('policyAssetPreview', id);
      }
      if (bundle?.contractDefId) {
        setVal('contractDefIdPreview', bundle.contractDefId);
        setVal('contractDefIdMirror', bundle.contractDefId);
        setVal('contractAssetPreview', id);
        setVal('contractAccessPolicyId', bundle.policyId || '');
        setVal('contractContractPolicyId', bundle.policyId || '');
      }
      setVal('assetBaseUrl', dataAddress?.baseUrl || '');
      setVal('assetPath', dataAddress?.path || '');
      activateView('asset');
      showInfoPopup('Asset cargado para edición', { assetId: id, note: 'Revisa y pulsa Crear/Actualizar asset para guardar cambios.' });
    }

    async function resolvePublishedPolicyForEdit(assetId, bundle = null) {
      const bundledPolicyId = String(bundle?.policyId || bundle?.policyBody?.['@id'] || '').trim();
      const bundledPolicy = bundle?.policyBody?.policy || bundle?.policyBody?.['edc:policy'] || null;
      if (bundledPolicyId && bundledPolicy) return { policyId: bundledPolicyId, policy: bundledPolicy };

      const policiesResp = await callApi('POST', '/v3/policydefinitions/request', q(), { silent: true, retries: 0 });
      const policies = unwrap(policiesResp);
      const policyId = bundledPolicyId || inferPublishedPolicyId(assetId, policies);
      const policyDefinition = policies.find(policy => getPolicyDefinitionId(policy) === policyId);
      const policy = policyDefinition?.policy || policyDefinition?.['edc:policy'] || null;
      return { policyId, policy, policyDefinition };
    }

    async function resolvePublishedContractForEdit(assetId, bundle = null) {
      const bundledContractDefId = String(bundle?.contractDefId || bundle?.contractBody?.['@id'] || '').trim();
      const bundledPolicyId = String(bundle?.policyId || bundle?.policyBody?.['@id'] || '').trim();
      const contractDefsResp = await callApi('POST', '/v3/contractdefinitions/request', q(), { silent: true, retries: 0 });
      const contractDefinitions = unwrap(contractDefsResp);
      const contractDefId = bundledContractDefId || inferPublishedContractDefId(assetId, contractDefinitions);
      const contractDefinition = contractDefinitions.find(contract => String(contract?.['@id'] || contract?.id || contract?.['edc:id'] || '').trim() === contractDefId) || bundle?.contractBody || null;
      const policyId = bundledPolicyId || String(
        contractDefinition?.accessPolicyId ||
        contractDefinition?.contractPolicyId ||
        contractDefinition?.['edc:accessPolicyId'] ||
        contractDefinition?.['edc:contractPolicyId'] ||
        ''
      ).trim();
      return { contractDefId, policyId, contractDefinition };
    }

    async function editPublishedPolicy(assetId) {
      const id = String(assetId || '').trim();
      if (!id) return;
      const bundle = await getPublicationBundleByAssetId(id);
      const { policyId, policy } = await resolvePublishedPolicyForEdit(id, bundle);
      if (!policyId || !policy) {
        showInfoPopup('Policy no encontrada', { assetId: id, message: 'No hay policy asociada guardada para esta publicación.' });
        return;
      }
      const setVal = (elId, value) => { const el = document.getElementById(elId); if (el) el.value = value; };
      setVal('assetIdPreview', id);
      setVal('policyIdPreview', policyId);
      setVal('policyIdMirror', policyId);
      setVal('policyAssetPreview', id);
      setVal('policyCustomJson', JSON.stringify(policy, null, 2));
      const policyMode = document.getElementById('policyMode');
      if (policyMode) policyMode.value = 'jsonld';
      if (typeof applyPolicyMode === 'function') applyPolicyMode();
      const policyAccessSelect = document.getElementById('policyAccessLevel');
      if (policyAccessSelect) policyAccessSelect.value = resolvePublicationAccessLevel({}, bundle);
      activateView('policy');
      showInfoPopup('Policy cargada para edición', { assetId: id, policyId, note: 'Se ha cargado en modo JSON-LD para editarla sin perder detalle.' });
    }

    async function editPublishedContract(assetId) {
      const id = String(assetId || '').trim();
      if (!id) return;
      const bundle = await getPublicationBundleByAssetId(id);
      const { contractDefId, policyId } = await resolvePublishedContractForEdit(id, bundle);
      if (!contractDefId) {
        showInfoPopup('ContractDefinition no encontrada', { assetId: id, message: 'No hay ContractDefinition asociada guardada para esta publicación.' });
        return;
      }
      const setVal = (elId, value) => { const el = document.getElementById(elId); if (el) el.value = value; };
      setVal('assetIdPreview', id);
      setVal('policyIdPreview', policyId);
      setVal('contractDefIdPreview', contractDefId);
      setVal('contractDefIdMirror', contractDefId);
      setVal('contractAssetPreview', id);
      setVal('contractAccessPolicyId', policyId);
      setVal('contractContractPolicyId', policyId);
      activateView('contractdef');
      showInfoPopup('ContractDefinition cargada', { assetId: id, contractDefId, policyId });
    }

    /**
     * Deletes a single published asset from the connector.
     * Removes asset by ID from Management API.
     * 
     * @async
     * @param {string} assetId - Asset ID to delete
     * @returns {Promise<Object>} API response with deletion status
     * 
     * @example
     * await deletePublishedAsset('asset-123'); // Delete specific asset
     */
    async function deletePublishedAsset(assetId) {
      const id = String(assetId || '').trim();
      if (!id) return;
      const r = await callApi('DELETE', `/v3/assets/${encodeURIComponent(id)}`);
      if (r.status >= 200 && r.status < 300) {
        removeAssetBundleBackup(id);
        showInfoPopup('Asset eliminado', { assetId: id, status: r.status });
      } else {
        showInfoPopup('Error eliminando asset', { assetId: id, response: r });
      }
      await loadPublishedAssets(false);
      await refreshOverview();
    }

    async function deletePublishedPolicy(assetId) {
      const id = String(assetId || '').trim();
      if (!id) return;
      const bundle = await getPublicationBundleByAssetId(id);
      const policyId = String(bundle?.policyId || bundle?.policyBody?.['@id'] || '').trim();
      if (!policyId) {
        showInfoPopup('Policy no encontrada', { assetId: id });
        return;
      }
      const response = await callApi('DELETE', `/v3/policydefinitions/${encodeURIComponent(policyId)}`);
      if (response.status >= 200 && response.status < 300) {
        upsertAssetBundleBackup({ assetId: id, policyId: '', policyBody: null });
        showInfoPopup('Policy eliminada', { assetId: id, policyId, status: response.status });
      } else {
        showInfoPopup('Error eliminando policy', { assetId: id, policyId, response });
      }
      await loadPublishedAssets(false);
      await refreshOverview();
    }

    async function deletePublishedContract(assetId) {
      const id = String(assetId || '').trim();
      if (!id) return;
      const bundle = await getPublicationBundleByAssetId(id);
      const contractDefId = String(bundle?.contractDefId || bundle?.contractBody?.['@id'] || '').trim();
      if (!contractDefId) {
        showInfoPopup('ContractDefinition no encontrada', { assetId: id });
        return;
      }
      const response = await callApi('DELETE', `/v3/contractdefinitions/${encodeURIComponent(contractDefId)}`);
      if (response.status >= 200 && response.status < 300) {
        upsertAssetBundleBackup({ assetId: id, contractDefId: '', contractBody: null });
        showInfoPopup('ContractDefinition eliminada', { assetId: id, contractDefId, status: response.status });
      } else {
        showInfoPopup('Error eliminando ContractDefinition', { assetId: id, contractDefId, response });
      }
      await loadPublishedAssets(false);
      await refreshOverview();
    }

    async function ensurePolicyAndContractDefinition() {
      const assetId = document.getElementById('assetIdPreview').value;
      const policyId = document.getElementById('policyIdPreview')?.value;
      const contractDefId = document.getElementById('contractDefIdPreview')?.value;
      if (!policyId || !contractDefId) return { skipped: true };

      const policyResult = await createOrUpdatePolicy();

      const contractDefs = unwrap(await callApi('POST', '/v3/contractdefinitions/request', q()));
      const duplicateById = contractDefs.find(c => (c['@id'] || c.id) === contractDefId);
      const duplicateByAsset = contractDefs.find(c => {
        const ac = getContractDefinitionAssetId(c);
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

