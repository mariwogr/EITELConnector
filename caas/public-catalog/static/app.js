let catalog = null;

const els = {
  title: document.getElementById('catalog-title'),
  subtitle: document.getElementById('catalog-subtitle'),
  lastCheck: document.getElementById('last-check'),
  joinEitel: document.getElementById('join-eitel'),
  connectors: document.getElementById('connectors'),
  connectorCount: document.getElementById('connector-count'),
  assets: document.getElementById('assets'),
  search: document.getElementById('search'),
  connectorFilter: document.getElementById('connector-filter'),
  visibility: document.getElementById('visibility'),
  clearFilters: document.getElementById('clear-filters'),
  resultCount: document.getElementById('result-count'),
  activeFilterLabel: document.getElementById('active-filter-label'),
  metricAssets: document.getElementById('metric-assets'),
  metricPublic: document.getElementById('metric-public'),
  metricPrivate: document.getElementById('metric-private'),
  metricConnectors: document.getElementById('metric-connectors'),
  modal: document.getElementById('asset-modal'),
  modalEyebrow: document.getElementById('asset-modal-eyebrow'),
  modalTitle: document.getElementById('asset-modal-title'),
  modalBody: document.getElementById('asset-modal-body'),
  modalClose: document.getElementById('asset-modal-close'),
};

let visibleAssets = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function normalize(value) {
  return String(value ?? '').toLowerCase();
}

function prettyConnectorLabel(value) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (lower.includes('fuenlabrada') || lower.includes('fuenla')) return 'Fuenlabrada';
  if (lower.includes('uc3m')) return 'UC3M';
  return text || 'Conector';
}

function visibilityState(asset) {
  const visibility = normalize(asset.visibility);
  if (visibility.includes('private') || visibility.includes('restricted') || visibility.includes('limit')) return 'private';
  if (visibility.includes('pending')) return 'private';
  if (visibility.includes('approved') || visibility.includes('available')) return 'available';
  return 'public';
}

function stateLabel(state) {
  return {
    public: 'Público',
    available: 'Disponible',
    private: 'Restringido',
  }[state] || 'Público';
}

function stateDescription(state) {
  return {
    public: 'Activos visibles publicados por los conectores proveedores.',
    available: 'Activos indicados como disponibles por su proveedor.',
    private: 'Activos restringidos. Solicita acceso mediante el formulario de EITEL.',
  }[state] || '';
}

