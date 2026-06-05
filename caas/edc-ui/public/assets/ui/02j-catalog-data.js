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
          const accessLevel = combineAccessLevels(meta.visibility, extractAccessLevelFromPolicy(pol));
          return {
            offerId: pol?.['@id'] || pol?.id || '',
            assetId: datasetId || target,
            policyTarget: target || '',
            assigner: pol?.assigner || pol?.['odrl:assigner'] || connectorId,
            connectorId,
            counterPartyAddress: address,
            accessLevel,
            ownerEmail: meta.ownerEmail || '',
            ownerName: meta.ownerName || '',
            policySummary: summarizePolicyTerms(pol),
            policyRaw: pol,
            sourceHintUrl,
            assetTitle: meta.title,
            assetDescription: meta.description,
            assetKeywords: meta.keywords,
            assetImageUrl: meta.imageUrl,
            catalogOfferResolved: Boolean(pol?.['@id'] || pol?.id),
            catalogOfferInferred: false,
            catalogOfferSource: 'dsp-catalog',
          };
        });
      }).filter(x => x.offerId || x.assetId);

      return rows;
    }

    function isCatalogRequestPath(path) {
      return ['/v3/catalog/request', '/v2/catalog/request', '/v2/catalog', '/v1/catalog/request', '/v1/catalog'].includes(String(path || ''));
    }

    async function callCatalogRequest(body, options = {}) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const endpoints = ['/v3/catalog/request', '/v2/catalog/request', '/v2/catalog', '/v1/catalog/request', '/v1/catalog'];
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 15000;
      const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 0;
      let lastResponse = null;

      for (const endpoint of endpoints) {
        const response = await callApi('POST', endpoint, payload, {
          timeoutMs,
          retries,
          silent: Boolean(options.silent),
          noAutoBaseFallback: options.noAutoBaseFallback !== false,
        });
        response.catalogEndpoint = endpoint;
        if (![404, 405].includes(Number(response?.status))) return response;
        lastResponse = response;
      }

      return lastResponse || { status: 0, catalogEndpoint: endpoints[0], error: 'No se pudo consultar el catálogo.' };
    }

    function buildManagementApiBaseUrlForConnector(connectorId) {
      const raw = String(connectorId || '').trim();
      const absolute = raw.startsWith('http://') || raw.startsWith('https://');
      if (absolute) {
        try {
          const url = new URL(raw);
          if (/\/api\/management\/?$/i.test(url.pathname)) return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
          const prefix = (url.pathname || '/').split('/').filter(Boolean)[0] || '';
          if (prefix) return `${url.origin}/${prefix}/api/management`;
          return `${url.origin}/api/management`;
        } catch {}
      }

      const configuredDsp = resolveConfiguredDspUrl(raw);
      if (configuredDsp) {
        try {
          const url = new URL(configuredDsp, window.location.origin);
          const prefix = (url.pathname || '/').split('/').filter(Boolean)[0] || canonicalConnectorPrefix(raw);
          return `${url.origin}/${prefix}/api/management`;
        } catch {}
      }

      const prefix = canonicalConnectorPrefix(raw || getDefaultRemoteConnector());
      return `${getPublicConnectorOrigin()}/${prefix}/api/management`;
    }

    function getManagementApiBaseCandidatesForConnector(connectorId) {
      const primary = buildManagementApiBaseUrlForConnector(connectorId);
      const candidates = [primary];
      if (primary.includes('/conectorFuenlabrada/')) candidates.push(primary.replace('/conectorFuenlabrada/', '/conectorfuenlabrada/'));
      if (primary.includes('/conectorfuenlabrada/')) candidates.push(primary.replace('/conectorfuenlabrada/', '/conectorFuenlabrada/'));
      return [...new Set(candidates)].filter(Boolean);
    }

    async function callConnectorManagementApi(connectorId, method, path, body, options = {}) {
      const bases = getManagementApiBaseCandidatesForConnector(connectorId);
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 10000;
      let last = null;
      for (const base of bases) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${base}${path}`, {
            method,
            headers: {
              'x-api-key': getApiKey(),
              'content-type': 'application/json',
              ...(options.headers || {}),
            },
            body: method === 'GET' || method === 'DELETE' ? undefined : body,
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          });
          const text = await res.text();
          let data = text;
          try { data = JSON.parse(text); } catch {}
          const response = { status: res.status, data, managementApiBase: base };
          if (res.status >= 200 && res.status < 300) return response;
          last = response;
        } catch (error) {
          last = { status: 0, error: String(error), managementApiBase: base };
        } finally {
          clearTimeout(timeout);
        }
      }
      return last || { status: 0, error: 'No se pudo llamar al Management API del conector.' };
    }

    async function fetchAccessRequestsForProviderAddress(address, options = {}) {
      const providerBase = deriveProviderLocalAssetsUrl(address);
      if (!providerBase) return [];
      const requesterConnectorId = canonicalConnectorPrefix(options.requesterConnectorId || getCurrentConnectorId());
      const requesterEmail = String(options.requesterEmail || getCatalogRequesterEmail() || '').trim();
      if (!requesterConnectorId && !requesterEmail) return [];
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 5000;
      const variants = [];
      if (requesterConnectorId) variants.push({ requesterConnectorId });
      if (requesterEmail) variants.push({ requesterEmail });
      const merged = new Map();

      for (const variant of variants) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const params = new URLSearchParams();
        if (variant.requesterConnectorId) params.set('requesterConnectorId', variant.requesterConnectorId);
        if (variant.requesterEmail) params.set('requesterEmail', variant.requesterEmail);
        try {
          const url = `${providerBase}/access-requests${params.toString() ? `?${params.toString()}` : ''}`;
          const res = await fetch(url, {
            method: 'GET',
            headers: getLocalAssetsAuthHeaders({ 'accept': 'application/json' }),
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!res.ok) continue;
          const data = await res.json();
          (Array.isArray(data?.items) ? data.items : []).forEach((item) => {
            const key = String(item?.requestId || `${item?.assetId || ''}:${item?.requesterConnectorId || ''}:${item?.requesterEmail || ''}`);
            if (key) merged.set(key, item);
          });
        } catch {
          // Keep the catalog usable even if one compatibility lookup fails.
        } finally {
          clearTimeout(timeout);
        }
      }
      return [...merged.values()];
    }

    function normalizeProviderAssetBundleMetadata(row = {}) {
      const assetBody = row?.assetBody || {};
      const props = assetBody?.properties || assetBody?.['edc:properties'] || {};
      const assetId = String(row?.assetId || assetBody?.['@id'] || assetBody?.id || '').trim();
      const keywords = [
        ...parseKeywordList(row?.keywords),
        ...parseKeywordList(props?.['dcat:keyword']),
        ...parseKeywordList(props?.['eitel:keywords']),
        ...parseKeywordList(props?.keywords),
      ];
      return {
        assetId,
        title: firstNonEmpty([row?.assetName, row?.title, props?.name, props?.title, props?.['dct:title'], assetId]),
        description: firstNonEmpty([row?.description, props?.description, props?.['eitel:description'], props?.['dct:description']]),
        imageUrl: firstNonEmpty([row?.imageUrl, props?.image, props?.['eitel:image'], props?.['schema:image']]),
        accessLevel: resolvePublicationAccessLevel({ visibility: row?.visibility }, row),
        ownerEmail: firstNonEmpty([row?.ownerEmail, props?.['eitel:ownerEmail']]),
        ownerName: firstNonEmpty([row?.ownerName, props?.['eitel:ownerName']]),
        policyId: String(row?.policyId || row?.policyBody?.['@id'] || '').trim(),
        contractDefId: String(row?.contractDefId || row?.contractBody?.['@id'] || '').trim(),
        updatedAt: String(row?.updatedAt || '').trim(),
        keywords: [...new Set(keywords)],
      };
    }

    async function fetchProviderAssetBundleMetadata(address, options = {}) {
      const providerBase = deriveProviderLocalAssetsUrl(address);
      if (!providerBase) return [];
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 5000;
      const paths = ['/asset-bundles/public', '/asset-bundles'];

      for (const path of paths) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${providerBase}${path}`, {
            method: 'GET',
            headers: getLocalAssetsAuthHeaders({ accept: 'application/json' }),
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          });
          const text = await res.text();
          let data = text;
          try { data = JSON.parse(text); } catch {}
          if (!res.ok) continue;
          const rows = Array.isArray(data?.items) ? data.items : [];
          return rows
            .map(normalizeProviderAssetBundleMetadata)
            .filter(row => row.assetId);
        } catch {
          // Try the next compatible endpoint.
        } finally {
          clearTimeout(timeout);
        }
      }

      return [];
    }

    function mapProviderAssetBundleMetadataToCatalogRows(bundleRows = [], connectorId = '', address = '') {
      const counterPartyAddress = ensureDspVersion(address || buildDspUrl(connectorId));
      return (Array.isArray(bundleRows) ? bundleRows : []).map(row => ({
        offerId: '',
        assetId: row.assetId || '',
        policyTarget: row.assetId || '',
        assigner: connectorId,
        connectorId,
        counterPartyAddress,
        accessLevel: row.accessLevel || 'public',
        ownerEmail: row.ownerEmail || '',
        ownerName: row.ownerName || '',
        policySummary: 'Asset publicado por el conector. Puedes solicitar acceso al propietario.',
        policyRaw: null,
        sourceHintUrl: '',
        assetTitle: row.title,
        assetDescription: row.description,
        assetKeywords: row.keywords,
        assetImageUrl: row.imageUrl,
        catalogOfferResolved: false,
        catalogOfferInferred: false,
        catalogOfferSource: 'provider-local-assets-metadata',
      })).filter(row => row.assetId);
    }

    async function validatePrivateAgreementTransferAccess(assetId, transferParty = {}) {
      const targetAssetId = String(assetId || '').trim();
      if (!targetAssetId) return { allowed: true, known: false };

      const providerId = String(transferParty?.counterPartyId || transferParty?.providerRaw || '').trim();
      if (providerId && sameConnectorId(providerId, getCurrentConnectorId())) return { allowed: true, known: true, own: true };

      const providerAddress = String(transferParty?.address || document.getElementById('transferAddress')?.value || '').trim();
      const cachedRow = (state.catalogRows || []).find(row => {
        const rowAssetId = String(row?.assetId || row?.policyTarget || '').trim();
        if (rowAssetId !== targetAssetId) return false;
        const rowProvider = String(row?.connectorId || row?.assigner || '').trim();
        const rowAddress = String(row?.counterPartyAddress || '').trim();
        return (providerId && sameConnectorId(rowProvider, providerId)) || (providerAddress && rowAddress === providerAddress) || (!providerId && !providerAddress);
      });
      if (cachedRow) {
        const stateName = getCatalogRowState(cachedRow);
        const restricted = isRestrictedAccessLevel(cachedRow.accessLevel || 'public');
        return {
          allowed: !restricted || stateName === 'approved',
          known: true,
          assetId: targetAssetId,
          accessLevel: cachedRow.accessLevel || 'public',
          accessStatus: cachedRow.accessRequestStatus || '',
          stateName,
          source: 'catalog-cache',
        };
      }

      if (!providerAddress) return { allowed: true, known: false };
      const bundleRows = await fetchProviderAssetBundleMetadata(providerAddress, { timeoutMs: 5000 });
      const bundle = bundleRows.find(row => String(row?.assetId || '').trim() === targetAssetId);
      if (!bundle || !isRestrictedAccessLevel(bundle.accessLevel || 'public')) {
        return {
          allowed: true,
          known: Boolean(bundle),
          assetId: targetAssetId,
          accessLevel: bundle?.accessLevel || 'public',
          source: bundle ? 'provider-local-assets' : 'unknown',
        };
      }

      const requests = await fetchAccessRequestsForProviderAddress(providerAddress, { timeoutMs: 5000 });
      const approved = requests.find(req =>
        String(req?.assetId || '').trim() === targetAssetId
        && String(req?.status || '').trim().toLowerCase() === 'approved'
      );
      const pending = requests.find(req =>
        String(req?.assetId || '').trim() === targetAssetId
        && String(req?.status || '').trim().toLowerCase() === 'pending'
      );
      return {
        allowed: Boolean(approved),
        known: true,
        assetId: targetAssetId,
        accessLevel: bundle.accessLevel || 'private',
        accessStatus: approved ? 'approved' : (pending ? 'pending' : 'none'),
        source: 'provider-local-assets',
      };
    }

    async function logTransferEvent(event = {}, providerAddress = '') {
      const payload = {
        role: event.role || 'consumer',
        eventType: event.eventType || 'transfer',
        status: event.status || '',
        transferMode: event.transferMode || getSelectedTransferMode(),
        transferType: event.transferType || '',
        transferId: event.transferId || '',
        contractId: event.contractId || '',
        assetId: event.assetId || '',
        counterPartyId: event.counterPartyId || '',
        counterPartyAddress: event.counterPartyAddress || providerAddress || '',
        destination: event.destination || '',
        bytes: Number.isFinite(Number(event.bytes)) ? Number(event.bytes) : undefined,
        filename: event.filename || '',
        detail: event.detail || '',
      };
      const calls = [
        callLocalAssetsApi('POST', '/transfer-events', {
          body: JSON.stringify({ ...payload, role: payload.role || 'consumer' }),
          headers: { 'content-type': 'application/json' },
        }).catch(() => null)
      ];
      const providerBase = deriveProviderLocalAssetsUrl(providerAddress || payload.counterPartyAddress || '');
      if (providerBase) {
        calls.push(fetch(`${providerBase}/transfer-events`, {
          method: 'POST',
          headers: getLocalAssetsAuthHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ ...payload, role: 'provider' }),
          credentials: 'include',
          cache: 'no-store',
        }).catch(() => null));
      }
      await Promise.allSettled(calls);
    }

    async function fetchTransferEventRows() {
      const response = await callLocalAssetsApi('GET', '/transfer-events');
      const items = response?.data?.items || [];
      return Array.isArray(items) ? items : [];
    }

    async function findNewAgreement(beforeAgreementIds = new Set()) {
      const agreementsResp = await callApi('POST', '/v3/contractagreements/request', q(), { silent: true, retries: 0 });
      const agreements = unwrap(agreementsResp);
      return agreements.find(a => {
        const id = a['@id'] || a.id;
        return id && !beforeAgreementIds.has(id);
      }) || null;
    }

    async function getNegotiationSnapshot(negotiationId) {
      if (!negotiationId || negotiationId === '-') return { state: '-', detail: null };
      const stateResp = await callApi('GET', `/v3/contractnegotiations/${encodeURIComponent(negotiationId)}/state`, undefined, { silent: true, retries: 0 });
      const detailResp = await callApi('GET', `/v3/contractnegotiations/${encodeURIComponent(negotiationId)}`, undefined, { silent: true, retries: 0 });
      const state = stateResp?.data?.state || stateResp?.data?.['edc:state'] || detailResp?.data?.state || detailResp?.data?.['edc:state'] || '-';
      const errorDetail = detailResp?.data?.errorDetail || detailResp?.data?.['edc:errorDetail'] || detailResp?.data?.error || '';
      return { state: normalizeTransferState(state), detail: detailResp?.data || null, status: detailResp?.status || stateResp?.status || 0, errorDetail };
    }

    async function waitForNegotiationAgreement(negotiationId, beforeAgreementIds, selected, options = {}) {
      const maxAttempts = Number(options.maxAttempts || 24);
      const delayMs = Number(options.delayMs || 2500);
      let lastSnapshot = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const agreement = await findNewAgreement(beforeAgreementIds);
        if (agreement) return { agreement, attempts: attempt, snapshot: lastSnapshot };
        lastSnapshot = await getNegotiationSnapshot(negotiationId);
        writeOut({
          status: 102,
          action: 'contract-negotiation-monitor',
          attempt,
          maxAttempts,
          negotiationId,
          state: lastSnapshot.state,
          assetId: selected?.assetId || '',
          hint: 'La negociación está arrancada, pero aún no hay ContractAgreement visible.',
        });
        const terminal = ['TERMINATED', 'ERROR', 'FAILED'].includes(String(lastSnapshot.state || '').toUpperCase());
        if (terminal) return { agreement: null, attempts: attempt, snapshot: lastSnapshot };
      }
      return { agreement: null, attempts: maxAttempts, snapshot: lastSnapshot };
    }

    function enrichCatalogRowsWithAccessRequests(rows, requests = []) {
      if (!Array.isArray(rows) || !rows.length || !Array.isArray(requests) || !requests.length) return rows;
      const byAsset = new Map();
      requests.forEach(req => {
        const assetId = String(req?.assetId || '').trim();
        if (!assetId) return;
        const current = byAsset.get(assetId);
        const status = String(req?.status || '').trim().toLowerCase();
        const rank = status === 'approved' ? 4 : status === 'pending' ? 3 : status === 'rejected' ? 2 : status === 'withdrawn' ? 1 : status === 'revoked' ? 1 : 0;
        const currentStatus = String(current?.status || '').trim().toLowerCase();
        const currentRank = currentStatus === 'approved' ? 4 : currentStatus === 'pending' ? 3 : currentStatus === 'rejected' ? 2 : currentStatus === 'withdrawn' ? 1 : currentStatus === 'revoked' ? 1 : 0;
        const updatedAt = Date.parse(req?.updatedAt || req?.decisionAt || req?.createdAt || '') || 0;
        const currentUpdatedAt = Date.parse(current?.updatedAt || current?.decisionAt || current?.createdAt || '') || 0;
        if (!current || updatedAt > currentUpdatedAt || (updatedAt === currentUpdatedAt && rank >= currentRank)) byAsset.set(assetId, req);
      });

      return rows.map(row => {
        const req = byAsset.get(String(row?.assetId || '').trim());
        if (!req) return row;
        return {
          ...row,
          accessRequestId: req.requestId || '',
          accessRequestStatus: String(req.status || '').trim().toLowerCase(),
          accessRequest: req,
        };
      });
    }

    function mergeProviderAssetBundleMetadataIntoCatalogRows(rows = [], bundleRows = []) {
      if (!Array.isArray(rows) || !rows.length || !Array.isArray(bundleRows) || !bundleRows.length) return rows;
      const byAsset = new Map();
      bundleRows.forEach(bundle => {
        const assetId = String(bundle?.assetId || '').trim();
        if (!assetId) return;
        const current = byAsset.get(assetId);
        const currentUpdatedAt = Date.parse(current?.updatedAt || '') || 0;
        const nextUpdatedAt = Date.parse(bundle?.updatedAt || '') || 0;
        if (!current || nextUpdatedAt >= currentUpdatedAt) byAsset.set(assetId, bundle);
      });

      return rows.map(row => {
        const bundle = byAsset.get(String(row?.assetId || '').trim());
        if (!bundle) return row;
        return {
          ...row,
          accessLevel: combineAccessLevels(row.accessLevel, bundle.accessLevel),
          ownerEmail: row.ownerEmail || bundle.ownerEmail || '',
          ownerName: row.ownerName || bundle.ownerName || '',
          assetTitle: row.assetTitle || bundle.title || '',
          assetDescription: row.assetDescription || bundle.description || '',
          assetKeywords: (row.assetKeywords && row.assetKeywords.length) ? row.assetKeywords : bundle.keywords,
          assetImageUrl: row.assetImageUrl || bundle.imageUrl || '',
          providerMetadataSource: 'local-assets',
        };
      });
    }

    function mergeCatalogOffersIntoAssetRows(assetRows = [], offerRows = []) {
      if (!Array.isArray(assetRows) || !assetRows.length || !Array.isArray(offerRows) || !offerRows.length) return assetRows;
      const byAsset = new Map();
      offerRows.forEach(row => {
        const assetId = String(row?.assetId || row?.policyTarget || '').trim();
        if (!assetId) return;
        const current = byAsset.get(assetId);
        if (!current || (!current.offerId && row.offerId)) byAsset.set(assetId, row);
      });

      return assetRows.map(assetRow => {
        const offerRow = byAsset.get(String(assetRow?.assetId || '').trim());
        if (!offerRow) return assetRow;
        return {
          ...assetRow,
          offerId: offerRow.offerId || assetRow.offerId || '',
          policyTarget: offerRow.policyTarget || assetRow.policyTarget || '',
          assigner: offerRow.assigner || assetRow.assigner || '',
          accessLevel: combineAccessLevels(assetRow.accessLevel, offerRow.accessLevel),
          ownerEmail: assetRow.ownerEmail || offerRow.ownerEmail || '',
          ownerName: assetRow.ownerName || offerRow.ownerName || '',
          policySummary: offerRow.policySummary || assetRow.policySummary || '',
          policyRaw: offerRow.policyRaw || assetRow.policyRaw || null,
          sourceHintUrl: offerRow.sourceHintUrl || assetRow.sourceHintUrl || '',
          assetTitle: offerRow.assetTitle || assetRow.assetTitle || '',
          assetDescription: offerRow.assetDescription || assetRow.assetDescription || '',
          assetKeywords: (offerRow.assetKeywords && offerRow.assetKeywords.length) ? offerRow.assetKeywords : assetRow.assetKeywords,
          assetImageUrl: offerRow.assetImageUrl || assetRow.assetImageUrl || '',
          catalogOfferResolved: Boolean(offerRow.offerId),
        };
      });
    }

    async function fetchRemoteCatalogOffers(connectorId, address, options = {}) {
      const candidates = getEdcDspAddressCandidates(connectorId, address);
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 15000;
      const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 0;
      let best = null;

      for (const candidateAddress of candidates) {
        const counterPartyId = resolveCounterPartyId(connectorId, candidateAddress);
        const response = await callCatalogRequest({
          '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
          '@type': 'CatalogRequest',
          counterPartyId,
          counterPartyAddress: candidateAddress,
          protocol: 'dataspace-protocol-http:2025-1'
        }, { timeoutMs, retries, silent: Boolean(options.silent) });
        response.triedCounterPartyAddress = candidateAddress;
        response.triedCounterPartyAddresses = candidates;
        const rows = response?.status >= 200 && response?.status < 300
          ? mapCatalogRowsFromResponse(response?.data || {}, connectorId, candidateAddress)
          : [];
        const result = { response, rows, address: candidateAddress };
        if (response?.status >= 200 && response?.status < 300 && rows.length) return result;
        if (response?.status >= 200 && response?.status < 300 && !best) best = result;
        if (!best || Number(response?.status || 0) < Number(best.response?.status || 999)) best = result;
      }

      return best || { response: { status: 0, error: 'No se pudo consultar el catalogo DSP.', triedCounterPartyAddresses: candidates }, rows: [], address: candidates[0] || address };
    }

    async function fetchRemoteCatalogRowsFromManagement(connectorId, address, options = {}) {
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 10000;
      const [assetsResp, contractsResp, policiesResp] = await Promise.all([
        callConnectorManagementApi(connectorId, 'POST', '/v3/assets/request', q(), { timeoutMs, silent: true }),
        callConnectorManagementApi(connectorId, 'POST', '/v3/contractdefinitions/request', q(), { timeoutMs, silent: true }),
        callConnectorManagementApi(connectorId, 'POST', '/v3/policydefinitions/request', q(), { timeoutMs, silent: true }),
      ]);

      const assets = mapPublishedAssetRows(unwrap(assetsResp));
      const contractDefinitions = unwrap(contractsResp);
      const policyDefinitions = unwrap(policiesResp);
      const policyMap = new Map(policyDefinitions.map(policyDef => [String(policyDef?.['@id'] || policyDef?.id || '').trim(), policyDef]));
      const contractByAssetId = new Map(contractDefinitions.map(contractDef => [String(getContractDefinitionAssetId(contractDef) || '').trim(), contractDef]));
      const counterPartyAddress = ensureDspVersion(address || buildDspUrl(connectorId));

      const rows = assets.map((asset) => {
        const assetId = String(asset?.id || '').trim();
        const contractDef = contractByAssetId.get(assetId);
        const policyId = String(
          contractDef?.contractPolicyId ||
          contractDef?.['edc:contractPolicyId'] ||
          contractDef?.accessPolicyId ||
          contractDef?.['edc:accessPolicyId'] ||
          ''
        ).trim();
        const policyDefinition = policyId ? policyMap.get(policyId) : null;
        const policyRaw = policyDefinition?.policy || policyDefinition?.['edc:policy'] || null;

        // accessLevel: asset.visibility is the ground truth (set at publish time by the publisher).
        // extractAccessLevelFromPolicy is a secondary signal — if the ODRL policy has no
        // dct:accessRights constraint it falls back to 'public', so we must check the asset property
        // first to avoid treating a privately-published asset as public.
        const rowAccessLevel = combineAccessLevels(asset.visibility, policyRaw ? extractAccessLevelFromPolicy(policyRaw) : '');

        return {
          offerId: '',
          assetId,
          policyTarget: assetId,
          assigner: connectorId,
          connectorId,
          counterPartyAddress,
          accessLevel: rowAccessLevel,
          ownerEmail: asset.ownerEmail || '',
          ownerName: asset.ownerName || '',
          policySummary: policyRaw ? summarizePolicyTerms(policyRaw) : 'Asset visible en el catalogo, pendiente de oferta contractual o acceso.',
          policyRaw: null,
          managementOfferId: String(policyRaw?.['@id'] || policyRaw?.id || policyId || '').trim(),
          managementPolicyRaw: policyRaw,
          managementContractDefinitionId: String(contractDef?.['@id'] || contractDef?.id || '').trim(),
          managementPublishedOfferAvailable: Boolean(contractDef && policyId && policyRaw),
          sourceHintUrl: '',
          assetTitle: asset.title,
          assetDescription: asset.description,
          assetKeywords: asset.keywords,
          assetImageUrl: asset.imageUrl,
          catalogOfferResolved: false,
          catalogOfferInferred: false,
          catalogOfferSource: 'provider-management-assets',
        };
      }).filter(Boolean);

      const status = [assetsResp?.status, contractsResp?.status, policiesResp?.status].every(code => Number(code) >= 200 && Number(code) < 300) ? 200 : (contractsResp?.status || policiesResp?.status || assetsResp?.status || 0);
      return {
        response: {
          status,
          catalogEndpoint: 'provider-management-fallback',
          managementApiBase: contractsResp?.managementApiBase || policiesResp?.managementApiBase || assetsResp?.managementApiBase || '',
          assets: assets.length,
          contractDefinitions: contractDefinitions.length,
          policies: policyDefinitions.length,
          catalogOffers: rows.length,
        },
        rows,
        address: counterPartyAddress,
      };
    }

    // EDC ContractOfferId wire format: Base64(contractDefinitionId):Base64(assetId):Base64(uuid)
    // ContractOfferId.parseId() splits by ':' and base64-decodes each part.
    // Sending plain-text ids (e.g. "def:asset") will be rejected because parseId requires exactly 3 parts.
    function makeEdcOfferId(contractDefinitionId, assetId) {
      const uuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      // btoa encodes to standard base64 (same as Java Base64.getEncoder().encodeToString)
      const b64 = (s) => btoa(unescape(encodeURIComponent(String(s || ''))));
      return `${b64(contractDefinitionId)}:${b64(assetId)}:${b64(uuid)}`;
    }

    async function resolveCatalogOfferFromRemoteManagement(row) {
      const connectorId = row?.connectorId || row?.assigner || getDefaultRemoteConnector();
      const assetId = String(row?.assetId || row?.policyTarget || '').trim();
      if (!connectorId || !assetId) return null;

      const [contractsResp, policiesResp] = await Promise.all([
        callConnectorManagementApi(connectorId, 'POST', '/v3/contractdefinitions/request', q(), { silent: true }),
        callConnectorManagementApi(connectorId, 'POST', '/v3/policydefinitions/request', q(), { silent: true }),
      ]);
      const contractDefinitions = unwrap(contractsResp);
      const policyDefinitions = unwrap(policiesResp);
      const contractDefinition = contractDefinitions.find(contractDef => getContractDefinitionAssetId(contractDef) === assetId);
      if (!contractDefinition) {
        return {
          resolved: false,
          response: {
            status: contractsResp?.status || 0,
            managementApiBase: contractsResp?.managementApiBase || '',
            reason: 'No existe ContractDefinition para este asset en el proveedor.',
            contractDefinitions: contractDefinitions.length,
          },
        };
      }

      const policyId = String(
        contractDefinition.contractPolicyId ||
        contractDefinition['edc:contractPolicyId'] ||
        contractDefinition.accessPolicyId ||
        contractDefinition['edc:accessPolicyId'] ||
        ''
      ).trim();
      const policyDefinition = policyDefinitions.find(policyDef => String(policyDef?.['@id'] || policyDef?.id || '').trim() === policyId);
      const policyRaw = policyDefinition?.policy || policyDefinition?.['edc:policy'] || null;
      if (!policyId || !policyRaw) {
        return {
          resolved: false,
          response: {
            status: policiesResp?.status || 0,
            managementApiBase: policiesResp?.managementApiBase || '',
            reason: 'Existe ContractDefinition, pero no se ha encontrado su PolicyDefinition asociada.',
            contractDefinitionId: contractDefinition?.['@id'] || contractDefinition?.id || '',
            policyId,
          },
        };
      }

      // EDC ContractOfferId format: Base64(contractDefinitionId):Base64(assetId):Base64(UUID)
      // parseId() splits by ':' and base64-decodes each of the 3 parts; plain-text or 2-part IDs are rejected.
      const contractDefinitionId = String(contractDefinition?.['@id'] || contractDefinition?.id || '').trim();
      const compositeOfferId = (contractDefinitionId && assetId)
        ? makeEdcOfferId(contractDefinitionId, assetId)
        : policyId;
      // Override policyRaw['@id'] so that requestContractByAsset uses the composite offer ID
      // (policy['@id'] = policy['@id'] || selected.offerId — if policyRaw['@id'] is wrong, offerId is ignored)
      const correctedPolicyRaw = { ...policyRaw, '@id': compositeOfferId };

      const counterPartyAddress = ensureDspVersion(row?.counterPartyAddress || buildDspUrl(connectorId));
      return {
        resolved: true,
        response: {
          status: 200,
          catalogEndpoint: 'provider-management-fallback',
          managementApiBase: contractsResp?.managementApiBase || policiesResp?.managementApiBase || '',
          contractDefinitionId,
          policyId,
        },
        row: {
          ...row,
          offerId: compositeOfferId,
          policyTarget: row?.policyTarget || assetId,
          assigner: row?.assigner || connectorId,
          connectorId,
          counterPartyAddress,
          policyRaw: correctedPolicyRaw,
          policySummary: row?.policySummary || summarizePolicyTerms(correctedPolicyRaw),
          catalogOfferResolved: true,
          catalogOfferInferred: false,
          catalogOfferSource: 'provider-management-fallback',
        },
      };
    }

    async function fetchCatalogRowsForConnector(connectorId, options = {}) {
      const normalizedConnector = normalizeRemoteConnectorId(connectorId);
      const address = buildDspUrl(normalizedConnector);
      const currentCanonical = canonicalConnectorPrefix(cfg?.connectorName || '').toLowerCase();
      const targetCanonical = canonicalConnectorPrefix(normalizedConnector).toLowerCase();
      const isCurrentConnector = currentCanonical && targetCanonical && currentCanonical === targetCanonical;
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 10000;
      const catalogTimeoutMs = Number.isFinite(Number(options.catalogTimeoutMs)) ? Number(options.catalogTimeoutMs) : timeoutMs;

      if (isCurrentConnector) {
        // Use the management API to load the self-connector's catalog including contract/policy data.
        // This avoids self-referential DSP dispatch failures (DSP 500 on self-catalog) and ensures
        // that catalog rows carry managementContractDefinitionId + managementPolicyRaw, which lets
        // resolveNegotiableCatalogOffer construct the correct composite offer ID without an extra
        // DSP round-trip (which would just fail again).
        return await fetchRemoteCatalogRowsFromManagement(normalizedConnector, address, { timeoutMs });
      }

      // For remote connectors NEVER call the remote management API — it is not exposed
      // externally. Only /asset-bundles/public (local-assets), DSP catalog offers and
      // local access-requests are reachable from outside.
      // skipDspOffers=true skips the /v3/catalog/request call (used in the showcase to avoid
      // slow/failing management API round-trips when only display is needed).
      const skipDspOffers = Boolean(options.skipDspOffers);

      const parallelTasks = [
        fetchProviderAssetBundleMetadata(address, { timeoutMs: Math.min(timeoutMs, 8000) }),
        skipDspOffers ? Promise.resolve(null) : fetchRemoteCatalogOffers(normalizedConnector, address, { timeoutMs: catalogTimeoutMs, retries: 0, silent: true }),
        fetchAccessRequestsForProviderAddress(address, { timeoutMs: Math.min(timeoutMs, 5000) }),
      ];
      const [bundlesSettled, offersSettled, requestsSettled] = await Promise.allSettled(parallelTasks);

      const bundleRows = bundlesSettled.status === 'fulfilled' && Array.isArray(bundlesSettled.value)
        ? bundlesSettled.value : [];
      const offersResult = skipDspOffers
        ? { response: { status: 200 }, rows: [], address }
        : (offersSettled.status === 'fulfilled'
          ? offersSettled.value
          : { response: { status: 0, error: String(offersSettled.reason || 'No se pudo consultar catalogo DSP') }, rows: [], address });
      const accessRequests = requestsSettled.status === 'fulfilled' && Array.isArray(requestsSettled.value)
        ? requestsSettled.value : [];

      const offerRows = Array.isArray(offersResult?.rows) ? offersResult.rows : [];

      // Bundle rows are the primary source (carry visibility/accessLevel).
      // Merge with DSP offer rows to attach offerId + policyRaw for negotiation.
      let rows;
      if (bundleRows.length && offerRows.length) {
        rows = mergeProviderAssetBundleMetadataIntoCatalogRows(offerRows, bundleRows);
        if (!rows.length) rows = mapProviderAssetBundleMetadataToCatalogRows(bundleRows, normalizedConnector, address);
      } else if (bundleRows.length) {
        rows = mapProviderAssetBundleMetadataToCatalogRows(bundleRows, normalizedConnector, address);
      } else {
        rows = offerRows;
      }

      rows = enrichCatalogRowsWithAccessRequests(rows, accessRequests);

      const catalogResponse = offersResult?.response || {};
      const ok = (catalogResponse?.status >= 200 && catalogResponse?.status < 300) || bundleRows.length > 0;
      const response = {
        status: ok ? 200 : (catalogResponse?.status || 0),
        data: catalogResponse?.data || null,
        assetEndpoint: bundleRows.length ? 'local-assets-bundles' : '',
        assetStatus: bundleRows.length ? 200 : 0,
        catalogEndpoint: catalogResponse?.catalogEndpoint || '',
        catalogStatus: catalogResponse?.status || 0,
        catalogOffers: offerRows.length,
        catalogError: catalogResponse?.error || catalogResponse?.data?.detail || catalogResponse?.data?.error || '',
        managementApiBase: '',
        accessRequests: accessRequests.length,
        providerAssetMetadata: bundleRows.length,
      };
      if (offersResult?.address) response.dspAddressUsed = offersResult.address;
      return { response, rows, connectorId: normalizedConnector, address };
    }

    function ensureDspVersion(url) {
      const trimmed = String(url || '').replace(/\/+$/, '');
      if (!trimmed) return trimmed;
      if (/\/api\/v1\/dsp\/2025-1$/i.test(trimmed)) return trimmed;
      if (/\/api\/v1\/dsp$/i.test(trimmed)) return `${trimmed}/2025-1`;
      return trimmed;
    }

    function withDspProtocolVersion(url) {
      const base = ensureDspVersion(url);
      if (!base) return base;
      if (/\/api\/v1\/dsp$/i.test(base)) return `${base}/2025-1`;
      return base;
    }

    function getDspAddressCandidates(url) {
      const versioned = withDspProtocolVersion(url);
      const base = ensureDspVersion(url);
      return [...new Set([versioned, base].filter(Boolean))];
    }

    function resolveInternalDspUrl(connectorId) {
      const canonical = canonicalConnectorPrefix(connectorId || '').toLowerCase();
      if (!canonical) return '';
      if (canonical === 'conectoruc3m') return withDspProtocolVersion('http://conectoruc3m:11003/api/v1/dsp');
      if (canonical === 'conectorfuenlabrada') return withDspProtocolVersion('http://conectorfuenlabrada:11003/api/v1/dsp');
      return '';
    }

    function getEdcDspAddressCandidates(connectorId, address) {
      return getDspAddressCandidates(address);
    }

    function getPreferredEdcDspAddress(connectorId, address) {
      return getEdcDspAddressCandidates(connectorId, address)[0] || withDspProtocolVersion(address);
    }

    function getConfiguredConnectorDirectory() {
      const source = cfg.connectorDirectory;
      const parsed = (source && typeof source === 'object' && !Array.isArray(source))
        ? source
        : parseJsonSafe(String(source || '').trim(), {});
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

      const normalized = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const normalizedKey = canonicalConnectorPrefix(key).toLowerCase();
        const url = String(value || '').trim();
        if (normalizedKey && url) normalized[normalizedKey] = ensureDspVersion(url);
      });
      return normalized;
    }

    function resolveConfiguredDspUrl(connectorId) {
      const raw = String(connectorId || '').trim();
      if (!raw) return '';

      const directory = getConfiguredConnectorDirectory();
      const canonical = canonicalConnectorPrefix(raw);
      const candidates = [raw, canonical, raw.toLowerCase(), canonical.toLowerCase()].filter(Boolean);

      for (const candidate of candidates) {
        const found = directory[String(candidate).toLowerCase()];
        if (found) return found;
      }
      return '';
    }

    function getDefaultRemoteConnector() {
      const configured = String(cfg.defaultRemoteConnector || '').trim();
      if (configured) return configured;
      const candidates = String(cfg.connectorCatalogList || '')
        .split(/[\n,;]+/g)
        .map(v => String(v || '').trim())
        .filter(Boolean);
      return candidates[0] || 'conectoruc3m';
    }

    function normalizeRemoteConnectorId(connectorId) {
      const raw = String(connectorId || '').trim();
      if (!raw) return getDefaultRemoteConnector();
      if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) return raw;
      const lower = raw.toLowerCase();
      if (lower === 'provider' || lower === 'consumer') return getDefaultRemoteConnector();
      return canonicalConnectorPrefix(raw);
    }

    // Construir URL DSP absoluta en base al conector remoto indicado por el usuario.
    function buildDspUrl(connectorId) {
      const raw = String(connectorId || getDefaultRemoteConnector()).trim();
      if (!raw) return ensureDspVersion(`${window.location.origin}/${canonicalConnectorPrefix(getDefaultRemoteConnector())}/api/v1/dsp`);

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

      const configuredUrl = resolveConfiguredDspUrl(raw);
      if (configuredUrl) {
        return ensureDspVersion(configuredUrl);
      }

      const connectorIdLower = raw.toLowerCase();
      if (connectorIdLower === 'provider') {
        const configured = resolveConfiguredDspUrl(raw);
        if (configured) return ensureDspVersion(configured);
        return buildDspUrl(getDefaultRemoteConnector());
      }
      if (connectorIdLower === 'consumer') {
        const configured = resolveConfiguredDspUrl(raw);
        if (configured) return ensureDspVersion(configured);
        return buildDspUrl(getDefaultRemoteConnector());
      }

      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname.startsWith('127.');
      if (isLocalHost) {
        return ensureDspVersion(`http://${raw}-connector:19103/api/v1/dsp`);
      }

      // Producción: resolver por mismo dominio público y prefijo canónico del conector remoto.
      const connectorPrefix = canonicalConnectorPrefix(raw);
      const publicOrigin = getPublicConnectorOrigin();
      return ensureDspVersion(`${publicOrigin}/${connectorPrefix}/api/v1/dsp`);
    }

