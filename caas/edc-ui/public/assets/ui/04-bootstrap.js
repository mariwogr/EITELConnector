function openSettings() { settingsModal.classList.add('open'); }
    function closeSettings() { settingsModal.classList.remove('open'); }

    function applyProjectVariantUi() {
      const starNav = document.querySelector('.nav button[data-view="star-trust"]');
      const starPanel = document.getElementById('panel-star-trust');
      const starEnabled = Boolean(starTrustConfig?.enabled);
      if (starNav) starNav.style.display = starEnabled ? '' : 'none';
      if (starPanel) starPanel.style.display = starEnabled ? '' : 'none';
      if (!starEnabled && starNav?.classList.contains('active')) activateView('dashboard');

      const arcgisEnabled = Boolean(arcgis?.enabled);
      [
        'arcgisTokenWidget',
        'btnArcgisLogout',
        'arcgisPublishAssist',
        'arcgisUploadWrap',
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el && !arcgisEnabled) el.style.display = 'none';
      });

      const arcgisAuthOption = document.querySelector('#pubAuthType option[value="arcgis-login"]');
      if (arcgisAuthOption) arcgisAuthOption.hidden = !arcgisEnabled;
      const authType = document.getElementById('pubAuthType');
      if (!arcgisEnabled && authType?.value === 'arcgis-login') authType.value = 'none';

      const arcgisTransferOption = document.querySelector('#transferMode option[value="arcgis-upload"]');
      if (arcgisTransferOption) arcgisTransferOption.hidden = !arcgisEnabled;
      const transferMode = document.getElementById('transferMode');
      if (!arcgisEnabled && transferMode?.value === 'arcgis-upload') transferMode.value = 'push';

      const arcgisSourceOption = document.querySelector('#assetSourceMode option[value="arcgis-feature-layer"]');
      if (arcgisSourceOption) arcgisSourceOption.hidden = !arcgisEnabled;
      const assetSourceModeEl = document.getElementById('assetSourceMode');
      if (!arcgisEnabled && assetSourceModeEl?.value === 'arcgis-feature-layer') {
        assetSourceModeEl.value = 'remote-url';
        if (typeof syncAssetSourceModeUi === 'function') syncAssetSourceModeUi();
      }

      const authGate = document.getElementById('authGate');
      if (authGate && !arcgisEnabled) authGate.classList.remove('open');
    }

    function bindEvents() {
      // Mobile hamburger: toggle the sidebar nav as a drawer.
      const navToggle = document.getElementById('btnNavToggle');
      const navBackdrop = document.getElementById('navBackdrop');
      const closeNav = () => {
        app.classList.remove('nav-open');
        if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
      };
      if (navToggle) navToggle.onclick = () => {
        const open = app.classList.toggle('nav-open');
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      if (navBackdrop) navBackdrop.onclick = closeNav;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });

      document.querySelectorAll('.nav button[data-view]').forEach(btn => btn.onclick = () => { activateView(btn.dataset.view); closeNav(); });

      document.getElementById('assetKey').oninput = updateAssetPreview;
      if (document.getElementById('assetSourceMode')) document.getElementById('assetSourceMode').addEventListener('change', syncAssetSourceModeUi);
      document.getElementById('btnRefreshOverview').onclick = refreshOverview;
      document.getElementById('btnSearchOffers').onclick = () => loadCatalogShowcase(true);
      document.getElementById('btnRefreshCatalog').onclick = async () => { await loadCatalogShowcase(true); };
      if (document.getElementById('btnLoadShowcase')) {
        document.getElementById('btnLoadShowcase').onclick = async () => { await loadCatalogShowcase(true); };
      }
      if (document.getElementById('catalogSearchText')) {
        document.getElementById('catalogSearchText').addEventListener('input', () => {
          if (typeof renderCatalogShowcase === 'function') renderCatalogShowcase(state.catalogRows || []);
        });
      }
      if (document.getElementById('catalogFilterConnector')) {
        document.getElementById('catalogFilterConnector').addEventListener('input', () => {
          if (typeof renderCatalogShowcase === 'function') renderCatalogShowcase(state.catalogRows || []);
        });
      }
      
      // Actualizar URL DSP dinámicamente cuando cambia el connector ID
      document.getElementById('searchConnectorId').addEventListener('input', (e) => {
        const connectorId = (e.target.value || getDefaultRemoteConnector()).trim() || getDefaultRemoteConnector();
        const dspUrl = buildDspUrl(connectorId);
        document.getElementById('resolvedAddress').value = dspUrl;
        document.getElementById('transferAddress').value = dspUrl;
      });
      
      document.getElementById('catalogAssetId').addEventListener('change', () => {
        const accept = document.getElementById('catalogAcceptTerms');
        if (accept) accept.checked = false;
        syncCatalogSelectionState();
      });
      document.getElementById('catalogAcceptTerms').addEventListener('change', syncCatalogSelectionState);
      document.getElementById('btnRequestContract').onclick = requestContractByAsset;
      if (document.getElementById('btnOpenAccessRequest')) {
        document.getElementById('btnOpenAccessRequest').onclick = () => {
          if (typeof getSelectedCatalogRow !== 'function' || typeof openAccessRequestModalForRow !== 'function') return;
          const selected = getSelectedCatalogRow();
          openAccessRequestModalForRow(selected);
        };
      }
      if (document.getElementById('btnSubmitAccessRequest')) {
        document.getElementById('btnSubmitAccessRequest').onclick = () => {
          if (typeof submitAccessRequest === 'function') submitAccessRequest();
        };
      }
      if (document.getElementById('btnCloseAccessRequest')) {
        document.getElementById('btnCloseAccessRequest').onclick = () => {
          if (typeof closeAccessRequestModal === 'function') closeAccessRequestModal();
        };
      }
      const accessRequestModal = document.getElementById('accessRequestModal');
      if (accessRequestModal) {
        accessRequestModal.onclick = (e) => {
          if (e.target === accessRequestModal && typeof closeAccessRequestModal === 'function') closeAccessRequestModal();
        };
      }
      document.getElementById('btnListAgreements').onclick = listAgreements;
      document.getElementById('agreementSelect').addEventListener('change', (e) => {
        const contractId = (e.target?.value || '').trim();
        if (!contractId) return;
        if (typeof syncTransferAddressFromAgreement === 'function') syncTransferAddressFromAgreement(contractId);
      });
      document.getElementById('btnStartTransfer').onclick = startTransfer;
      document.getElementById('btnListTransfers').onclick = listTransfers;
      if (document.getElementById('transferMode')) document.getElementById('transferMode').addEventListener('change', syncTransferModeUi);
      if (document.getElementById('btnRestoreFromBackup')) {
        document.getElementById('btnRestoreFromBackup').onclick = async () => {
          await restoreAssetsFromBackup({ onlyIfEmpty: false, silent: false });
        };
      }
      if (document.getElementById('btnArcgisTokenRefresh')) {
        document.getElementById('btnArcgisTokenRefresh').onclick = async () => {
          const token = await resolveArcgisTokenForPublish();
          refreshArcgisTokenIndicator();
          if (!token) {
            writeOut({ status: 401, error: 'No se pudo regenerar token ArcGIS. Revisa la sesión del portal.' });
            return;
          }
          writeOut({ status: 200, message: 'Token ArcGIS regenerado correctamente.' });
        };
      }
      if (document.getElementById('btnPublishArcgisLogin')) {
        document.getElementById('btnPublishArcgisLogin').onclick = () => ensureArcgisLogin();
      }
      if (document.getElementById('btnPublishArcgisTokenRefresh')) {
        document.getElementById('btnPublishArcgisTokenRefresh').onclick = async () => {
          const token = await resolveArcgisTokenForPublish();
          refreshArcgisTokenIndicator();
          if (!token) {
            writeOut({ status: 401, error: 'No se pudo obtener token ArcGIS para el origen del asset.' });
            return;
          }
          writeOut({ status: 200, message: 'Token ArcGIS disponible para publicar el asset.' });
        };
      }
      if (document.getElementById('btnStarArcgisLogin')) {
        document.getElementById('btnStarArcgisLogin').onclick = () => ensureArcgisLogin();
      }
      if (document.getElementById('btnStarTrustRefresh')) {
        document.getElementById('btnStarTrustRefresh').onclick = async () => {
          try { await listSecrets(false); } catch {}
          try { refreshArcgisTokenIndicator(); } catch {}
          try { await refreshOverview(); } catch {}
          try {
            if (typeof refreshStarTrustSnapshot === 'function') {
              await refreshStarTrustSnapshot(true);
            }
          } catch {}
          try { refreshStarTrustPanel(); } catch {}
        };
      }
      if (document.getElementById('btnSaveSecret')) document.getElementById('btnSaveSecret').onclick = saveSecret;
      if (document.getElementById('btnListSecrets')) document.getElementById('btnListSecrets').onclick = () => listSecrets(true);
      if (document.getElementById('btnDeleteSecret')) document.getElementById('btnDeleteSecret').onclick = deleteSecret;
      if (document.getElementById('btnProbeSecrets')) document.getElementById('btnProbeSecrets').onclick = () => discoverSecretsApi(true);
      if (document.getElementById('btnToggleSecretValue')) {
        document.getElementById('btnToggleSecretValue').onclick = () => {
          const input = document.getElementById('secretValue');
          if (!input) return;
          input.type = input.type === 'password' ? 'text' : 'password';
          document.getElementById('btnToggleSecretValue').textContent = input.type === 'password' ? 'Mostrar valor' : 'Ocultar valor';
        };
      }
      document.getElementById('btnCreatePolicy').onclick = async () => writeOut(await createOrUpdatePolicy());
      document.getElementById('btnListPolicies').onclick = listPolicies;
      document.getElementById('btnDeletePolicy').onclick = deletePolicy;
      document.getElementById('btnCreateContractDef').onclick = async () => writeOut(await createContractDefinition());
      document.getElementById('btnListContractDefs').onclick = listContractDefinitions;
      document.getElementById('btnDeleteContractDef').onclick = deleteContractDefinition;
      document.getElementById('btnGoPolicy').onclick = () => activateView('policy');
      document.getElementById('btnGoContract').onclick = () => activateView('contractdef');

      document.getElementById('btnCreateAsset').onclick = async () => {
        writeOut(await createOrUpdateAsset());
        await refreshOverview();
        if (typeof loadPublishedAssets === 'function') await loadPublishedAssets(false);
      };
      document.getElementById('btnListAssets').onclick = async () => {
        writeOut(await callApi('POST', '/v3/assets/request', q()));
        if (typeof loadPublishedAssets === 'function') await loadPublishedAssets(false);
      };
      if (document.getElementById('btnRefreshPublishedAssets')) {
        document.getElementById('btnRefreshPublishedAssets').onclick = async () => {
          if (typeof loadPublishedAssets === 'function') await loadPublishedAssets(true);
        };
      }
      document.getElementById('btnDeleteAsset').onclick = async () => {
        const assetId = String(document.getElementById('assetIdPreview')?.value || '').trim();
        const response = await deleteAssetAndCleanupBackup();
        writeOut(response);
        if (response.status >= 200 && response.status < 300) {
          showInfoPopup('Asset eliminado', { assetId, status: response.status }, { html: renderResultCard({
            title: 'Asset eliminado',
            subtitle: assetId,
            tone: 'ok',
            status: response.status,
            hint: 'Se eliminó el asset y su copia de backup local.'
          }) });
        } else if (!assetId) {
          showInfoPopup('Asset ID requerido', { status: 400 }, { html: renderResultCard({
            title: 'Falta el Asset ID',
            tone: 'warn',
            hint: 'Selecciona o introduce un Asset ID antes de borrar.'
          }) });
        } else {
          showInfoPopup('Error eliminando asset', response);
        }
        if (typeof loadPublishedAssets === 'function') await loadPublishedAssets(false);
      };
      document.getElementById('btnExplorerSend').onclick = async () => writeOut(await callApi(document.getElementById('explMethod').value, document.getElementById('explPath').value.trim(), document.getElementById('explBody').value));

      document.getElementById('btnOpenSettings').onclick = openSettings;
      document.getElementById('btnCloseSettings').onclick = closeSettings;
      settingsModal.onclick = (e) => { if (e.target === settingsModal) closeSettings(); };
      document.getElementById('btnCloseInfo').onclick = closeInfoPopup;
      document.getElementById('btnInfoAction').onclick = () => {
        if (typeof infoActionHandler === 'function') infoActionHandler();
      };
      infoModal.onclick = (e) => { if (e.target === infoModal) closeInfoPopup(); };

      const gaiaxModal = document.getElementById('gaiaxModal');
      if (gaiaxModal) {
        document.getElementById('btnCloseGaiax').onclick = () => gaiaxModal.classList.remove('open');
        gaiaxModal.onclick = (e) => { if (e.target === gaiaxModal) gaiaxModal.classList.remove('open'); };
      }

      const autoApply = () => {
        settings.language = document.getElementById('setLanguage').value;
        settings.theme = document.getElementById('setTheme').value;
        settings.consolePos = document.getElementById('setConsolePos').value;
        settings.consoleFont = Number(document.getElementById('setConsoleFont').value || 13);
        const apiBaseRaw = (document.getElementById('setApiBaseUrl')?.value || cfg.managementApiUrl || '/api/management').trim();
        const apiBaseNormalized = typeof normalizeManagementApiBaseUrl === 'function'
          ? normalizeManagementApiBaseUrl(apiBaseRaw)
          : apiBaseRaw;
        settings.apiBaseUrl = apiBaseNormalized;
        settings.apiKeyOverride = (document.getElementById('setApiKey')?.value || '').trim();
        settings.apiTimeoutMs = Math.max(1000, Number(document.getElementById('setApiTimeout')?.value || 15000));
        settings.apiRetries = Math.max(0, Math.min(5, Number(document.getElementById('setApiRetries')?.value || 1)));
        applySettings();
      };
      ['setLanguage', 'setTheme', 'setConsolePos'].forEach(id => document.getElementById(id).addEventListener('change', autoApply));
      document.getElementById('setConsoleFont').addEventListener('input', autoApply);
      ['setApiBaseUrl', 'setApiKey', 'setApiTimeout', 'setApiRetries'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', autoApply);
      });
      document.getElementById('policyMode').addEventListener('change', applyPolicyMode);

      const authTypeSelect = document.getElementById('pubAuthType');
      const authTokenInput = document.getElementById('pubAuthToken');
      const authHeaderInput = document.getElementById('pubAuthHeader');
      const authPrefixInput = document.getElementById('pubAuthPrefix');
      const authSecretSelect = document.getElementById('pubAuthSecret');

      if (authTypeSelect) authTypeSelect.addEventListener('change', applyAuthTypeForm);
      [authTokenInput, authHeaderInput, authPrefixInput, authSecretSelect].forEach(el => {
        if (!el) return;
        el.addEventListener('input', () => {
          try { syncAuthHeadersJson(); } catch {}
        });
      });

      document.getElementById('btnConsoleToggle').onclick = () => {
        const hidden = app.classList.toggle('console-hidden');
        updateConsoleButtons(hidden);
        persistSettings();
      };
      document.getElementById('btnConsoleExpand').onclick = () => {
        settings.consoleExpanded = !settings.consoleExpanded;
        // Expand/collapse snaps the console to preset sizes; drag gives custom sizes.
        if (settings.consolePos === 'bottom') {
          settings.consoleHeight = settings.consoleExpanded ? 460 : 300;
        } else {
          settings.consoleWidth = settings.consoleExpanded ? 560 : 410;
        }
        applySettings();
        persistSettings();
      };
      document.getElementById('btnConsoleShow').onclick = () => {
        app.classList.remove('console-hidden');
        updateConsoleButtons(false);
      };
      initConsoleResizer();
    }

    window.useAgreement = (id) => {
      document.getElementById('agreementId').value = id;
      document.getElementById('agreementSelect').value = id;
      if (typeof syncTransferAddressFromAgreement === 'function') syncTransferAddressFromAgreement(id);
      activateView('transfers');
    };

    // Solicitudes panel
    window.approveAccessRequest = approveAccessRequest;
    window.rejectAccessRequest = rejectAccessRequest;
    window.withdrawAccessRequest = withdrawAccessRequest;
    window.revokeAccessRequest = revokeAccessRequest;

    document.getElementById('btnRefreshSolicitudes')?.addEventListener('click', () => loadAccessRequestsPanel());
    document.getElementById('btnFilterSolicitudesAll')?.addEventListener('click', () => loadAccessRequestsPanel('all'));
    document.getElementById('btnFilterSolicitudesPending')?.addEventListener('click', () => loadAccessRequestsPanel('pending'));
    document.getElementById('btnFilterSolicitudesApproved')?.addEventListener('click', () => loadAccessRequestsPanel('approved'));
    document.getElementById('btnFilterSolicitudesRejected')?.addEventListener('click', () => loadAccessRequestsPanel('rejected'));
    window.checkTransfer = checkTransfer;
    window.useCatalogAsset = (assetId) => {
      const idx = state.catalogRows.findIndex(r => r.assetId === assetId);
      if (idx >= 0) document.getElementById('catalogAssetId').value = String(idx);
      const accept = document.getElementById('catalogAcceptTerms');
      if (accept) accept.checked = false;
      syncCatalogSelectionState();
      activateView('catalog');
    };
    window.useCatalogAssetByIndex = (idx) => {
      const parsed = Number(idx);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed >= (state.catalogRows || []).length) return;
      const select = document.getElementById('catalogAssetId');
      if (select) select.value = String(parsed);
      const accept = document.getElementById('catalogAcceptTerms');
      if (accept) accept.checked = false;
      syncCatalogSelectionState();
      activateView('catalog');
      const contractBox = document.getElementById('catalogContractBox');
      if (contractBox) contractBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.openAccessRequestByIndex = (idx) => {
      const parsed = Number(idx);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed >= (state.catalogRows || []).length) return;
      const select = document.getElementById('catalogAssetId');
      if (select) select.value = String(parsed);
      syncCatalogSelectionState();
      if (typeof openAccessRequestModalForRow === 'function') {
        openAccessRequestModalForRow(state.catalogRows[parsed]);
      }
    };
    window.showCatalogAssetStatusByIndex = (idx) => {
      const parsed = Number(idx);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed >= (state.catalogRows || []).length) return;
      const row = state.catalogRows[parsed] || {};
      const availability = typeof getCatalogContractAvailability === 'function'
        ? getCatalogContractAvailability(row)
        : { canContract: false, reason: 'Estado no disponible.', nextStep: 'Recarga el catalogo.' };
      const select = document.getElementById('catalogAssetId');
      if (select) select.value = String(parsed);
      syncCatalogSelectionState();
      activateView('catalog');
      showInfoPopup('Estado del asset', {
        assetId: row.assetId || '',
        connector: row.connectorId || row.assigner || '',
        estado: typeof getCatalogRowState === 'function' ? getCatalogRowState(row) : '',
        acceso: row.accessRequestStatus || 'sin solicitud',
        requestId: row.accessRequestId || '',
        offerId: row.offerId || '',
        contratacion: availability.canContract
          ? 'Puedes iniciar contratación.'
          : availability.reason,
        siguientePaso: availability.nextStep,
      });
    };
    window.showAgreementDetail = (index) => showInfoPopup('Detalle de contrato', state.agreementRows[index] || {});
    window.showTransferDetail = (index) => showInfoPopup('Detalle de transferencia', state.transferRows[index] || {});
    // Keep original handlers from 02-operations.js to avoid recursive self-calls.

    function init() {
      hideAuthGate();
      document.getElementById('badge').textContent = `${role} · EDC · ${getApiBaseUrl() || 'management api'}`;
      const configuredRemoteConnector = (cfg.defaultRemoteConnector || '').trim();
      document.getElementById('searchConnectorId').value = configuredRemoteConnector || getDefaultRemoteConnector();
      document.getElementById('transferAddress').value = '';
      if (document.getElementById('catalogConnectorsList')) {
        document.getElementById('catalogConnectorsList').value = (cfg.connectorCatalogList || 'conectoruc3m, conectorFuenlabrada').trim();
      }
      if (document.getElementById('catalogFilterConnector')) {
        document.getElementById('catalogFilterConnector').value = '';
      }
      document.getElementById('btnEitelPortal').onclick = () => window.open('https://uc3m-espacioeitel.hub.arcgis.com/', '_blank');
      document.getElementById('btnEitelProyecto').onclick = () => window.open('https://uc3m-espacioeitel.hub.arcgis.com/pages/proyecto', '_blank');
      document.getElementById('btnEitelCatalogo').onclick = () => window.open('https://uc3m-espacioeitel.hub.arcgis.com/search', '_blank');
      updateAssetPreview();
      loadSettings();
      applyProjectVariantUi();
      bindEvents();
      
      // Inicializar URL DSP con el valor por defecto
      const initialConnectorId = (document.getElementById('searchConnectorId').value || configuredRemoteConnector || getDefaultRemoteConnector()).trim() || getDefaultRemoteConnector();
      document.getElementById('resolvedAddress').value = buildDspUrl(initialConnectorId);
      document.getElementById('transferAddress').value = buildDspUrl(initialConnectorId);
      
      document.getElementById('btnArcgisLogout').onclick = arcgisLogout;
      applyPolicyMode();
      if (typeof syncAssetSourceModeUi === 'function') syncAssetSourceModeUi();
      if (typeof applyAuthTypeForm === 'function') applyAuthTypeForm();
      if (typeof syncTransferModeUi === 'function') syncTransferModeUi();
      applyProjectVariantUi();
      if (typeof ensureArcgisTokenIndicatorTimer === 'function') ensureArcgisTokenIndicatorTimer();
      if (typeof refreshArcgisTokenIndicator === 'function') refreshArcgisTokenIndicator();
      if (typeof refreshStarTrustPanel === 'function') refreshStarTrustPanel();
      if (arcgis?.enabled && arcgis?.requiresLogin && typeof ensureArcgisLogin === 'function') {
        ensureArcgisLogin();
      }
      applySettings();

      refreshOverview();
      loadCatalogShowcase(false);
      loadPublishedAssets(false);
      restoreAssetsFromBackup({ onlyIfEmpty: true, silent: true });
      listSecrets(false);
      // Badge de solicitudes pendientes: cargar al inicio y refrescar cada 60 s
      refreshSolicitudesBadge();
      setInterval(refreshSolicitudesBadge, 60000);
    }
    init();

