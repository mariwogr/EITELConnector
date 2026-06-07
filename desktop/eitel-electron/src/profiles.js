const origin = 'https://gis.eiteldata.eu';

const profiles = [
  {
    id: 'uc3m',
    name: 'UC3M',
    description: 'Conector productivo UC3M',
    prefix: 'conectoruc3m',
    remoteOrigin: origin,
    remotePrefix: '/conectoruc3m',
    connectorName: 'conectoruc3m',
    dspUrl: `${origin}/conectoruc3m/api/v1/dsp/2025-1`,
    uiVariant: 'desktop',
  },
  {
    id: 'fuenlabrada',
    name: 'Fuenlabrada',
    description: 'Conector productivo Fuenlabrada',
    prefix: 'conectorFuenlabrada',
    remoteOrigin: origin,
    remotePrefix: '/conectorFuenlabrada',
    connectorName: 'conectorFuenlabrada',
    dspUrl: `${origin}/conectorFuenlabrada/api/v1/dsp/2025-1`,
    uiVariant: 'desktop',
  },
  {
    id: 'local-uc3m',
    name: 'Local UC3M',
    description: 'Stack local del compose base',
    prefix: 'local-uc3m',
    remoteOrigin: 'http://localhost:12000',
    remotePrefix: '/conectoruc3m',
    connectorName: 'conectoruc3m',
    dspUrl: 'http://localhost:12000/conectoruc3m/api/v1/dsp/2025-1',
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
