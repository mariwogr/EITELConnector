let catalog = null;

const els = {
  title: document.getElementById('catalog-title'),
  subtitle: document.getElementById('catalog-subtitle'),
  lastCheck: document.getElementById('last-check'),
  refresh: document.getElementById('refresh'),
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
};

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
  return text || 'Connector';
}

function visibilityState(asset) {
  const visibility = normalize(asset.visibility);
  if (visibility.includes('private') || visibility.includes('restricted') || visibility.includes('limit')) return 'private';
  if (visibility.includes('pending')) return 'pending';
  if (visibility.includes('approved') || visibility.includes('available')) return 'available';
  return 'public';
}

function stateLabel(state) {
  return {
    public: 'Public',
    available: 'Available',
    pending: 'Pending',
    private: 'Restricted',
  }[state] || 'Public';
}

function stateDescription(state) {
  return {
    public: 'Openly visible assets published by provider connectors.',
    available: 'Assets currently reported as available by their provider.',
    pending: 'Assets with a pending access status.',
    private: 'Restricted assets. Use the access form or contact the provider connector.',
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

function sortedAssets() {
  return [...(catalog?.assets || [])].sort((a, b) => {
    const pa = prettyConnectorLabel(a.providerId || a.providerName);
    const pb = prettyConnectorLabel(b.providerId || b.providerName);
    return `${pa} ${a.assetName || a.assetId}`.localeCompare(`${pb} ${b.assetName || b.assetId}`);
  });
}

async function loadCatalog() {
  els.lastCheck.textContent = 'Checking connectors...';
  els.refresh.disabled = true;
  try {
    const response = await fetch('api/catalog?refresh=true', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    catalog = await response.json();
    render();
  } finally {
    els.refresh.disabled = false;
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
  els.connectorFilter.innerHTML = '<option value="">All connectors</option>' + connectors.map((connector) => {
    const id = String(connector.id || '').trim();
    const label = connector.name || prettyConnectorLabel(id);
    return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
  }).join('');
  els.connectorFilter.value = [...els.connectorFilter.options].some((option) => option.value === current) ? current : '';
}

function renderConnectors() {
  const connectors = catalog?.connectors || [];
  els.connectorCount.textContent = `${connectors.length} sources`;
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
          <span class="pill ${connector.online ? 'online' : 'offline'}">${connector.online ? 'Online' : 'Offline'}</span>
        </div>
        <p class="connector-count">${Number(connector.assetCount || 0)} published assets</p>
        <div class="connector-links">
          ${connector.connectorUrl ? `<a href="${escapeHtml(connector.connectorUrl)}" target="_blank" rel="noopener">Open connector</a>` : ''}
          ${connector.credentialUrl ? `<a href="${escapeHtml(connector.credentialUrl)}" target="_blank" rel="noopener">Gaia-X credential</a>` : ''}
        </div>
        ${connector.catalogError ? `<p class="connector-error">${escapeHtml(connector.catalogError)}</p>` : ''}
      </article>
    `;
  }).join('');

  document.querySelectorAll('.connector[data-connector-id]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      els.connectorFilter.value = card.dataset.connectorId || '';
      renderAssets();
      renderConnectors();
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
  if (els.search.value.trim()) parts.push(`search "${els.search.value.trim()}"`);
  if (els.connectorFilter.value) parts.push(prettyConnectorLabel(els.connectorFilter.value));
  if (els.visibility.value) parts.push(stateLabel(els.visibility.value));
  if (!parts.length) return 'Showing all published assets';
  return `Filtered by ${parts.join(', ')} (${count} results)`;
}

function renderAssetCard(asset, idx, state) {
  const title = asset.assetName || asset.assetId || 'Untitled asset';
  const tags = (asset.keywords || []).slice(0, 7).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const connector = prettyConnectorLabel(asset.providerId || asset.providerName);
  const delayMs = Math.min(idx * 35, 420);
  const owner = asset.ownerName || asset.ownerEmail || asset.providerOrganization || '';
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
        <div class="asset-card-meta">${escapeHtml(asset.providerName)} &middot; ${escapeHtml(asset.visibility || 'unknown')}</div>
        <p class="asset-card-desc">${escapeHtml(asset.description || 'No description provided.')}</p>
        ${tags ? `<div class="tags">${tags}</div>` : '<div class="asset-card-meta">No keywords published</div>'}
        <dl class="asset-facts">
          ${owner ? `<div><dt>Owner</dt><dd>${escapeHtml(owner)}</dd></div>` : ''}
          ${updated ? `<div><dt>Updated</dt><dd>${escapeHtml(updated)}</dd></div>` : ''}
          ${asset.contractDefId ? `<div><dt>Contract</dt><dd>${escapeHtml(asset.contractDefId)}</dd></div>` : ''}
        </dl>
        <div class="actions">
          ${asset.accessFormUrl ? `<a class="primary" href="${escapeHtml(asset.accessFormUrl)}" target="_blank" rel="noopener">Request access</a>` : ''}
          ${asset.connectorUrl ? `<a href="${escapeHtml(asset.connectorUrl)}" target="_blank" rel="noopener">Open connector</a>` : ''}
          ${asset.credentialUrl ? `<a href="${escapeHtml(asset.credentialUrl)}" target="_blank" rel="noopener">Credential</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderAssets() {
  const assets = sortedAssets().filter(assetMatches);
  els.resultCount.textContent = `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}`;
  els.activeFilterLabel.textContent = activeFilterText(assets.length);
  if (!assets.length) {
    els.assets.innerHTML = '<div class="empty"><strong>No assets found</strong><span>Try clearing filters or selecting another connector.</span></div>';
    return;
  }

  const groups = [
    { key: 'public', title: 'Public', rows: [] },
    { key: 'available', title: 'Available', rows: [] },
    { key: 'pending', title: 'Pending', rows: [] },
    { key: 'private', title: 'Restricted', rows: [] },
  ];
  const groupMap = new Map(groups.map((group) => [group.key, group]));
  assets.forEach((asset) => {
    const state = visibilityState(asset);
    (groupMap.get(state) || groupMap.get('public')).rows.push(asset);
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
          ${group.rows.map((asset, idx) => renderAssetCard(asset, idx, group.key)).join('')}
        </div>
      </section>
    `).join('');
}

function render() {
  els.title.textContent = catalog?.title || 'EITEL Data Catalog';
  els.subtitle.textContent = catalog?.subtitle || 'Published assets from EITEL connectors.';
  els.lastCheck.textContent = catalog?.generatedAt ? `Updated ${new Date(catalog.generatedAt).toLocaleString()}` : '';
  renderMetrics();
  renderConnectorFilter();
  renderConnectors();
  renderAssets();
}

els.refresh.addEventListener('click', () => loadCatalog().catch((err) => {
  els.lastCheck.textContent = err.message;
}));
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

loadCatalog().catch((err) => {
  els.lastCheck.textContent = err.message;
});
