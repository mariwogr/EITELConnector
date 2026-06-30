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
      <strong>${escapeHtml(connector.name)}</strong>
      <span class="meta">${escapeHtml(connector.organization || connector.id)}</span>
      <br>
      <span class="pill ${connector.online ? 'online' : 'offline'}">${connector.online ? 'Online' : 'Offline'}</span>
      <p class="meta">${Number(connector.assetCount || 0)} assets visible</p>
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

function renderAssets() {
  const assets = (catalog?.assets || []).filter(assetMatches);
  if (!assets.length) {
    els.assets.innerHTML = '<div class="empty">No metadata records match the current filters.</div>';
    return;
  }
  els.assets.innerHTML = assets.map((asset) => {
    const title = asset.assetName || asset.assetId || 'Untitled asset';
    const tags = (asset.keywords || []).slice(0, 8).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
    const image = asset.imageUrl ? `<img src="${escapeHtml(asset.imageUrl)}" alt="">` : '';
    return `
      <article class="asset">
        ${image}
        <div class="asset-body">
          <h2>${escapeHtml(title)}</h2>
          <div class="meta">${escapeHtml(asset.providerName)} · ${escapeHtml(asset.visibility || 'unknown')}</div>
          <p class="desc">${escapeHtml(asset.description || 'No description provided.')}</p>
          <div class="tags">${tags}</div>
          <div class="actions">
            ${asset.accessFormUrl ? `<a class="primary" href="${escapeHtml(asset.accessFormUrl)}" target="_blank" rel="noopener">Request access</a>` : ''}
            ${asset.connectorUrl ? `<a href="${escapeHtml(asset.connectorUrl)}" target="_blank" rel="noopener">Open connector</a>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');
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
