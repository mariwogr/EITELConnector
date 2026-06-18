(function () {
  function getConfig() {
    return window.EITEL_UI_CONFIG || {};
  }

  function arcgisEnabled() {
    var raw = String(getConfig().arcgisAuthEnabled || '').trim().toLowerCase();
    if (raw) return ['1', 'true', 'yes', 'on'].indexOf(raw) >= 0;
    return String(getConfig().uiVariant || '').trim().toLowerCase() === 'production';
  }

  function portalUrl() {
    var cfg = getConfig();
    return String(cfg.arcgisPortalUrl || 'https://gis.eiteldata.eu/arcgis').replace(/\/+$/, '');
  }

  function redirectUri() {
    var cfg = getConfig();
    return String(cfg.arcgisRedirectUri || window.location.href);
  }

  function startLogin() {
    if (!arcgisEnabled()) return;
    var cfg = getConfig();
    var clientId = String(cfg.arcgisClientId || 'arcgisonline');
    var url = portalUrl() + '/sharing/oauth2/authorize'
      + '?client_id=' + encodeURIComponent(clientId)
      + '&response_type=token'
      + '&expiration=20160'
      + '&redirect_uri=' + encodeURIComponent(redirectUri());
    window.location.assign(url);
  }

  function ensureButton() {
    var gate = document.getElementById('authGate');
    if (!gate) return;
    if (!arcgisEnabled()) {
      gate.classList.remove('open');
      var disabledError = document.getElementById('authError');
      if (disabledError) {
        disabledError.textContent = '';
        disabledError.style.display = 'none';
      }
      return;
    }
    if (!gate.classList.contains('open')) return;

    var error = document.getElementById('authError');
    if (error && /Acceso no disponible|Contacte con el administrador/i.test(error.textContent || '')) {
      error.textContent = 'Inicia sesión con ArcGIS Enterprise para acceder al conector.';
    }

    var existing = document.getElementById('btnArcgisLoginGate') || document.getElementById('btnArcgisLogin');
    if (!existing) {
      var row = gate.querySelector('.auth-card .row') || gate.querySelector('.auth-card');
      existing = document.createElement('button');
      existing.type = 'button';
      existing.className = 'primary';
      existing.id = 'btnArcgisLoginGate';
      existing.textContent = 'Entrar con ArcGIS Enterprise';
      if (row) row.insertBefore(existing, row.firstChild);
    }

    existing.style.setProperty('display', 'inline-flex', 'important');
    existing.disabled = false;
    existing.onclick = startLogin;

    var check = document.getElementById('btnArcgisCheckGate') || document.getElementById('btnArcgisCheck');
    if (check) check.style.setProperty('display', 'inline-flex', 'important');
  }

  window.startArcgisEnterpriseLoginFromGate = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    startLogin();
    return false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureButton);
  } else {
    ensureButton();
  }
  setInterval(ensureButton, 250);
})();
