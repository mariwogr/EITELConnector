    /**
     * Applies i18n translation overrides from configuration.
     * Merges config language pack into main i18n dictionary.
     * 
     * @example
     * applyI18n(); // Applies any cfg.languagePack overrides
     */
    function applyI18n() {
      document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
      document.getElementById('brandTitle').textContent = settings.language === 'en' ? 'EITEL Connector' : 'Conector EITEL';
      document.getElementById('brandSub').textContent = settings.language === 'en' ? 'Operations console' : 'Consola de operación';
      document.getElementById('consoleTitle').textContent = settings.language === 'en' ? 'Console' : 'Consola';
      applyStaticLanguagePack();
    }

    /**
     * Applies a static language pack from configuration for i18n.
     * Loads and applies language translations defined in cfg.staticLanguagePack.
     * Updates all translatable UI elements with provided language strings.
     * 
     * @example
     * applyStaticLanguagePack(); // Loads translations from cfg configuration
     */
    function applyStaticLanguagePack() {
      const esToEn = {
        'Centro de control': 'Control Center',
        'Publicar': 'Publish',
        'Más': 'More',
        'Catálogo': 'Catalog',
        'Contratos': 'Contracts',
        'Transferencias': 'Transfers',
        'Política': 'Policy',
        'Contrato': 'Contract',
        'Mis assets': 'My publications',
        'Mis publicaciones': 'My publications',
        'Secretos': 'Secrets',
        'Sobre EITEL': 'About EITEL',
        'Actualizar': 'Refresh',
        'Restaurar assets desde backup': 'Restore assets from backup',
        'Assets publicados': 'Published assets',
        'Policies activas': 'Active policies',
        'Contratos vigentes': 'Active contracts',
        'Publicar asset': 'Publish asset',
        'Configura y publica el asset antes de definir política y contrato.': 'Configure and publish the asset before creating policy and contract.',
        'Descripción': 'Description',
        'Keywords (separadas por coma)': 'Keywords (comma-separated)',
        'Foto del asset (archivo local)': 'Asset image (local file)',
        'Origen del asset': 'Asset source',
        'Base URL remota': 'Remote base URL',
        'Archivo local': 'Local file',
        'Autenticación opcional': 'Optional authentication',
        'Ninguna': 'None',
        'Secreto de cliente': 'Client secret',
        'Token temporal': 'Temporary token',
        'Secreto (Vault)': 'Secret (Vault)',
        'Header auth': 'Auth header',
        'Prefijo': 'Prefix',
        'Headers JSON': 'Headers JSON',
        'Borrar': 'Delete',
        'Continuar a Política': 'Continue to Policy',
        'Definir política': 'Define policy',
        'Define condiciones de uso con un formulario simple (sin términos técnicos) o pega JSON-LD si lo necesitas.': 'Define usage conditions with a simple form or paste JSON-LD if needed.',
        'Modo': 'Mode',
        'Formulario': 'Form',
        'Nivel de acceso': 'Access level',
        'Público': 'Public',
        'Publico': 'Public',
        'Crear/Actualizar policy': 'Create/Update policy',
        'Listar policies': 'List policies',
        'Borrar policy': 'Delete policy',
        'Definir contrato': 'Define contract',
        'Aquí se asocia el asset con la policy mediante ContractDefinition.': 'Associate asset and policy through ContractDefinition here.',
        'Crear ContractDefinition': 'Create ContractDefinition',
        'Listar ContractDefinitions': 'List ContractDefinitions',
        'Borrar ContractDefinition': 'Delete ContractDefinition',
        'Catalogo de activos': 'Asset catalog',
        'Consulta activos disponibles, filtra resultados y prepara la contratacion desde esta vista.': 'Browse available assets, filter results, and prepare contracting from this view.',
        'Conector remoto': 'Remote connector',
        'Ver catálogos': 'Load catalogs',
        'Cargar catalogo completo': 'Load full catalog',
        'Busqueda y filtros': 'Search and filters',
        'Buscar activos': 'Search assets',
        'Filtrar por conector': 'Filter by connector',
        'Conector seleccionado': 'Selected connector',
        'URL DSP seleccionada': 'Selected DSP URL',
        'Preparar contrato del asset seleccionado': 'Prepare contract for selected asset',
        'Revisa la politica del activo seleccionado antes de iniciar la contratacion.': 'Review selected asset policy before starting contract request.',
        'Términos de policy seleccionada': 'Selected policy terms',
        'Aceptar los términos y condiciones de uso de la política seleccionada.': 'Accept selected policy terms and conditions.',
        'Realizar contrato': 'Request contract',
        'Modo de salida': 'Output mode',
        'Enviar a URL destino': 'Send to destination URL',
        'Descargar en local': 'Download locally',
        'Subir a ArcGIS': 'Upload to ArcGIS',
        'Dirección partner': 'Partner address',
        'Listar transferencias': 'List transfers',
        'Iniciar transferencia': 'Start transfer',
        'Mis assets publicados en este conector': 'My publications in this connector',
        'Mis publicaciones de este conector': 'My publications in this connector',
        'Lista visual de los assets que ya tienes publicados en el runtime actual.': 'Visual list of publications managed by this connector runtime.',
        'Lista visual de assets, policies y contratos que tienes publicados en el runtime actual.': 'Visual list of assets, policies, and contracts managed by this connector runtime.',
        'Editar asset': 'Edit asset',
        'Editar policy': 'Edit policy',
        'Editar contrato': 'Edit contract',
        'Borrar asset': 'Delete asset',
        'Borrar contrato': 'Delete contract',
        'Editar': 'Edit',
        'Guardar': 'Save',
        'Listar': 'List',
        'Mostrar valor': 'Show value',
        'Ocultar valor': 'Hide value',
      };

      const activeMap = settings.language === 'en'
        ? esToEn
        : Object.fromEntries(Object.entries(esToEn).map(([es, en]) => [en, es]));

      const textNodes = document.querySelectorAll('.nav-group-title, h2, h3, p, label, button, option, summary, th');
      textNodes.forEach((el) => {
        const isButton = el.tagName === 'BUTTON';
        const spanInIconButton = isButton ? el.querySelector('svg + span, span') : null;
        const target = isButton && spanInIconButton ? spanInIconButton : el;
        const raw = String(target.textContent || '').trim();
        if (!raw) return;
        const translated = activeMap[raw];
        if (translated) target.textContent = translated;
      });

      const placeholders = {
        'ej: dataset-clima-uc3m': 'e.g. climate-dataset-uc3m',
        'ej: Dataset Clima UC3M': 'e.g. Climate Dataset UC3M',
        'Describe qué datos contiene este asset, su periodicidad y para qué sirve.': 'Describe the data in this asset, its frequency, and intended use.',
        'energia, consumo, municipio, clima': 'energy, consumption, city, climate',
        'Token': 'Token',
        'Filtra por nombre, keyword o descripcion': 'Filter by name, keyword, or description',
      };
      const placeholderMap = settings.language === 'en'
        ? placeholders
        : Object.fromEntries(Object.entries(placeholders).map(([es, en]) => [en, es]));
      document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
        const raw = String(el.getAttribute('placeholder') || '').trim();
        if (!raw) return;
        const translated = placeholderMap[raw];
        if (translated) el.setAttribute('placeholder', translated);
      });
    }

    /**
     * Updates console button visibility based on console view state.
     * Toggles buttons display when user hides/shows the console panel.
     * 
     * @param {boolean} [hidden] - Whether console is hidden (auto-detected if omitted)
     * 
     * @example
     * updateConsoleButtons(true); // Hide buttons when console is hidden
     */
    function updateConsoleButtons(hidden = app.classList.contains('console-hidden')) {
      const toggle = document.getElementById('btnConsoleToggle');
      const expand = document.getElementById('btnConsoleExpand');
      const show = document.getElementById('btnConsoleShow');
      toggle.textContent = settings.consolePos === 'bottom' ? 'v' : '>';
      expand.textContent = settings.consoleExpanded ? '-' : '+';
      show.textContent = settings.consolePos === 'bottom' ? '^ Consola' : '< Consola';
      show.style.display = hidden ? 'inline-flex' : 'none';
    }

    /**
     * Shows an information popup modal with formatted content.
     * Displays title and payload data in a modal dialog within console area.
     * Supports various display options and auto-close behavior.
     * 
     * @param {string} title - Popup title
     * @param {string|Object} payload - Content to display (stringified if object)
     * @param {Object} [options={}] - Display options
     * @param {number} [options.autoClose] - Auto-close after milliseconds
     * 
     * @example
     * showInfoPopup('Success', { status: 200, message: 'Created' }, { autoClose: 3000 });
     */
    function showInfoPopup(title, payload, options = {}) {
      document.getElementById('infoTitle').textContent = title || 'Detalle';
      const infoBody = document.getElementById('infoBody');
      if (options && typeof options.html === 'string') {
        infoBody.classList.add('info-rich');
        infoBody.innerHTML = options.html;
      } else if (options && options.plainText) {
        infoBody.classList.remove('info-rich');
        infoBody.textContent = typeof payload === 'string' ? payload : String(payload ?? '');
      } else if (payload && typeof payload === 'object') {
        // Auto-prettify object/array payloads into a card instead of dumping raw JSON.
        infoBody.classList.add('info-rich');
        infoBody.innerHTML = renderGenericPayloadCard(title, payload);
      } else {
        infoBody.classList.remove('info-rich');
        infoBody.textContent = typeof payload === 'string' ? payload : String(payload ?? '');
      }
      const actionBtn = document.getElementById('btnInfoAction');
      if (options && options.actionLabel && typeof options.onAction === 'function') {
        infoActionHandler = options.onAction;
        actionBtn.textContent = options.actionLabel;
        actionBtn.style.display = 'inline-flex';
      } else {
        infoActionHandler = null;
        actionBtn.style.display = 'none';
      }
      infoModal.classList.add('open');
    }
    /**
     * Closes the information popup modal.
     * Removes popup from DOM and clears its content.
     * 
     * @example
     * closeInfoPopup(); // Hides and removes popup modal
     */
    function closeInfoPopup() {
      infoModal.classList.remove('open');
      infoActionHandler = null;
      const actionBtn = document.getElementById('btnInfoAction');
      actionBtn.style.display = 'none';
    }

    /**
     * Formats a byte count into a human-readable size (e.g. 5157048 -> "4.9 MB").
     *
     * @param {number|string} bytes - Raw byte count.
     * @returns {string} Human-readable size, or '' when unavailable.
     */
    function formatAssetBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = n;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
      return `${rounded} ${units[unit]}`;
    }

    function assetSourceModeLabel(mode) {
      switch (String(mode || '')) {
        case 'local-file': return 'Archivo local soberano';
        case 'remote-url': return 'Origen remoto (HTTP)';
        default: return mode ? String(mode) : 'Origen remoto (HTTP)';
      }
    }

    function assetAuthTypeLabel(type) {
      switch (String(type || 'none')) {
        case 'none': return 'Sin autenticación';
        case 'arcgis-login': return 'Token ArcGIS';
        case 'oauth2': return 'OAuth2';
        case 'apikey': return 'API token';
        default: return String(type || 'Sin autenticación');
      }
    }

    /**
     * Copies a value to the clipboard from an info-popup button and shows quick feedback.
     * Exposed on window so inline onclick handlers inside the popup can call it.
     *
     * @param {string} text - Value to copy.
     * @param {HTMLElement} [btn] - Button that triggered the copy, used for feedback.
     */
    window.copyAssetPublishValue = async function copyAssetPublishValue(text, btn) {
      const value = String(text || '');
      if (!value) return;
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
          ok = true;
        }
      } catch { ok = false; }
      if (!ok) {
        try {
          const ta = document.createElement('textarea');
          ta.value = value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch { ok = false; }
      }
      if (btn) {
        const original = btn.dataset.label || btn.textContent;
        btn.dataset.label = original;
        btn.textContent = ok ? 'Copiado' : 'Error';
        setTimeout(() => { btn.textContent = btn.dataset.label || original; }, 1400);
      }
    };

    /**
     * Builds a friendly HTML card describing a freshly published/updated asset.
     * Used as the body of the info popup instead of raw JSON.
     *
     * @param {Object} info - Asset publish result (status, assetId, name, sourceMode, localUpload, ...).
     * @returns {string} HTML markup for showInfoPopup({ html }).
     */
    function renderAssetPublishedCard(info) {
      const data = info || {};
      const status = Number(data.status) || 0;
      const assetId = htmlEscape(String(data.assetId || '—'));
      const name = String(data.name || '').trim();
      const description = String(data.description || '').trim();
      const keywords = Array.isArray(data.keywords)
        ? data.keywords.map(k => String(k || '').trim()).filter(Boolean)
        : [];
      const sourceMode = String(data.sourceMode || '');
      const upload = data.localUpload || null;
      const isLocal = sourceMode === 'local-file';

      const field = (label, value) => `
        <div class="pub-field">
          <span class="pub-field-label">${htmlEscape(label)}</span>
          <span class="pub-field-value">${value && String(value).trim() ? htmlEscape(value) : '<span class="pub-empty">—</span>'}</span>
        </div>`;

      const keywordsBlock = keywords.length
        ? `<div class="pub-section">
             <div class="pub-section-title">Keywords</div>
             <div class="pub-chips">${keywords.map(k => `<span class="pub-chip">${htmlEscape(k)}</span>`).join('')}</div>
           </div>`
        : '';

      let sourceBlock = '';
      if (isLocal && upload) {
        const filename = String(upload.filename || '').trim() || 'archivo';
        const size = formatAssetBytes(upload.bytes);
        const ctype = String(upload.contentType || '').trim();
        const publicUrl = String(upload.publicUrl || '').trim();
        const metaParts = [size, ctype].filter(Boolean).join(' · ');
        const urlRow = publicUrl
          ? `<div class="pub-url-row">
               <input class="pub-url-input" value="${htmlEscape(publicUrl)}" readonly />
               <button type="button" class="ghost pub-url-btn" data-label="Copiar" onclick="window.copyAssetPublishValue(this.previousElementSibling.value, this)">Copiar</button>
               <a class="ghost pub-url-btn" href="${htmlEscape(publicUrl)}" target="_blank" rel="noopener">Abrir</a>
             </div>`
          : '<p class="pub-note">Asset privado: el archivo se sirve de forma soberana, sin URL pública.</p>';
        sourceBlock = `
          <div class="pub-section">
            <div class="pub-section-title">Archivo soberano</div>
            <div class="pub-file">
              <div class="pub-file-icon">📄</div>
              <div class="pub-file-info">
                <div class="pub-file-name">${htmlEscape(filename)}</div>
                ${metaParts ? `<div class="pub-file-meta">${htmlEscape(metaParts)}</div>` : ''}
              </div>
            </div>
            ${urlRow}
          </div>`;
      } else {
        const baseUrl = String(data.baseUrl || '').trim();
        const path = String(data.path || '').trim();
        const fullUrl = (baseUrl + path) || baseUrl || path;
        sourceBlock = fullUrl
          ? `<div class="pub-section">
               <div class="pub-section-title">Origen remoto</div>
               <div class="pub-url-row">
                 <input class="pub-url-input" value="${htmlEscape(fullUrl)}" readonly />
                 <button type="button" class="ghost pub-url-btn" data-label="Copiar" onclick="window.copyAssetPublishValue(this.previousElementSibling.value, this)">Copiar</button>
               </div>
             </div>`
          : '';
      }

      const hint = String(data.hint || '').trim();

      return `
        <div class="pub-result">
          <div class="pub-hero">
            <div class="pub-hero-icon">✓</div>
            <div class="pub-hero-text">
              <div class="pub-hero-title">Asset publicado correctamente</div>
              <div class="pub-hero-id">${assetId}</div>
            </div>
            ${status ? `<span class="pub-status-badge">HTTP ${status}</span>` : ''}
          </div>
          <div class="pub-grid">
            ${field('Nombre', name)}
            ${field('Descripción', description)}
            ${field('Origen', assetSourceModeLabel(sourceMode))}
            ${field('Autenticación', assetAuthTypeLabel(data.authType))}
          </div>
          ${keywordsBlock}
          ${sourceBlock}
          ${hint ? `<p class="pub-hint">${htmlEscape(hint)}</p>` : ''}
        </div>`;
    }

    /**
     * Maps an access-level code to its Spanish label (matches the policy selector).
     *
     * @param {string} level - public | private | partners | internal.
     * @returns {string} Human-readable label.
     */
    function policyAccessLevelLabel(level) {
      switch (String(level || '')) {
        case 'public': return 'Público';
        case 'private': return 'Privado (requiere solicitud)';
        case 'partners': return 'Solo entidades colaboradoras';
        case 'internal': return 'Uso interno del proyecto';
        default: return level ? String(level) : '';
      }
    }

    /**
     * Builds a friendly HTML card for a created/updated policy response,
     * used as the body of the info popup instead of raw JSON.
     *
     * @param {Object} info - { policyId, assetId, status, accessLevel }.
     * @returns {string} HTML markup for showInfoPopup({ html }).
     */
    function renderPolicyCreatedCard(info) {
      const data = info || {};
      const status = Number(data.status) || 0;
      // 204 (No Content) is returned by the PUT update path; 200/201 by the create path.
      const updated = status === 204;
      const policyId = String(data.policyId || '—');
      const assetId = String(data.assetId || '');
      const accessLevel = String(data.accessLevel || data.visibility || '').trim();

      const field = (label, value) => `
        <div class="pub-field">
          <span class="pub-field-label">${htmlEscape(label)}</span>
          <span class="pub-field-value">${value && String(value).trim() ? htmlEscape(value) : '<span class="pub-empty">—</span>'}</span>
        </div>`;

      const fields = [field('Asset', assetId)];
      if (accessLevel) fields.push(field('Visibilidad', policyAccessLevelLabel(accessLevel)));

      return `
        <div class="pub-result">
          <div class="pub-hero">
            <div class="pub-hero-icon">✓</div>
            <div class="pub-hero-text">
              <div class="pub-hero-title">Política de uso ${updated ? 'actualizada' : 'creada'} correctamente</div>
              <div class="pub-hero-id">${htmlEscape(policyId)}</div>
            </div>
            ${status ? `<span class="pub-status-badge">HTTP ${status}</span>` : ''}
          </div>
          <div class="pub-grid">
            ${fields.join('')}
          </div>
          <p class="pub-hint">La política quedó asociada al asset. Continúa a Contrato para exponer la oferta en el catálogo.</p>
        </div>`;
    }

    /**
     * Generic result card for info popups, reusing the .pub-* styles.
     * Use it instead of dumping raw JSON for simple confirmation/info popups.
     *
     * @param {Object} opts
     * @param {string} opts.title - Hero title.
     * @param {string} [opts.subtitle] - Monospace identifier under the title.
     * @param {('ok'|'info'|'warn'|'danger')} [opts.tone='ok'] - Visual tone.
     * @param {number} [opts.status] - HTTP status badge (omitted when falsy).
     * @param {Array<{label:string,value:*}>} [opts.fields] - Key/value rows.
     * @param {Array<{label:string,json:string}>} [opts.details] - Collapsible JSON blocks.
     * @param {string} [opts.hint] - Footer note.
     * @returns {string} HTML markup for showInfoPopup({ html }).
     */
    function renderResultCard(opts) {
      const o = opts || {};
      const tone = ['ok', 'info', 'warn', 'danger'].includes(o.tone) ? o.tone : 'ok';
      const icon = { ok: '✓', info: 'ℹ', warn: '!', danger: '✕' }[tone];
      const status = Number(o.status) || 0;
      const fields = (Array.isArray(o.fields) ? o.fields : []).filter(f => f && f.label);
      const details = (Array.isArray(o.details) ? o.details : []).filter(d => d && d.json);
      const fieldHtml = (label, value) => `
        <div class="pub-field">
          <span class="pub-field-label">${htmlEscape(label)}</span>
          <span class="pub-field-value">${value !== undefined && value !== null && String(value).trim() ? htmlEscape(value) : '<span class="pub-empty">—</span>'}</span>
        </div>`;
      const grid = fields.length ? `<div class="pub-grid">${fields.map(f => fieldHtml(f.label, f.value)).join('')}</div>` : '';
      const detailsHtml = details.map(d => `<details class="pub-details"><summary>${htmlEscape(d.label || 'Detalle')}</summary><pre class="pub-pre">${htmlEscape(d.json)}</pre></details>`).join('');
      const subtitle = o.subtitle ? `<div class="pub-hero-id">${htmlEscape(o.subtitle)}</div>` : '';
      const hint = o.hint ? `<p class="pub-hint">${htmlEscape(o.hint)}</p>` : '';
      return `
        <div class="pub-result">
          <div class="pub-hero pub-hero-${tone}">
            <div class="pub-hero-icon">${icon}</div>
            <div class="pub-hero-text">
              <div class="pub-hero-title">${htmlEscape(o.title || '')}</div>
              ${subtitle}
            </div>
            ${status ? `<span class="pub-status-badge">HTTP ${status}</span>` : ''}
          </div>
          ${grid}
          ${detailsHtml}
          ${hint}
        </div>`;
    }

    // Keys treated specially when auto-rendering an arbitrary payload object.
    const POPUP_ID_KEYS = ['assetId', 'policyId', 'contractDefId', 'negotiationId', 'agreementId', 'transferId', 'transferProcessId', 'offerId', '@id', 'id'];
    const POPUP_HINT_KEYS = ['message', 'note', 'hint', 'nextStep', 'detail', 'errorDetail', 'error', 'reason'];
    const POPUP_SKIP_KEYS = ['@context', '@type'];
    const POPUP_KEY_LABELS = {
      assetId: 'Asset', policyId: 'Policy', contractDefId: 'ContractDefinition',
      negotiationId: 'Negociación', agreementId: 'Agreement', transferId: 'Transferencia',
      transferProcessId: 'Transferencia', offerId: 'Oferta', provider: 'Provider', consumer: 'Consumer',
      providerId: 'Provider', consumerId: 'Consumer', estado: 'Estado', status: 'Estado HTTP',
      httpStatus: 'Estado HTTP', visibility: 'Visibilidad', negotiationState: 'Estado negociación',
      counterPartyId: 'Contraparte', counterPartyAddress: 'Dirección contraparte', removed: 'Eliminados',
    };

    function popupHumanizeKey(key) {
      if (POPUP_KEY_LABELS[key]) return POPUP_KEY_LABELS[key];
      return String(key)
        .replace(/^@/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, c => c.toUpperCase());
    }

    function popupSafeJson(value) {
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }

    /**
     * Infers a visual tone from a popup title and HTTP status (cosmetic only).
     * @returns {('ok'|'info'|'warn'|'danger')}
     */
    function inferPopupTone(title, status) {
      const t = String(title || '').toLowerCase();
      const code = Number(status) || 0;
      if (code >= 400) return 'danger';
      if (/error|fall[aoó]|no se pudo|rechaz|denegad|❌/.test(t)) return 'danger';
      if (/⚠|bloquead|estancad|sin |no hay|no puedes|no reconocid|todav[ií]a|pendiente|requerid|falta|no encontrad|no disponible/.test(t)) return 'warn';
      if (/en curso|monitoriz|iniciad|enviad|cargad|detalle|estado:|evento:/.test(t)) return 'info';
      return 'ok';
    }

    /**
     * Auto-renders an arbitrary popup payload (object or array) into a result card:
     * primitive entries become field rows, an id-like key becomes the subtitle,
     * message-like keys become the footer hint, and nested values become
     * collapsible JSON blocks (so detail is preserved, not dumped).
     *
     * @param {string} title - Popup title (also used to infer tone).
     * @param {Object|Array} payload - Arbitrary payload.
     * @returns {string} HTML markup.
     */
    function renderGenericPayloadCard(title, payload) {
      const isArray = Array.isArray(payload);
      const obj = (!isArray && payload && typeof payload === 'object') ? payload : {};
      const status = Number(obj.status) || 0;
      const tone = inferPopupTone(title, status);
      const skip = new Set(['status', ...POPUP_SKIP_KEYS]);

      let subtitle = '';
      for (const k of POPUP_ID_KEYS) {
        const v = obj[k];
        if (v != null && String(v).trim() && String(v) !== '-') { subtitle = String(v); skip.add(k); break; }
      }

      const hintParts = [];
      for (const k of POPUP_HINT_KEYS) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) { hintParts.push(v.trim()); skip.add(k); }
      }

      const fields = [];
      const details = [];
      const entries = isArray ? [['items', payload]] : Object.entries(obj);
      for (const [k, v] of entries) {
        if (skip.has(k)) continue;
        if (v == null || v === '') continue;
        if (typeof v === 'object') {
          details.push({ label: popupHumanizeKey(k), json: popupSafeJson(v) });
        } else {
          fields.push({ label: popupHumanizeKey(k), value: String(v) });
        }
      }

      return renderResultCard({ title, subtitle, tone, status, fields, details, hint: hintParts.join(' ') });
    }

    // Console resize bounds (px). The minimum keeps the console usable.
    const CONSOLE_MIN_W = 280;
    const CONSOLE_MIN_H = 140;

    // Max size leaves room for the 250px sidebar + main content (width) and the top bar (height).
    function consoleMaxWidth() { return Math.max(CONSOLE_MIN_W, window.innerWidth - 250 - 320); }
    function consoleMaxHeight() { return Math.max(CONSOLE_MIN_H, window.innerHeight - 220); }

    /**
     * Applies the persisted console width/height (clamped) as CSS variables on .app.
     * Width drives the right-docked console; height drives the bottom-docked console.
     *
     * @example
     * applyConsoleSize(); // Re-applies settings.consoleWidth / consoleHeight
     */
    function applyConsoleSize() {
      const w = Math.min(Math.max(Number(settings.consoleWidth) || 410, CONSOLE_MIN_W), consoleMaxWidth());
      const h = Math.min(Math.max(Number(settings.consoleHeight) || 300, CONSOLE_MIN_H), consoleMaxHeight());
      app.style.setProperty('--console-w', `${w}px`);
      app.style.setProperty('--console-h', `${h}px`);
    }

    /**
     * Wires the drag handle that resizes the console by dragging its inner border.
     * Right dock => horizontal resize (width); bottom dock => vertical resize (height).
     * The size is clamped to [min, max] and persisted on release.
     *
     * @example
     * initConsoleResizer(); // Call once during bootstrap
     */
    function initConsoleResizer() {
      const resizer = document.getElementById('consoleResizer');
      if (!resizer) return;
      let dragging = false;

      const onMove = (e) => {
        if (!dragging) return;
        if (settings.consolePos === 'bottom') {
          const h = window.innerHeight - e.clientY;
          settings.consoleHeight = Math.min(Math.max(h, CONSOLE_MIN_H), consoleMaxHeight());
        } else {
          const w = window.innerWidth - e.clientX;
          settings.consoleWidth = Math.min(Math.max(w, CONSOLE_MIN_W), consoleMaxWidth());
        }
        applyConsoleSize();
      };

      const stop = () => {
        if (!dragging) return;
        dragging = false;
        resizer.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', stop);
        persistSettings();
      };

      resizer.addEventListener('pointerdown', (e) => {
        if (app.classList.contains('console-hidden')) return; // nothing to resize while hidden
        dragging = true;
        resizer.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = settings.consolePos === 'bottom' ? 'row-resize' : 'col-resize';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', stop);
        e.preventDefault();
      });
    }

    /**
     * Applies UI configuration and initialization settings.
     * Sets up theme, language, layout preferences from stored configuration.
     * Called on page load to restore user preferences.
     *
     * @example
     * applySettings(); // Restores saved UI configuration
     */
    function applySettings() {
      document.body.dataset.theme = settings.theme;
      app.classList.toggle('console-bottom', settings.consolePos === 'bottom');
      app.classList.toggle('console-expanded', settings.consoleExpanded);
      out.style.fontSize = `${settings.consoleFont}px`;
      applyConsoleSize();

      document.getElementById('consoleState').textContent = `${settings.consolePos}${settings.consoleExpanded ? ' + expanded' : ''}`;
      document.getElementById('setLanguage').value = settings.language;
      document.getElementById('setTheme').value = settings.theme;
      document.getElementById('setConsolePos').value = settings.consolePos;
      document.getElementById('setConsoleFont').value = String(settings.consoleFont);
      if (document.getElementById('setApiBaseUrl')) document.getElementById('setApiBaseUrl').value = settings.apiBaseUrl;
      if (document.getElementById('setApiKey')) document.getElementById('setApiKey').value = settings.apiKeyOverride;
      if (document.getElementById('setApiTimeout')) document.getElementById('setApiTimeout').value = String(settings.apiTimeoutMs);
      if (document.getElementById('setApiRetries')) document.getElementById('setApiRetries').value = String(settings.apiRetries);
      if (document.getElementById('setDummyUrl')) document.getElementById('setDummyUrl').value = settings.dummyUrl || '';
      applyI18n();
      updateConsoleButtons();
      persistSettings();
    }

    /**
     * Activates a specific view panel in the UI.
     * Hides other views and shows selected one with its content and controls.
     * 
     * @param {string} view - View identifier ('publish', 'contract', 'transfer', 'catalog')
     * 
     * @example
     * activateView('publish'); // Show asset publishing view
     */
    function activateView(view) {
      const resolved = view;
      document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelector(`.nav button[data-view="${view}"]`)?.classList.add('active');
      document.getElementById(`panel-${resolved}`)?.classList.add('active');
        if (resolved === 'catalog') {
          if (state.catalogShowcaseLoaded && Array.isArray(state.catalogRows) && state.catalogRows.length) {
            renderCatalogShowcase(state.catalogRows || []);
          } else {
            loadCatalogShowcase(false);
          }
        }
      if (resolved === 'asset' || resolved === 'my-assets') {
        loadPublishedAssets(false);
      }
      if (resolved === 'secrets') {
        listSecrets(false).then((r) => {
          if (!(r.status >= 200 && r.status < 300)) {
            showInfoPopup('Secretos no disponibles', {
              message: 'No hay endpoint de secrets en runtime y tampoco en almacenamiento local del conector.',
              attempts: ['/v3/secrets/request', '/v3/secret/request', '/v3/secrets', '/local-assets/local-secrets']
            });
          }
        });
      }
      if (resolved === 'solicitudes') {
        loadAccessRequestsPanel(window._solicitudesCurrentFilter || 'all');
      }
    }

    /**
     * Updates asset preview panel with selected asset details.
     * Displays asset metadata, image, and source configuration in preview area.
     * 
     * @example
     * updateAssetPreview(); // Refresh preview with current asset selection
     */
    function updateAssetPreview() {
      const key = slug(document.getElementById('assetKey').value || '');
      document.getElementById('assetIdPreview').value = `asset-${key}`;
      const p = document.getElementById('policyIdPreview');
      const c = document.getElementById('contractDefIdPreview');
      if (p) p.value = `policy-${key}`;
      if (c) c.value = `contractdef-${key}`;
      const assetId = document.getElementById('assetIdPreview').value;
      const policyId = document.getElementById('policyIdPreview').value;
      const contractDefId = document.getElementById('contractDefIdPreview').value;
      const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
      setVal('policyAssetPreview', assetId);
      setVal('policyIdMirror', policyId);
      setVal('contractDefIdMirror', contractDefId);
      setVal('contractAssetPreview', assetId);
      setVal('contractAccessPolicyId', policyId);
      setVal('contractContractPolicyId', policyId);
    }

    /**
     * Applies policy mode UI configuration.
     * Shows or hides policy-related controls based on current mode.
     * Supports 'restricted' or 'open' policy creation modes.
     * 
     * @example
     * applyPolicyMode(); // Configure policy UI based on app settings
     */
    function applyPolicyMode() {
      const mode = document.getElementById('policyMode')?.value || 'form';
      const form = document.getElementById('policyFormBlock');
      const json = document.getElementById('policyJsonBlock');
      if (!form || !json) return;
      form.style.display = mode === 'jsonld' ? 'none' : 'block';
      json.style.display = mode === 'jsonld' ? 'block' : 'none';
    }

    /**
     * Refreshes catalog asset dropdown options.
     * Fetches latest assets from Management API and updates selection list.
     * Handles errors gracefully by maintaining current options.
     * 
     * @example
     * refreshCatalogAssetOptions(); // Reload available assets for selection
     */
    function refreshCatalogAssetOptions() {
      const sel = document.getElementById('catalogAssetId');
      const terms = document.getElementById('catalogPolicyTerms');
      const policyJsonLd = document.getElementById('catalogPolicyJsonLd');
      const accept = document.getElementById('catalogAcceptTerms');
      if (!sel) return;

      sel.innerHTML = '<option value="">Selecciona un data-offer</option>';
      state.catalogRows.forEach((r, idx) => {
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = `${safeText(r.assetTitle, clean(r.assetId))} · ${safeText(r.connectorId, r.assigner || '-')}`;
        sel.appendChild(o);
      });

      if (terms) terms.value = '';
      if (policyJsonLd) policyJsonLd.value = '';
      if (accept) accept.checked = false;
    }

    /**
     * Renders catalog showcase panel with dataset cards.
     * Displays available assets from catalog with metadata and preview.
     * Creates clickable cards for asset selection and browsing.
     * 
     * @param {Object[]} [rows=[]] - Array of dataset/asset objects to display
     * 
     * @example
     * renderCatalogShowcase(datasets); // Display catalog with dataset cards
     */
    function renderCatalogShowcase(rows = []) {
      const wrap = document.getElementById('catalogShowcase');
      if (!wrap) return;
      const query = String(document.getElementById('catalogSearchText')?.value || '').trim().toLowerCase();
      const connectorFilter = String(document.getElementById('catalogFilterConnector')?.value || '').trim().toLowerCase();

      const indexed = state.catalogRows.map((row, idx) => ({ row, idx }));
      const filtered = indexed.filter(({ row }) => {
        if (connectorFilter) {
          const connectorText = String(row.connectorId || row.assigner || '').toLowerCase();
          if (!connectorText.includes(connectorFilter)) return false;
        }
        if (!query) return true;
        const haystack = [
          row.assetTitle,
          row.assetDescription,
          row.assetId,
          row.offerId,
          row.connectorId,
          ...(Array.isArray(row.assetKeywords) ? row.assetKeywords : []),
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });

      if (!rows.length || !filtered.length) {
        wrap.innerHTML = '<div class="card" style="box-shadow:none"><p class="muted" style="margin:0">No hay assets para mostrar con el filtro actual.</p></div>';
        const contractBox = document.getElementById('catalogContractBox');
        if (contractBox) contractBox.style.display = 'none';
        return;
      }

      const groups = [
        { key: 'public', title: 'Públicos', rows: [] },
        { key: 'approved', title: 'Disponibles por solicitud anterior', rows: [] },
        { key: 'pending', title: 'Solicitud pendiente', rows: [] },
        { key: 'no-access', title: 'Privado', rows: [] },
        { key: 'own', title: 'Tus assets', rows: [] },
      ];
      const groupMap = new Map(groups.map(group => [group.key, group]));
      filtered.forEach(item => {
        const stateName = getCatalogRowState(item.row);
        const group = groupMap.get(stateName) || groupMap.get('public');
        group.rows.push({ ...item, stateName });
      });

      const renderCard = ({ row, idx, stateName }) => {
        const title = htmlEscape(safeText(row.assetTitle, clean(row.assetId)));
        const connector = htmlEscape(safeText(row.connectorId, row.assigner || '-'));
        const connectorBadge = htmlEscape(prettyConnectorLabel(safeText(row.connectorId, row.assigner || '-')));
        const desc = htmlEscape(safeText(row.assetDescription, 'Sin descripción publicada.'));
        const image = resolveAssetImageUrl(row.assetImageUrl);
        const defaultImageClass = isDefaultAssetImage(image) ? ' is-default' : '';
        const keywords = Array.isArray(row.assetKeywords) ? row.assetKeywords.slice(0, 8) : [];
        const delayMs = Math.min(idx * 55, 550);
        const hasOffer = Boolean(row.offerId);
        const isOwn = stateName === 'own';
        const canContract = canPrepareCatalogContract(row);
        const assetIdForAction = JSON.stringify(String(row.assetId || ''));
        const connectorIdForAction = JSON.stringify(String(row.connectorId || row.assigner || ''));
        const gaiaxOnClick = `window.openGaiaXModal(${connectorIdForAction})`;
        const actionLabel = isOwn
          ? 'Modificar'
          : (canContract
            ? 'Iniciar contratacion'
            : (stateName === 'no-access' ? 'Solicitarla' : 'Ver estado'));
        const actionOnClick = isOwn
          ? `window.editPublishedAsset(${assetIdForAction})`
          : canContract
          ? `window.useCatalogAssetByIndex(${idx})`
          : (stateName === 'no-access'
            ? `window.openAccessRequestByIndex(${idx})`
            : `window.showCatalogAssetStatusByIndex(${idx})`);
        const media = `<div class="asset-card-media${defaultImageClass}"><img src="${htmlEscape(image)}" alt="Imagen del asset ${title}" /><span class="asset-card-badge">${connectorBadge}</span><div class="asset-card-media-overlay"><span class="asset-card-media-title">${title}</span></div></div>`;
        const chips = keywords.length
          ? `<div class="asset-card-keywords">${keywords.map(k => `<span class="asset-chip">${htmlEscape(k)}</span>`).join('')}</div>`
          : '<div class="asset-card-meta">Sin keywords</div>';

        return `
          <article class="asset-card catalog-state-${htmlEscape(stateName)}" style="--delay:${delayMs}ms">
            ${media}
            <div class="asset-card-body">
              <div class="asset-card-title">${title}</div>
              <div class="asset-card-meta"><button class="gaiax-id-btn" onclick="${htmlEscape(gaiaxOnClick)}">${connector} <span class="gaiax-pill">GAIA-X</span></button></div>
              <details>
                <summary>Detalles</summary>
                <div class="asset-card-desc">${desc}</div>
                ${chips}
              </details>
              <div class="row">
                <button class="primary" onclick="${htmlEscape(actionOnClick)}">${actionLabel}</button>
              </div>
            </div>
          </article>
        `;
      };

      wrap.innerHTML = groups
        .filter(group => group.rows.length)
        .map(group => `
          <section class="catalog-group catalog-group-${htmlEscape(group.key)}">
            <div class="catalog-group-head">
              <h3>${htmlEscape(group.title)}</h3>
              <span class="muted">${group.rows.length} assets</span>
            </div>
            <p class="muted" style="margin-top:0">${htmlEscape(catalogStateDescription(group.key))}</p>
            <div class="asset-card-grid">${group.rows.map(renderCard).join('')}</div>
          </section>
        `).join('');
    }

    function syncCatalogSelectionState() {
      const sel = document.getElementById('catalogAssetId');
      const terms = document.getElementById('catalogPolicyTerms');
      const policyJsonLd = document.getElementById('catalogPolicyJsonLd');
      const accept = document.getElementById('catalogAcceptTerms');
      if (!sel || !accept) return;

      const idx = Number(sel.value);
      const selected = Number.isInteger(idx) && idx >= 0 ? state.catalogRows[idx] : null;
      if (terms) terms.value = selected?.policySummary || '';
      if (policyJsonLd) policyJsonLd.value = selected ? buildPolicyDcatJsonLd(selected) : '';
      const isPrivate = isRestrictedAccessLevel(selected?.accessLevel || 'public');

      const contractBox = document.getElementById('catalogContractBox');
      if (contractBox) contractBox.style.display = selected ? 'block' : 'none';
      const requestBtn = document.getElementById('btnRequestContract');
      const requestAccessBtn = document.getElementById('btnOpenAccessRequest');
      const contractHint = document.getElementById('catalogContractHint');
      const selectedState = selected ? getCatalogRowState(selected) : '';
      const availability = selected ? getCatalogContractAvailability(selected) : null;
      if (requestBtn) requestBtn.style.display = selected && canPrepareCatalogContract(selected) ? 'inline-flex' : 'none';
      if (requestAccessBtn) requestAccessBtn.style.display = selected && selectedState === 'no-access' ? 'inline-flex' : 'none';
      if (contractHint) {
        if (!selected) {
          contractHint.textContent = 'Selecciona un asset para preparar la contratación.';
        } else if (availability?.canContract) {
          contractHint.textContent = 'Este asset tiene una oferta DSP válida. Acepta los términos y pulsa Realizar contrato.';
        } else {
          contractHint.textContent = `${availability?.reason || 'Este asset todavía no se puede contratar.'} ${availability?.nextStep || ''}`.trim();
        }
      }
      if (accept) {
        if (isPrivate && selectedState !== 'approved') {
          accept.checked = false;
          accept.disabled = true;
        } else {
          accept.disabled = false;
        }
      }

      const selectedConnector = document.getElementById('catalogSelectedConnector');
      if (selectedConnector) selectedConnector.value = selected?.connectorId || '';
      const selectedDsp = document.getElementById('catalogSelectedDsp');
      if (selectedDsp) selectedDsp.value = selected?.counterPartyAddress || '';
      if (selected?.counterPartyAddress) {
        const resolved = document.getElementById('resolvedAddress');
        const transferAddress = document.getElementById('transferAddress');
        const connectorInput = document.getElementById('searchConnectorId');
        if (resolved) resolved.value = selected.counterPartyAddress;
        if (transferAddress) transferAddress.value = selected.counterPartyAddress;
        if (connectorInput && selected.connectorId) connectorInput.value = selected.connectorId;
      }

      // Explicit flow: contract is only requested when user clicks "Realizar contrato".
    }

    function getSelectedCatalogRow() {
      const select = document.getElementById('catalogAssetId');
      if (!select) return null;
      const idx = Number(select.value);
      if (!Number.isInteger(idx) || idx < 0 || idx >= (state.catalogRows || []).length) return null;
      return state.catalogRows[idx] || null;
    }

    function getStoredAccessRequester() {
      let parsed = {};
      try {
        const raw = localStorage.getItem(accessRequesterStorageKey);
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      const name = String(parsed?.name || authState?.username || '').trim();
      const email = String(parsed?.email || '').trim();
      const org = String(parsed?.org || '').trim();
      return { name, email, org };
    }

    function saveStoredAccessRequester(payload = {}) {
      const identity = {
        name: String(payload.requesterName || payload.name || '').trim(),
        email: String(payload.requesterEmail || payload.email || '').trim(),
        org: String(payload.requesterOrg || payload.org || '').trim(),
      };
      if (!identity.name && !identity.email && !identity.org) return;
      try { localStorage.setItem(accessRequesterStorageKey, JSON.stringify(identity)); } catch {}
    }

    function getCatalogRequesterEmail() {
      const fromForm = String(document.getElementById('reqRequesterEmail')?.value || '').trim();
      if (fromForm) return fromForm;
      return getStoredAccessRequester().email;
    }

    function closeAccessRequestModal() {
      const modal = document.getElementById('accessRequestModal');
      if (modal) modal.classList.remove('open');
    }

    function openAccessRequestModalForRow(row) {
      if (!row) {
        writeOut({ status: 400, error: 'Selecciona primero un asset privado.' });
        return;
      }
      const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = String(value || '').trim();
      };
      setVal('reqAssetId', row.assetId || '');
      setVal('reqAssetTitle', row.assetTitle || clean(row.assetId || ''));
      setVal('reqOwnerConnector', row.connectorId || row.assigner || '');
      setVal('reqOwnerEmail', row.ownerEmail || '');
      const requester = getStoredAccessRequester();
      setVal('reqRequesterName', requester.name || '');
      setVal('reqRequesterEmail', requester.email || '');
      setVal('reqRequesterOrg', requester.org || '');
      setVal('reqPurpose', '');
      setVal('reqDuration', '');
      setVal('reqMessage', '');
      const legal = document.getElementById('reqLegalAccept');
      if (legal) legal.checked = false;

      const modal = document.getElementById('accessRequestModal');
      if (modal) modal.classList.add('open');
    }

    /**
     * Derives the public local-assets base URL for a remote connector from its DSP address.
     * e.g. https://gis.eiteldata.eu/conectoruc3m/api/v1/dsp → https://gis.eiteldata.eu/conectoruc3m/local-assets
     */
    function deriveProviderLocalAssetsUrl(dspAddress) {
      if (!dspAddress) return null;
      try {
        // Strip /2025-1 protocol version suffix if present
        const cleanAddr = String(dspAddress).replace(/\/2025-1\/?$/, '');
        const url = new URL(cleanAddr);
        const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
        // Pattern: ['conectorXXX', 'api', 'v1', 'dsp'] → prefix = 'conectorXXX'
        const apiIdx = parts.indexOf('api');
        if (apiIdx > 0) {
          const prefix = parts.slice(0, apiIdx).join('/');
          return `${url.origin}/${prefix}/local-assets`;
        }
        // Fallback: use first path segment
        if (parts.length > 0) return `${url.origin}/${parts[0]}/local-assets`;
        return null;
      } catch {
        return null;
      }
    }

    async function submitAccessRequest() {
      const selected = getSelectedCatalogRow();
      if (!selected) {
        writeOut({ status: 400, error: 'No hay asset seleccionado para solicitar acceso.' });
        return;
      }

      const legalAccepted = document.getElementById('reqLegalAccept')?.checked;
      if (!legalAccepted) {
        writeOut({ status: 400, error: 'Debes aceptar la declaración antes de enviar la solicitud.' });
        return;
      }

      const payload = {
        assetId: selected.assetId || '',
        assetTitle: selected.assetTitle || clean(selected.assetId || ''),
        ownerConnectorId: selected.connectorId || selected.assigner || '',
        requesterConnectorId: getCurrentConnectorId(),
        ownerEmail: String(document.getElementById('reqOwnerEmail')?.value || selected.ownerEmail || '').trim(),
        requesterName: String(document.getElementById('reqRequesterName')?.value || '').trim(),
        requesterEmail: String(document.getElementById('reqRequesterEmail')?.value || '').trim(),
        requesterOrg: String(document.getElementById('reqRequesterOrg')?.value || '').trim(),
        purpose: String(document.getElementById('reqPurpose')?.value || '').trim(),
        requestedDuration: String(document.getElementById('reqDuration')?.value || '').trim(),
        message: String(document.getElementById('reqMessage')?.value || '').trim(),
      };

      if (!payload.requesterName || !payload.requesterEmail || !payload.purpose) {
        writeOut({ status: 400, error: 'Completa nombre, email y finalidad para enviar la solicitud.' });
        return;
      }
      saveStoredAccessRequester(payload);

      // POST to the provider's local-assets (cross-connector), not to own local-assets
      const dspAddress = selected.counterPartyAddress || '';
      const providerBase = deriveProviderLocalAssetsUrl(dspAddress);
      let response;
      if (providerBase) {
        try {
          const rawResp = await fetch(`${providerBase}/access-requests`, {
            method: 'POST',
            headers: getLocalAssetsAuthHeaders({ 'content-type': 'application/json' }),
            body: JSON.stringify(payload),
            credentials: 'include',
            cache: 'no-store',
          });
          const text = await rawResp.text();
          let data;
          try { data = JSON.parse(text); } catch { data = { raw: text }; }
          response = { status: rawResp.status, data };
        } catch (err) {
          response = { status: 503, data: { error: String(err) } };
        }
      } else {
        // Fallback for local dev where DSP URL may not follow the standard pattern
        response = await callLocalAssetsApi('POST', '/access-requests', {
          body: JSON.stringify(payload),
          headers: { 'content-type': 'application/json' },
        });
      }
      writeOut(response);
      if (response.status >= 200 && response.status < 300) {
        const item = response?.data?.item || {};
        const requestStatus = String(item.status || response?.data?.status || 'pending').trim().toLowerCase();
        const idx = state.catalogRows.findIndex(row =>
          String(row?.assetId || '').trim() === String(selected.assetId || '').trim()
          && String(row?.connectorId || row?.assigner || '').trim() === String(selected.connectorId || selected.assigner || '').trim()
        );
        if (idx >= 0) {
          const selectedValue = document.getElementById('catalogAssetId')?.value || '';
          state.catalogRows[idx] = {
            ...state.catalogRows[idx],
            accessRequestId: item.requestId || response?.data?.requestId || '',
            accessRequestStatus: requestStatus,
            accessRequest: item,
          };
          renderCatalogShowcase(state.catalogRows);
          refreshCatalogAssetOptions();
          const select = document.getElementById('catalogAssetId');
          if (select) select.value = selectedValue;
          syncCatalogSelectionState();
        }
        closeAccessRequestModal();
        showInfoPopup('Solicitud enviada', {
          assetId: payload.assetId,
          requestId: response?.data?.requestId || '',
          status: response?.data?.status || 'pending',
          ownerEmail: payload.ownerEmail || '-',
        });
      } else {
        showInfoPopup('No se pudo enviar la solicitud', response);
      }
    }

    // ---------------------------------------------------------------------------
    // Panel "Solicitudes recibidas" — gestión de access requests del propietario
    // ---------------------------------------------------------------------------

    async function loadAccessRequestsPanel(statusFilter) {
      const filter = statusFilter || window._solicitudesCurrentFilter || 'all';
      window._solicitudesCurrentFilter = filter;
      const tbody = document.getElementById('solicitudesTableBody');
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Cargando...</td></tr>';
      const params = filter !== 'all' ? `?status=${encodeURIComponent(filter)}` : '';
      const response = await callLocalAssetsApi('GET', `/access-requests${params}`);
      if (response.status < 200 || response.status >= 300) {
        tbody.innerHTML = `<tr><td colspan="7" class="muted">Error: ${htmlEscape(String(response.data?.detail || response.data?.error || 'Error'))}</td></tr>`;
        return;
      }
      const items = response.data?.items || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted">No hay solicitudes para este filtro.</td></tr>';
        return;
      }
      tbody.innerHTML = items.map(req => {
        const status = req.status || 'pending';
        const statusLabel = status === 'pending' ? 'Pendiente'
          : status === 'approved' ? 'Aprobada'
          : status === 'withdrawn' ? 'Retirada'
          : status === 'revoked' ? 'Revocada'
          : 'Rechazada';
        const statusStyle = status === 'pending'
          ? 'background:#fff3cd;color:#856404;padding:2px 7px;border-radius:4px;font-size:12px'
          : status === 'approved'
            ? 'background:#d4edda;color:#155724;padding:2px 7px;border-radius:4px;font-size:12px'
            : 'background:#f8d7da;color:#721c24;padding:2px 7px;border-radius:4px;font-size:12px';
        const date = req.createdAt ? new Date(req.createdAt).toLocaleDateString('es-ES') : '-';
        const gaiaxConnId = JSON.stringify(String(req.requesterConnectorId || ''));
        const gaiaxBtn = req.requesterConnectorId
          ? `<button class="gaiax-id-btn" style="font-size:11px;padding:1px 6px;margin-top:3px" onclick="window.openGaiaXModal(${htmlEscape(gaiaxConnId)})">GAIA-X <span class="gaiax-pill" style="font-size:10px">✓</span></button>`
          : '';
        const actions = status === 'pending'
          ? `<button class="primary" style="font-size:12px;padding:3px 10px" onclick="window.approveAccessRequest('${htmlEscape(req.requestId)}')">Aprobar</button>
             <button class="ghost" style="font-size:12px;padding:3px 10px;margin-left:4px" onclick="window.rejectAccessRequest('${htmlEscape(req.requestId)}')">Rechazar</button>
             <button class="ghost" style="font-size:12px;padding:3px 10px;margin-left:4px" onclick="window.withdrawAccessRequest('${htmlEscape(req.requestId)}')">Retirar</button>`
          : status === 'approved'
            ? `<button class="ghost" style="font-size:12px;padding:3px 10px" onclick="window.revokeAccessRequest('${htmlEscape(req.requestId)}')">Revocar</button>`
          : `<span class="muted" style="font-size:12px">${req.decisionReason ? htmlEscape(req.decisionReason) : '-'}</span>`;
        const purposeFull = String(req.purpose || '-');
        const messageFull = String(req.message || '');
        const purposeShort = purposeFull.length > 80 ? purposeFull.slice(0, 80) + '\u2026' : purposeFull;
        const needsExpand = purposeFull.length > 80 || messageFull.length > 0;
        const purposeCell = needsExpand
          ? `<details style="max-width:220px"><summary style="cursor:pointer;word-break:break-word;list-style:none" title="${htmlEscape(purposeFull)}">${htmlEscape(purposeShort)}</summary><div style="white-space:pre-wrap;word-break:break-word;padding-top:4px;font-size:12px">${htmlEscape(purposeFull)}${messageFull ? `<hr style="margin:6px 0;border:none;border-top:1px solid #e0e0e0"><span class="muted" style="font-size:11px">Mensaje:</span> ${htmlEscape(messageFull)}` : ''}</div></details>`
          : htmlEscape(purposeFull);
        return `<tr>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${htmlEscape(req.assetId || '')}">${htmlEscape(req.assetTitle || req.assetId || '-')}</td>
          <td>${htmlEscape(req.requesterName || '-')}<br><span class="muted" style="font-size:11px">${htmlEscape(req.requesterEmail || '')}</span>${gaiaxBtn ? '<br>' + gaiaxBtn : ''}</td>
          <td>${htmlEscape(req.requesterOrg || '-')}</td>
          <td style="max-width:220px">${purposeCell}</td>
          <td style="white-space:nowrap">${date}</td>
          <td><span style="${statusStyle}">${statusLabel}</span></td>
          <td style="white-space:nowrap">${actions}</td>
        </tr>`;
      }).join('');
    }

    async function approveAccessRequest(requestId) {
      if (!requestId) return;
      const reason = window.prompt('Motivo de aprobación (opcional):') ?? '';
      const response = await callLocalAssetsApi('POST', `/access-requests/${encodeURIComponent(requestId)}/approve`, {
        body: JSON.stringify({ decisionReason: reason }),
        headers: { 'content-type': 'application/json' },
      });
      writeOut(response);
      showAccessRequestDecisionEmailResult('Solicitud aprobada', response);
      await loadAccessRequestsPanel();
      refreshSolicitudesBadge();
    }

    async function rejectAccessRequest(requestId) {
      if (!requestId) return;
      const reason = window.prompt('Motivo de rechazo (opcional):') ?? '';
      const response = await callLocalAssetsApi('POST', `/access-requests/${encodeURIComponent(requestId)}/reject`, {
        body: JSON.stringify({ decisionReason: reason }),
        headers: { 'content-type': 'application/json' },
      });
      writeOut(response);
      showAccessRequestDecisionEmailResult('Solicitud rechazada', response);
      await loadAccessRequestsPanel();
      refreshSolicitudesBadge();
    }

    function describeAccessRequestEmailNotification(notification = {}) {
      if (notification?.sent) {
        return `Correo enviado a ${notification.to || '-'}.`;
      }
      const reason = String(notification?.reason || '').trim();
      if (reason === 'smtp-not-configured') return 'Correo no enviado: SMTP no está configurado en local-assets.';
      if (reason === 'requester-email-missing') return 'Correo no enviado: la solicitud no tiene email del solicitante.';
      if (reason === 'owner-email-missing') return 'Correo no enviado: la solicitud no tiene email del propietario.';
      if (reason === 'send-failed') return `Correo no enviado: ${notification.error || 'falló el servidor SMTP.'}`;
      return 'Correo no enviado: sin detalle de notificación SMTP.';
    }

    function showAccessRequestDecisionEmailResult(title, response = {}) {
      const data = response?.data || {};
      const notification = data?.emailNotification || {};
      const ok = response.status >= 200 && response.status < 300;
      if (!ok) {
        showInfoPopup(title, response);
        return;
      }
      showInfoPopup(notification?.sent ? title : `${title}: correo no enviado`, {
        status: response.status,
        requestId: data.requestId || data.item?.requestId || '',
        decisionStatus: data.status || data.item?.status || '',
        emailNotification: notification,
        message: describeAccessRequestEmailNotification(notification),
      });
    }

    async function withdrawAccessRequest(requestId) {
      if (!requestId) return;
      const reason = window.prompt('Motivo de retirada (opcional):') ?? '';
      const response = await callLocalAssetsApi('POST', `/access-requests/${encodeURIComponent(requestId)}/withdraw`, {
        body: JSON.stringify({ decisionReason: reason }),
        headers: { 'content-type': 'application/json' },
      });
      writeOut(response);
      await loadAccessRequestsPanel();
      refreshSolicitudesBadge();
    }

    async function revokeAccessRequest(requestId) {
      if (!requestId) return;
      const reason = window.prompt('Motivo de revocación (opcional):') ?? '';
      const response = await callLocalAssetsApi('POST', `/access-requests/${encodeURIComponent(requestId)}/revoke`, {
        body: JSON.stringify({ decisionReason: reason }),
        headers: { 'content-type': 'application/json' },
      });
      writeOut(response);
      await loadAccessRequestsPanel();
      refreshSolicitudesBadge();
    }

    async function refreshSolicitudesBadge() {
      const badge = document.getElementById('solicitudesBadge');
      if (!badge) return;
      try {
        const response = await callLocalAssetsApi('GET', '/access-requests?status=pending');
        const count = (response.data?.items || []).length;
        badge.textContent = count > 0 ? String(count) : '';
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
      } catch {
        badge.style.display = 'none';
      }
    }

