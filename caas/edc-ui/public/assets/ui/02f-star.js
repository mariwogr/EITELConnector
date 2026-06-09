    const starTrustEnabled = ['1', 'true', 'yes', 'on'].includes(String(cfg.starMode || (String(connectorName || '').toLowerCase().includes('star') ? 'true' : '')).toLowerCase());
    const starTrustConfig = {
      enabled: starTrustEnabled,
      coordinatorName: String(cfg.starCoordinatorName || 'UC3M Coordinador EITEL').trim(),
      coordinatorUrl: String(cfg.starCoordinatorUrl || '').trim(),
      coordinatorStatusUrl: String(cfg.starCoordinatorStatusUrl || '').trim(),
      didMethod: String(cfg.starDidMethod || 'did:key').trim(),
      participantDid: String(cfg.starParticipantDid || '').trim(),
      vcPresent: ['1', 'true', 'yes', 'on'].includes(String(cfg.starVcPresent || '').toLowerCase()),
      vcIssuer: String(cfg.starVcIssuer || 'UC3M').trim(),
    };
    const starTrustState = {
      handshakeState: 'idle',
      handshakeDetail: '',
      transferState: 'idle',
      transferDetail: '',
      lastCounterParty: '',
      lastAssetId: '',
      lastAgreementId: '',
      lastTransferId: '',
      timeline: [],
    };
    const starTrustRemote = {
      loading: false,
      lastLoadedAt: 0,
      snapshot: null,
      participants: {},
      participantErrors: {},
      error: '',
      lastSuccessSignature: '',
    };

    function escapeStarHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getStarSecretMatch(patterns = []) {
      const names = Array.isArray(state?.secretNames) ? state.secretNames : [];
      return names.find((name) => patterns.some((pattern) => pattern.test(String(name || '')))) || '';
    }

    function getRemoteStarCoordinator() {
      return starTrustRemote.snapshot && typeof starTrustRemote.snapshot === 'object'
        ? (starTrustRemote.snapshot.coordinator || null)
        : null;
    }

    function getRemoteStarParticipant() {
      return starTrustRemote.snapshot && typeof starTrustRemote.snapshot === 'object'
        ? (starTrustRemote.snapshot.participant || null)
        : null;
    }

    function getStarParticipantCandidates() {
      const configured = [];
      const current = canonicalConnectorPrefix(connectorName || cfg?.connectorName || '');
      if (current) configured.push(current);

      const configuredList = String(cfg.connectorCatalogList || '').trim();
      if (configuredList) {
        configuredList.split(/[\n,;]+/g)
          .map((value) => canonicalConnectorPrefix(value))
          .filter(Boolean)
          .forEach((value) => configured.push(value));
      }

      Object.keys(getConfiguredConnectorDirectory()).forEach((value) => {
        const normalized = canonicalConnectorPrefix(value);
        if (normalized) configured.push(normalized);
      });

      return [...new Set(configured.map((value) => String(value || '').trim()).filter(Boolean))];
    }

    function buildStarStatusUrl(participantId = '') {
      const base = String(starTrustConfig.coordinatorStatusUrl || '').trim();
      if (!base) return '';

      try {
        const url = new URL(base, window.location.origin);
        if (participantId) url.searchParams.set('participant', participantId);
        else url.searchParams.delete('participant');
        return url.toString();
      } catch {
        const trimmed = base.replace(/[?&]participant=[^&]*/gi, '').replace(/[?&]$/, '');
        if (!participantId) return trimmed;
        const separator = trimmed.includes('?') ? '&' : '?';
        return `${trimmed}${separator}participant=${encodeURIComponent(participantId)}`;
      }
    }

    async function fetchStarStatusSnapshot(participantId = '') {
      const url = buildStarStatusUrl(participantId);
      if (!url) throw new Error('Falta la URL pública del coordinador Star.');

      const response = await fetch(url, {
        headers: { accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(`HTTP ${response.status} al consultar ${url}`);
      }
      return { url, payload };
    }

    function getStarParticipantTone(participant, error = '') {
      if (error) return 'warn';
      const didAvailable = Boolean(participant?.did);
      const vcAvailable = Boolean(participant?.vc?.present);
      if (didAvailable && vcAvailable) return 'ok';
      if (didAvailable || vcAvailable) return 'warn';
      return 'danger';
    }

    function getStarParticipantStatusLabel(participant, error = '') {
      if (error) return 'Sin respuesta';
      const didAvailable = Boolean(participant?.did);
      const vcAvailable = Boolean(participant?.vc?.present);
      if (didAvailable && vcAvailable) return 'Identidad completa';
      if (didAvailable || vcAvailable) return 'Identidad parcial';
      return 'Pendiente';
    }

    function buildFallbackStarParticipant(participantId) {
      const current = canonicalConnectorPrefix(connectorName || cfg?.connectorName || '');
      if (participantId !== current) return null;
      return {
        id: participantId,
        did: starTrustConfig.participantDid || '',
        vc: {
          present: Boolean(starTrustConfig.vcPresent),
          issuer: starTrustConfig.vcIssuer || '',
          id: '',
          status: starTrustConfig.vcPresent ? 'configured' : 'pending',
        },
      };
    }

    function renderStarParticipants() {
      const container = document.getElementById('starParticipantsGrid');
      if (!container) return;

      const participantIds = getStarParticipantCandidates();
      const current = canonicalConnectorPrefix(connectorName || cfg?.connectorName || '');
      if (!participantIds.length) {
        container.innerHTML = '<article class="star-participant-card" data-tone="info"><div class="star-participant-head"><div><div class="star-participant-role">Participante</div><div class="star-participant-name">Sin conectores configurados</div></div><div class="star-participant-status">Pendiente</div></div><dl class="star-participant-list"><dt>Detalle</dt><dd>Define los conectores Star en la configuración para mostrar DID, VC y endpoint DSP de cada uno.</dd></dl></article>';
        return;
      }

      const cards = participantIds.map((participantId) => {
        const participant = starTrustRemote.participants[participantId] || buildFallbackStarParticipant(participantId);
        const error = starTrustRemote.participantErrors[participantId] || '';
        const tone = getStarParticipantTone(participant, error);
        const status = getStarParticipantStatusLabel(participant, error);
        const label = prettyConnectorLabel(participantId);
        const did = participant?.did ? clean(participant.did) : 'pendiente';
        const vcId = participant?.vc?.id ? clean(participant.vc.id) : 'pendiente';
        const issuer = participant?.vc?.issuer ? clean(participant.vc.issuer) : (participant?.vc?.present ? 'configurado' : '-');
        const vcStatus = error
          ? `Error: ${clean(error)}`
          : (participant?.vc?.present
            ? `${clean(participant?.vc?.status || 'disponible')}`
            : 'pendiente');
        const dspUrl = resolveConfiguredDspUrl(participantId) || (participantId === current ? String(cfg?.dspUrl || '').trim() : '');

        return `
          <article class="star-participant-card" data-tone="${escapeStarHtml(tone)}">
            <div class="star-participant-head">
              <div>
                <div class="star-participant-role">${participantId === current ? 'Conector local' : 'Conector remoto'}</div>
                <div class="star-participant-name">${escapeStarHtml(label)}</div>
              </div>
              <div class="star-participant-status">${escapeStarHtml(status)}</div>
            </div>
            <dl class="star-participant-list">
              <dt>ID</dt><dd>${escapeStarHtml(clean(participant?.id || participantId))}</dd>
              <dt>DID</dt><dd>${escapeStarHtml(did)}</dd>
              <dt>VC</dt><dd>${escapeStarHtml(vcId)}</dd>
              <dt>Emisor</dt><dd>${escapeStarHtml(issuer)}</dd>
              <dt>Estado</dt><dd>${escapeStarHtml(vcStatus)}</dd>
              <dt>DSP</dt><dd>${escapeStarHtml(dspUrl || 'sin resolver')}</dd>
            </dl>
          </article>
        `;
      });

      container.innerHTML = cards.join('');
    }

    function getStarCounterpartyLabel() {
      const raw = String(starTrustState.lastCounterParty || '').trim();
      if (!raw) return '-';
      const normalized = canonicalConnectorPrefix(raw);
      const pretty = prettyConnectorLabel(normalized || raw);
      return normalized && pretty !== normalized ? `${pretty} (${clean(normalized)})` : clean(raw);
    }

    function renderStarProcess() {
      const container = document.getElementById('starProcessSteps');
      if (!container) return;

      const remoteCoordinator = getRemoteStarCoordinator();
      const coordinatorName = String(remoteCoordinator?.name || starTrustConfig.coordinatorName || 'UC3M Coordinador EITEL').trim();
      const coordinatorUrl = String(remoteCoordinator?.url || starTrustConfig.coordinatorUrl || '').trim();
      const coordinatorReady = Boolean(coordinatorUrl);
      const didReady = hasStarDid();
      const vcReady = hasStarVc();
      const hasCounterparty = Boolean(String(starTrustState.lastCounterParty || '').trim());

      const handshakePhase = {
        idle: ['warn', 'Pendiente', 'Todavía no se ha elegido una contraparte para negociar.'],
        resolving: ['info', 'Resolviendo', starTrustState.handshakeDetail || 'La UI está resolviendo la identidad y el endpoint de la contraparte.'],
        negotiating: ['info', 'En curso', starTrustState.handshakeDetail || 'La negociación P2P ya se ha enviado al nodo remoto.'],
        agreed: ['ok', 'Completado', starTrustState.handshakeDetail || 'Ya existe un agreement y el plano de datos puede arrancar.'],
        failed: ['danger', 'Fallido', starTrustState.handshakeDetail || 'La negociación no ha podido completarse.'],
      };
      const transferPhase = {
        idle: ['warn', 'Pendiente', 'Aún no hay transferencia directa iniciada.'],
        preparing: ['info', 'Preparando', starTrustState.transferDetail || 'Preparando canal y destino de la transferencia.'],
        running: ['info', 'En curso', starTrustState.transferDetail || 'Los datos están viajando de nodo a nodo.'],
        completed: ['ok', 'Completada', starTrustState.transferDetail || 'La transferencia directa ya terminó.'],
        failed: ['danger', 'Fallida', starTrustState.transferDetail || 'La transferencia no pudo completarse.'],
      };

      const steps = [
        {
          num: 1,
          title: 'Coordinador publica confianza',
          tone: coordinatorReady ? 'ok' : 'warn',
          status: coordinatorReady ? 'Listo' : 'Pendiente',
          detail: coordinatorReady
            ? `${coordinatorName} expone la clave pública y el estado inicial. Después sale del camino de la negociación y de la transferencia.`
            : 'Falta configurar o alcanzar el endpoint del coordinador Star.',
        },
        {
          num: 2,
          title: 'Nodo carga DID y VC',
          tone: didReady && vcReady ? 'ok' : (didReady || vcReady ? 'warn' : 'danger'),
          status: didReady && vcReady ? 'Listo' : (didReady || vcReady ? 'Parcial' : 'Pendiente'),
          detail: didReady && vcReady
            ? 'El participante local ya tiene identidad suficiente para operar en Star.'
            : 'Todavía falta completar parte de la identidad del nodo local.',
        },
        {
          num: 3,
          title: 'Se resuelve la contraparte',
          tone: hasCounterparty ? 'ok' : 'warn',
          status: hasCounterparty ? 'Resuelta' : 'Pendiente',
          detail: hasCounterparty
            ? `La contraparte actual es ${getStarCounterpartyLabel()}. Su DSP y material de confianza se usan para el siguiente paso.`
            : 'Aquí aparecerá el conector remoto seleccionado en catálogo o contrato. Esto es lo que estabas buscando como counter party.',
        },
        {
          num: 4,
          title: 'Handshake P2P',
          tone: (handshakePhase[starTrustState.handshakeState] || handshakePhase.idle)[0],
          status: (handshakePhase[starTrustState.handshakeState] || handshakePhase.idle)[1],
          detail: (handshakePhase[starTrustState.handshakeState] || handshakePhase.idle)[2],
        },
        {
          num: 5,
          title: 'Transferencia directa',
          tone: (transferPhase[starTrustState.transferState] || transferPhase.idle)[0],
          status: (transferPhase[starTrustState.transferState] || transferPhase.idle)[1],
          detail: (transferPhase[starTrustState.transferState] || transferPhase.idle)[2],
        },
      ];

      container.innerHTML = steps.map((step) => `
        <article class="star-process-step" data-tone="${escapeStarHtml(step.tone)}">
          <div class="star-process-step-num">${escapeStarHtml(step.num)}</div>
          <div class="star-process-step-title">${escapeStarHtml(step.title)}</div>
          <div class="star-process-step-status">${escapeStarHtml(step.status)}</div>
          <p class="star-process-step-detail">${escapeStarHtml(step.detail)}</p>
        </article>
      `).join('');
    }

    function renderStarSessionFacts() {
      const container = document.getElementById('starSessionFacts');
      if (!container) return;

      const remoteCoordinator = getRemoteStarCoordinator();
      const coordinatorName = String(remoteCoordinator?.name || starTrustConfig.coordinatorName || 'UC3M Coordinador EITEL').trim();
      const coordinatorUrl = String(remoteCoordinator?.url || starTrustConfig.coordinatorUrl || '').trim();
      const facts = [
        { label: 'Coordinador', value: coordinatorUrl ? `${coordinatorName} · ${coordinatorUrl}` : coordinatorName },
        { label: 'Contraparte', value: getStarCounterpartyLabel() },
        { label: 'Asset', value: clean(starTrustState.lastAssetId || '-') },
        { label: 'Agreement', value: clean(starTrustState.lastAgreementId || '-') },
        { label: 'Transfer ID', value: clean(starTrustState.lastTransferId || '-') },
        { label: 'Rol real del coordinador', value: 'Solo publica confianza inicial, clave pública y estado. No mueve el dato ni media en tiempo real en el handshake P2P.' },
      ];

      container.innerHTML = facts.map((fact) => `
        <article class="star-session-card">
          <div class="star-session-label">${escapeStarHtml(fact.label)}</div>
          <div class="star-session-value">${escapeStarHtml(fact.value)}</div>
        </article>
      `).join('');
    }

    function getStarDidLabel() {
      const remoteParticipant = getRemoteStarParticipant();
      const didSecret = getStarSecretMatch([/participant.*did/i, /^did$/i, /star.*did/i]);
      if (remoteParticipant?.did) return String(remoteParticipant.did).trim();
      if (starTrustConfig.participantDid) return starTrustConfig.participantDid;
      if (didSecret) return `vault:${didSecret}`;
      return `${starTrustConfig.didMethod || 'did:key'} pendiente`;
    }

    function hasStarDid() {
      const remoteParticipant = getRemoteStarParticipant();
      return Boolean(remoteParticipant?.did || starTrustConfig.participantDid || getStarSecretMatch([/participant.*did/i, /^did$/i, /star.*did/i]));
    }

    function hasStarVc() {
      const remoteParticipant = getRemoteStarParticipant();
      return Boolean(
        remoteParticipant?.vc?.present ||
        starTrustConfig.vcPresent ||
        getStarSecretMatch([/verifiable.*credential/i, /participant.*vc/i, /^vc$/i, /star.*vc/i, /credential/i])
      );
    }

    async function loadStarTrustSnapshot(force = false) {
      if (!starTrustConfig.enabled || !starTrustConfig.coordinatorStatusUrl) return;
      const now = Date.now();
      if (starTrustRemote.loading) return;
      if (!force && starTrustRemote.snapshot && (now - starTrustRemote.lastLoadedAt) < 30000) return;

      starTrustRemote.loading = true;
      try {
        const participantIds = getStarParticipantCandidates();
        const currentParticipantId = canonicalConnectorPrefix(connectorName || cfg?.connectorName || '');
        const targets = participantIds.length ? participantIds : [currentParticipantId || ''];
        const results = await Promise.all(targets.map(async (participantId) => {
          try {
            const snapshot = await fetchStarStatusSnapshot(participantId);
            return { participantId, snapshot, error: '' };
          } catch (error) {
            return {
              participantId,
              snapshot: null,
              error: error?.message ? String(error.message) : 'No se pudo consultar el estado Star.',
            };
          }
        }));

        const participants = {};
        const participantErrors = {};
        let currentPayload = null;
        let firstSuccess = null;

        results.forEach(({ participantId, snapshot, error }) => {
          const normalizedId = canonicalConnectorPrefix(participantId || snapshot?.payload?.participant?.id || '');
          if (snapshot?.payload?.participant && normalizedId) {
            participants[normalizedId] = snapshot.payload.participant;
            if (!firstSuccess) firstSuccess = snapshot.payload;
            if (normalizedId === currentParticipantId) currentPayload = snapshot.payload;
          }
          if (error && normalizedId) participantErrors[normalizedId] = error;
        });

        starTrustRemote.participants = participants;
        starTrustRemote.participantErrors = participantErrors;
        starTrustRemote.snapshot = currentPayload || firstSuccess;
        starTrustRemote.error = '';
        starTrustRemote.lastLoadedAt = Date.now();

        const participantId = clean(starTrustRemote.snapshot?.participant?.id || connectorName || 'participante');
        const didValue = clean(starTrustRemote.snapshot?.participant?.did || 'pendiente');
        const vcState = starTrustRemote.snapshot?.participant?.vc?.present ? 'disponible' : 'pendiente';
        const signature = JSON.stringify([
          starTrustRemote.snapshot?.coordinator?.url || '',
          ...Object.values(participants).map((participant) => [
            participant?.id || '',
            participant?.did || '',
            participant?.vc?.present || false,
            participant?.vc?.status || '',
          ]),
        ]);

        if (force || signature !== starTrustRemote.lastSuccessSignature) {
          starTrustRemote.lastSuccessSignature = signature;
          pushStarTrustEvent('Coordinador Star consultado', `Estado recibido para ${Object.keys(participants).length || 1} conector(es). Nodo activo ${participantId}: DID ${didValue} y VC ${vcState}.`, starTrustRemote.snapshot?.participant?.vc?.present ? 'ok' : 'warn');
          return;
        }
      } catch (error) {
        starTrustRemote.error = error?.message ? String(error.message) : 'No se pudo consultar el coordinador Star.';
        starTrustRemote.lastLoadedAt = Date.now();
        if (force) {
          pushStarTrustEvent('Coordinador Star no disponible', starTrustRemote.error, 'warn');
          return;
        }
      } finally {
        starTrustRemote.loading = false;
        refreshStarTrustPanel();
      }
    }

    function pushStarTrustEvent(title, detail, tone = 'info') {
      if (!starTrustConfig.enabled) return;
      starTrustState.timeline.unshift({
        title: String(title || 'Estado Star').trim(),
        detail: String(detail || '').trim(),
        tone,
        at: Date.now(),
      });
      starTrustState.timeline = starTrustState.timeline.slice(0, 8);
      refreshStarTrustPanel();
    }

    function setStarTrustCard(prefix, tone, status, detail) {
      const card = document.getElementById(`${prefix}Card`);
      const statusNode = document.getElementById(`${prefix}Status`);
      const detailNode = document.getElementById(`${prefix}Detail`);
      if (card) card.setAttribute('data-tone', tone || 'info');
      if (statusNode) statusNode.textContent = status || '';
      if (detailNode) detailNode.textContent = detail || '';
    }

    function refreshArcgisPublishAssist() {
      const wrap = document.getElementById('arcgisPublishAssist');
      const status = document.getElementById('publishArcgisAuthState');
      if (!wrap || !status) return;

      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const shouldShow = Boolean(arcgis?.enabled) && (starTrustConfig.enabled || authType === 'arcgis-login');
      wrap.style.display = shouldShow ? '' : 'none';
      if (!shouldShow) return;

      const token = getArcgisAccessTokenForPublish();
      const expiresAt = getStoredArcgisTokenExpiresAt();
      const remainingMs = expiresAt ? (expiresAt - Date.now()) : 0;
      status.className = 'status-pill';

      if (!token) {
        status.classList.add('warn');
        status.textContent = 'ArcGIS pendiente de login';
        return;
      }
      if (expiresAt && remainingMs <= 0) {
        status.classList.add('danger');
        status.textContent = 'Token ArcGIS expirado';
        return;
      }
      if (expiresAt && remainingMs < 30 * 60 * 1000) {
        status.classList.add('warn');
        status.textContent = `Token ArcGIS activo (${formatRemainingTimeMs(remainingMs)})`;
        return;
      }

      status.classList.add('ok');
      status.textContent = expiresAt ? `Token ArcGIS activo (${formatRemainingTimeMs(remainingMs)})` : 'Sesion ArcGIS activa';
    }

    function refreshStarTrustPanel() {
      const banner = document.getElementById('starTrustBanner');
      const summary = document.getElementById('starTrustSummary');
      const timeline = document.getElementById('starTrustTimeline');
      if (!banner || !summary || !timeline) return;

      banner.style.display = starTrustConfig.enabled ? '' : 'none';
      if (!starTrustConfig.enabled) return;

      loadStarTrustSnapshot(false);

      summary.textContent = 'Proceso Star: 1) el coordinador publica confianza inicial, 2) cada nodo expone DID y VC, 3) se resuelve la contraparte, 4) el handshake ocurre P2P, 5) el dato viaja directo entre nodos.';

      const remoteCoordinator = getRemoteStarCoordinator();
      const remoteParticipant = getRemoteStarParticipant();
      const coordinatorName = String(remoteCoordinator?.name || starTrustConfig.coordinatorName || 'UC3M Coordinador EITEL').trim();
      const coordinatorUrl = String(remoteCoordinator?.url || starTrustConfig.coordinatorUrl || '').trim();
      const coordinatorHasKey = Boolean(remoteCoordinator?.publicKey?.published || remoteCoordinator?.publicKey?.id);
      const coordinatorTone = starTrustRemote.loading ? 'info' : (coordinatorUrl ? (coordinatorHasKey ? 'ok' : 'warn') : 'warn');
      const coordinatorStatus = starTrustRemote.loading
        ? 'Consultando coordinador'
        : (coordinatorUrl ? (coordinatorHasKey ? 'Coordinador verificado' : 'Coordinador configurado') : 'Coordinador sin endpoint');
      const coordinatorDetail = starTrustRemote.error
        ? `${coordinatorName}. ${starTrustRemote.error}`
        : (coordinatorUrl
          ? `${coordinatorName} · ${coordinatorUrl}${coordinatorHasKey ? ` · clave ${clean(remoteCoordinator?.publicKey?.id || 'publicada')}` : ''}`
          : `${coordinatorName}. Falta exponer el endpoint público de clave o metadatos.`);
      setStarTrustCard('starCoordinator', coordinatorTone, coordinatorStatus, coordinatorDetail);

      const didLabel = getStarDidLabel();
      const remoteVc = remoteParticipant?.vc || null;
      const vcAvailable = hasStarVc();
      const didAvailable = hasStarDid();
      const vcTone = vcAvailable && didAvailable ? 'ok' : (vcAvailable || didAvailable ? 'warn' : 'danger');
      const vcStatus = vcAvailable && didAvailable ? 'Identidad preparada' : (vcAvailable || didAvailable ? 'Identidad parcial' : 'VC y DID pendientes');
      const vcSource = remoteVc?.id
        ? `coordinador:${clean(remoteVc.id)}`
        : getStarSecretMatch([/verifiable.*credential/i, /participant.*vc/i, /^vc$/i, /star.*vc/i, /credential/i]);
      const vcIssuer = String(remoteVc?.issuer || starTrustConfig.vcIssuer || 'UC3M').trim();
      const vcDetail = `DID: ${didLabel}. VC: ${vcAvailable ? `disponible${vcSource ? ` en ${vcSource}` : ''}` : `pendiente (${vcIssuer} emite una sola vez)`}.${remoteVc?.status ? ` Estado: ${clean(remoteVc.status)}.` : ''}`;
      setStarTrustCard('starVc', vcTone, vcStatus, vcDetail);
      renderStarProcess();
      renderStarSessionFacts();
      renderStarParticipants();

      const arcgisToken = getArcgisAccessTokenForPublish();
      const arcgisTone = !arcgis?.enabled ? 'info' : (arcgisToken || authState.username ? 'ok' : 'warn');
      const arcgisStatus = !arcgis?.enabled
        ? 'ArcGIS no requerido'
        : (arcgisToken || authState.username ? 'Sesion ArcGIS activa' : 'Login requerido');
      const arcgisDetail = !arcgis?.enabled
        ? 'Este despliegue puede operar sin ArcGIS. El token solo se pide cuando el asset o el destino lo requieren.'
        : ((authState.username || arcgisToken)
          ? `Portal ${arcgis.portalUrl || '-'} · ${authState.username ? `usuario ${authState.username}` : 'token disponible para publicar o subir datos'}`
          : `Portal ${arcgis.portalUrl || '-'} · inicia sesión para publicar assets ArcGIS o subir transferencias al portal.`);
      setStarTrustCard('starArcgis', arcgisTone, arcgisStatus, arcgisDetail);

      const handshakeByState = {
        idle: ['warn', 'Sin negociación', 'Todavía no se ha abierto una negociación de contrato con otro participante.'],
        resolving: ['info', 'Resolviendo identidad', starTrustState.handshakeDetail || 'Resolviendo el participante remoto, su DSP y el material de confianza disponible.'],
        negotiating: ['info', 'Negociando contrato', starTrustState.handshakeDetail || 'El plano de control está creando el acuerdo entre nodos.'],
        agreed: ['ok', 'Handshake preparado', starTrustState.handshakeDetail || 'Existe acuerdo y la relación P2P puede pasar al plano de datos.'],
        failed: ['danger', 'Handshake con incidencia', starTrustState.handshakeDetail || 'La negociación no ha terminado correctamente.'],
      };
      const [handshakeTone, handshakeStatus, handshakeDetail] = handshakeByState[starTrustState.handshakeState] || handshakeByState.idle;
      setStarTrustCard('starHandshake', handshakeTone, handshakeStatus, handshakeDetail);

      const transferByState = {
        idle: ['warn', 'Sin transferencia', 'No hay un intercambio directo activo entre nodos en este momento.'],
        preparing: ['info', 'Preparando canal', starTrustState.transferDetail || 'La UI está preparando la transferencia directa entre participante consumidor y proveedor.'],
        running: ['info', 'Transferencia en curso', starTrustState.transferDetail || 'El dato está viajando directamente por el plano de datos.'],
        completed: ['ok', 'Transferencia completada', starTrustState.transferDetail || 'La transferencia directa ha finalizado correctamente.'],
        failed: ['danger', 'Transferencia con incidencia', starTrustState.transferDetail || 'La transferencia no se ha completado correctamente.'],
      };
      const [transferTone, transferStatus, transferDetail] = transferByState[starTrustState.transferState] || transferByState.idle;
      setStarTrustCard('starTransfer', transferTone, transferStatus, transferDetail);

      if (!starTrustState.timeline.length) {
        timeline.innerHTML = '<div class="star-event" data-tone="info"><div class="star-event-head"><span class="star-event-title">Star listo para PoC</span><span class="star-event-time">ahora</span></div><div class="star-event-detail">La UI está preparada para reflejar coordinador, VC, DID, handshake P2P y transferencia directa. Si hay endpoint configurado, consulta su estado automáticamente.</div></div>';
      } else {
        timeline.innerHTML = starTrustState.timeline.map((event) => `\n          <div class="star-event" data-tone="${escapeStarHtml(event.tone || 'info')}">\n            <div class="star-event-head">\n              <span class="star-event-title">${escapeStarHtml(event.title)}</span>\n              <span class="star-event-time">${escapeStarHtml(new Date(event.at).toLocaleTimeString())}</span>\n            </div>\n            <div class="star-event-detail">${escapeStarHtml(event.detail)}</div>\n          </div>\n        `).join('');
      }

      refreshArcgisPublishAssist();
    }

    window.refreshStarTrustPanel = refreshStarTrustPanel;
  window.refreshStarTrustSnapshot = loadStarTrustSnapshot;

    let lastArcgisPublishToken = '';

    function getArcgisAccessTokenForPublish() {
      try {
        if (typeof getStoredArcgisToken === 'function') {
          const token = (getStoredArcgisToken() || '').trim();
          if (token) {
            lastArcgisPublishToken = token;
            return token;
          }
        }
      } catch {}
      try {
        const token = (sessionStorage.getItem('eitel.arcgis.access_token') || '').trim();
        if (token) {
          lastArcgisPublishToken = token;
          return token;
        }
        return lastArcgisPublishToken;
      } catch {
        return lastArcgisPublishToken;
      }
    }

    /**
     * Fetches ArcGIS access token from existing browser portal session.
     * Attempts to retrieve token from active ArcGIS Portal login.
     * 
     * @async
     * @returns {Promise<string|null>} Access token if found, null otherwise
     * 
     * @example
     * const token = await fetchArcgisAccessTokenFromPortalSession();
     */
    async function fetchArcgisAccessTokenFromPortalSession() {
      if (!arcgis?.portalUrl) return '';
      try {
        // Use window.location.origin (stable base URL, e.g. https://gis.eiteldata.eu) so the token's
        // referer is a prefix that both the browser validation fetch AND the EDC connector request match.
        const stableReferer = window.location.origin;
        const body = new URLSearchParams({
          f: 'json',
          client: 'referer',
          referer: stableReferer,
          expiration: '20160'
        });
        const res = await fetch(`${arcgis.portalUrl}/sharing/rest/generateToken`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: body.toString(),
          credentials: 'include',
        });
        const data = await res.json();
        const token = (data?.token || '').trim();
        const expiresAt = Number(data?.expires || 0);
        if (token) {
          lastArcgisPublishToken = token;
          try { sessionStorage.setItem('eitel.arcgis.access_token', token); } catch {}
          if (Number.isFinite(expiresAt) && expiresAt > 0) setStoredArcgisTokenExpiresAt(expiresAt);
          refreshArcgisTokenIndicator();
        }
        return token;
      } catch {
        return '';
      }
    }

    /**
     * Resolves ArcGIS access token for asset publishing operations.
     * Checks session, portal token storage, and user input fields.
     * Returns cached token or fetches new one from portal.
     * 
     * @async
     * @returns {Promise<string|null>} Valid ArcGIS access token or null if unavailable
     * 
     * @example
     * const token = await resolveArcgisTokenForPublish();
     * if (!token) { ensureArcgisLogin(); }
     */
    async function resolveArcgisTokenForPublish() {
      // Prefer a fresh token from ArcGIS session to avoid stale-token transfers.
      const fresh = await fetchArcgisAccessTokenFromPortalSession();
      if (fresh) return fresh;
      return getArcgisAccessTokenForPublish();
    }

    function resolveAuthTokenForPublish(authType) {
      if (authType === 'arcgis-login') {
        return getArcgisAccessTokenForPublish() || lastArcgisPublishToken;
      }
      return (document.getElementById('pubAuthToken')?.value || '').trim();
    }

    function buildAuthHeaders(baseHeaders = {}) {
      const authType = document.getElementById('pubAuthType')?.value || 'none';
      const authHeader = (document.getElementById('pubAuthHeader')?.value || 'Authorization').trim();
      const authPrefix = (document.getElementById('pubAuthPrefix')?.value || '').trim();
      const authToken = resolveAuthTokenForPublish(authType);
      const authSecret = (document.getElementById('pubAuthSecret')?.value || '').trim();
      const headers = { ...baseHeaders };

      if (authType === 'none') return headers;
      if (authType === 'arcgis-login') {
        if (authToken) {
          headers.token = authToken;
        }
        return headers;
      }

      let authValue = '';
      if (authToken) {
        // token provided directly in the form (useful for OAuth2 or API tokens)
        if (authType === 'apikey') {
          authValue = authToken;
        } else {
          const prefix = authPrefix || 'Bearer ';
          authValue = `${prefix}${authToken}`;
        }
      } else if (authSecret) {
        const secretRef = `{{vault:${authSecret}}}`;
        authValue = authType === 'apikey' ? secretRef : `${authPrefix || 'Bearer '}${secretRef}`;
      }

      if (authValue) headers[authHeader] = authValue;
      return headers;
    }

    function appendQueryParams(path, params) {
      const basePath = String(path || '').trim();
      const [rawPath, rawQuery = ''] = basePath.split('?', 2);
      const qs = new URLSearchParams(rawQuery);
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        if (!qs.has(k)) qs.set(k, String(v));
      });
      const query = qs.toString();
      return query ? `${rawPath}?${query}` : rawPath;
    }

    function buildArcgisPathWithToken(path, token) {
      const withFormat = setQueryParams(path, { f: 'json' });
      return setQueryParams(withFormat, { token });
    }

    function setQueryParams(path, params) {
      const basePath = String(path || '').trim();
      const [rawPath, rawQuery = ''] = basePath.split('?', 2);
      const qs = new URLSearchParams(rawQuery);
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        qs.set(k, String(v));
      });
      const query = qs.toString();
      return query ? `${rawPath}?${query}` : rawPath;
    }

    function removeQueryParams(path, keys = []) {
      const basePath = String(path || '').trim();
      const [rawPath, rawQuery = ''] = basePath.split('?', 2);
      const qs = new URLSearchParams(rawQuery);
      keys.forEach(key => qs.delete(key));
      const query = qs.toString();
      return query ? `${rawPath}?${query}` : rawPath;
    }

    function normalizeArcgisFeatureLayerBaseUrl(rawUrl) {
      let baseUrl = String(rawUrl || '').trim();
      if (!baseUrl) return '';

      baseUrl = baseUrl.replace(/\/query(?:\?.*)?$/i, '');
      try {
        const url = new URL(baseUrl);
        url.hash = '';
        url.search = '';
        baseUrl = `${url.origin}${url.pathname}`;
      } catch {
        baseUrl = baseUrl.replace(/[?#].*$/, '');
      }

      baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/query$/i, '');
      if (/\/(?:FeatureServer|MapServer)$/i.test(baseUrl)) {
        baseUrl = `${baseUrl}/0`;
      }
      return baseUrl;
    }

    function getArcgisExportExtension(exportFormat) {
      const fmt = String(exportFormat || '').trim().toLowerCase();
      if (fmt === 'csv') return 'csv';
      if (fmt === 'kml') return 'kml';
      if (fmt === 'json') return 'json';
      return 'geojson';
    }

    function getArcgisExportContentType(exportFormat) {
      const fmt = String(exportFormat || '').trim().toLowerCase();
      if (fmt === 'csv') return 'text/csv';
      if (fmt === 'kml') return 'application/vnd.google-earth.kml+xml';
      if (fmt === 'json') return 'application/json';
      return 'application/geo+json';
    }

    function inferArcgisExportFilename(assetId, exportFormat) {
      const safeAssetId = String(assetId || 'arcgis-export').trim().replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'arcgis-export';
      return `${safeAssetId}.${getArcgisExportExtension(exportFormat)}`;
    }

    function buildArcgisFeatureLayerQueryPath(exportFormat, token = '', options = {}) {
      const fmt = String(exportFormat || 'geojson').trim() || 'geojson';
      const extraParts = Object.entries(options || {})
        .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
        .map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('');
      const tokenPart = token ? `&token=${encodeURIComponent(token)}` : '';
      return `/query?where=1=1&outFields=*&f=${encodeURIComponent(fmt)}${extraParts}${tokenPart}`;
    }

    function normalizeHttpDataUrlParts(rawBaseUrl, rawPath) {
      let baseUrl = String(rawBaseUrl || '').trim();
      let path = String(rawPath || '').trim();

      // Accept full URL pasted in path field.
      if (/^https?:\/\//i.test(path)) {
        try {
          const u = new URL(path);
          baseUrl = `${u.origin}${u.pathname}`;
          const q = u.search ? u.search.replace(/^\?/, '') : '';
          path = q ? `?${q}` : '';
        } catch {}
      }

      // If baseUrl already contains query, move it to path query to avoid double '?'.
      const qIndex = baseUrl.indexOf('?');
      if (qIndex >= 0) {
        const baseQuery = baseUrl.slice(qIndex + 1);
        baseUrl = baseUrl.slice(0, qIndex);
        path = appendQueryParams(path, Object.fromEntries(new URLSearchParams(baseQuery).entries()));
      }

      if (path && !path.startsWith('/') && !path.startsWith('?')) {
        path = `/${path}`;
      }

      return { baseUrl: baseUrl.trim(), path: path.trim() };
    }

    function getSelectedTransferMode() {
      return (document.getElementById('transferMode')?.value || 'push').trim();
    }

    function getSelectedAssetSourceMode() {
      return (document.getElementById('assetSourceMode')?.value || 'remote-url').trim();
    }

    function syncAssetSourceModeUi() {
      const mode = getSelectedAssetSourceMode();
      const baseUrlWrap = document.getElementById('assetRemoteBaseUrlWrap');
      const pathWrap = document.getElementById('assetRemotePathWrap');
      const localFileWrap = document.getElementById('assetLocalFileWrap');
      const arcgisLayerWrap = document.getElementById('assetArcgisWrap');
      const hideRemoteUrl = mode === 'local-file' || mode === 'arcgis-feature-layer';
      if (baseUrlWrap) baseUrlWrap.style.display = hideRemoteUrl ? 'none' : '';
      if (pathWrap) pathWrap.style.display = hideRemoteUrl ? 'none' : '';
      if (localFileWrap) localFileWrap.style.display = mode === 'local-file' ? '' : 'none';
      if (arcgisLayerWrap) arcgisLayerWrap.style.display = mode === 'arcgis-feature-layer' ? '' : 'none';
    }

    function syncTransferModeUi() {
      const mode = getSelectedTransferMode();
      const sinkWrap = document.getElementById('sinkBaseUrlWrap');
      const arcgisWrap = document.getElementById('arcgisUploadWrap');
      const startBtn = document.getElementById('btnStartTransfer');
      if (sinkWrap) sinkWrap.style.display = mode === 'push' ? '' : 'none';
      if (arcgisWrap) arcgisWrap.style.display = mode === 'arcgis-upload' ? '' : 'none';
      if (startBtn && !transferStartInFlight) {
        startBtn.textContent = mode === 'local-download'
          ? 'Descargar en local'
          : (mode === 'arcgis-upload' ? 'Subir a ArcGIS' : 'Iniciar transferencia');
      }
    }

