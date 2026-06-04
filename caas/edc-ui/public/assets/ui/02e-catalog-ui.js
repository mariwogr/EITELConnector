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
          visibility: combineAccessLevels(props?.['eitel:visibility'], props?.['dct:accessRights']),
          ownerEmail: firstNonEmpty([props?.['eitel:ownerEmail'], '']),
          ownerName: firstNonEmpty([props?.['eitel:ownerName'], '']),
          managedBy: firstNonEmpty([props?.['eitel:managedByConnector'], props?.['eitel:managedBy']]),
          keywords: [...new Set(keywords)],
        };
      });
    }

    async function getMergedAssetBundleBackups() {
      const localRows = getAssetBundleBackups();
      const serverRows = await listServerAssetBundleBackups();
      const merged = new Map();

      [...serverRows, ...localRows].forEach((row) => {
        const assetId = String(row?.assetId || '').trim();
        if (!assetId) return;
        const current = merged.get(assetId);
        const currentUpdatedAt = Date.parse(String(current?.updatedAt || '')) || 0;
        const nextUpdatedAt = Date.parse(String(row?.updatedAt || '')) || 0;
        if (!current || nextUpdatedAt >= currentUpdatedAt) merged.set(assetId, row);
      });

      return [...merged.values()];
    }

    function resolvePublicationAccessLevel(row = {}, bundle = null) {
      const assetProps = bundle?.assetBody?.properties || bundle?.assetBody?.['edc:properties'] || {};
      const policy = bundle?.policyBody?.policy || bundle?.policyBody?.['edc:policy'] || null;
      const privateProps = bundle?.policyBody?.privateProperties || {};
      return combineAccessLevels(
        bundle?.policyMeta?.accessLevel,
        privateProps?.['eitel:accessLevel'],
        policy?.['dct:accessRights'],
        extractAccessLevelFromPolicy(policy),
        assetProps?.['eitel:visibility'],
        assetProps?.['dct:accessRights'],
        row?.visibility
      );
    }

    function enrichPublishedAssetsWithBundles(rows = [], bundles = []) {
      const byAssetId = new Map((Array.isArray(bundles) ? bundles : []).map(bundle => [String(bundle?.assetId || '').trim(), bundle]));
      return (Array.isArray(rows) ? rows : []).map((row) => {
        const assetId = String(row?.id || '').trim();
        const bundle = byAssetId.get(assetId) || null;
        return {
          ...row,
          bundle,
          visibility: resolvePublicationAccessLevel(row, bundle),
          policyId: String(bundle?.policyId || bundle?.policyBody?.['@id'] || '').trim(),
          contractDefId: String(bundle?.contractDefId || bundle?.contractBody?.['@id'] || '').trim(),
          updatedAt: String(bundle?.updatedAt || '').trim(),
        };
      });
    }

    function getPolicyDefinitionId(policyDefinition) {
      return String(policyDefinition?.['@id'] || policyDefinition?.id || policyDefinition?.['edc:id'] || '').trim();
    }

    function getPolicyDefinitionAssetId(policyDefinition) {
      const policy = policyDefinition?.policy || policyDefinition?.['edc:policy'] || policyDefinition || {};
      const permissions = policy?.permission || policy?.['odrl:permission'] || [];
      const firstPermission = Array.isArray(permissions) ? permissions[0] : permissions;
      return String(
        firstPermission?.target ||
        firstPermission?.['odrl:target'] ||
        policy?.target ||
        policy?.['odrl:target'] ||
        ''
      ).trim();
    }

    function inferPublishedPolicyId(assetId, policies = []) {
      const id = String(assetId || '').trim();
      if (!id) return '';
      const byTarget = (Array.isArray(policies) ? policies : []).find(policy => getPolicyDefinitionAssetId(policy) === id);
      if (byTarget) return getPolicyDefinitionId(byTarget);
      const suffix = id.replace(/^asset-/, '');
      const conventional = `policy-${suffix}`;
      const byConvention = (Array.isArray(policies) ? policies : []).find(policy => getPolicyDefinitionId(policy) === conventional);
      return byConvention ? conventional : '';
    }

    function inferPublishedContractDefId(assetId, contractDefinitions = []) {
      const id = String(assetId || '').trim();
      if (!id) return '';
      const byAsset = (Array.isArray(contractDefinitions) ? contractDefinitions : []).find(contract => getContractDefinitionAssetId(contract) === id);
      if (byAsset) return String(byAsset?.['@id'] || byAsset?.id || byAsset?.['edc:id'] || '').trim();
      const suffix = id.replace(/^asset-/, '');
      const conventional = `contractdef-${suffix}`;
      const byConvention = (Array.isArray(contractDefinitions) ? contractDefinitions : []).find(contract => String(contract?.['@id'] || contract?.id || contract?.['edc:id'] || '').trim() === conventional);
      return byConvention ? conventional : '';
    }

    function enrichPublishedAssetsWithRuntimeArtifacts(rows = [], policies = [], contractDefinitions = []) {
      return (Array.isArray(rows) ? rows : []).map((row) => {
        const assetId = String(row?.id || '').trim();
        const policyId = String(row?.policyId || '').trim() || inferPublishedPolicyId(assetId, policies);
        const contractDefId = String(row?.contractDefId || '').trim() || inferPublishedContractDefId(assetId, contractDefinitions);
        return { ...row, policyId, contractDefId };
      });
    }

    async function getPublicationBundleByAssetId(assetId) {
      const target = String(assetId || '').trim();
      if (!target) return null;
      const bundles = await getMergedAssetBundleBackups();
      return bundles.find(bundle => String(bundle?.assetId || '').trim() === target) || null;
    }

    function mapPublishedAssetsToCatalogVisualRows(rawAssets = [], options = {}) {
      const connectorId = options.connectorId || PROD_CONNECTOR_ID;
      const counterPartyAddress = options.counterPartyAddress || '';
      return mapPublishedAssetRows(rawAssets).map((row) => ({
        offerId: '',
        assetId: row.id || '',
        policyTarget: row.id || '',
        assigner: connectorId,
        connectorId,
        counterPartyAddress,
        policySummary: 'Asset publicado por el conector. Puedes solicitar acceso al propietario.',
        policyRaw: null,
        sourceHintUrl: '',
        assetTitle: row.title,
        assetDescription: row.description,
        assetKeywords: row.keywords,
        assetImageUrl: row.imageUrl,
        accessLevel: row.visibility || 'public',
        ownerEmail: row.ownerEmail || '',
        ownerName: row.ownerName || '',
      }));
    }

    /**
     * Renders published assets table in UI.
     * Creates HTML table with asset data including name, source, and action buttons.
     * Each row is clickable to select asset for editing.
     * 
     * @param {Object[]} [rows=[]] - Array of published asset objects
     * @returns {void}
     * 
     * @example
     * renderPublishedAssets(assets); // Display assets in table format
     */
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
        const jsId = (row.id || '').replace(/'/g, "\\'");
        const managedBy = htmlEscape(String(row.managedBy || '-'));
        const visibility = htmlEscape(row.visibility === 'private' ? 'privado' : 'publico');
        const ownerEmail = htmlEscape(String(row.ownerEmail || '-'));
        const policyId = htmlEscape(String(row.policyId || '-'));
        const contractDefId = htmlEscape(String(row.contractDefId || '-'));
        const updatedAt = htmlEscape(row.updatedAt ? fmtDate(row.updatedAt) : '-');
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
              <div class="asset-card-meta">managedBy: ${managedBy}</div>
              <div class="asset-card-meta">Visibilidad: ${visibility}</div>
              <div class="asset-card-meta">Owner email: ${ownerEmail}</div>
              <div class="asset-card-meta">Policy: ${policyId}</div>
              <div class="asset-card-meta">Contract: ${contractDefId}</div>
              <div class="asset-card-meta">Actualizado: ${updatedAt}</div>
              <details>
                <summary>Detalles</summary>
                <div class="asset-card-desc">${desc}</div>
                ${chips}
              </details>
              <div class="row">
                <button class="ghost" onclick="window.editPublishedAsset('${jsId}')">Editar asset</button>
                <button class="ghost" onclick="window.editPublishedPolicy('${jsId}')" ${row.policyId ? '' : 'disabled'}>Editar policy</button>
                <button class="ghost" onclick="window.editPublishedContract('${jsId}')" ${row.contractDefId ? '' : 'disabled'}>Editar contrato</button>
              </div>
              <div class="row">
                <button class="danger" onclick="window.deletePublishedAsset('${jsId}')">Borrar asset</button>
                <button class="danger" onclick="window.deletePublishedPolicy('${jsId}')" ${row.policyId ? '' : 'disabled'}>Borrar policy</button>
                <button class="danger" onclick="window.deletePublishedContract('${jsId}')" ${row.contractDefId ? '' : 'disabled'}>Borrar contrato</button>
              </div>
            </div>
          </article>
        `;
      }).join('');
    }

    /**
     * Loads published assets from Management API.
     * Fetches asset list from connector and updates internal cache.
     * Optionally logs results to console for debugging.
     * 
     * @async
     * @param {boolean} [showOutput=false] - Whether to log results to console
     * @returns {Promise<Object[]>} Array of published assets
     * 
     * @example
     * const assets = await loadPublishedAssets(true);
     */
    async function loadPublishedAssets(showOutput = false) {
      const [r, policiesResp, contractsResp] = await Promise.all([
        callApi('POST', '/v3/assets/request', q()),
        callApi('POST', '/v3/policydefinitions/request', q(), { silent: true, retries: 0 }),
        callApi('POST', '/v3/contractdefinitions/request', q(), { silent: true, retries: 0 }),
      ]);
      const bundleRows = await getMergedAssetBundleBackups();
      const allRows = enrichPublishedAssetsWithRuntimeArtifacts(
        enrichPublishedAssetsWithBundles(mapPublishedAssetRows(unwrap(r)), bundleRows),
        unwrap(policiesResp),
        unwrap(contractsResp)
      );
      const ownRows = allRows.filter(row => String(row.managedBy || '').trim().toLowerCase() === String(connectorName || '').trim().toLowerCase());
      const rowsToRender = ownRows.length ? ownRows : allRows;
      renderPublishedAssets(rowsToRender);
      if (showOutput) writeOut({ ...r, totalPublishedAssets: allRows.length, connectorOwnedAssets: ownRows.length, rendered: rowsToRender.length, bundles: bundleRows.length, policies: unwrap(policiesResp).length, contractDefinitions: unwrap(contractsResp).length });
      return r;
    }

    /**
     * Refreshes all overview panels with latest connector data.
     * Reloads assets, policies, contracts, and transfers from API.
     * Updates all UI sections to reflect current connector state.
     * 
     * @async
     * @returns {Promise<void>}
     * 
     * @example
     * await refreshOverview(); // Reload all connector data
     */
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

      try { refreshStarTrustPanel(); } catch {}
    }

