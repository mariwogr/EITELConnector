// ============================================================
// GAIA-X identity modal
// Lines 7670-7756 of the original 02-operations.js
// ============================================================

    function getGaiaXComplianceUrl(connectorId) {
      const id = String(connectorId || '').toLowerCase();
      if (id.includes('fuenlabrada') || id.includes('fuenla')) {
        return 'https://eiteldata.uc3m.es/.well-known/vp-FUENLAcompliance.json';
      }
      return 'https://eiteldata.uc3m.es/.well-known/vp-UC3Mcompliance.json';
    }

    async function openGaiaXModal(connectorId) {
      const modal = document.getElementById('gaiaxModal');
      const titleEl = document.getElementById('gaiaxModalTitle');
      const didEl = document.getElementById('gaiaxModalDid');
      const bodyEl = document.getElementById('gaiaxModalBody');
      const badgeEl = document.getElementById('gaiaxCompliantBadge');
      if (!modal) return;

      titleEl.textContent = `Certificado GAIA-X \u2014 ${prettyConnectorLabel(connectorId)}`;
      if (didEl) didEl.textContent = 'Cargando\u2026';
      if (bodyEl) bodyEl.innerHTML = '<p class="muted" style="padding:8px 0">Obteniendo credencial\u2026</p>';
      if (badgeEl) { badgeEl.textContent = ''; badgeEl.style.display = 'none'; }
      modal.classList.add('open');

      const credUrl = getGaiaXComplianceUrl(connectorId);
      let vpData = null;
      try {
        // Proxy through the control-plane to avoid CORS (eiteldata.uc3m.es → gis.eiteldata.eu)
        const proxyResp = await callLocalAssetsApi('GET', `/gaiax-credential?connector_id=${encodeURIComponent(connectorId)}`);
        if (proxyResp.status >= 200 && proxyResp.status < 300 && proxyResp.data && typeof proxyResp.data === 'object') {
          vpData = proxyResp.data;
        } else {
          throw new Error(`HTTP ${proxyResp.status}`);
        }
      } catch (err) {
        if (didEl) didEl.textContent = '\u2014';
        if (bodyEl) bodyEl.innerHTML = `<p style="color:var(--danger);padding:8px 0">\u26a0 Error al cargar credencial: ${htmlEscape(String(err))}</p>`;
        return;
      }

      // Extract participant data (first VC with gx:LegalParticipant)
      const vcs = Array.isArray(vpData?.verifiableCredential) ? vpData.verifiableCredential : [];
      const participantVc = vcs.find(vc => {
        const subj = vc?.credentialSubject;
        return subj && (subj.type === 'gx:LegalParticipant' || subj['gx:legalName']);
      });
      const subject = participantVc?.credentialSubject || {};
      const legalName = String(subject['gx:legalName'] || subject.id || '\u2014');
      const connectorIds = Array.isArray(subject['conector:id'])
        ? subject['conector:id']
        : (subject['conector:id'] ? [subject['conector:id']] : []);

      if (didEl) didEl.textContent = legalName;

      // Compare conector:id against the connector's configured DSP URL (base prefix)
      const dspUrl = resolveConfiguredDspUrl(connectorId);
      const isCompliant = connectorIds.length > 0 && dspUrl &&
        connectorIds.some(u => {
          const base = String(u).replace(/\/+$/, '');
          return dspUrl.startsWith(base);
        });

      if (badgeEl) {
        badgeEl.style.display = 'block';
        if (connectorIds.length === 0) {
          badgeEl.className = 'gaiax-verify-warn';
          badgeEl.textContent = '\u26a0 No se encontr\u00f3 conector:id en la credencial';
        } else if (isCompliant) {
          badgeEl.className = 'gaiax-verify-ok';
          badgeEl.textContent = '\u2705 Participante GAIA-X Compliant';
        } else {
          badgeEl.className = 'gaiax-verify-err';
          badgeEl.textContent = '\u2717 NO COMPLIANT';
        }
      }

      // Show full VP JSON scrollable
      if (bodyEl) {
        let html = '<div class="gaiax-section">';
        html += `<div class="gaiax-section-label">Verifiable Presentation <span class="gaiax-url">${htmlEscape(credUrl)}</span></div>`;
        html += `<pre class="gaiax-pre">${htmlEscape(JSON.stringify(vpData, null, 2))}</pre>`;
        html += '</div>';
        bodyEl.innerHTML = html;
      }
    }

    window.openGaiaXModal = openGaiaXModal;


