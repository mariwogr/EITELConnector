// ============================================================
// Module state variables + transfer storage
// Lines 671-953 of the original 02-operations.js
// ============================================================

    let transferStartInFlight = false;
    const _remoteLocalDownloadInFlightByContract = new Set();
    const localTransferStorageKey = `eitel.ui.localTransfers.${connectorName}`;
    const hiddenTransferStorageKey = `eitel.ui.hiddenTransfers.${connectorName}`;
    const localAssetBundleStorageKey = `eitel.ui.assetBundles.${connectorName}`;
    const accessRequesterStorageKey = `eitel.ui.accessRequester.${connectorName}`;
    const arcgisTokenExpiresStorageKey = 'eitel.arcgis.access_token_expires';
    const agreementSourceHints = new Map();
    let arcgisTokenUiTimer = null;

    /**
     * Normalizes transfer state codes to human-readable state names.
     * Maps numeric codes to standard EDC transfer state strings.
     * 
     * @param {string|number|null|undefined} raw - Raw state code
     * @returns {string} Normalized state name (e.g., 'INITIAL', 'COMPLETED') or raw value if unmapped
     * 
     * @example
     * normalizeTransferState('700'); // Returns: 'COMPLETED'
     * normalizeTransferState('500'); // Returns: 'STARTED'
     */
    function normalizeTransferState(raw) {
      if (raw === undefined || raw === null) return '-';
      const txt = String(raw).trim();
      const numericMap = {
        '100': 'INITIAL',
        '200': 'PROVISIONING',
        '300': 'PROVISIONED',
        '400': 'REQUESTED',
        '500': 'STARTED',
        '600': 'SUSPENDED',
        '700': 'COMPLETED',
        '800': 'TERMINATED',
      };
      return numericMap[txt] || txt;
    }

    /**
     * Checks if a transfer state represents a terminal state.
     * Terminal states indicate transfer is no longer in progress.
     * 
     * @param {string|number} state - Transfer state to check
     * @returns {boolean} True if state is COMPLETED, TERMINATED, or FAILED
     * 
     * @example
     * isTransferTerminalState('700'); // Returns: true (COMPLETED)
     * isTransferTerminalState('500'); // Returns: false (STARTED)
     */
    function isTransferTerminalState(state) {
      const normalized = normalizeTransferState(state);
      return normalized === 'COMPLETED' || normalized === 'TERMINATED' || normalized === 'FAILED';
    }

    /**
     * Retrieves locally stored transfer records from browser storage.
     * Handles JSON parsing errors gracefully by returning empty array.
     * 
     * @returns {Object[]} Array of local transfer record objects
     * 
     * @example
     * const transfers = getLocalTransferRecords();
     * console.log(transfers.length); // Number of stored transfers
     */
    function getLocalTransferRecords() {
      try {
        const raw = localStorage.getItem(localTransferStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    /**
     * Saves transfer records to browser local storage.
     * Limits storage to 200 most recent records to prevent bloat.
     * 
     * @param {Object[]} records - Array of transfer records to save
     * 
     * @example
     * saveLocalTransferRecords([{id: '123', status: 'completed'}, ...]);
     */
    function saveLocalTransferRecords(records) {
      try {
        localStorage.setItem(localTransferStorageKey, JSON.stringify(records.slice(0, 200)));
      } catch {}
    }

    /**
     * Adds a single transfer record to local storage.
     * Retrieves current records, appends new one, and saves back.
     * 
     * @param {Object} record - Transfer record to add
     * 
     * @example
     * addLocalTransferRecord({id: 'new-transfer-123', status: 'active'});
     */
    function addLocalTransferRecord(record) {
      const current = getLocalTransferRecords();
      current.unshift(record);
      saveLocalTransferRecords(current);
      return record;
    }

    /**
     * Retrieves IDs of transfers hidden by user in UI.
     * Hidden transfers are tracked locally but not displayed to user.
     * 
     * @returns {string[]} Array of hidden transfer IDs
     * 
     * @example
     * const hiddenIds = getHiddenTransferIds();
     */
    function getHiddenTransferIds() {
      try {
        const raw = localStorage.getItem(hiddenTransferStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    }

    /**
     * Saves a set of transfer IDs to be hidden from UI.
     * 
     * @param {string[]} ids - Array of transfer IDs to hide
     * 
     * @example
     * saveHiddenTransferIds(['transfer-1', 'transfer-2']);
     */
    function saveHiddenTransferIds(ids) {
      try {
        const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean))).slice(-500);
        localStorage.setItem(hiddenTransferStorageKey, JSON.stringify(unique));
      } catch {}
    }

    /**
     * Removes a transfer record from local storage by ID.
     * 
     * @param {string} transferId - ID of transfer record to delete
     * 
     * @example
     * removeLocalTransferRecordById('transfer-123');
     */
    function removeLocalTransferRecordById(transferId) {
      const current = getLocalTransferRecords();
      const next = current.filter(t => (t['@id'] || t.id || '') !== transferId);
      saveLocalTransferRecords(next);
      return next.length !== current.length;
    }

    /**
     * Hides a transfer record from UI by adding its ID to hidden set.
     * Record remains in storage but is not displayed to user.
     * 
     * @param {string} transferId - ID of transfer to hide
     * 
     * @example
     * hideTransferRecordById('transfer-123');
     */
    function hideTransferRecordById(transferId) {
      const hidden = getHiddenTransferIds();
      if (!hidden.includes(transferId)) hidden.push(transferId);
      saveHiddenTransferIds(hidden);
    }

    /**
     * Builds a standardized local transfer record from transfer result.
     * Normalizes contract and transfer identifiers, extracts metadata from result.
     * 
     * @param {Object} result - Transfer result from EDC connector
     * @returns {Object} Normalized transfer record for local storage
     * 
     * @example
     * const record = buildLocalTransferRecord(edcTransferResult);
     * console.log(record.transferId, record.state, record.createdAt);
     */
    function buildLocalTransferRecord(result) {
      const status = Number(result?.status || 0);
      const localTransferId = `local-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const completed = status >= 200 && status < 300;
      return {
        '@id': localTransferId,
        id: localTransferId,
        state: completed ? 'COMPLETED' : 'FAILED',
        contractId: result?.contractId || '',
        assetId: result?.assetId || '',
        createdAt: new Date().toISOString(),
        transferType: 'LOCAL-DOWNLOAD',
        destinationType: 'browser-download',
        filename: result?.filename || '',
        bytes: Number(result?.bytes || 0),
        sourceUrl: result?.sourceUrl || '',
        contentType: result?.contentType || '',
        errorDetail: result?.error || result?.detail || '',
        detail: result,
        localDownload: true,
      };
    }

    /**
     * Normalizes a transfer row for display, extracting common properties.
     * Maps various property name formats to standard output format.
     * 
     * @param {Object} row - Transfer row object from API
     * @returns {Object} Normalized transfer object with standard properties
     * 
     * @example
     * const normalized = normalizeTransferRow(apiTransferRow);
     * console.log(normalized.transferId, normalized.state, normalized.createdAt);
     */
    function normalizeTransferRow(row) {
      const id = row['@id'] || row.id || '';
      const createdAt = row.createdAt || row['edc:createdAt'] || row.startedAt || row['edc:startedAt'] || '';
      return {
        ...row,
        '@id': id,
        id,
        state: row.state || row['edc:state'] || '-',
        contractId: row.contractId || row['edc:contractId'] || '',
        createdAt,
        localDownload: Boolean(row.localDownload),
      };
    }

    /**
     * Aggregates all transfer rows from local storage and remote API.
     * Merges local and remote transfers, filters hidden ones, and returns consolidated list.
     * 
     * @param {Object[]} [remoteRows=[]] - Transfer rows from remote API
     * @returns {Object[]} Consolidated array of all transfer rows (local + remote)
     * 
     * @example
     * const allTransfers = getAllTransferRows(apiTransfers);
     * console.log(allTransfers.length); // Total transfers visible
     */
    function getAllTransferRows(remoteRows = []) {
      const localRows = getLocalTransferRecords().map(normalizeTransferRow);
      const normalizedRemote = (Array.isArray(remoteRows) ? remoteRows : []).map(normalizeTransferRow);
      const hidden = new Set(getHiddenTransferIds());
      return [...localRows, ...normalizedRemote]
      .filter(r => !hidden.has(r['@id'] || r.id || ''))
      .sort((a, b) => {
        const aTime = Date.parse(a.createdAt || 0) || 0;
        const bTime = Date.parse(b.createdAt || 0) || 0;
        return bTime - aTime;
      });
    }

    /**
     * Gets the UI prefix path from the management API URL.
     * Extracts path segment from configured management API to determine routing prefix.
     * 
     * @returns {string} UI prefix path for routing (e.g., '/conectoruc3m')
     * 
     * @example
     * const prefix = getUiPrefixPath();
     * // Returns: '/conectoruc3m' if API is at '/conectoruc3m/api/management'
     */
    function getUiPrefixPath() {
      const parts = (window.location.pathname || '/').split('/').filter(Boolean);
      const first = String(parts[0] || '').trim();
      if (first.toLowerCase().startsWith('conector')) return `/${first}/`;

      const fromConfig = canonicalConnectorPrefix(cfg?.connectorName || '');
      if (fromConfig) return `/${fromConfig}/`;

      const fallback = canonicalConnectorPrefix(PROD_CONNECTOR_ID || 'conectoruc3m') || 'conectoruc3m';
      return `/${fallback}/`;
    }

    /**
     * Gets the base URL for local assets API from configuration.
     * Constructs URL using current window origin and connector prefix.
     * 
     * @returns {string} Base URL for local assets API
     * 
     * @example
     * const baseUrl = getLocalAssetsApiBaseUrl();
     * // Returns: 'http://localhost:3000/conectoruc3m/local-assets'
     */
