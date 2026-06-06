import './styles.css';
import { participantProfiles, type ParticipantProfile } from './profiles';

const storageKey = 'eitel.desktop.selectedProfile';

function getSavedProfileId(): string {
  try {
    return localStorage.getItem(storageKey) || participantProfiles[0]?.id || '';
  } catch {
    return participantProfiles[0]?.id || '';
  }
}

function saveProfileId(id: string): void {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // Local storage is only a convenience for the launcher.
  }
}

function byId(id: string): ParticipantProfile {
  return participantProfiles.find((profile) => profile.id === id) || participantProfiles[0];
}

function openProfile(profile: ParticipantProfile): void {
  saveProfileId(profile.id);
  window.location.assign(profile.url);
}

function renderProfileCard(profile: ParticipantProfile, selectedId: string): string {
  const selected = profile.id === selectedId;
  const tags = profile.tags.map((tag) => `<span>${tag}</span>`).join('');

  return `
    <button class="profile-card ${selected ? 'is-selected' : ''}" data-profile="${profile.id}" data-tone="${profile.tone}">
      <span class="profile-card__status"></span>
      <span class="profile-card__body">
        <strong>${profile.name}</strong>
        <small>${profile.subtitle}</small>
        <span class="profile-card__tags">${tags}</span>
      </span>
    </button>
  `;
}

function render(selectedId = getSavedProfileId()): void {
  const selected = byId(selectedId);
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <section class="shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="/eitel-logo-brand.png" alt="EITEL" />
          <div>
            <p>Desktop</p>
            <h1>EITEL Connector</h1>
          </div>
        </div>

        <div class="profile-list">
          ${participantProfiles.map((profile) => renderProfileCard(profile, selected.id)).join('')}
        </div>
      </aside>

      <section class="main-panel" data-tone="${selected.tone}">
        <div class="connector-preview">
          <div>
            <p class="eyebrow">Participante seleccionado</p>
            <h2>${selected.name}</h2>
            <p class="summary">${selected.subtitle}</p>
          </div>
          <div class="url-box">${selected.url}</div>
        </div>

        <div class="actions">
          <button class="primary-action" id="openSelected">Abrir conector</button>
          <button class="secondary-action" id="copyUrl">Copiar URL</button>
        </div>

        <div class="notes">
          <article>
            <strong>Login</strong>
            <span>La autenticacion ArcGIS ocurre dentro del WebView, igual que en navegador.</span>
          </article>
          <article>
            <strong>Perfiles</strong>
            <span>Los participantes viven en <code>src/profiles.ts</code> y se pueden duplicar por municipio.</span>
          </article>
          <article>
            <strong>Build</strong>
            <span>El ejecutable se genera con <code>npm run tauri:build</code>.</span>
          </article>
        </div>
      </section>
    </section>
  `;

  document.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextId = button.dataset.profile || selected.id;
      saveProfileId(nextId);
      render(nextId);
    });
  });

  document.getElementById('openSelected')?.addEventListener('click', () => openProfile(selected));
  document.getElementById('copyUrl')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(selected.url);
    } catch {
      window.prompt('URL del conector', selected.url);
    }
  });
}

render();
