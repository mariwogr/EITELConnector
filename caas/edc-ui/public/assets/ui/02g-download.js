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

    async function fetchArcgisFeatureLayerBlob(contractId, assetId, asset) {
      const props = asset?.properties || asset?.['edc:properties'] || {};
      const dataAddress = asset?.dataAddress || asset?.['edc:dataAddress'] || {};
      const baseUrl = normalizeArcgisFeatureLayerBaseUrl(dataAddress.baseUrl || dataAddress['edc:baseUrl'] || '');
      const authType = String(props['eitel:authType'] || '').trim();
      const exportFormat = String(props['eitel:arcgisExportFormat'] || 'geojson').trim() || 'geojson';
      if (!baseUrl) {
        return { status: 400, error: 'El FeatureLayer ArcGIS no tiene baseUrl válido.', contractId, assetId };
      }

      let token = '';
      if (authType === 'arcgis-login') {
        token = await resolveArcgisTokenForPublish();
        if (!token) {
          return { status: 401, error: 'No se pudo obtener un token ArcGIS válido para la descarga local.', contractId, assetId };
        }
      }

      const sourceUrl = `${baseUrl.replace(/\/+$/, '')}${buildArcgisFeatureLayerQueryPath(exportFormat, token)}`;
      try {
        const response = await fetch(sourceUrl, { method: 'GET', credentials: 'include' });
        const responseContentType = response.headers.get('content-type') || '';
        const text = await response.text();
        if (!response.ok) {
          return {
            status: response.status,
            error: 'La exportación ArcGIS devolvió error HTTP.',
            contractId,
            assetId,
            sourceUrl,
            contentType: responseContentType,
            detail: text.slice(0, 1000),
          };
        }
        const badPayload = typeof looksLikeSourceErrorPayload === 'function'
          ? looksLikeSourceErrorPayload(text, responseContentType)
          : String(responseContentType || '').toLowerCase().includes('text/html');
        if (badPayload) {
          return {
            status: 502,
            error: 'ArcGIS devolvió HTML/error en vez del formato de exportación solicitado.',
            contractId,
            assetId,
            sourceUrl,
            contentType: responseContentType,
            preview: text.slice(0, 500),
            badPayload: true,
          };
        }

        const contentType = getArcgisExportContentType(exportFormat);
        const blob = new Blob([text], { type: contentType });
        const filename = inferArcgisExportFilename(assetId, exportFormat);
        return {
          status: 200,
          contractId,
          assetId,
          sourceUrl,
          blob,
          filename,
          contentType,
          bytes: blob.size,
          via: 'arcgis-feature-layer',
        };
      } catch (error) {
        return {
          status: 500,
          error: 'No se pudo exportar el FeatureLayer ArcGIS en el navegador.',
          contractId,
          assetId,
          sourceUrl,
          detail: String(error),
        };
      }
    }

    async function downloadArcgisFeatureLayerAsset(contractId, assetId, asset) {
      const blobResult = await fetchArcgisFeatureLayerBlob(contractId, assetId, asset);
      if (!(blobResult.status >= 200 && blobResult.status < 300)) return blobResult;

      const objectUrl = URL.createObjectURL(blobResult.blob);
      triggerBrowserDownload(objectUrl, blobResult.filename);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

      return {
        ...blobResult,
        downloaded: true,
        blob: undefined,
      };
    }

    /**
     * Downloads asset from remote source to local storage via EDC transfer.
     * Initiates transfer process and stores downloaded file in download-sink service.
     * Handles error cases including missing assets and failed transfers.
     * 
     * @async
     * @param {string} contractId - Contract ID for the transfer
     * @param {string} assetId - Asset ID to download
     * @returns {Promise<Object>} Response with status and file information
     * 
     * @example
     * const result = await downloadAssetLocally('contract-123', 'asset-456');
     */
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
      let baseUrl = String(dataAddress.baseUrl || '').trim();
      let path = String(dataAddress.path || '').trim();
      let headers = { ...(dataAddress.headers || {}) };
      const authType = String(props['eitel:authType'] || '').trim();

      if (!baseUrl || String(dataAddress.type || '').trim() !== 'HttpData') {
        return { status: 400, error: 'El asset seleccionado no usa un origen HttpData descargable.', contractId, assetId, dataAddress };
      }

      if (sourceMode === 'arcgis-feature-layer') {
        return downloadArcgisFeatureLayerAsset(contractId, assetId, asset);
      }

      if (authType === 'arcgis-login') {
        const authToken = await resolveArcgisTokenForPublish();
        if (!authToken) {
          return { status: 401, error: 'No se pudo obtener un token ArcGIS válido para la descarga local.' };
        }
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
      const resolvedAddress = hint ? getPreferredEdcDspAddress(hint, buildDspUrl(hint)) : currentTransferAddress;

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

    /**
     * Waits for a transfer to complete or reach terminal state.
     * Polls transfer status at intervals until completion or timeout.
     * 
     * @async
     * @param {string} transferId - Transfer ID to monitor
     * @param {number} [maxWaitMs=120000] - Maximum wait time in milliseconds (default 2 minutes)
     * @returns {Promise<Object|null>} Final transfer state or null if timed out
     * 
     * @example
     * const transfer = await waitTransferToFinish('transfer-123', 60000);
     */
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

    /**
     * Retrieves latest download sink record for a contract.
     * Gets most recent downloaded file associated with contract/asset.
     * 
     * @async
     * @param {string} contractId - Contract ID to check
     * @returns {Promise<Object|null>} Latest download record or null if none found
     * 
     * @example
     * const download = await getLatestDownloadSinkRecord('contract-123');
     */
    async function getLatestDownloadSinkRecord(contractId) {
      const sinkBaseUrl = buildLocalDownloadSinkPublicBaseUrl();
      const recordsRes = await fetch(`${sinkBaseUrl}/records?contractId=${encodeURIComponent(contractId)}`, {
        headers: getLocalAssetsAuthHeaders(),
        credentials: 'include',
        cache: 'no-store',
      });
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

    /**
     * Downloads asset from alternate source hint URL.
     * Used as fallback when EDC transfer fails or asset is unavailable.
     * Directly fetches asset from provided URL hint.
     * 
     * @async
     * @param {string} contractId - Contract ID context
     * @param {string} assetId - Asset ID context
     * @param {string} sourceUrl - Alternate source URL to download from
     * @returns {Promise<Object>} Download response with status and data
     * 
     * @example
     * const result = await downloadFromSourceHint('contract-123', 'asset-456', 'https://example.com/asset');
     */
    async function downloadFromSourceHint(contractId, assetId, sourceUrl) {
      const url = String(sourceUrl || '').trim();
      if (!url) return { status: 404, error: 'Sin URL de origen alternativa para descarga directa.', contractId, assetId };
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: getLocalAssetsAuthHeadersForUrl(url),
          credentials: 'include',
        });
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
        let blob;
        if (String(contentType || '').toLowerCase().includes('text/html')) {
          const text = await response.text();
          return {
            status: 502,
            error: 'La URL alternativa devolvió HTML/error en vez de un dato descargable.',
            contractId,
            assetId,
            sourceUrl: url,
            contentType,
            preview: text.slice(0, 500),
            badPayload: true,
          };
        }
        if (/json|text\//i.test(contentType)) {
          const text = await response.text();
          const badPayload = typeof looksLikeSourceErrorPayload === 'function'
            ? looksLikeSourceErrorPayload(text, contentType)
            : false;
          if (badPayload) {
            return {
              status: 502,
              error: 'La URL alternativa devolvió error/login en vez de un dato descargable.',
              contractId,
              assetId,
              sourceUrl: url,
              contentType,
              preview: text.slice(0, 500),
              badPayload: true,
            };
          }
          blob = new Blob([text], { type: contentType });
        } else {
          blob = await response.blob();
        }
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

    function mapFilenameToArcgisType(filename, fallback = 'File') {
      const txt = String(filename || '').toLowerCase();
      if (txt.endsWith('.csv')) return 'CSV';
      if (txt.endsWith('.geojson') || txt.endsWith('.json')) return 'GeoJson';
      if (txt.endsWith('.zip')) return 'Shapefile';
      if (txt.endsWith('.pdf')) return 'PDF';
      if (txt.endsWith('.xlsx') || txt.endsWith('.xls')) return 'Microsoft Excel';
      if (txt.endsWith('.kml')) return 'KML';
      return fallback;
    }

    function normalizeArcgisItemType(rawType, filename, contentType) {
      const value = String(rawType || '').trim();
      const lower = value.toLowerCase();
      if (!value) {
        const byName = mapFilenameToArcgisType(filename, '');
        if (byName) return byName;
        return mapContentTypeToArcgisType(contentType, 'File');
      }

      const aliases = {
        csv: 'CSV',
        geojson: 'GeoJson',
        'geo json': 'GeoJson',
        json: 'GeoJson',
        shapefile: 'Shapefile',
        shp: 'Shapefile',
        pdf: 'PDF',
        file: 'File',
        excel: 'Microsoft Excel',
        xlsx: 'Microsoft Excel',
        xls: 'Microsoft Excel',
        kml: 'KML',
      };

      return aliases[lower] || value;
    }

    function isArcgisUnknownTypeError(payload) {
      const text = JSON.stringify(payload || {}).toLowerCase();
      // ArcGIS rejects an unknown/unsupported item type with a 400 whose message is
      // "Item type not valid." (EN) or "El tipo de elemento no es válido." (ES). Match
      // those phrases directly so the caller can fall back to the generic "File" type.
      if (
        text.includes('item type not valid') ||
        text.includes('tipo de elemento no es válido') ||
        text.includes('tipo de elemento no es valido')
      ) {
        return true;
      }
      return text.includes('type') && (
        text.includes('not recognized') ||
        text.includes('unsupported') ||
        text.includes('invalid') ||
        text.includes('not valid') ||
        text.includes('no se ha podido reconocer') ||
        text.includes('cannot recognize')
      );
    }

    function isArcgisTypeRequiredError(payload) {
      const text = JSON.stringify(payload || {}).toLowerCase();
      return text.includes('type') && (
        text.includes('required') ||
        text.includes('missing') ||
        text.includes('obligatorio')
      );
    }

    function isArcgisGeoJsonAnalysisError(payload) {
      const text = JSON.stringify(payload || {}).toLowerCase();
      return text.includes('geojson') && (
        text.includes("doesn't have 'type'") ||
        text.includes('analyzing geojson') ||
        text.includes('error while analyzing geojson')
      );
    }

    /**
     * Resolves complete asset metadata required for ArcGIS upload.
     * Fetches asset details including title, description, and type information.
     * 
     * @async
     * @param {string} assetId - Asset ID to retrieve metadata for
     * @returns {Promise<Object>} Asset metadata object for ArcGIS operations
     * 
     * @example
     * const metadata = await resolveAssetMetadataForArcgis('asset-123');
     */
    async function resolveAssetMetadataForArcgis(assetId) {
      const safeAssetId = String(assetId || '').trim();
      if (!safeAssetId) return { title: '', description: '', keywords: [] };
      try {
        const assetsResp = await callApi('POST', '/v3/assets/request', q(), { silent: true, retries: 0 });
        const assets = unwrap(assetsResp);
        const asset = assets.find(a => (a['@id'] || a.id || '') === safeAssetId);
        if (!asset) return { title: '', description: '', keywords: [] };
        const props = asset?.properties || asset?.['edc:properties'] || {};
        const title = firstNonEmpty([props?.title, props?.name, safeAssetId]);
        const description = firstNonEmpty([props?.description, '']);
        const keywords = [...new Set(parseKeywordList(props?.keywords || '').filter(Boolean))];
        return { title, description, keywords };
      } catch {
        return { title: '', description: '', keywords: [] };
      }
    }

