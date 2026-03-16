function openSettings() { settingsModal.classList.add('open'); }
    function closeSettings() { settingsModal.classList.remove('open'); }

    function bindEvents() {
      document.querySelectorAll('.nav button[data-view]').forEach(btn => btn.onclick = () => activateView(btn.dataset.view));

      document.getElementById('assetKey').oninput = updateAssetPreview;
      document.getElementById('btnRefreshOverview').onclick = refreshOverview;
      document.getElementById('btnSearchOffers').onclick = () => loadCatalogs(true);
      document.getElementById('btnRefreshCatalog').onclick = async () => { await loadCatalogs(false); };
      document.getElementById('catalogAssetId').addEventListener('change', () => {
        const accept = document.getElementById('catalogAcceptTerms');
        if (accept) accept.checked = false;
        syncCatalogSelectionState();
      });
      document.getElementById('catalogAcceptTerms').addEventListener('change', syncCatalogSelectionState);
      document.getElementById('btnRequestContract').onclick = requestContractByAsset;
      document.getElementById('btnListAgreements').onclick = listAgreements;
      document.getElementById('btnStartTransfer').onclick = startTransfer;
      document.getElementById('btnListTransfers').onclick = listTransfers;
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
      };
      document.getElementById('btnListAssets').onclick = async () => writeOut(await callApi('POST', '/v3/assets/request', q()));
      document.getElementById('btnDeleteAsset').onclick = async () => writeOut(await callApi('DELETE', `/v3/assets/${encodeURIComponent(document.getElementById('assetIdPreview').value)}`));
      document.getElementById('btnExplorerSend').onclick = async () => writeOut(await callApi(document.getElementById('explMethod').value, document.getElementById('explPath').value.trim(), document.getElementById('explBody').value));

      document.getElementById('btnOpenSettings').onclick = openSettings;
      document.getElementById('btnCloseSettings').onclick = closeSettings;
      settingsModal.onclick = (e) => { if (e.target === settingsModal) closeSettings(); };
      document.getElementById('btnCloseInfo').onclick = closeInfoPopup;
      document.getElementById('btnInfoAction').onclick = () => {
        if (typeof infoActionHandler === 'function') infoActionHandler();
      };
      infoModal.onclick = (e) => { if (e.target === infoModal) closeInfoPopup(); };

      const autoApply = () => {
        settings.language = document.getElementById('setLanguage').value;
        settings.theme = document.getElementById('setTheme').value;
        settings.consolePos = document.getElementById('setConsolePos').value;
        settings.consoleFont = Number(document.getElementById('setConsoleFont').value || 13);
        settings.apiBaseUrl = (document.getElementById('setApiBaseUrl')?.value || cfg.managementApiUrl || '/api/management').trim();
        settings.apiKeyOverride = (document.getElementById('setApiKey')?.value || '').trim();
        settings.apiTimeoutMs = Math.max(1000, Number(document.getElementById('setApiTimeout')?.value || 15000));
        settings.apiRetries = Math.max(0, Math.min(5, Number(document.getElementById('setApiRetries')?.value || 1)));
        if (settings.consolePos === 'bottom') app.classList.remove('console-hidden');
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
      if (authTypeSelect) authTypeSelect.addEventListener('change', applyAuthTypeForm);

      document.getElementById('btnConsoleToggle').onclick = () => {
        const hidden = app.classList.toggle('console-hidden');
        updateConsoleButtons(hidden);
        persistSettings();
      };
      document.getElementById('btnConsoleExpand').onclick = () => {
        settings.consoleExpanded = !settings.consoleExpanded;
        applySettings();
      };
      document.getElementById('btnConsoleShow').onclick = () => {
        app.classList.remove('console-hidden');
        updateConsoleButtons(false);
      };
    }

    window.useAgreement = (id) => {
      document.getElementById('agreementId').value = id;
      document.getElementById('agreementSelect').value = id;
      activateView('transfers');
    };
    window.checkTransfer = checkTransfer;
    window.useCatalogAsset = (assetId) => {
      const idx = state.catalogRows.findIndex(r => r.assetId === assetId);
      if (idx >= 0) document.getElementById('catalogAssetId').value = String(idx);
      const accept = document.getElementById('catalogAcceptTerms');
      if (accept) accept.checked = false;
      syncCatalogSelectionState();
      activateView('catalog');
    };
    window.showAgreementDetail = (index) => showInfoPopup('Detalle de contrato', state.agreementRows[index] || {});
    window.showTransferDetail = (index) => showInfoPopup('Detalle de transferencia', state.transferRows[index] || {});

    function init() {
      if (arcgis.enabled) {
        showAuthGate('Validando sesion ArcGIS...', false);
      }
      document.getElementById('badge').textContent = `${role} · EDC · ${getApiBaseUrl() || 'management api'}`;
      document.getElementById('searchConnectorId').value = '';
      document.getElementById('transferAddress').value = '';
      document.getElementById('btnEitelPortal').onclick = () => window.open('https://uc3m-espacioeitel.hub.arcgis.com/', '_blank');
      document.getElementById('btnEitelProyecto').onclick = () => window.open('https://uc3m-espacioeitel.hub.arcgis.com/pages/proyecto', '_blank');
      document.getElementById('btnEitelCatalogo').onclick = () => window.open('https://uc3m-espacioeitel.hub.arcgis.com/search', '_blank');
      updateAssetPreview();
      loadSettings();
      bindEvents();
      document.getElementById('btnArcgisLogout').onclick = arcgisLogout;
      applyPolicyMode();
      if (typeof applyAuthTypeForm === 'function') applyAuthTypeForm();
      applySettings();

      ensureArcgisLogin().then((ok) => {
        if (!ok) return;
        if (arcgis.enabled && authState.username) {
          document.getElementById('badge').textContent = `${role} · ${authState.username} · ${getApiBaseUrl() || 'management api'}`;
          document.getElementById('btnArcgisLogout').style.display = 'inline-flex';
        }
        refreshOverview();
        loadCatalogs(false);
        listSecrets(false);
      });
    }
    init();

