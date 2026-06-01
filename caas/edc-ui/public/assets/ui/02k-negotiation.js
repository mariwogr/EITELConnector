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
      const connectorId = (document.getElementById('searchConnectorId').value || getDefaultRemoteConnector()).trim() || getDefaultRemoteConnector();
      const { response, rows, address } = await fetchCatalogRowsForConnector(connectorId, { timeoutMs: 10000, catalogTimeoutMs: 10000 });
      document.getElementById('resolvedAddress').value = address;
      document.getElementById('transferAddress').value = address;
      state.catalogRows = rows;
      renderCatalogShowcase(state.catalogRows);
      refreshCatalogAssetOptions();
      syncCatalogSelectionState();
      if (showOutput) writeOut(response);
    }

    async function loadCatalogShowcase(showOutput = true) {
      if (state.catalogAutoRequestInFlight) return;
      state.catalogAutoRequestInFlight = true;

      const connectors = parseConnectorCandidates({ includeSingle: false });
      const allRows = [];
      const connectorSummaries = [];
      const renderCurrentRows = () => {
        const dedupe = new Map();
        allRows.forEach(row => {
          const key = `${row.connectorId}::${row.assetId}::${row.offerId}`;
          if (!dedupe.has(key)) dedupe.set(key, row);
        });
        state.catalogRows = [...dedupe.values()];
        renderCatalogShowcase(state.catalogRows);
        refreshCatalogAssetOptions();
        syncCatalogSelectionState();
      };

      try {
        if (showOutput && document.getElementById('catalogShowcase')) {
          document.getElementById('catalogShowcase').innerHTML = '<div class="card" style="box-shadow:none"><p class="muted" style="margin:0">Cargando catálogos...</p></div>';
        }

        const tasks = connectors.map(async (connectorId) => {
          let result;
          try {
            result = await fetchCatalogRowsForConnector(connectorId, { timeoutMs: 10000, skipDspOffers: true, silent: true });
          } catch (error) {
            result = {
              response: { status: 0, error: String(error || 'No se pudo consultar el conector.') },
              rows: [],
              connectorId,
              address: buildDspUrl(connectorId),
            };
          }
          if (result?.response?.status >= 200 && result?.response?.status < 300) {
            allRows.push(...(result.rows || []));
            renderCurrentRows();
          }
          connectorSummaries.push({
            connectorId,
            status: result?.response?.status || 0,
            catalogEndpoint: result?.response?.catalogEndpoint || '',
            catalogStatus: result?.response?.catalogStatus || '',
            catalogOffers: result?.response?.catalogOffers || 0,
            catalogError: result?.response?.catalogError || '',
            assetEndpoint: result?.response?.assetEndpoint || '',
            managementApiBase: result?.response?.managementApiBase || '',
            assets: (result.rows || []).length,
            dspUrl: result?.address || ''
          });
          return result;
        });
        await Promise.allSettled(tasks);

        renderCurrentRows();
        if (!state.catalogRows.length) {
          const localAssetsResp = await callApi('POST', '/v3/assets/request', q(), { silent: true, retries: 0 });
          const localAssets = unwrap(localAssetsResp);
          state.catalogRows = mapPublishedAssetsToCatalogVisualRows(localAssets);
          renderCatalogShowcase(state.catalogRows);
          refreshCatalogAssetOptions();
          syncCatalogSelectionState();
        }

        if (showOutput) {
          writeOut({
            status: 200,
            action: 'catalog-showcase',
            connectors: connectorSummaries,
            totalAssets: state.catalogRows.length,
          });
        }
        state.catalogShowcaseLoaded = state.catalogRows.length > 0;
      } finally {
        state.catalogAutoRequestInFlight = false;
      }
    }

    async function resolveNegotiableCatalogOffer(row) {
      if (!row || !canPrepareCatalogContract(row)) return { row, response: null, resolved: false };
      if (row.offerId && row.policyRaw && row.catalogOfferResolved) return { row, response: null, resolved: true };

      // Shortcut: row was loaded via management API fallback and already has contract/policy data.
      // Skip the DSP re-fetch (which will 502 anyway) and compute the correct composite offer ID directly.
      const assetIdForShortcut = String(row.assetId || row.policyTarget || '').trim();
      if (row.managementContractDefinitionId && row.managementPolicyRaw && assetIdForShortcut) {
        // Use EDC ContractOfferId format: Base64(defId):Base64(assetId):Base64(UUID)
        const compositeOfferId = makeEdcOfferId(row.managementContractDefinitionId, assetIdForShortcut);
        const correctedPolicyRaw = { ...row.managementPolicyRaw, '@id': compositeOfferId };
        return {
          row: {
            ...row,
            offerId: compositeOfferId,
            policyRaw: correctedPolicyRaw,
            catalogOfferResolved: true,
            catalogOfferSource: 'provider-management-cached',
          },
          response: null,
          resolved: true,
        };
      }

      const connectorId = row.connectorId || row.assigner || getDefaultRemoteConnector();
      const address = row.counterPartyAddress || buildDspUrl(connectorId);

      // Try to resolve the offer via the provider's management API from the browser first.
      // This is faster and more reliable than the DSP catalog request in deployments where
      // EDC-to-EDC DSP connectivity is limited (e.g. cross-server EC2 behind ALB).
      const mgmtResult = await resolveCatalogOfferFromRemoteManagement(row);
      if (mgmtResult?.resolved) return mgmtResult;

      // Fallback to DSP catalog request only if management API resolution failed.
      const result = await fetchRemoteCatalogOffers(connectorId, address);
      const assetId = String(row.assetId || row.policyTarget || '').trim();
      const match = (result.rows || []).find(offer => {
        const offerAsset = String(offer.assetId || offer.policyTarget || '').trim();
        const offerTarget = String(offer.policyTarget || '').trim();
        return offerAsset === assetId || offerTarget === assetId;
      });

      if (!match?.offerId || !match?.policyRaw) {
        return {
          row,
          response: result.response,
          resolved: false,
          reason: 'El asset no aparece como oferta negociable en el catalogo DSP del proveedor.',
        };
      }

      return {
        row: {
          ...row,
          ...match,
          accessLevel: combineAccessLevels(row.accessLevel, match.accessLevel),
          ownerEmail: row.ownerEmail || match.ownerEmail || '',
          ownerName: row.ownerName || match.ownerName || '',
          accessRequestId: row.accessRequestId || '',
          accessRequestStatus: row.accessRequestStatus || '',
          accessRequest: row.accessRequest || null,
          catalogOfferResolved: true,
          catalogOfferInferred: false,
        },
        response: result.response,
        resolved: true,
      };
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

      let selected = state.catalogRows[Number(selectedIdxRaw)];
      if (!selected) {
        writeOut({ status: 404, error: 'No se encontró ese asset en el catálogo.' });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      const selectedState = getCatalogRowState(selected);
      if (isRestrictedAccessLevel(selected.accessLevel || 'public') && selectedState !== 'approved') {
        openAccessRequestModalForRow(selected);
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        writeOut({ status: 403, error: 'Este asset es privado. Debes solicitar acceso al propietario.' });
        return;
      }

      if (!canPrepareCatalogContract(selected)) {
        const availability = getCatalogContractAvailability(selected);
        showInfoPopup('No puedes contratar este asset todavía', {
          assetId: selected.assetId || '',
          estado: selectedState,
          visibility: selected.accessLevel || '',
          reason: availability.reason,
          nextStep: availability.nextStep,
        });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      const offerResolution = await resolveNegotiableCatalogOffer(selected);
      if (!offerResolution.resolved) {
        const catalogStatus = offerResolution.response?.status || 0;
        const catalogEndpoint = offerResolution.response?.catalogEndpoint || '';
        showInfoPopup('No hay oferta contractual negociable', {
          assetId: selected.assetId || '',
          provider: selected.connectorId || selected.assigner || '',
          catalogStatus,
          catalogEndpoint,
          reason: offerResolution.reason || 'No se ha podido resolver la oferta DSP del asset.',
          probableCause: 'El proveedor tiene el asset publicado, pero le falta una ContractDefinition valida para ese asset o el selector no apunta al asset correcto.',
          nextStep: 'En el conector proveedor, vuelve a publicar/actualizar el asset para recrear PolicyDefinition y ContractDefinition. Despues recarga Catalogo y vuelve a contratar.',
        });
        writeOut({
          status: 409,
          error: 'Asset sin oferta contractual DSP resoluble.',
          assetId: selected.assetId || '',
          provider: selected.connectorId || selected.assigner || '',
          catalogStatus,
          catalogEndpoint,
          catalogResponse: offerResolution.response || null,
        });
        if (actionBtn) {
          actionBtn.disabled = false;
          actionBtn.textContent = 'Realizar contrato';
        }
        return;
      }

      selected = offerResolution.row;
      state.catalogRows[Number(selectedIdxRaw)] = selected;
      refreshCatalogAssetOptions();
      const select = document.getElementById('catalogAssetId');
      if (select) select.value = selectedIdxRaw;
      syncCatalogSelectionState();

      if (starTrustConfig.enabled) {
        starTrustState.lastCounterParty = selected.connectorId || selected.assigner || '';
        starTrustState.lastAssetId = selected.assetId || '';
        starTrustState.handshakeState = 'resolving';
        starTrustState.handshakeDetail = `Preparando handshake con ${selected.connectorId || selected.assigner || 'participant'} para el asset ${clean(selected.assetId || '-')}. Se resolverá el endpoint remoto y el material de confianza disponible.`;
        pushStarTrustEvent('Inicio de handshake', starTrustState.handshakeDetail, 'info');
      }

      if (!selected.offerId) {
        showInfoPopup('No hay oferta contractual', {
          assetId: selected.assetId || '',
          connector: selected.connectorId || selected.assigner || '',
          message: 'No se pudo inferir policy/offer para iniciar la negociación.',
        });
        writeOut({ status: 400, error: 'No se pudo inferir policy/offer para iniciar la negociación.', selected });
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

      const sourcePolicy = selected.policyRaw
        ? JSON.parse(JSON.stringify(selected.policyRaw))
        : {};

      const compactOdrlNode = (node) => {
        if (Array.isArray(node)) return node.map(compactOdrlNode);
        if (!node || typeof node !== 'object') return node;
        const compacted = {};
        Object.entries(node).forEach(([key, value]) => {
          if (key === '@context') return;
          const normalizedKey = key.startsWith('odrl:') ? key.slice(5) : key;
          const normalizedValue = normalizedKey === '@type' && typeof value === 'string' && value.startsWith('odrl:')
            ? value.slice(5)
            : compactOdrlNode(value);
          if (!(normalizedKey in compacted)) compacted[normalizedKey] = normalizedValue;
        });
        return compacted;
      };

      const policy = compactOdrlNode(sourcePolicy);

      // Para ContractRequest, EDC espera términos ODRL compactados bajo el contexto ODRL.
      policy['@context'] = 'http://www.w3.org/ns/odrl.jsonld';
      policy['@type'] = 'Offer';
      policy['@id'] = policy['@id'] || selected.offerId;
      const resolvedAssigner = (policy.assigner || selected.assigner || 'provider').toString().trim();
      policy.assigner = resolvedAssigner || 'provider';
      // Forzar el asset real del dataset seleccionado; algunas policies publicadas traen target placeholder.
      const resolvedTarget = (selected.assetId || policy.target || selected.policyTarget || '').toString().trim();
      policy.target = resolvedTarget;

      const normalizeRuleTarget = (rule) => {
        if (!rule || typeof rule !== 'object') return rule;
        const compactRule = compactOdrlNode(rule);
        const resolved = (selected.assetId || compactRule.target || selected.policyTarget || '').toString().trim();
        return { ...compactRule, target: resolved };
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

      const negotiatedCounterPartyAddress = selected.counterPartyAddress
        || document.getElementById('resolvedAddress').value
        || buildDspUrl(selected.connectorId || selected.assigner);
      const negotiatedCounterPartyId = resolveCounterPartyId(selected.connectorId || selected.assigner || '', negotiatedCounterPartyAddress);
      const resolvedAddressInputForNegotiation = document.getElementById('resolvedAddress');
      if (resolvedAddressInputForNegotiation) resolvedAddressInputForNegotiation.value = negotiatedCounterPartyAddress;

      const beforeAgreementsResp = await callApi('POST', '/v3/contractagreements/request', q());
      const beforeAgreementIds = new Set(unwrap(beforeAgreementsResp).map(a => a['@id'] || a.id).filter(Boolean));

      const contractRequestBody = {
        '@context': { edc: 'https://w3id.org/edc/v0.0.1/ns/' },
        '@type': 'ContractRequest',
        protocol: 'dataspace-protocol-http:2025-1',
        counterPartyAddress: negotiatedCounterPartyAddress,
        counterPartyId: negotiatedCounterPartyId,
        policy
      };

      const r = await callApi('POST', '/v3/contractnegotiations', JSON.stringify(contractRequestBody));
      if (starTrustConfig.enabled) {
        if (r.status >= 200 && r.status < 300) {
          starTrustState.handshakeState = 'negotiating';
          starTrustState.handshakeDetail = `Negociación enviada al participante ${selected.connectorId || selected.assigner || 'remoto'} en ${document.getElementById('resolvedAddress').value || '-'}. El coordinador ya no interviene en tiempo real.`;
          pushStarTrustEvent('Negociación P2P enviada', starTrustState.handshakeDetail, 'info');
        } else {
          starTrustState.handshakeState = 'failed';
          starTrustState.handshakeDetail = `No se pudo iniciar la negociación con ${selected.connectorId || selected.assigner || 'el participante remoto'}.`;
          pushStarTrustEvent('Handshake fallido', `${starTrustState.handshakeDetail} HTTP ${r.status}.`, 'danger');
        }
      }
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
        'Negociación en curso',
        {
          negotiationId,
          assetId: selected.assetId || '',
          provider: selected.connectorId || selected.assigner || '',
          estado: 'monitorizando',
          message: 'La solicitud de contrato se ha enviado. La UI monitoriza la negociación y mostrará si termina, falla o sigue pendiente.',
          nextStep: 'No cierres esta pestaña si quieres ver el diagnóstico automático. También puedes abrir Contratos para recargar manualmente.',
        }
      );

      if (actionBtn) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'Realizar contrato';
      }

      const monitorResult = await waitForNegotiationAgreement(negotiationId, beforeAgreementIds, selected, { maxAttempts: 24, delayMs: 2500 });
      const createdAgreement = monitorResult.agreement;

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
        if (starTrustConfig.enabled) {
          starTrustState.lastAgreementId = agreementId || '';
          starTrustState.handshakeState = 'agreed';
          starTrustState.handshakeDetail = `Handshake preparado con ${providerId || selected.assigner || 'provider'} para el asset ${clean(assetId || selected.assetId || '-')}. Agreement ${clean(agreementId || '-')}.`;
          pushStarTrustEvent('Contrato disponible', starTrustState.handshakeDetail, 'ok');
        }
        showInfoPopup('Aviso', `Contrato concretado correctamente.\nAgreement ID: ${agreementId}\nNegotiation ID: ${negotiationId}\nAsset: ${assetId}\nProvider: ${providerId}\nConsumer: ${consumerId}`, {
          plainText: true,
          actionLabel: 'Ir al contrato',
          onAction: () => window.useAgreement(agreementId)
        });
      } else {
        if (starTrustConfig.enabled) {
          starTrustState.handshakeState = 'negotiating';
          starTrustState.handshakeDetail = `La negociación ${clean(negotiationId)} sigue en curso. La UI seguirá reflejando que el handshake está pendiente de acuerdo.`;
          pushStarTrustEvent('Handshake en espera', starTrustState.handshakeDetail, 'warn');
        }
        const snapshot = monitorResult.snapshot || {};
        showInfoPopup('Negociación sin contrato todavía', {
          negotiationId,
          negotiationState: snapshot.state || '-',
          httpStatus: snapshot.status || '',
          errorDetail: snapshot.errorDetail || '',
          assetId: selected.assetId || '',
          provider: selected.connectorId || selected.assigner || '',
          counterPartyId: negotiatedCounterPartyId,
          counterPartyAddress: negotiatedCounterPartyAddress,
          offerId: selected.offerId || '',
          attempts: monitorResult.attempts,
          checkedForSeconds: monitorResult.attempts * 2.5,
          probableCause: snapshot.errorDetail
            ? 'El runtime ha devuelto un detalle de error en la negociación.'
            : 'El provider no ha materializado aún el ContractAgreement o ha rechazado la policy inferida.',
          nextStep: 'Si vuelve a aparecer 404, comprueba que el proveedor expone este offerId en su catalogo DSP y que la ContractDefinition selecciona exactamente este asset.',
        });
      }
    }

    /**
     * Retrieves all catalog agreements (purchase contracts) from connector.
     * Fetches active agreements where this connector is data provider or consumer.
     * Displays agreements in catalog view with counter-party and asset information.
     * 
     * @async
     * @returns {Promise<Object>} API response with agreement list
     * 
     * @example
     * await listAgreements(); // Load all available agreements
     */
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
      try { refreshStarTrustPanel(); } catch {}
      writeOut({ ...r, deduplicated });
      showInfoPopup('Contratos cargados', {
        total: state.agreementRows.length,
        deduplicated,
        preview: state.agreementRows.slice(0, 5)
      });
    }