function assetInitials(asset) {
  const source = asset.assetName || asset.assetId || asset.providerName || 'EITEL';
  return String(source)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'DS';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function publishedBy(asset) {
  return asset.publisherName
    || asset.publisherEmail
    || asset.createdBy
    || asset.ownerName
    || asset.ownerEmail
    || asset.providerOrganization
    || '';
}

function detailRows(asset) {
  return [
    ['Nombre', asset.assetName || asset.assetId, true],
    ['Descripción', asset.description, true],
    ['Conector proveedor', asset.providerName || prettyConnectorLabel(asset.providerId)],
    ['Organización', asset.providerOrganization],
    ['Visibilidad', stateLabel(visibilityState(asset))],
    ['Publicado por', publishedBy(asset)],
    ['Contacto responsable', asset.ownerName || asset.ownerEmail],
    ['Identificador del activo', asset.assetId],
    ['Contrato', asset.contractDefId],
    ['Política', asset.policyId],
    ['Actualizado', formatDate(asset.updatedAt)],
  ].filter(([, value]) => value);
}

function openSharedModal({ eyebrow, title, body, mode = 'details' }) {
  els.modalEyebrow.textContent = eyebrow;
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = body;
  els.modal.dataset.mode = mode;
  els.modal.hidden = false;
  els.modal.classList.add('open');
  els.modal.setAttribute('aria-hidden', 'false');
  els.modalClose.focus();
}

function openAssetModal(index) {
  const asset = visibleAssets[Number(index)];
  if (!asset) return;
  const title = asset.assetName || asset.assetId || 'Activo';
  const tags = (asset.keywords || [])
    .filter(Boolean)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
  const connector = asset.providerName || prettyConnectorLabel(asset.providerId);
  const body = `
    <div class="asset-detail-hero">
      <span class="asset-detail-mark">${escapeHtml(assetInitials(asset))}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(connector)} · ${escapeHtml(stateLabel(visibilityState(asset)))}</span>
      </div>
    </div>
    <dl class="detail-grid">
      ${detailRows(asset).map(([label, value, wide]) => `
        <div class="detail-item${wide ? ' wide' : ''}">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `).join('')}
    </dl>
    ${tags ? `<div class="detail-keywords"><strong>Palabras clave</strong><div class="tags">${tags}</div></div>` : ''}
  `;
  openSharedModal({ eyebrow: 'Detalle del activo', title, body, mode: 'details' });
}

function credentialSubject(vpData) {
  const vcs = Array.isArray(vpData?.verifiableCredential) ? vpData.verifiableCredential : [];
  const participantVc = vcs.find((vc) => {
    const subject = vc?.credentialSubject;
    return subject && (subject.type === 'gx:LegalParticipant' || subject['gx:legalName'] || subject.legalName);
  });
  return participantVc?.credentialSubject || {};
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function credentialSummaryRows(subject, connectorLabel) {
  const legalName = subject['gx:legalName'] || subject.legalName || subject.name || subject.id || connectorLabel;
  const did = subject.id || subject['@id'] || '';
  const connectorIds = asList(subject['conector:id']);
  return [
    ['Participante', legalName, true],
    ['Identificador', did, true],
    ['Conector declarado', connectorIds.join(', '), true],
    ['Tipo', subject.type],
  ].filter(([, value]) => value);
}

async function openCredentialModal(connectorId, connectorLabel) {
  const title = `Credencial Gaia-X · ${connectorLabel}`;
  openSharedModal({
    eyebrow: 'Identidad del conector',
    title,
    mode: 'credential',
    body: '<div class="credential-loading">Obteniendo credencial Gaia-X…</div>',
  });
  try {
    const response = await fetch(`api/credential/${encodeURIComponent(connectorId)}`, { headers: { Accept: 'application/json' } });
    const vpData = await response.json();
    if (!response.ok) throw new Error(vpData?.error || `HTTP ${response.status}`);
    const subject = credentialSubject(vpData);
    const rows = credentialSummaryRows(subject, connectorLabel);
    const rawJson = JSON.stringify(vpData, null, 2);
    els.modalBody.innerHTML = `
      <div class="credential-panel">
        <div class="credential-seal">GX</div>
        <div>
          <strong>${escapeHtml(rows[0]?.[1] || connectorLabel)}</strong>
          <span>Verifiable Presentation publicada por el participante</span>
        </div>
      </div>
      <dl class="detail-grid credential-grid">
        ${rows.map(([label, value, wide]) => `
          <div class="detail-item${wide ? ' wide' : ''}">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join('')}
      </dl>
      <details class="credential-json">
        <summary>Ver JSON completo de la credencial</summary>
        <pre>${escapeHtml(rawJson)}</pre>
      </details>
    `;
  } catch (err) {
    els.modalBody.innerHTML = `<div class="modal-error">No se pudo cargar la credencial: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function closeAssetModal() {
  els.modal.classList.remove('open');
  els.modal.setAttribute('aria-hidden', 'true');
  els.modal.hidden = true;
  els.modal.dataset.mode = '';
}

function sortedAssets() {
  return [...(catalog?.assets || [])].sort((a, b) => {
    const pa = prettyConnectorLabel(a.providerId || a.providerName);
    const pb = prettyConnectorLabel(b.providerId || b.providerName);
    return `${pa} ${a.assetName || a.assetId}`.localeCompare(`${pb} ${b.assetName || b.assetId}`);
  });
}

async function loadCatalog() {
  els.lastCheck.textContent = 'Comprobando conectores...';
  try {
    const response = await fetch('api/catalog?refresh=true', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`No se pudo cargar el catálogo: ${response.status}`);
    catalog = await response.json();
    render();
  } catch (err) {
    els.lastCheck.textContent = err.message;
  }
}

function renderMetrics() {
  const assets = catalog?.assets || [];
  const connectors = catalog?.connectors || [];
  const publicCount = assets.filter((asset) => visibilityState(asset) === 'public').length;
  const restrictedCount = assets.filter((asset) => visibilityState(asset) === 'private').length;
  const onlineCount = connectors.filter((connector) => connector.online).length;
  els.metricAssets.textContent = String(assets.length);
  els.metricPublic.textContent = String(publicCount);
  els.metricPrivate.textContent = String(restrictedCount);
  els.metricConnectors.textContent = `${onlineCount}/${connectors.length}`;
}

function renderConnectorFilter() {
  const connectors = catalog?.connectors || [];
  const current = els.connectorFilter.value;
  els.connectorFilter.innerHTML = '<option value="">Todos los conectores</option>' + connectors.map((connector) => {
    const id = String(connector.id || '').trim();
    const label = connector.name || prettyConnectorLabel(id);
    return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
  }).join('');
  els.connectorFilter.value = [...els.connectorFilter.options].some((option) => option.value === current) ? current : '';
}

function renderConnectors() {
  const connectors = catalog?.connectors || [];
  els.connectorCount.textContent = `${connectors.length} ${connectors.length === 1 ? 'fuente' : 'fuentes'}`;
  els.connectors.innerHTML = connectors.map((connector) => {
    const id = String(connector.id || '').trim();
    const selected = id && id === els.connectorFilter.value;
    return `
      <article class="connector${selected ? ' selected' : ''}" data-connector-id="${escapeHtml(id)}">
        <div class="connector-top">
          <div>
            <strong>${escapeHtml(connector.name)}</strong>
            <span class="meta">${escapeHtml(connector.organization || id)}</span>
          </div>
          <span class="pill ${connector.online ? 'online' : 'offline'}">${connector.online ? 'En línea' : 'No disponible'}</span>
        </div>
        <p class="connector-count">${Number(connector.assetCount || 0)} activos publicados</p>
        <div class="connector-links">
          ${connector.credentialUrl ? `<button type="button" class="credential-link" data-credential-id="${escapeHtml(id)}" data-credential-label="${escapeHtml(connector.name || prettyConnectorLabel(id))}">Ver credencial Gaia-X</button>` : ''}
        </div>
        ${connector.catalogError ? `<p class="connector-error">${escapeHtml(connector.catalogError)}</p>` : ''}
      </article>
    `;
  }).join('');

  document.querySelectorAll('.connector[data-connector-id]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      if (event.target.closest('button')) return;
      els.connectorFilter.value = card.dataset.connectorId || '';
      renderAssets();
      renderConnectors();
    });
  });

  els.connectors.querySelectorAll('.credential-link[data-credential-id]').forEach((button) => {
    button.addEventListener('click', () => {
      openCredentialModal(button.dataset.credentialId, button.dataset.credentialLabel || prettyConnectorLabel(button.dataset.credentialId));
    });
  });
}

