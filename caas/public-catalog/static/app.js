let catalog = null;

const els = {
  title: document.getElementById('catalog-title'),
  subtitle: document.getElementById('catalog-subtitle'),
  lastCheck: document.getElementById('last-check'),
  refresh: document.getElementById('refresh'),
  connectors: document.getElementById('connectors'),
  assets: document.getElementById('assets'),
  search: document.getElementById('search'),
  visibility: document.getElementById('visibility'),
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
  if (lower.includes('fuenlabrada') || lower.includes('fuenla')) return 'FUENLABRADA';
  if (lower.includes('uc3m')) return 'UC3M';
  return text || 'CONNECTOR';
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
    private: 'Private',
  }[state] || 'Public';
}

function stateDescription(state) {
  return {
    public: 'Assets visible through the connector metadata endpoint.',
    available: 'Assets reported as available by the provider metadata endpoint.',
    pending: 'Assets with a pending access state in the provider metadata.',
    private: 'Restricted assets. Request access through the EITEL form or the source connector.',
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

async function loadCatalog() {
  els.lastCheck.textContent = 'Checking connectors...';
  const response = await fetch('api/catalog?refresh=true', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
  catalog = await response.json();
  render();
}

function renderConnectors() {
  const connectors = catalog?.connectors || [];
  els.connectors.innerHTML = connectors.map((connector) => `
    <article class="connector">
      <div>
        <strong>${escapeHtml(connector.name)}</strong>
        <span class="meta">${escapeHtml(connector.organization || connector.id)}</span>
      </div>
      <span class="pill ${connector.online ? 'online' : 'offline'}">${connector.online ? 'Online' : 'Offline'}</span>
      <p class="meta">${Number(connector.assetCount || 0)} assets from local-assets metadata</p>
      ${connector.catalogError ? `<p class="connector-error">${escapeHtml(connector.catalogError)}</p>` : ''}
    </article>
  `).join('');
}

function assetMatches(asset) {
  const query = normalize(els.search.value).trim();
  const visibility = normalize(els.visibility.value).trim();
  const haystack = normalize([
    asset.assetName,
    asset.description,
    asset.providerName,
    asset.providerOrganization,
    ...(asset.keywords || []),
  ].join(' '));
  const assetVisibility = normalize(asset.visibility);
  return (!query || haystack.includes(query)) && (!visibility || assetVisibility.includes(visibility));
}

function renderAssetCard(asset, idx, state) {
  const title = asset.assetName || asset.assetId || 'Untitled asset';
  const tags = (asset.keywords || []).slice(0, 8).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const connector = prettyConnectorLabel(asset.providerId || asset.providerName);
  const delayMs = Math.min(idx * 45, 450);
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
        <details open>
          <summary>Details</summary>
          <div class="asset-card-desc">${escapeHtml(asset.description || 'No description provided.')}</div>
          ${tags ? `<div class="tags">${tags}</div>` : '<div class="asset-card-meta">No keywords</div>'}
          <div class="asset-card-meta">Source: provider local-assets metadata</div>
        </details>
        <div class="actions">
          ${asset.accessFormUrl ? `<a class="primary" href="${escapeHtml(asset.accessFormUrl)}" target="_blank" rel="noopener">Request access</a>` : ''}
          ${asset.connectorUrl ? `<a href="${escapeHtml(asset.connectorUrl)}" target="_blank" rel="noopener">Open connector</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderAssets() {
  const assets = (catalog?.assets || []).filter(assetMatches);
  if (!assets.length) {
    els.assets.innerHTML = '<div class="empty">No metadata records match the current filters.</div>';
    return;
  }

  const groups = [
    { key: 'public', title: 'Public', rows: [] },
    { key: 'available', title: 'Available', rows: [] },
    { key: 'pending', title: 'Pending', rows: [] },
    { key: 'private', title: 'Private', rows: [] },
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
          <h2>${escapeHtml(group.title)}</h2>
          <span class="meta">${group.rows.length} assets</span>
        </div>
        <p class="meta group-desc">${escapeHtml(stateDescription(group.key))}</p>
        <div class="asset-card-grid">
          ${group.rows.map((asset, idx) => renderAssetCard(asset, idx, group.key)).join('')}
        </div>
      </section>
    `).join('');
}

function render() {
  els.title.textContent = catalog?.title || 'EITEL Public Catalog';
  els.subtitle.textContent = catalog?.subtitle || 'Metadata-only connector catalog.';
  els.lastCheck.textContent = catalog?.generatedAt ? `Last checked ${new Date(catalog.generatedAt).toLocaleString()}` : '';
  renderConnectors();
  renderAssets();
}

els.refresh.addEventListener('click', () => loadCatalog().catch((err) => {
  els.lastCheck.textContent = err.message;
}));
els.search.addEventListener('input', renderAssets);
els.visibility.addEventListener('change', renderAssets);

loadCatalog().catch((err) => {
  els.lastCheck.textContent = err.message;
});
