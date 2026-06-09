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

    // ArcGIS has no generic "File" item type: addItem rejects unknown types with
    // "Item type not valid." (HTTP 400). These helpers therefore return '' (unknown)
    // when they can't map a *valid* ArcGIS type, so callers can sniff the bytes or
    // surface a clear error instead of sending a placeholder ArcGIS will reject.
    function mapContentTypeToArcgisType(contentType, fallback = '') {
      const txt = String(contentType || '').toLowerCase();
      if (txt.includes('csv')) return 'CSV';
      if (txt.includes('geo+json') || txt.includes('geojson')) return 'GeoJson';
      if (txt.includes('json')) return 'GeoJson';
      if (txt.includes('zip')) return 'Shapefile';
      if (txt.includes('pdf')) return 'PDF';
      if (txt.includes('spreadsheetml') || txt.includes('ms-excel')) return 'Microsoft Excel';
      if (txt.includes('image/')) return 'Image';
      if (txt.includes('vnd.google-earth.kml') || txt.includes('kml')) return 'KML';
      return fallback;
    }

    function mapFilenameToArcgisType(filename, fallback = '') {
      const txt = String(filename || '').toLowerCase();
      if (txt.endsWith('.csv')) return 'CSV';
      if (txt.endsWith('.geojson')) return 'GeoJson';
      if (txt.endsWith('.json')) return 'GeoJson';
      if (txt.endsWith('.zip')) return 'Shapefile';
      if (txt.endsWith('.pdf')) return 'PDF';
      if (txt.endsWith('.xlsx') || txt.endsWith('.xls')) return 'Microsoft Excel';
      if (txt.endsWith('.kml')) return 'KML';
      if (txt.endsWith('.gml')) return 'GML';
      if (/\.(png|jpe?g|gif|tiff?)$/.test(txt)) return 'Image';
      return fallback;
    }

    function normalizeArcgisItemType(rawType, filename, contentType) {
      const value = String(rawType || '').trim();
      const lower = value.toLowerCase();
      if (!value) {
        return mapFilenameToArcgisType(filename, '') || mapContentTypeToArcgisType(contentType, '');
      }

      const aliases = {
        csv: 'CSV',
        geojson: 'GeoJson',
        'geo json': 'GeoJson',
        json: 'GeoJson',
        shapefile: 'Shapefile',
        shp: 'Shapefile',
        pdf: 'PDF',
        excel: 'Microsoft Excel',
        xlsx: 'Microsoft Excel',
        xls: 'Microsoft Excel',
        kml: 'KML',
        gml: 'GML',
        image: 'Image',
      };

      return aliases[lower] || value;
    }

    // Best-effort detection of a *valid* ArcGIS item type from the actual bytes. Used
    // when an EDC transfer strips the filename/content-type and metadata-based mapping
    // comes back empty. Returns a valid type string, or '' when it can't tell.
    async function sniffArcgisItemTypeFromBlob(blob) {
      if (!blob || typeof blob.slice !== 'function') return '';
      try {
        const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'PDF'; // %PDF
        if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'Image'; // PNG
        if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'Image'; // JPEG
        if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'Image'; // GIF
        if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
          return 'Shapefile'; // ZIP container (shapefile is the common transferred case)
        }
        const sample = String(await blob.slice(0, 65536).text() || '').trim();
        if (!sample) return '';
        const lower = sample.toLowerCase();
        const firstChar = sample[0];
        if (firstChar === '{' || firstChar === '[') {
          // Any JSON (real GeoJSON or plain tabular JSON) targets ArcGIS "GeoJson":
          // ensureGeoJsonBlob() wraps plain JSON into a valid FeatureCollection at upload.
          return 'GeoJson';
        }
        if (firstChar === '<') {
          if (lower.includes('<kml')) return 'KML';
          if (lower.includes('<wfs') || lower.includes('gml')) return 'GML';
          return '';
        }
        const lines = sample.split(/\r?\n/).filter(Boolean);
        const firstLine = lines[0] || '';
        if (lines.length > 1 && (firstLine.includes(',') || firstLine.includes(';') || firstLine.includes('\t'))) {
          return 'CSV';
        }
        return '';
      } catch {
        return '';
      }
    }

    function isGeoJsonGeometry(g) {
      return g && typeof g === 'object' && typeof g.type === 'string'
        && ['point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'].includes(g.type.toLowerCase());
    }

    // --- Esri JSON FeatureSet -> GeoJSON ----------------------------------------------
    // ArcGIS REST "query?f=json" responses (Esri JSON FeatureSet) are NOT GeoJSON: geometry
    // lives in features[].geometry as { rings | paths | points | x,y } in the layer's
    // spatialReference (often Web Mercator or UTM), and attributes in features[].attributes.
    // To publish a usable Feature Layer we convert to GeoJSON and reproject coordinates to
    // WGS84, which GeoJSON requires (lon/lat degrees).

    function webMercatorToWgs84(x, y) {
      const R = 6378137.0;
      const lon = (x / R) * 180 / Math.PI;
      const lat = (Math.PI / 2 - 2 * Math.atan(Math.exp(-y / R))) * 180 / Math.PI;
      return [lon, lat];
    }

    // Inverse UTM (Transverse Mercator) on the GRS80/ETRS89 ellipsoid -> WGS84 [lon, lat].
    function utmToWgs84(easting, northing, zone) {
      const a = 6378137.0, f = 1 / 298.257222101, k0 = 0.9996;
      const e2 = f * (2 - f), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2)), ep2 = e2 / (1 - e2);
      const x = easting - 500000, M = northing / k0;
      const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
      const phi1 = mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
      const s = Math.sin(phi1), c = Math.cos(phi1), tn = Math.tan(phi1);
      const C1 = ep2 * c * c, T1 = tn * tn;
      const N1 = a / Math.sqrt(1 - e2 * s * s);
      const R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
      const D = x / (N1 * k0);
      const lat = phi1 - (N1 * tn / R1) * (D * D / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
      const lon0 = (zone * 6 - 183) * Math.PI / 180;
      const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
      return [lon * 180 / Math.PI, lat * 180 / Math.PI];
    }

    // Returns a fn (x,y)->[lon,lat] for the given Esri spatialReference, or null if unknown.
    function esriReprojector(spatialReference) {
      const wkid = (spatialReference && (spatialReference.latestWkid || spatialReference.wkid)) || 0;
      if (!wkid || wkid === 4326) return (x, y) => [x, y];
      if (wkid === 102100 || wkid === 3857 || wkid === 900913) return webMercatorToWgs84;
      if (wkid === 25830 || wkid === 23030) return (x, y) => utmToWgs84(x, y, 30);
      if (wkid === 25829 || wkid === 23029) return (x, y) => utmToWgs84(x, y, 29);
      if (wkid === 25831 || wkid === 23031) return (x, y) => utmToWgs84(x, y, 31);
      return null;
    }

    function closeRing(ring) {
      const a = ring[0], b = ring[ring.length - 1];
      if (a && b && (a[0] !== b[0] || a[1] !== b[1])) ring.push([a[0], a[1]]);
      return ring;
    }
    function ringIsClockwise(ring) {
      let total = 0, p1 = ring[0], p2;
      for (let i = 0; i < ring.length - 1; i++) { p2 = ring[i + 1]; total += (p2[0] - p1[0]) * (p2[1] + p1[1]); p1 = p2; }
      return total >= 0;
    }
    function pointInRing(pt, ring) {
      let inside = false; const x = pt[0], y = pt[1];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }
    // Esri polygon rings (clockwise = outer, counter-clockwise = holes) -> GeoJSON.
    function esriRingsToGeoJson(rings, reproject) {
      const outer = [], holes = [];
      for (const raw of rings) {
        if (!Array.isArray(raw) || raw.length < 3) continue;
        const ring = closeRing(raw.map((p) => reproject(p[0], p[1])));
        if (ring.length < 4) continue;
        if (ringIsClockwise(ring)) outer.push([ring.slice().reverse()]);
        else holes.push(ring.slice().reverse());
      }
      for (const hole of holes) {
        let placed = false;
        for (let j = outer.length - 1; j >= 0; j--) {
          if (pointInRing(hole[0], outer[j][0])) { outer[j].push(hole); placed = true; break; }
        }
        if (!placed) outer.push([hole.slice().reverse()]);
      }
      if (outer.length === 0) return null;
      return outer.length === 1 ? { type: 'Polygon', coordinates: outer[0] } : { type: 'MultiPolygon', coordinates: outer };
    }
    function esriGeometryToGeoJson(geom, geometryType, reproject) {
      if (!geom || typeof geom !== 'object') return null;
      const t = String(geometryType || '').toLowerCase();
      if (t.includes('polygon') && Array.isArray(geom.rings)) return esriRingsToGeoJson(geom.rings, reproject);
      if (t.includes('polyline') && Array.isArray(geom.paths)) {
        const lines = geom.paths.map((p) => p.map((cc) => reproject(cc[0], cc[1])));
        return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
      }
      if (t.includes('multipoint') && Array.isArray(geom.points)) {
        return { type: 'MultiPoint', coordinates: geom.points.map((cc) => reproject(cc[0], cc[1])) };
      }
      if (Number.isFinite(geom.x) && Number.isFinite(geom.y)) return { type: 'Point', coordinates: reproject(geom.x, geom.y) };
      return null;
    }
    function isEsriFeatureSet(parsed) {
      return parsed && typeof parsed === 'object' && Array.isArray(parsed.features)
        && (parsed.geometryType || Array.isArray(parsed.fields)
          || (parsed.features[0] && typeof parsed.features[0] === 'object' && 'attributes' in parsed.features[0]));
    }

    // Pull a GeoJSON geometry out of a tabular record using the conventions real-world
    // open-data portals use, so the result is a *spatial* layer rather than null geometry:
    //  - embedded GeoJSON geometry/Feature: geometry, geo_shape, the_geom, shape, geom
    //  - OpenDataSoft geo_point_2d: [lat, lon] | {lat,lon} | "lat,lon"
    //  - coordinate columns: lon/lat, longitud/latitud, x/y, coordenada_x/coordenada_y...
    // Coordinates are validated to WGS84 ranges (GeoJSON requires lon/lat in degrees), so
    // projected values (e.g. UTM) are ignored rather than producing broken geometry.
    function extractGeometryFromRecord(rec) {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;

      for (const k of ['geometry', 'geo_shape', 'the_geom', 'shape', 'geom']) {
        const g = rec[k];
        if (isGeoJsonGeometry(g)) return g;
        if (g && typeof g === 'object' && g.type === 'Feature' && isGeoJsonGeometry(g.geometry)) return g.geometry;
      }

      const okPoint = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
      const gp = rec.geo_point_2d ?? rec.geopoint ?? rec.geo_point;
      if (Array.isArray(gp) && gp.length >= 2 && okPoint(Number(gp[1]), Number(gp[0]))) {
        return { type: 'Point', coordinates: [Number(gp[1]), Number(gp[0])] }; // [lat,lon] -> [lon,lat]
      }
      if (gp && typeof gp === 'object' && !Array.isArray(gp)) {
        const la = Number(gp.lat ?? gp.latitude), lo = Number(gp.lon ?? gp.lng ?? gp.longitude);
        if (okPoint(lo, la)) return { type: 'Point', coordinates: [lo, la] };
      }
      if (typeof gp === 'string' && gp.includes(',')) {
        const [la, lo] = gp.split(',').map((s) => Number(s.trim()));
        if (okPoint(lo, la)) return { type: 'Point', coordinates: [lo, la] };
      }

      const LON = new Set(['lon', 'lng', 'long', 'longitude', 'longitud', 'x', 'coordenada_x', 'coord_x', 'x_wgs84', 'lon_wgs84']);
      const LAT = new Set(['lat', 'latitude', 'latitud', 'y', 'coordenada_y', 'coord_y', 'y_wgs84', 'lat_wgs84']);
      const pick = (keys) => {
        for (const k of Object.keys(rec)) {
          if (keys.has(k.toLowerCase())) { const n = Number(rec[k]); if (Number.isFinite(n)) return n; }
        }
        return null;
      };
      const lon = pick(LON), lat = pick(LAT);
      if (lon !== null && lat !== null && okPoint(lon, lat)) return { type: 'Point', coordinates: [lon, lat] };
      return null;
    }

    // Build a valid GeoJSON FeatureCollection from arbitrary JSON so ArcGIS can ingest it
    // as a "GeoJson" item (and publish it as a Feature Layer). Real GeoJSON is returned
    // untouched. Tabular/plain JSON records become Features, with real geometry extracted
    // when present (see extractGeometryFromRecord) or null otherwise. Returns
    // { geojson, hasGeometry, featureCount }, or null when the input has no records.
    function buildGeoJsonFeatureCollection(jsonText) {
      let parsed;
      try { parsed = JSON.parse(jsonText); } catch { return null; }

      // Esri JSON FeatureSet (ArcGIS REST query response) -> GeoJSON, reprojected to WGS84.
      // Checked before the generic paths because it also exposes a `features` array.
      if (isEsriFeatureSet(parsed)) {
        const reproject = esriReprojector(parsed.spatialReference);
        if (!reproject) {
          return { unsupported: `spatialReference no soportada (wkid ${parsed.spatialReference && (parsed.spatialReference.latestWkid || parsed.spatialReference.wkid)}). Exporta el origen en WGS84/Web Mercator o UTM (zonas 29-31).` };
        }
        let hasGeometry = false;
        const features = parsed.features.map((f) => {
          const geometry = esriGeometryToGeoJson(f && f.geometry, parsed.geometryType, reproject);
          if (geometry) hasGeometry = true;
          return { type: 'Feature', geometry: geometry || null, properties: (f && f.attributes) || {} };
        });
        return { geojson: JSON.stringify({ type: 'FeatureCollection', features }), hasGeometry, featureCount: features.length };
      }

      const GEOJSON_TYPES = ['featurecollection', 'feature', 'geometrycollection', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon'];
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && typeof parsed.type === 'string' && GEOJSON_TYPES.includes(parsed.type.toLowerCase())) {
        const t = parsed.type.toLowerCase();
        let hasGeometry = false, featureCount = 1;
        if (t === 'featurecollection' && Array.isArray(parsed.features)) {
          featureCount = parsed.features.length;
          hasGeometry = parsed.features.some((f) => f && isGeoJsonGeometry(f.geometry));
        } else if (t === 'feature') {
          hasGeometry = isGeoJsonGeometry(parsed.geometry);
        } else {
          hasGeometry = isGeoJsonGeometry(parsed);
        }
        return { geojson: jsonText, hasGeometry, featureCount }; // already GeoJSON, keep bytes
      }

      let records = null;
      if (Array.isArray(parsed)) {
        records = parsed;
      } else if (parsed && typeof parsed === 'object') {
        for (const key of ['features', 'data', 'results', 'records', 'items', 'rows', 'value']) {
          if (Array.isArray(parsed[key])) { records = parsed[key]; break; }
        }
        if (!records) records = [parsed]; // single object -> single feature
      }
      if (!Array.isArray(records) || records.length === 0) return null;

      const GEOM_FIELDS = ['geometry', 'geo_shape', 'the_geom', 'shape', 'geom', 'geo_point_2d', 'geopoint', 'geo_point'];
      let hasGeometry = false;
      const features = records.map((rec) => {
        if (rec && typeof rec === 'object' && !Array.isArray(rec) && rec.type === 'Feature') {
          if (isGeoJsonGeometry(rec.geometry)) hasGeometry = true;
          return rec; // already a GeoJSON Feature, keep it
        }
        const geometry = extractGeometryFromRecord(rec);
        if (geometry) hasGeometry = true;
        let properties;
        if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
          properties = { ...rec };
          for (const gf of GEOM_FIELDS) delete properties[gf]; // avoid duplicating bulky geometry
        } else {
          properties = { value: rec };
        }
        return { type: 'Feature', geometry: geometry || null, properties };
      });

      return { geojson: JSON.stringify({ type: 'FeatureCollection', features }), hasGeometry, featureCount: features.length };
    }

    // Returns { blob, filename, hasGeometry, featureCount } whose bytes are valid GeoJSON
    // (converting plain JSON when needed), or null when the blob can't be represented.
    async function ensureGeoJsonBlob(blob, filename) {
      if (!blob || typeof blob.text !== 'function') return null;
      let text = '';
      try { text = await blob.text(); } catch { return null; }
      const built = buildGeoJsonFeatureCollection(text);
      if (!built) return null;
      if (built.unsupported) return { unsupported: built.unsupported };
      const base = String(filename || 'asset').replace(/\.(geo)?json$/i, '') || 'asset';
      return {
        blob: new Blob([built.geojson], { type: 'application/geo+json' }),
        filename: `${base}.geojson`,
        hasGeometry: built.hasGeometry,
        featureCount: built.featureCount,
      };
    }

    function isArcgisUnknownTypeError(payload) {
      const text = JSON.stringify(payload || {}).toLowerCase();
      // ArcGIS rejects an unknown/unsupported item type with a 400 whose message is
      // "Item type not valid." (EN) or "El tipo de elemento no es válido." (ES). Match
      // those phrases directly so the caller can retry with a content-sniffed valid type.
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