function assetMatches(asset) {
  const query = normalize(els.search.value).trim();
  const visibility = normalize(els.visibility.value).trim();
  const connector = normalize(els.connectorFilter.value).trim();
  const provider = normalize(`${asset.providerId || ''} ${asset.providerName || ''}`);
  const haystack = normalize([
    asset.assetName,
    asset.assetId,
    asset.description,
    asset.providerName,
    asset.providerOrganization,
    asset.ownerName,
    ...(asset.keywords || []),
  ].join(' '));
  const assetVisibility = normalize(asset.visibility);
  return (!query || haystack.includes(query))
    && (!visibility || assetVisibility.includes(visibility) || visibilityState(asset) === visibility)
    && (!connector || provider.includes(connector));
}

function activeFilterText(count) {
  const parts = [];
  if (els.search.value.trim()) parts.push(`búsqueda "${els.search.value.trim()}"`);
  if (els.connectorFilter.value) parts.push(prettyConnectorLabel(els.connectorFilter.value));
  if (els.visibility.value) parts.push(stateLabel(els.visibility.value));
  if (!parts.length) return 'Mostrando todos los activos publicados';
  return `Filtrado por ${parts.join(', ')} (${count} resultados)`;
}

function renderAssetCard(asset, idx, state) {
  const title = asset.assetName || asset.assetId || 'Activo sin título';
  const tags = (asset.keywords || []).slice(0, 7).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const connector = prettyConnectorLabel(asset.providerId || asset.providerName);
  const delayMs = Math.min(idx * 35, 420);
  const owner = publishedBy(asset);
  const updated = formatDate(asset.updatedAt);
  return `
    <article class="asset catalog-state-${escapeHtml(state)}" style="--delay:${delayMs}ms">
      <div class="asset-card-media">
        <span class="asset-state-badge">${escapeHtml(stateLabel(state))}</span>
        <span class="asset-card-badge">${escapeHtml(connector)}</span>
        <span class="asset-initials">${escapeHtml(assetInitials(asset))}</span>
        <div class="asset-card-media-overlay"><span class="asset-card-media-title">${escapeHtml(title)}</span></div>
      </div>
      <div class="asset-body">
        <div class="asset-card-title">${escapeHtml(title)}</div>
        <p class="asset-card-desc">${escapeHtml(asset.description || 'Sin descripción publicada.')}</p>
        ${tags ? `<div class="tags">${tags}</div>` : '<div class="asset-card-meta">Sin palabras clave publicadas</div>'}
        <dl class="asset-facts">
          ${owner ? `<div><dt>Publicado por</dt><dd>${escapeHtml(owner)}</dd></div>` : ''}
          ${updated ? `<div><dt>Actualizado</dt><dd>${escapeHtml(updated)}</dd></div>` : ''}
          ${asset.contractDefId ? `<div><dt>Contrato</dt><dd>${escapeHtml(asset.contractDefId)}</dd></div>` : ''}
        </dl>
        <div class="actions">
          <button type="button" class="details-button" data-asset-index="${idx}">Ver detalles</button>
          ${asset.accessFormUrl ? `<a class="primary" href="${escapeHtml(asset.accessFormUrl)}" target="_blank" rel="noopener">Solicitar acceso</a>` : ''}
          ${asset.credentialUrl ? `<button type="button" class="credential-link" data-credential-id="${escapeHtml(asset.providerId || asset.providerName || '')}" data-credential-label="${escapeHtml(connector)}">Ver credencial</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderAssets() {
  const assets = sortedAssets().filter(assetMatches);
  visibleAssets = assets;
  els.resultCount.textContent = `${assets.length} ${assets.length === 1 ? 'activo' : 'activos'}`;
  els.activeFilterLabel.textContent = activeFilterText(assets.length);
  if (!assets.length) {
    els.assets.innerHTML = '<div class="empty"><strong>No se encontraron activos</strong><span>Prueba a limpiar filtros o seleccionar otro conector.</span></div>';
    return;
  }

  const groups = [
    { key: 'public', title: 'Públicos', rows: [] },
    { key: 'available', title: 'Disponibles', rows: [] },
    { key: 'private', title: 'Restringidos', rows: [] },
  ];
  const groupMap = new Map(groups.map((group) => [group.key, group]));
  assets.forEach((asset, idx) => {
    const state = visibilityState(asset);
    (groupMap.get(state) || groupMap.get('public')).rows.push({ asset, idx });
  });

  els.assets.innerHTML = groups
    .filter((group) => group.rows.length)
    .map((group) => `
      <section class="catalog-group catalog-group-${escapeHtml(group.key)}">
        <div class="catalog-group-head">
          <div>
            <h2>${escapeHtml(group.title)}</h2>
            <p class="group-desc">${escapeHtml(stateDescription(group.key))}</p>
          </div>
          <span class="group-count">${group.rows.length}</span>
        </div>
        <div class="asset-card-grid">
          ${group.rows.map((row) => renderAssetCard(row.asset, row.idx, group.key)).join('')}
        </div>
      </section>
    `).join('');

  els.assets.querySelectorAll('.details-button[data-asset-index]').forEach((button) => {
    button.addEventListener('click', () => openAssetModal(button.dataset.assetIndex));
  });
  els.assets.querySelectorAll('.credential-link[data-credential-id]').forEach((button) => {
    button.addEventListener('click', () => {
      openCredentialModal(button.dataset.credentialId, button.dataset.credentialLabel || prettyConnectorLabel(button.dataset.credentialId));
    });
  });
}

function render() {
  els.title.textContent = catalog?.title || 'Catálogo de datos EITEL';
  els.subtitle.textContent = catalog?.subtitle || 'Activos publicados por los conectores EITEL.';
  els.lastCheck.textContent = catalog?.generatedAt ? `Actualizado ${new Date(catalog.generatedAt).toLocaleString()}` : '';
  if (catalog?.defaultAccessFormUrl) els.joinEitel.href = catalog.defaultAccessFormUrl;
  renderMetrics();
  renderConnectorFilter();
  renderConnectors();
  renderAssets();
}

els.search.addEventListener('input', renderAssets);
els.visibility.addEventListener('change', renderAssets);
els.connectorFilter.addEventListener('change', () => {
  renderAssets();
  renderConnectors();
});
els.clearFilters.addEventListener('click', () => {
  els.search.value = '';
  els.visibility.value = '';
  els.connectorFilter.value = '';
  renderAssets();
  renderConnectors();
});
els.modalClose.addEventListener('click', closeAssetModal);
els.modal.addEventListener('click', (event) => {
  if (event.target === els.modal) closeAssetModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.modal.classList.contains('open')) closeAssetModal();
});

loadCatalog();
