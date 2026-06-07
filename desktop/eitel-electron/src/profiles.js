const profiles = [
  {
    id: 'peer-a',
    name: 'Peer A',
    description: 'Nodo local P2P A',
    prefix: 'conectorstar-a',
    remoteOrigin: 'http://127.0.0.1:12110',
    remotePrefix: '/conectorstar-a',
    connectorName: 'conectorstar-a',
    dspUrl: 'http://127.0.0.1:12110/conectorstar-a/api/v1/dsp/2025-1',
    uiVariant: 'desktop',
  },
  {
    id: 'peer-b',
    name: 'Peer B',
    description: 'Nodo local P2P B',
    prefix: 'conectorstar-b',
    remoteOrigin: 'http://127.0.0.1:12120',
    remotePrefix: '/conectorstar-b',
    connectorName: 'conectorstar-b',
    dspUrl: 'http://127.0.0.1:12120/conectorstar-b/api/v1/dsp/2025-1',
    uiVariant: 'desktop',
  },
];

function getProfile(id) {
  return profiles.find((profile) => profile.id === id) || profiles[0];
}

function getProfileByPrefix(prefix) {
  const normalized = String(prefix || '').toLowerCase();
  return profiles.find((profile) => String(profile.prefix || '').toLowerCase() === normalized) || null;
}

function getConnectorDirectory() {
  return profiles.reduce((acc, profile) => {
    acc[profile.connectorName] = profile.dspUrl;
    return acc;
  }, {});
}

module.exports = {
  profiles,
  getProfile,
  getProfileByPrefix,
  getConnectorDirectory,
};
