export type ParticipantProfile = {
  id: string;
  name: string;
  subtitle: string;
  url: string;
  tone: 'blue' | 'green' | 'slate' | 'gold';
  tags: string[];
};

export const participantProfiles: ParticipantProfile[] = [
  {
    id: 'uc3m',
    name: 'UC3M',
    subtitle: 'Conector productivo UC3M',
    url: 'https://gis.eiteldata.eu/conectoruc3m/',
    tone: 'blue',
    tags: ['Produccion', 'ArcGIS', 'EITEL'],
  },
  {
    id: 'fuenlabrada',
    name: 'Fuenlabrada',
    subtitle: 'Conector productivo Fuenlabrada',
    url: 'https://gis.eiteldata.eu/conectorFuenlabrada/',
    tone: 'green',
    tags: ['Produccion', 'ArcGIS', 'Municipio'],
  },
  {
    id: 'local-uc3m',
    name: 'Local UC3M',
    subtitle: 'Stack local levantado con docker-compose.yaml',
    url: 'http://localhost:12000/conectoruc3m/',
    tone: 'slate',
    tags: ['Local', 'Docker', 'Dev'],
  },
  {
    id: 'star-local',
    name: 'Star Local',
    subtitle: 'Perfil Star para pruebas de participante',
    url: 'http://localhost:12020/conectorstar/',
    tone: 'gold',
    tags: ['Star', 'Local', 'PoC'],
  },
];
