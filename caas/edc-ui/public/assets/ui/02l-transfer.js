// ============================================================
// Data transfer operations
// Lines 7014-7669 of the original 02-operations.js
// ============================================================

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
      if (starTrustConfig.enabled) {
        starTrustState.lastAgreementId = contractId;
        starTrustState.lastAssetId = agreementAssetId || starTrustState.lastAssetId;
        starTrustState.lastCounterParty = transferParty?.counterPartyId || transferParty?.providerRaw || starTrustState.lastCounterParty;
        starTrustState.transferState = 'preparing';
        starTrustState.transferDetail = `Preparando transferencia directa para el contrato ${clean(contractId)} hacia ${transferParty?.address || document.getElementById('transferAddress').value.trim() || '-'}.`;
        pushStarTrustEvent('Preparación de transferencia', starTrustState.transferDetail, 'info');
      }
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

      const privateAccess = await validatePrivateAgreementTransferAccess(agreementAssetId, transferParty);
      if (!privateAccess.allowed) {
        showInfoPopup('Transferencia bloqueada', {
          message: 'Este contrato corresponde a un asset privado sin solicitud aprobada para este conector. Solicita acceso o espera a que el propietario apruebe la solicitud antes de transferir.',
          contractId,
          assetId: agreementAssetId,
          estadoSolicitud: privateAccess.accessStatus || 'none',
          source: privateAccess.source || '',
        });
        writeOut({
          status: 403,
          error: 'Asset privado sin solicitud aprobada. Transferencia bloqueada.',
          contractId,
          assetId: agreementAssetId,
          privateAccess,
        });
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
          // Si no hay hint en memoria (contrato de sesiones previas o catálogo cargado sin negociación),
          // consultar la Management API del proveedor para obtener la URL pública del asset.
          if (downloadResp?.status === 404 && agreementAssetId && transferParty?.counterPartyId) {
            const providerConnectorId = extractConnectorIdHint(transferParty.counterPartyId) || transferParty.counterPartyId;
            const providerAssetResp = await callConnectorManagementApi(
              providerConnectorId, 'GET', `/v3/assets/${encodeURIComponent(agreementAssetId)}`, undefined,
              { timeoutMs: 5000, silent: true }
            ).catch(() => null);
            if (providerAssetResp?.status >= 200 && providerAssetResp?.status < 300) {
              const derivedUrl = pickBestSourceUrl(collectUrlCandidatesFromObject(providerAssetResp.data));
              if (derivedUrl) {
                const providerHintResp = await downloadFromSourceHint(contractId, agreementAssetId, derivedUrl);
                if (providerHintResp?.status >= 200 && providerHintResp?.status < 300) {
                  downloadResp = providerHintResp;
                }
              }
            }
          }
        }
        // Si el asset no existe localmente y no se pudo obtener URL directa (asset privado o error de red),
        // usar transferencia EDC al sink local como último recurso.
        if (downloadResp?.status === 404) {
          downloadResp = await downloadRemoteAssetViaTransfer(contractId, agreementAssetId, transferParty);
        }
        const localTransfer = addLocalTransferRecord(buildLocalTransferRecord(downloadResp));
        if (starTrustConfig.enabled) {
          starTrustState.lastTransferId = localTransfer.id || '';
          starTrustState.transferState = downloadResp.status >= 200 && downloadResp.status < 300 ? 'completed' : 'failed';
          starTrustState.transferDetail = downloadResp.status >= 200 && downloadResp.status < 300
            ? `El consumidor ha obtenido el dato ${clean(downloadResp.filename || agreementAssetId || '-')} directamente desde el nodo proveedor.`
            : `La descarga directa del asset ${clean(agreementAssetId || '-')} no se ha completado correctamente.`;
          pushStarTrustEvent(downloadResp.status >= 200 && downloadResp.status < 300 ? 'Transferencia directa completada' : 'Transferencia directa con error', starTrustState.transferDetail, downloadResp.status >= 200 && downloadResp.status < 300 ? 'ok' : 'danger');
        }
        writeOut(downloadResp);
        await logTransferEvent({
          eventType: 'local-download',
          status: downloadResp.status >= 200 && downloadResp.status < 300 ? 'COMPLETED' : 'FAILED',
          transferMode,
          transferType: 'LOCAL-DOWNLOAD',
          transferId: localTransfer.id,
          contractId,
          assetId: agreementAssetId,
          counterPartyId: transferParty?.counterPartyId || '',
          counterPartyAddress: transferParty?.address || '',
          destination: 'browser-download',
          bytes: downloadResp.bytes || 0,
          filename: downloadResp.filename || '',
          detail: downloadResp.error || downloadResp.detail || '',
        }, transferParty?.address || '');
        await refreshOverview();
        await listTransfers();
        if (downloadResp.status >= 200 && downloadResp.status < 300) {
          const isDirectDownload = downloadResp.downloaded === true;
          showInfoPopup('Descarga iniciada', {
            transferId: localTransfer.id,
            contractId,
            assetId: agreementAssetId,
            filename: downloadResp.filename,
            bytes: downloadResp.bytes,
            sourceUrl: downloadResp.sourceUrl,
            message: isDirectDownload
              ? 'El navegador ha iniciado la descarga local. Normalmente se guardará en Descargas según tu configuración del navegador.'
              : 'Transferencia remota en curso. El archivo se descargará automáticamente cuando el servidor proveedor lo envíe al sink local (puede tardar unos segundos).'
          });
        } else {
          showInfoPopup('Error en descarga local', downloadResp);
        }
        return;
      }

      if (transferMode === 'arcgis-upload') {
        const uploadResp = await uploadTransferToArcgis(contractId, agreementAssetId, transferParty);
        const localTransfer = addLocalTransferRecord(buildLocalTransferRecord(uploadResp));
        if (starTrustConfig.enabled) {
          starTrustState.lastTransferId = localTransfer.id || '';
          starTrustState.transferState = uploadResp.status >= 200 && uploadResp.status < 300 ? 'completed' : 'failed';
          starTrustState.transferDetail = uploadResp.status >= 200 && uploadResp.status < 300
            ? `El dato ${clean(uploadResp.filename || agreementAssetId || '-')} se ha cargado en ArcGIS tras la transferencia directa.`
            : `La subida a ArcGIS tras la transferencia del asset ${clean(agreementAssetId || '-')} ha fallado.`;
          pushStarTrustEvent(uploadResp.status >= 200 && uploadResp.status < 300 ? 'Carga ArcGIS completada' : 'Carga ArcGIS fallida', starTrustState.transferDetail, uploadResp.status >= 200 && uploadResp.status < 300 ? 'ok' : 'danger');
        }
        writeOut(uploadResp);
        await logTransferEvent({
          eventType: 'arcgis-upload',
          status: uploadResp.status >= 200 && uploadResp.status < 300 ? 'COMPLETED' : 'FAILED',
          transferMode,
          transferType: 'ARCGIS-UPLOAD',
          transferId: localTransfer.id,
          contractId,
          assetId: agreementAssetId,
          counterPartyId: transferParty?.counterPartyId || '',
          counterPartyAddress: transferParty?.address || '',
          destination: arcgis?.portalUrl || 'ArcGIS',
          bytes: uploadResp.bytes || 0,
          filename: uploadResp.filename || '',
          detail: uploadResp.error || uploadResp.detail || '',
        }, transferParty?.address || '');
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
      if (starTrustConfig.enabled) {
        starTrustState.transferState = r.status >= 200 && r.status < 300 ? 'running' : 'failed';
        starTrustState.transferDetail = r.status >= 200 && r.status < 300
          ? `La transferencia ${clean(r?.data?.['@id'] || r?.data?.id || contractId)} ha sido aceptada. El dato viajará de nodo a nodo sin pasar por el coordinador.`
          : `La transferencia del contrato ${clean(contractId)} no ha podido iniciarse.`;
        pushStarTrustEvent(r.status >= 200 && r.status < 300 ? 'Transferencia P2P iniciada' : 'Inicio de transferencia fallido', starTrustState.transferDetail, r.status >= 200 && r.status < 300 ? 'info' : 'danger');
      }
      writeOut(r);

      const transferId = r?.data?.['@id'] || r?.data?.id || '';
      await logTransferEvent({
        eventType: 'edc-push',
        status: r.status >= 200 && r.status < 300 ? 'STARTED' : 'FAILED',
        transferMode,
        transferType: 'HttpData-PUSH',
        transferId,
        contractId,
        assetId: agreementAssetId,
        counterPartyId: transferParty?.counterPartyId || '',
        counterPartyAddress: transferParty?.address || document.getElementById('transferAddress').value.trim(),
        destination: sinkBaseUrl,
        detail: r.status >= 200 && r.status < 300 ? 'TransferProcess creado' : JSON.stringify(r.data || {}),
      }, transferParty?.address || '');
      if (r.status >= 200 && r.status < 300) {
        if (starTrustConfig.enabled) starTrustState.lastTransferId = transferId || '';
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

    /**
     * Retrieves all transfer processes from connector API.
     * Fetches completed, active, and failed transfers.
     * Combines local storage records with remote API data.
     * 
     * @async
     * @returns {Promise<Object>} API response with transfer list
     * 
     * @example
     * await listTransfers(); // Load all transfer records
     */
    async function listTransfers() {
      const r = await callApi('POST', '/v3/transferprocesses/request', q());
      const transferEvents = await fetchTransferEventRows();
      const eventRows = transferEvents.map(event => ({
        '@id': event.eventId || '',
        id: event.eventId || '',
        state: event.status || '-',
        contractId: event.contractId || '',
        assetId: event.assetId || '',
        transferType: event.transferType || event.eventType || 'EVENT',
        transferMode: event.transferMode || '',
        role: event.role || '',
        destination: event.destination || '',
        counterPartyId: event.counterPartyId || '',
        counterPartyAddress: event.counterPartyAddress || '',
        filename: event.filename || '',
        bytes: event.bytes || 0,
        errorDetail: event.detail || '',
        createdAt: event.createdAt || '',
        localEvent: true,
      }));
      const rows = [...eventRows, ...getAllTransferRows(unwrap(r))];
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
          const type = clean(t.transferType || t.transferMode || (t.localDownload ? 'LOCAL-DOWNLOAD' : 'EDC'));
          const role = t.role ? ` · ${clean(t.role)}` : '';
          const title = t.localEvent
            ? `${type}${role} · ${clean(t.assetId || t.filename || id)}`
            : (t.localDownload ? `Descarga local · ${clean(t.filename || id)}` : `Transferencia ${i + 1}`);
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
      try { refreshStarTrustPanel(); } catch {}
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

      const eventTransfer = (await fetchTransferEventRows()).find(t => (t.eventId || t.id || '') === transferId);
      if (eventTransfer) {
        const st = normalizeTransferState(eventTransfer.status || '-');
        showInfoPopup(`Evento: ${st}`, {
          eventId: transferId,
          role: eventTransfer.role || '',
          eventType: eventTransfer.eventType || '',
          transferMode: eventTransfer.transferMode || '',
          transferType: eventTransfer.transferType || '',
          contractId: eventTransfer.contractId || '',
          assetId: eventTransfer.assetId || '',
          counterPartyId: eventTransfer.counterPartyId || '',
          destination: eventTransfer.destination || '',
          filename: eventTransfer.filename || '',
          bytes: eventTransfer.bytes || 0,
          createdAt: fmtDate(eventTransfer.createdAt || ''),
          detail: eventTransfer.detail || '',
        });
        writeOut({ status: 200, data: eventTransfer, transferEvent: true });
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
    window.editPublishedAsset = editPublishedAsset;
    window.editPublishedPolicy = editPublishedPolicy;
    window.editPublishedContract = editPublishedContract;
    window.deletePublishedAsset = deletePublishedAsset;
    window.deletePublishedPolicy = deletePublishedPolicy;
    window.deletePublishedContract = deletePublishedContract;

    /**
     * Deletes a transfer record from local or remote storage.
     * Removes transfer from visible list and optionally hides from future display.
     * 
     * @async
     * @param {string} transferId - Transfer ID to delete
     * @param {boolean} [isLocal=false] - Whether to delete from local storage only
     * @returns {Promise<void>}
     * 
     * @example
     * await deleteTransferRecord('transfer-123'); // Delete transfer record
     */
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

    /**
     * Checks status of the dummy sink test service.
     * Fetches recorded messages from dummy inbox endpoint.
     * Useful for testing connector message flow without real transfers.
     * 
     * @async
     * @returns {Promise<void>}
     * 
     * @example
     * await checkDummy(); // Check dummy sink records
     */
    async function checkDummy() {
      try {
        const res = await fetch(`${settings.dummyUrl}/v1/dummy-sink/records`);
        const data = await res.json();
        writeOut({ status: res.status, data });
      } catch (e) {
        writeOut({ step: 'Dummy inbox error', error: String(e), hint: `${settings.dummyUrl}/health` });
      }
    }

    /**
     * Clears all records from the dummy sink test service.
     * Resets dummy inbox for fresh testing of connector message flow.
     * 
     * @async
     * @returns {Promise<void>}
     * 
     * @example
     * await clearDummy(); // Clear dummy sink records
     */
    async function clearDummy() {
      try {
        const res = await fetch(`${settings.dummyUrl}/v1/dummy-sink/records`, { method: 'DELETE' });
        const data = await res.json();
        writeOut({ status: res.status, data });
      } catch (e) {
        writeOut({ error: String(e) });
      }
    }

    // ── GAIA-X Identity Modal ─────────────────────────────────────────────────

