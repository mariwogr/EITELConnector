    function buildArcgisMetadataEnvelope({
      manualTitle,
      manualTags,
      manualDescription,
      contractId,
      assetId,
      sourceUrl,
      blobFilename,
      fallbackTitle,
      fallbackDescription,
      fallbackKeywords,
    }) {
      const cleanAsset = clean(assetId || blobFilename || 'asset');
      const today = new Date().toISOString().slice(0, 10);
      const title = String(manualTitle || '').trim() || fallbackTitle || `EITEL ${cleanAsset} ${today}`;

      const manualTagList = parseKeywordList(manualTags || '');
      const autoTagList = [
        ...(Array.isArray(fallbackKeywords) ? fallbackKeywords : []),
        'eitel',
        String(connectorName || '').toLowerCase(),
        contractId ? `contract:${contractId}` : '',
        assetId ? `asset:${assetId}` : '',
      ].map(v => String(v || '').trim()).filter(Boolean);
      const tags = [...new Set((manualTagList.length ? manualTagList : autoTagList).slice(0, 20))].join(', ');

      const descriptionAuto = [
        fallbackDescription || '',
        `Asset: ${assetId || '-'}`,
        `Contract: ${contractId || '-'}`,
        sourceUrl ? `Origen: ${sourceUrl}` : '',
      ].filter(Boolean).join(' | ');
      const description = String(manualDescription || '').trim() || descriptionAuto || 'Item creado desde transferencia EDC.';

      const snippet = `${title} · ${contractId ? `Contrato ${clean(contractId)}` : 'Sin contrato'} · ${cleanAsset}`.slice(0, 240);
      return { title, tags, description, snippet };
    }

    /**
     * Fetches asset blob/file data for uploading to ArcGIS.
     * Retrieves binary data from local storage or remote source for upload.
     * Handles authentication and data formatting for ArcGIS compatibility.
     * 
     * @async
     * @param {string} contractId - Contract ID for transfer context
     * @param {string} assetId - Asset ID to fetch blob for
     * @returns {Promise<Object>} Blob object with binary data and metadata
     * 
     * @example
     * const blob = await fetchAssetBlobForArcgisUpload('contract-123', 'asset-456');
     */
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
          const hintedRes = await fetch(hintedUrl, {
            method: 'GET',
            headers: getLocalAssetsAuthHeadersForUrl(hintedUrl),
            credentials: 'include',
          });
          const hintedContentType = hintedRes.headers.get('content-type') || 'application/octet-stream';
          if (!hintedRes.ok) {
            const detail = await hintedRes.text();
            return { status: hintedRes.status, error: 'No se pudo descargar el asset remoto para subir a ArcGIS.', detail: detail.slice(0, 1000) };
          }
          let hintedBlob;
          if (String(hintedContentType || '').toLowerCase().includes('text/html')) {
            const text = await hintedRes.text();
            return {
              status: 502,
              error: 'La URL alternativa devolvió HTML/error en vez de un dato para subir a ArcGIS.',
              contentType: hintedContentType,
              preview: text.slice(0, 500),
              sourceUrl: hintedUrl,
              badPayload: true,
            };
          }
          if (/json|text\//i.test(hintedContentType)) {
            const text = await hintedRes.text();
            const badPayload = looksLikeSourceErrorPayload(text, hintedContentType);
            if (badPayload) {
              return {
                status: 502,
                error: 'La URL alternativa devolvió error/login en vez de un dato para subir a ArcGIS.',
                contentType: hintedContentType,
                preview: text.slice(0, 500),
                sourceUrl: hintedUrl,
                badPayload: true,
              };
            }
            hintedBlob = new Blob([text], { type: hintedContentType });
          } else {
            hintedBlob = await hintedRes.blob();
          }
          return {
            status: 200,
            blob: hintedBlob,
            filename: inferDownloadFilename(assetId, hintedUrl, hintedContentType || hintedBlob.type, hintedRes.headers.get('content-disposition') || ''),
            contentType: hintedContentType || hintedBlob.type || 'application/octet-stream',
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

      if (sourceMode === 'arcgis-feature-layer') {
        const exportFormat = String(props['eitel:arcgisExportFormat'] || 'geojson').trim();
        const token = authType === 'arcgis-login' ? (await resolveArcgisTokenForPublish()) : '';
        if (authType === 'arcgis-login' && !token) {
          return { status: 401, error: 'No se pudo obtener token ArcGIS para exportar el FeatureLayer.' };
        }
        const layerBaseUrl = normalizeArcgisFeatureLayerBaseUrl(baseUrl);
        const exportUrl = `${layerBaseUrl.replace(/\/+$/, '')}${buildArcgisFeatureLayerQueryPath(exportFormat, token)}`;
        try {
          const response = await fetch(exportUrl, { method: 'GET', credentials: 'include' });
          if (!response.ok) return { status: response.status, error: 'No se pudo exportar el FeatureLayer ArcGIS.' };
          const text = await response.text();
          const responseContentType = response.headers.get('content-type') || '';
          const badPayload = looksLikeSourceErrorPayload(text, responseContentType);
          if (badPayload) {
            return {
              status: 502,
              error: 'ArcGIS devolvió HTML/error en vez del formato de exportación solicitado.',
              contentType: responseContentType,
              preview: text.slice(0, 500),
              sourceUrl: exportUrl,
            };
          }
          const contentType = getArcgisExportContentType(exportFormat);
          const blob = new Blob([text], { type: contentType });
          const filename = inferArcgisExportFilename(assetId, exportFormat);
          return { status: 200, blob, filename, contentType, sourceUrl: exportUrl };
        } catch (error) {
          return { status: 500, error: `Error exportando FeatureLayer ArcGIS: ${String(error)}` };
        }
      }

      if (authType === 'arcgis-login') {
        const authToken = await resolveArcgisTokenForPublish();
        if (!authToken) return { status: 401, error: 'No se pudo obtener token ArcGIS para leer el asset.' };
        path = buildArcgisPathWithToken(removeQueryParams(path, ['token']), authToken);
        headers = { ...headers, token: authToken };
      }
      if (sourceMode === 'local-file') {
        headers = getLocalAssetsAuthHeaders(headers);
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

    /**
     * Fetches remote asset blob using EDC transfer and download sink.
     * Initiates transfer to download-sink service and retrieves binary file data.
     * Handles counter-party resolution and transfer monitoring.
     * 
     * @async
     * @param {string} contractId - Contract ID for transfer
     * @param {string} assetId - Asset ID to fetch
     * @param {string|null} [transferParty=null] - Optional counter-party identifier
     * @returns {Promise<Object>} Blob response with binary data and metadata
     * 
     * @example
     * const blob = await fetchRemoteBlobViaTransferSink('contract-123', 'asset-456');
     */
    async function fetchRemoteBlobViaTransferSink(contractId, assetId, transferParty = null) {
      const transferAddress = String(transferParty?.address || '').trim() || (document.getElementById('transferAddress')?.value || '').trim();
      const counterPartyId = String(transferParty?.counterPartyId || '').trim();
      if (!transferAddress) {
        return { status: 400, error: 'Falta dirección DSP del partner para recuperar el asset remoto.' };
      }

      const sinkPublicBaseUrl = buildLocalDownloadSinkPublicBaseUrl();
      const sinkInternalBaseUrl = buildLocalDownloadSinkInternalBaseUrl();
      const sinkBaseUrlForTransfer = shouldUsePublicSinkForRemoteTransfer(transferAddress)
        ? sinkPublicBaseUrl
        : sinkInternalBaseUrl;

      try { await fetch(`${sinkPublicBaseUrl}/records`, { method: 'DELETE', headers: getLocalAssetsAuthHeaders() }); } catch {}

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

      const startResp = await callApi('POST', '/v3/transferprocesses', JSON.stringify(transferReq), { retries: 0, silent: true });
      const transferId = startResp?.data?.['@id'] || startResp?.data?.id || '';
      if (!(startResp.status >= 200 && startResp.status < 300) || !transferId) {
        return {
          status: startResp.status || 500,
          error: 'No se pudo iniciar la transferencia remota al sink local para ArcGIS.',
          response: startResp,
        };
      }

      const started = Date.now();
      const timeoutMs = 180000;
      while (Date.now() - started < timeoutMs) {
        await sleepMs(2500);

        const record = await getLatestDownloadSinkRecord(contractId).catch(() => null);
        if (record?.downloadPath) {
          const fileUrl = `${sinkPublicBaseUrl}${record.downloadPath}`;
          try {
            const fileResp = await fetch(fileUrl, { method: 'GET', headers: getLocalAssetsAuthHeaders(), credentials: 'include' });
            if (!fileResp.ok) {
              return {
                status: fileResp.status,
                error: 'El sink local recibió registro pero no se pudo leer el archivo.',
                sourceUrl: fileUrl,
              };
            }
            const contentType = fileResp.headers.get('content-type') || 'application/octet-stream';
            let blob;
            if (String(contentType || '').toLowerCase().includes('text/html')) {
              const text = await fileResp.text();
              return {
                status: 502,
                error: 'El sink local recibió HTML/error en vez de un dato para subir a ArcGIS.',
                sourceUrl: fileUrl,
                contentType,
                preview: text.slice(0, 500),
                transferId,
                badPayload: true,
              };
            }
            if (/json|text\//i.test(contentType)) {
              const text = await fileResp.text();
              const badPayload = looksLikeSourceErrorPayload(text, contentType);
              if (badPayload) {
                return {
                  status: 502,
                  error: 'El sink local recibió error/login en vez de un dato para subir a ArcGIS.',
                  sourceUrl: fileUrl,
                  contentType,
                  preview: text.slice(0, 500),
                  transferId,
                  badPayload: true,
                };
              }
              blob = new Blob([text], { type: contentType });
            } else {
              blob = await fileResp.blob();
            }
            const filename = record.filename || inferDownloadFilename(assetId, fileUrl, contentType, fileResp.headers.get('content-disposition') || '');
            return { status: 200, blob, filename, contentType, sourceUrl: fileUrl, transferId };
          } catch (error) {
            return { status: 500, error: `Error leyendo archivo del sink local: ${String(error)}`, transferId };
          }
        }

        const stateResp = await callApi('GET', `/v3/transferprocesses/${encodeURIComponent(transferId)}/state`, undefined, { silent: true, retries: 0 });
        const st = normalizeTransferState(stateResp?.data?.state || stateResp?.data?.['edc:state'] || '');
        if (st === 'FAILED' || st === 'TERMINATED') {
          return {
            status: 502,
            error: 'La transferencia remota terminó en error antes de guardar archivo en sink local.',
            transferId,
            state: st,
          };
        }
      }

      return {
        status: 504,
        error: 'Timeout esperando archivo remoto en sink local para subida ArcGIS.',
      };
    }

    /**
     * Uploads asset blob to ArcGIS Portal as an item.
     * Handles file upload, item creation, and metadata assignment on ArcGIS server.
     * Supports various item types and includes error recovery strategies.
     * 
     * @async
     * @param {string} contractId - Contract ID context
     * @param {string} assetId - Asset ID being uploaded
     * @param {string|null} [transferParty=null] - Optional counter-party context
     * @returns {Promise<Object>} Upload response with item creation status
     * 
     * @example
     * const result = await uploadTransferToArcgis('contract-123', 'asset-456');
     */
    async function uploadTransferToArcgis(contractId, assetId, transferParty = null) {
      const title = String(document.getElementById('arcgisUploadTitle')?.value || '').trim();
      const typeInput = String(document.getElementById('arcgisUploadType')?.value || '').trim();
      const tags = String(document.getElementById('arcgisUploadTags')?.value || '').trim();
      const description = String(document.getElementById('arcgisUploadDescription')?.value || '').trim();

      if (!arcgis?.portalUrl) return { status: 400, error: 'Falta ARCGIS_PORTAL_URL en configuración.' };
      if (!authState?.username) return { status: 401, error: 'No hay sesión ArcGIS activa para subir el item.' };

      const token = await resolveArcgisTokenForPublish();
      if (!token) return { status: 401, error: 'No se pudo obtener token ArcGIS para subida.' };

      let blobResult = await fetchAssetBlobForArcgisUpload(contractId, assetId);
      if (!(blobResult.status >= 200 && blobResult.status < 300) && assetId && transferParty?.counterPartyId) {
        const providerConnectorId = extractConnectorIdHint(transferParty.counterPartyId) || transferParty.counterPartyId;
        const providerAssetResp = await callConnectorManagementApi(
          providerConnectorId, 'GET', `/v3/assets/${encodeURIComponent(assetId)}`, undefined,
          { timeoutMs: 5000, silent: true }
        ).catch(() => null);
        if (providerAssetResp?.status >= 200 && providerAssetResp?.status < 300) {
          const providerAsset = providerAssetResp.data || {};
          const providerProps = providerAsset.properties || providerAsset['edc:properties'] || {};
          if (String(providerProps['eitel:sourceMode'] || '').trim() === 'arcgis-feature-layer') {
            blobResult = await fetchArcgisFeatureLayerBlob(contractId, assetId, providerAsset);
          }
        }
      }
      if (!(blobResult.status >= 200 && blobResult.status < 300)) {
        blobResult = await fetchRemoteBlobViaTransferSink(contractId, assetId, transferParty);
      }
      if (!(blobResult.status >= 200 && blobResult.status < 300)) return blobResult;

      const assetMeta = await resolveAssetMetadataForArcgis(assetId);
      const arcgisMeta = buildArcgisMetadataEnvelope({
        manualTitle: title,
        manualTags: tags,
        manualDescription: description,
        contractId,
        assetId,
        sourceUrl: blobResult.sourceUrl,
        blobFilename: blobResult.filename,
        fallbackTitle: assetMeta.title,
        fallbackDescription: assetMeta.description,
        fallbackKeywords: assetMeta.keywords,
      });

      const autoMode = !String(typeInput || '').trim();
      let resolvedType = normalizeArcgisItemType(typeInput, blobResult.filename, blobResult.contentType);
      // EDC transfers frequently strip the filename/content-type, leaving no valid
      // ArcGIS item type derivable from metadata. ArcGIS has no generic "File" type
      // (addItem answers "Item type not valid."), so sniff the bytes and never send a
      // placeholder ArcGIS will reject.
      const sniffedType = await sniffArcgisItemTypeFromBlob(blobResult.blob);
      if (!resolvedType) resolvedType = sniffedType;
      if (!resolvedType) {
        return {
          status: 400,
          error: 'No se pudo determinar un tipo de item ArcGIS válido para este archivo. Indica el tipo manualmente en el campo "Tipo" (por ejemplo CSV, GeoJson, PDF, Shapefile, Microsoft Excel, KML o Image).',
          filename: blobResult.filename,
          contentType: blobResult.contentType,
          sourceUrl: blobResult.sourceUrl,
        };
      }
      const buildForm = (itemType) => {
        const form = new FormData();
        form.append('f', 'json');
        form.append('token', token);
        form.append('title', arcgisMeta.title);
        const normalizedType = String(itemType || '').trim();
        if (normalizedType) form.append('type', normalizedType);
        form.append('tags', arcgisMeta.tags || 'eitel,edc');
        form.append('description', arcgisMeta.description || 'Item generado desde transferencia del conector EITEL');
        form.append('snippet', arcgisMeta.snippet || 'Item publicado desde EITEL Connector');
        form.append('file', blobResult.blob, blobResult.filename || `${assetId || 'asset'}.bin`);
        return form;
      };

      const sendAddItem = async (itemType) => {
        const endpoint = `${arcgis.portalUrl}/sharing/rest/content/users/${encodeURIComponent(authState.username)}/addItem`;
        const response = await fetch(endpoint, { method: 'POST', body: buildForm(itemType), credentials: 'include' });
        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {
            error: {
              message: 'ArcGIS devolvió una respuesta no JSON al crear el item.',
              preview: text.slice(0, 500),
            },
          };
        }
        return { endpoint, response, data, itemType };
      };

      try {
        let result = await sendAddItem(resolvedType);
        if (!result.response.ok || result.data?.error || result.data?.success === false) {
          const isTypeError = (
            isArcgisUnknownTypeError(result.data) ||
            isArcgisGeoJsonAnalysisError(result.data) ||
            (autoMode && isArcgisTypeRequiredError(result.data))
          );
          // Retry once with the content-sniffed type when ArcGIS rejected the first
          // guess (never with the invalid "File" placeholder used previously).
          if (isTypeError && sniffedType && sniffedType !== result.itemType) {
            result = await sendAddItem(sniffedType);
          }
        }
        if (!result.response.ok || result.data?.error || result.data?.success === false) {
          return {
            status: result.response.status || 500,
            error: result.data?.error?.message || result.data?.error || 'ArcGIS no aceptó la subida del item.',
            detail: result.data,
            usedType: result.itemType,
          };
        }
        return {
          status: 200,
          uploaded: true,
          contractId,
          assetId,
          itemId: result.data?.id || '',
          title: arcgisMeta.title,
          tags: arcgisMeta.tags,
          description: arcgisMeta.description,
          filename: blobResult.filename,
          contentType: blobResult.contentType,
          usedType: result.itemType,
          sourceUrl: blobResult.sourceUrl,
          arcgisResponse: result.data,
        };
      } catch (error) {
        return { status: 500, error: `Error subiendo item a ArcGIS: ${String(error)}` };
      }
    }

    /**
     * Monitors remote download transfer and fetches resulting asset blob.
     * Polls transfer status and retrieves downloaded file from sink service.
     * Coordinates multi-step asset download from remote connector.
     * 
     * @async
     * @param {string} contractId - Contract ID for transfer
     * @param {string} transferId - Transfer ID to monitor
     * @param {string} assetId - Asset ID being transferred
     * @returns {Promise<Object>} Final blob data from sink service
     * 
     * @example
     * const blob = await monitorRemoteDownloadAndFetch('contract-123', 'transfer-456', 'asset-789');
     */
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
            const fileResp = await fetch(fileUrl, {
              method: 'GET',
              headers: getLocalAssetsAuthHeaders(),
              credentials: 'include',
              cache: 'no-store',
            });
            if (!fileResp.ok) {
              writeOut({
                status: fileResp.status,
                error: 'El sink local recibió archivo, pero no se pudo descargar con autenticación.',
                transferId,
                contractId,
                assetId,
                sourceUrl: fileUrl,
              });
              return;
            }
            const blob = await fileResp.blob();
            const objectUrl = URL.createObjectURL(blob);
            triggerBrowserDownload(objectUrl, latest.filename || 'download.bin');
            setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
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

    /**
     * Downloads remote asset via EDC transfer contract.
     * Orchestrates full process: initiates transfer, monitors progress, retrieves file.
     * Stores result in local download-sink for user access.
     * 
     * @async
     * @param {string} contractId - Contract ID for transfer
     * @param {string} assetId - Asset ID to download
     * @param {string|null} [transferParty=null] - Optional counter-party identifier
     * @returns {Promise<Object>} Download completion status and file information
     * 
     * @example
     * const result = await downloadRemoteAssetViaTransfer('contract-123', 'asset-456');
     */
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
      try { await fetch(`${sinkPublicBaseUrl}/records`, { method: 'DELETE', headers: getLocalAssetsAuthHeaders() }); } catch {}

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

    /**
     * Validates that a source endpoint can be reached and returns valid data.
     * Tests connectivity to asset source URL with proper authentication headers.
     * Used to verify asset availability before publishing.
     * 
     * @async
     * @param {string} baseUrl - Base URL of the source
     * @param {string} path - API path on source
     * @param {Object} [headers={}] - Authentication headers for the request
     * @returns {Promise<Object>} Validation result with ok flag and response metadata
     * 
     * @example
     * const validation = await validateSourcePayloadPreview('https://api.example.com', '/data', {});
     */
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

    /**
     * Uploads a local asset file to the connector's local assets service.
     * Attempts multiple upload methods (raw, multipart) for compatibility.
     * Stores file and generates accessible public URL.
     * 
     * @async
     * @param {string} assetId - Asset ID for file association
     * @returns {Promise<Object>} Upload response with file info and public URL
     * 
     * @example
     * const result = await uploadLocalAssetSource('asset-123');
     */
    async function uploadLocalAssetSource(assetId) {
      const fileInput = document.getElementById('assetLocalFile');
      const file = fileInput?.files?.[0];
      if (!file) {
        return { status: 400, error: 'Selecciona un archivo local antes de publicar el asset.' };
      }

      const filename = file.name || `${assetId || 'asset'}.bin`;
      let baseCandidates = getLocalAssetsApiBaseUrlCandidates();
      baseCandidates = await prioritizeHealthyLocalAssetsCandidates(baseCandidates);
      let lastHttpFailure = null;

      // First try raw upload to avoid multipart/proxy edge cases.
      for (const baseUrl of baseCandidates) {
        try {
          const rawUrl = `${baseUrl}/upload-raw?filename=${encodeURIComponent(filename)}`;
          const rawRes = await fetch(rawUrl, {
            method: 'PUT',
            headers: getLocalAssetsAuthHeaders({
              'Content-Type': file.type || 'application/octet-stream',
              'X-Filename': filename,
            }),
            body: file,
          });
          const rawText = await rawRes.text();
          let rawData = rawText;
          try { rawData = JSON.parse(rawText); } catch {}
          if (rawRes.status >= 200 && rawRes.status < 300) {
            return { status: rawRes.status, data: rawData };
          }
          lastHttpFailure = {
            status: rawRes.status,
            error: 'Upload raw rechazado por el gateway/servicio local-assets.',
            endpoint: rawUrl,
            data: rawData,
          };
        } catch {}
      }

      for (const baseUrl of baseCandidates) {
        const formData = new FormData();
        formData.append('file', file, filename);
        try {
          const res = await fetch(`${baseUrl}/upload`, {
            method: 'POST',
            headers: getLocalAssetsAuthHeaders(),
            body: formData,
          });
          const text = await res.text();
          let data = text;
          try { data = JSON.parse(text); } catch {}
          if (res.status >= 200 && res.status < 300) {
            return { status: res.status, data };
          }
          lastHttpFailure = {
            status: res.status,
            error: 'Upload multipart rechazado por el gateway/servicio local-assets.',
            endpoint: `${baseUrl}/upload`,
            data,
          };
        } catch (error) {
          if (baseUrl === baseCandidates[baseCandidates.length - 1]) {
            return { status: 500, error: `No se pudo subir el archivo local: ${String(error)}` };
          }
        }
      }

      if (lastHttpFailure) {
        return {
          status: Number(lastHttpFailure.status || 502),
          error: lastHttpFailure.error,
          endpoint: lastHttpFailure.endpoint,
          data: lastHttpFailure.data,
          tried: baseCandidates,
        };
      }

      return { status: 502, error: 'No se pudo resolver una ruta de upload local-assets válida desde la UI.', tried: baseCandidates };
    }

    /**
     * Uploads a local asset image/icon file.
     * Handles image file selection from UI and uploads to local assets service.
     * Skips gracefully if no image selected.
     * 
     * @async
     * @param {string} assetId - Asset ID to associate image with
     * @returns {Promise<Object>} Upload response with image URL or skipped status
     * 
     * @example
     * const result = await uploadLocalAssetImage('asset-123');
     */
    async function uploadLocalAssetImage(assetId) {
      const fileInput = document.getElementById('assetImageFile');
      const file = fileInput?.files?.[0];
      if (!file) return { status: 204, skipped: true };

      const formData = new FormData();
      formData.append('file', file, file.name || `${assetId || 'asset'}-image.png`);

      try {
        const res = await fetch(`${getLocalAssetsApiBaseUrl()}/upload`, {
          method: 'POST',
          headers: getLocalAssetsAuthHeaders(),
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
      refreshArcgisPublishAssist();
      refreshStarTrustPanel();
    }

