// ============================================================
// Policy utilities + common utilities
// Lines 1-670 of the original 02-operations.js
// ============================================================

/**
 * Summarizes policy terms from an ODRL policy object.
 * Extracts constraints from permissions and formats them as a readable string.
 * 
 * @param {Object} policyObj - ODRL policy object containing permissions and constraints
 * @returns {string} Formatted constraint summary or message indicating no explicit constraints
 * 
 * @example
 * const summary = summarizePolicyTerms(policyDefinition);
 * // Returns: "purpose eq USE | recipient eq urn:uuid:123"
 */
function summarizePolicyTerms(policyObj) {
      const permsRaw = policyObj?.['odrl:permission'] || policyObj?.permission || [];
      const perms = Array.isArray(permsRaw) ? permsRaw : [permsRaw];
      const constraints = perms.flatMap(p => {
        const c = p?.constraint || p?.['odrl:constraint'] || [];
        return Array.isArray(c) ? c : [c];
      }).filter(Boolean);
      if (!constraints.length) return 'Sin restricciones explícitas';
      return constraints.map(c => `${c.leftOperand || c['odrl:leftOperand'] || 'condición'} ${c.operator || c['odrl:operator'] || 'eq'} ${c.rightOperand || c['odrl:rightOperand'] || '-'}`).join(' | ');
    }

    function normalizeAccessLevel(value) {
      const raw = extractPolicyScalar(value) || value;
      const normalized = String(raw || '').trim().toLowerCase();
      if (!normalized) return 'public';
      const token = normalized.split(/[\/#:]+/g).filter(Boolean).pop() || normalized;
      if (['privado', 'private', 'restricted', 'partners', 'internal'].includes(token)) return 'private';
      if (['publico', 'public'].includes(token)) return 'public';
      return normalized;
    }

    function isRestrictedAccessLevel(value) {
      return normalizeAccessLevel(value || 'public') !== 'public';
    }

    function combineAccessLevels(...values) {
      const normalized = values
        .map(value => String(extractPolicyScalar(value) || value || '').trim())
        .filter(Boolean)
        .map(value => normalizeAccessLevel(value));
      if (normalized.some(level => level && level !== 'public')) return 'private';
      return 'public';
    }

    function extractPolicyScalar(value) {
      if (value === undefined || value === null) return '';
      if (Array.isArray(value)) {
        for (const item of value) {
          const scalar = extractPolicyScalar(item);
          if (scalar) return scalar;
        }
        return '';
      }
      if (typeof value !== 'object') return String(value).trim();
      const candidates = [
        value['@value'],
        value.value,
        value.rightOperand,
        value['odrl:rightOperand'],
        value.operandRight,
        value['edc:operandRight'],
        value.leftOperand,
        value['odrl:leftOperand'],
        value.operandLeft,
        value['edc:operandLeft'],
        value['@id'],
        value.id,
      ];
      for (const candidate of candidates) {
        const scalar = extractPolicyScalar(candidate);
        if (scalar) return scalar;
      }
      return '';
    }

    function extractAccessLevelFromPolicy(policyObj) {
      const permsRaw = policyObj?.['odrl:permission'] || policyObj?.permission || [];
      const perms = Array.isArray(permsRaw) ? permsRaw : [permsRaw];
      const constraints = [
        ...(Array.isArray(policyObj?.constraint || policyObj?.['odrl:constraint'])
          ? (policyObj?.constraint || policyObj?.['odrl:constraint'])
          : [policyObj?.constraint || policyObj?.['odrl:constraint']].filter(Boolean)),
        ...perms.flatMap(p => {
          const c = p?.constraint || p?.['odrl:constraint'] || [];
          return Array.isArray(c) ? c : [c];
        }),
      ].filter(Boolean);

      const found = constraints.find(c => {
        const left = extractPolicyScalar(c?.leftOperand || c?.['odrl:leftOperand'] || c?.operandLeft || c?.['edc:operandLeft']).toLowerCase();
        return left === 'dct:accessrights'
          || left === 'accessrights'
          || left === 'http://purl.org/dc/terms/accessrights'
          || left === 'https://purl.org/dc/terms/accessrights';
      });
      const right = found
        ? extractPolicyScalar(found?.rightOperand || found?.['odrl:rightOperand'] || found?.operandRight || found?.['edc:operandRight'])
        : extractPolicyScalar(policyObj?.['dct:accessRights'] || policyObj?.accessRights || policyObj?.['dct:accessrights'] || '');
      return right ? normalizeAccessLevel(right) : '';
    }

    function normalizePolicyOperandIri(value) {
      const raw = String(value || '').trim();
      if (!raw) return raw;
      const normalized = raw.toLowerCase();
      const map = {
        'accessrights': 'http://purl.org/dc/terms/accessRights',
        'dct:accessrights': 'http://purl.org/dc/terms/accessRights',
        'http://purl.org/dc/terms/accessrights': 'http://purl.org/dc/terms/accessRights',
        'https://purl.org/dc/terms/accessrights': 'http://purl.org/dc/terms/accessRights',
        'dct:purpose': 'http://purl.org/dc/terms/purpose',
        'http://purl.org/dc/terms/purpose': 'http://purl.org/dc/terms/purpose',
        'dct:spatial': 'http://purl.org/dc/terms/spatial',
        'http://purl.org/dc/terms/spatial': 'http://purl.org/dc/terms/spatial',
        'dcat:theme': 'https://www.w3.org/ns/dcat#theme',
        'https://www.w3.org/ns/dcat#theme': 'https://www.w3.org/ns/dcat#theme',
        'eitel:commercialuse': 'https://w3id.org/eitel/ns/commercialUse',
        'https://w3id.org/eitel/ns/commercialuse': 'https://w3id.org/eitel/ns/commercialUse',
        'odrl:datetime': 'http://www.w3.org/ns/odrl/2/dateTime',
        'http://www.w3.org/ns/odrl/2/datetime': 'http://www.w3.org/ns/odrl/2/dateTime',
      };
      return map[normalized] || raw;
    }

    function sanitizePolicyForStorage(policyInput, assetId, policyId) {
      const normalizeNode = (node, options = {}) => {
        if (Array.isArray(node)) return node.map(item => normalizeNode(item, options)).filter(item => item !== undefined);
        if (!node || typeof node !== 'object') return node;

        const result = {};
        Object.entries(node).forEach(([key, value]) => {
          if (key === '@context') return;

          let normalizedKey = key.startsWith('odrl:') ? key.slice(5) : key;
          let normalizedValue = normalizeNode(value, options);

          if (normalizedKey === '@type' && typeof normalizedValue === 'string') {
            normalizedValue = normalizedValue.replace(/^.*\//, '').replace(/^odrl:/i, '') || normalizedValue;
          }
          if (normalizedKey === 'leftOperand' && typeof normalizedValue === 'string') {
            normalizedValue = normalizePolicyOperandIri(normalizedValue);
          }
          if ((normalizedKey === 'operator' || normalizedKey === 'action') && typeof normalizedValue === 'string') {
            normalizedValue = normalizedValue.replace(/^odrl:/i, '');
          }
          if (normalizedKey === 'target' && options.forceAssetTarget) {
            normalizedValue = assetId;
          }

          result[normalizedKey] = normalizedValue;
        });

        return result;
      };

      const sanitized = normalizeNode(policyInput || {}, { forceAssetTarget: false }) || {};
      sanitized['@id'] = String(policyId || sanitized['@id'] || '').trim();
      sanitized['@type'] = 'http://www.w3.org/ns/odrl/2/Set';

      delete sanitized['dct:accessRights'];
      delete sanitized['dct:purpose'];
      delete sanitized['dct:spatial'];
      delete sanitized['dcat:theme'];
      delete sanitized['dct:validUntil'];

      const normalizeRule = (rule) => {
        const normalizedRule = normalizeNode(rule || {}, { forceAssetTarget: true }) || {};
        normalizedRule.target = assetId;
        if (!normalizedRule.action) normalizedRule.action = 'use';
        const constraintsRaw = normalizedRule.constraint || [];
        normalizedRule.constraint = (Array.isArray(constraintsRaw) ? constraintsRaw : [constraintsRaw]).filter(Boolean);
        return normalizedRule;
      };

      const permissions = sanitized.permission || [];
      sanitized.permission = (Array.isArray(permissions) ? permissions : [permissions]).filter(Boolean).map(normalizeRule);
      if (!sanitized.permission.length) sanitized.permission = [{ action: 'use', target: assetId, constraint: [] }];

      const prohibitions = sanitized.prohibition || [];
      sanitized.prohibition = (Array.isArray(prohibitions) ? prohibitions : [prohibitions]).filter(Boolean).map(normalizeRule);

      const obligations = sanitized.obligation || [];
      sanitized.obligation = (Array.isArray(obligations) ? obligations : [obligations]).filter(Boolean).map(normalizeRule);

      return sanitized;
    }

    /**
     * Parses a keyword list from various input formats.
     * Handles arrays, strings (split by comma, semicolon, or newline), and null/undefined values.
     * 
     * @param {string|string[]|null|undefined} raw - Raw keyword input in array or string format
     * @returns {string[]} Array of trimmed, non-empty keywords
     * 
     * @example
     * parseKeywordList('python, javascript; nodejs\nreact');
     * // Returns: ['python', 'javascript', 'nodejs', 'react']
     */
    function parseKeywordList(raw) {
      if (Array.isArray(raw)) return raw.map(v => String(v || '').trim()).filter(Boolean);
      if (!raw) return [];
      return String(raw)
        .split(/[;,\n]/g)
        .map(v => v.trim())
        .filter(Boolean);
    }

    /**
     * Returns the first non-empty value from an array of candidates.
     * Skips null, undefined, and whitespace-only strings.
     * 
     * @param {any[]} values - Array of values to check
     * @returns {string} First non-empty value, or empty string if none found
     * 
     * @example
     * firstNonEmpty(['', null, '  ', 'found', 'second']);
     * // Returns: 'found'
     */
    function firstNonEmpty(values = []) {
      for (const value of values) {
        if (value === undefined || value === null) continue;
        const txt = String(value).trim();
        if (txt) return txt;
      }
      return '';
    }

    /**
     * Safely converts any value to a trimmed string with fallback support.
     * Returns fallback if value is null, undefined, or empty after trimming.
     * 
     * @param {any} value - Value to convert
     * @param {string} [fallback=''] - Fallback value if conversion results in empty string
     * @returns {string} Converted and trimmed text or fallback
     * 
     * @example
     * safeText(null, 'default'); // Returns: 'default'
     * safeText('  hello  '); // Returns: 'hello'
     */
    function safeText(value, fallback = '') {
      const txt = value === undefined || value === null ? '' : String(value).trim();
      return txt || fallback;
    }

    /**
     * Escapes HTML special characters in a string for safe embedding in HTML.
     * Converts &, <, >, ", and ' to their HTML entity equivalents.
     * 
     * @param {any} value - Value to escape
     * @returns {string} HTML-escaped string
     * 
     * @example
     * htmlEscape('<script>alert("xss")</script>');
     * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
     */
    function htmlEscape(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /**
     * Resolves an asset image URL, providing a default if empty.
     * Returns the EITEL brand logo as fallback for missing or empty URLs.
     * 
     * @param {string|null|undefined} rawImageUrl - Raw image URL from asset metadata
     * @returns {string} Valid image URL or default EITEL logo path
     * 
     * @example
     * resolveAssetImageUrl(''); // Returns: 'assets/eitel-logo-brand.png'
     * resolveAssetImageUrl('https://example.com/logo.png'); // Returns provided URL
     */
    function resolveAssetImageUrl(rawImageUrl) {
      const candidate = String(rawImageUrl || '').trim();
      if (candidate) return candidate;
      return 'assets/eitel-logo-brand.png';
    }

    /**
     * Checks if an image URL is the default EITEL brand logo.
     * Performs case-insensitive comparison with known default paths.
     * 
     * @param {string|null|undefined} imageUrl - Image URL to check
     * @returns {boolean} True if URL matches default EITEL logo path
     * 
     * @example
     * isDefaultAssetImage('assets/eitel-logo-brand.png'); // Returns: true
     * isDefaultAssetImage('https://example.com/logo.png'); // Returns: false
     */
    function isDefaultAssetImage(imageUrl) {
      const txt = String(imageUrl || '').trim().toLowerCase();
      return txt.endsWith('/assets/eitel-logo-brand.png') || txt === 'assets/eitel-logo-brand.png';
    }

    /**
     * Formats a connector name for display in UI.
     * Recognizes known connectors (UC3M, FUENLABRADA) and formats accordingly.
     * 
     * @param {string|null|undefined} rawConnector - Raw connector identifier
     * @returns {string} Formatted connector label in uppercase
     * 
     * @example
     * prettyConnectorLabel('conectoruc3m'); // Returns: 'UC3M'
     * prettyConnectorLabel('conectorFuenlabrada'); // Returns: 'FUENLABRADA'
     * prettyConnectorLabel('unknown'); // Returns: 'UNKNOWN'
     */
    function prettyConnectorLabel(rawConnector) {
      const txt = String(rawConnector || '').trim();
      if (!txt) return 'CONNECTOR';
      const lower = txt.toLowerCase();
      if (lower.includes('uc3m')) return 'UC3M';
      if (lower.includes('fuenlabrada')) return 'FUENLABRADA';
      return txt.replace(/^conector/i, '').trim().toUpperCase() || 'CONNECTOR';
    }

    function sameConnectorId(left, right) {
      const a = canonicalConnectorPrefix(left || '').toLowerCase();
      const b = canonicalConnectorPrefix(right || '').toLowerCase();
      return Boolean(a && b && a === b);
    }

    function getCurrentConnectorId() {
      const raw = firstNonEmpty([connectorName, cfg?.connectorName, PROD_CONNECTOR_ID]);
      const canonical = canonicalConnectorPrefix(raw);
      return canonical && canonical.toLowerCase() !== 'conectorconnector' ? canonical : '';
    }

    function getCatalogRowState(row) {
      const isOwn = sameConnectorId(row?.connectorId || row?.assigner || '', getCurrentConnectorId());
      if (isOwn) return 'own';
      const accessLevel = normalizeAccessLevel(row?.accessLevel || 'public');
      if (!isRestrictedAccessLevel(accessLevel)) return 'public';
      const accessStatus = String(row?.accessRequestStatus || '').trim().toLowerCase();
      if (accessStatus === 'approved') return 'approved';
      return accessStatus === 'pending' ? 'pending' : 'no-access';
    }

    function catalogStateLabel(stateName) {
      const labels = {
        own: 'Asset propio',
        public: 'Público',
        pending: 'Solicitud pendiente',
        'no-access': 'Privado',
        approved: 'Disponible (solicitud anterior)',
      };
      return labels[stateName] || 'Catalogo';
    }

    function catalogStateDescription(stateName) {
      const descriptions = {
        own: 'Assets publicados por este conector.',
        'no-access': 'Assets privados de otros conectores sin solicitud activa de este consumidor.',
        pending: 'Solicitudes enviadas pendientes de aprobacion por el propietario.',
        approved: 'Assets privados con solicitud aprobada anteriormente para este consumidor.',
        public: 'Assets disponibles para cualquier consumidor sin solicitud previa.',
      };
      return descriptions[stateName] || '';
    }

    function inferPolicyIdForAsset(assetId) {
      const raw = String(assetId || '').trim();
      if (!raw) return '';
      const key = raw.replace(/^asset-/i, '');
      return `policy-${key}`;
    }

    function canUseCatalogRow(row) {
      if (!row) return false;
      if (!canPrepareCatalogContract(row)) return false;
      return hasNegotiableCatalogOffer(row);
    }

    function canPrepareCatalogContract(row) {
      if (!row) return false;
      if (sameConnectorId(row.connectorId || row.assigner || '', getCurrentConnectorId())) return false;
      const stateName = getCatalogRowState(row);
      if (isRestrictedAccessLevel(row?.accessLevel || 'public') && stateName !== 'approved') return false;
      if (!(stateName === 'public' || stateName === 'approved')) return false;
      return true;
    }

    function hasNegotiableCatalogOffer(row) {
      if (!row) return false;
      if (!row.offerId || !row.policyRaw) return false;
      if (!row.catalogOfferResolved) return false;
      return String(row.catalogOfferSource || '').trim().toLowerCase() !== 'provider-management-fallback';
    }

    function hasManagementPublishedOffer(row) {
      if (!row) return false;
      return Boolean(row.managementPublishedOfferAvailable && row.managementOfferId && row.managementPolicyRaw);
    }

    function getCatalogContractAvailability(row) {
      if (!row) {
        return {
          canContract: false,
          reason: 'No se ha seleccionado ningun asset.',
          nextStep: 'Selecciona un asset del catalogo.',
        };
      }

      const stateName = getCatalogRowState(row);
      if (sameConnectorId(row.connectorId || row.assigner || '', getCurrentConnectorId())) {
        return {
          canContract: false,
          reason: 'Es un asset propio. Aparece en catálogo para trazabilidad, pero no se contrata desde el mismo conector.',
          nextStep: 'Gestiona este asset desde Mis publicaciones.',
        };
      }

      if (isRestrictedAccessLevel(row.accessLevel || 'public')) {
        return {
          canContract: stateName === 'approved',
          reason: stateName === 'approved'
            ? 'Este asset privado tiene una solicitud anterior aprobada para este conector.'
            : 'Este asset es privado. Solo puede gestionarse mediante solicitud de acceso.',
          nextStep: stateName === 'approved' ? 'Selecciona el asset y pulsa Realizar contrato.' : 'Solicita acceso al propietario.',
        };
      }

      if (!hasNegotiableCatalogOffer(row)) {
        return {
          canContract: false,
          reason: stateName === 'public'
            ? 'El asset es publico y visible, pero el proveedor no lo esta publicando como oferta DSP negociable.'
            : 'Tienes visibilidad del asset, pero no existe una oferta DSP negociable para este asset.',
          nextStep: 'Pide al proveedor que publique o repare la ContractDefinition y la PolicyDefinition del asset, y luego recarga el catálogo.',
        };
      }

      if (!(stateName === 'public' || stateName === 'approved')) {
        return {
          canContract: false,
          reason: 'Todavia no tienes permiso para contratar este asset.',
          nextStep: stateName === 'no-access' ? 'Solicita acceso al propietario.' : 'Espera a que el propietario apruebe la solicitud.',
        };
      }

      return {
        canContract: true,
        reason: 'Existe una oferta DSP negociable para este asset.',
        nextStep: 'Selecciona el asset y pulsa Realizar contrato.',
      };
    }

    function ensureNegotiableCatalogRow(row) {
      if (!row || !canUseCatalogRow(row)) return row;
      if (row.offerId && row.policyRaw) return row;
      const assetId = String(row.assetId || row.policyTarget || '').trim();
      const policyId = String(row.offerId || inferPolicyIdForAsset(assetId)).trim();
      const assigner = String(row.assigner || row.connectorId || 'provider').trim();
      const policyRaw = row.policyRaw || {
        '@id': policyId,
        '@type': 'odrl:Offer',
        assigner,
        target: assetId,
        permission: [{ action: 'use', target: assetId }],
        prohibition: [],
        obligation: [],
      };
      return {
        ...row,
        offerId: policyId,
        policyTarget: row.policyTarget || assetId,
        assigner,
        policyRaw,
        policySummary: row.policySummary || 'Oferta inferida desde asset publicado y policy convencional.',
        catalogOfferResolved: Boolean(row.offerId),
        catalogOfferInferred: !row.offerId,
      };
    }

    function getContractDefinitionAssetId(contractDefinition) {
      const selectors = contractDefinition?.assetsSelector || contractDefinition?.['edc:assetsSelector'] || [];
      const flatSelectors = Array.isArray(selectors)
        ? selectors.flatMap(item => Array.isArray(item) ? item : [item])
        : [];
      const idCriterion = flatSelectors.find(criterion => {
        const left = String(criterion?.operandLeft || criterion?.leftOperand || criterion?.['edc:operandLeft'] || '').trim();
        return left === 'https://w3id.org/edc/v0.0.1/ns/id' || left.endsWith('/id') || left === 'id';
      }) || flatSelectors[0];
      return String(
        idCriterion?.operandRight ||
        idCriterion?.rightOperand ||
        idCriterion?.rightValue ||
        idCriterion?.['edc:operandRight'] ||
        ''
      ).trim();
    }

    /**
     * Extracts standardized metadata from a dataset object.
     * Handles multiple metadata formats (DublinCore, EDC, EITEL properties) and consolidates keywords.
     * 
     * @param {Object} dataset - Dataset object containing metadata properties
     * @returns {Object} Standardized metadata object with title, description, imageUrl, and keywords
     * @returns {string} returns.title - Dataset title
     * @returns {string} returns.description - Dataset description
     * @returns {string} returns.imageUrl - Image/icon URL
     * @returns {string[]} returns.keywords - Array of unique keywords
     * 
     * @example
     * const metadata = extractDatasetMetadata(dataset);
     * console.log(metadata.title, metadata.description, metadata.keywords);
     */
    function extractDatasetMetadata(dataset) {
      const d = dataset || {};
      const props = d?.properties || d?.['dct:properties'] || d?.['edc:properties'] || {};

      const title = firstNonEmpty([
        d?.['dct:title'],
        d?.title,
        d?.name,
        props?.['dct:title'],
        props?.title,
        props?.name,
      ]);
      const description = firstNonEmpty([
        d?.['dct:description'],
        d?.description,
        props?.['dct:description'],
        props?.description,
        props?.['eitel:description'],
      ]);
      const imageUrl = firstNonEmpty([
        d?.['schema:image'],
        d?.image,
        props?.['schema:image'],
        props?.['eitel:image'],
        props?.image,
      ]);

      const keywords = [
        ...parseKeywordList(d?.['dcat:keyword']),
        ...parseKeywordList(d?.keyword),
        ...parseKeywordList(props?.['dcat:keyword']),
        ...parseKeywordList(props?.['eitel:keywords']),
        ...parseKeywordList(props?.keywords),
      ];

      return {
        title,
        description,
        imageUrl,
        visibility: firstNonEmpty([
          d?.['dct:accessRights'],
          props?.['dct:accessRights'],
          props?.['eitel:visibility'],
          props?.visibility,
        ]),
        ownerEmail: firstNonEmpty([
          props?.['eitel:ownerEmail'],
          props?.ownerEmail,
        ]),
        ownerName: firstNonEmpty([
          props?.['eitel:ownerName'],
          props?.ownerName,
        ]),
        keywords: [...new Set(keywords)],
      };
    }

    /**
     * Builds a complete DublinCore JSON-LD representation of a policy.
     * Formats policy information according to W3C standards with ODRL and EITEL namespaces.
     * 
     * @param {Object} row - Policy row containing asset and policy information
     * @param {string} row.assetId - Asset identifier
     * @param {string} row.assetTitle - Human-readable asset title
     * @param {string} row.assetDescription - Asset description text
     * @param {string[]} row.assetKeywords - Array of keywords
     * @param {string} row.connectorId - Connector identifier
     * @param {string} row.counterPartyAddress - Counter-party connector address
     * @param {Object} row.policyRaw - Raw ODRL policy object
     * @returns {string} JSON-LD formatted policy representation
     * 
     * @example
     * const jsonLd = buildPolicyDcatJsonLd(policyRow);
     * console.log(JSON.parse(jsonLd));
     */
    function buildPolicyDcatJsonLd(row) {
      const payload = {
        '@context': {
          dcat: 'https://www.w3.org/ns/dcat#',
          dct: 'http://purl.org/dc/terms/',
          odrl: 'http://www.w3.org/ns/odrl/2/',
          eitel: 'https://w3id.org/eitel/ns/'
        },
        '@type': 'dcat:Dataset',
        '@id': row?.assetId || '',
        'dct:title': row?.assetTitle || clean(row?.assetId || ''),
        'dct:description': row?.assetDescription || '',
        'dcat:keyword': Array.isArray(row?.assetKeywords) ? row.assetKeywords : [],
        'eitel:connectorId': row?.connectorId || '',
        'eitel:connectorAddress': row?.counterPartyAddress || '',
        'odrl:hasPolicy': row?.policyRaw || {},
      };
      return JSON.stringify(payload, null, 2);
    }

    /**
     * Parses connector candidates from UI inputs.
     * Extracts connector identifiers from textarea and single input fields,
     * normalizes them, and provides sensible defaults.
     * 
     * @returns {string[]} Array of unique connector URLs or identifiers
     * 
     * @example
     * const connectors = parseConnectorCandidates();
     * // Returns: ['conectoruc3m', 'conectorFuenlabrada', ...]
     */
    function parseConnectorCandidates(options = {}) {
      const includeSingle = options.includeSingle !== false;
      const listRaw = document.getElementById('catalogConnectorsList')?.value || '';
      const values = listRaw
        .split(/[\n,;]+/g)
        .map(v => String(v || '').trim())
        .filter(Boolean)
        .map(v => {
          if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')) return v;
          return canonicalConnectorPrefix(v) || v;
        });
      if (includeSingle) {
        const single = String(document.getElementById('searchConnectorId')?.value || '').trim();
        if (single) values.unshift(canonicalConnectorPrefix(single) || single);
      }
      if (!values.length) {
        const configuredList = String(cfg.connectorCatalogList || '').trim();
        if (configuredList) {
          configuredList.split(/[\n,;]+/g)
            .map(v => String(v || '').trim())
            .filter(Boolean)
            .forEach(v => values.push(canonicalConnectorPrefix(v) || v));
        }
      }
      const currentConnector = getCurrentConnectorId();
      if (currentConnector) values.push(currentConnector);
      Object.keys(getConfiguredConnectorDirectory()).forEach((key) => {
        const normalized = canonicalConnectorPrefix(key);
        if (normalized) values.push(normalized);
      });
      if (!values.length) values.push('conectoruc3m', 'conectorFuenlabrada');
      return [...new Set(values)];
    }

    /**
     * Resolves the public origin URL for the connector.
     * Uses DSP URL config if available, fallback to current window location.
     * 
     * @returns {string} Public origin URL (e.g., 'https://example.com')
     * 
     * @example
     * const origin = getPublicConnectorOrigin();
     * // Returns: 'http://localhost:3000' or configured DSP origin
     */
    function getPublicConnectorOrigin() {
      try {
        const cfgDsp = String(cfg?.dspUrl || '').trim();
        if (cfgDsp.startsWith('http://') || cfgDsp.startsWith('https://')) {
          return new URL(cfgDsp).origin;
        }
      } catch {}
      return window.location.origin;
    }

