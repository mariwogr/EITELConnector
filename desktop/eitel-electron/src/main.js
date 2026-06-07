const path = require('node:path');
const { app, BrowserWindow, Menu, shell } = require('electron');
const { startServer } = require('./local-server');
const { profiles } = require('./profiles');

let mainWindow = null;
let localServer = null;

function resolveUiDir() {
  return path.join(app.getAppPath(), 'ui-dist');
}

function createMenu() {
  const template = [
    {
      label: 'Participante',
      submenu: [
        { label: 'Selector', click: () => mainWindow?.loadURL(localServer.url) },
        { type: 'separator' },
        ...profiles.map((profile) => ({
          label: profile.name,
          click: () => mainWindow?.loadURL(localServer.openProfileUrl(profile.id)),
        })),
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Abrir carpeta de configuracion',
          click: () => shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  localServer = await startServer({
    uiDir: resolveUiDir(),
    userDataDir: app.getPath('userData'),
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    title: 'EITEL Connector Desktop',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  createMenu();
  await mainWindow.loadURL(localServer.url);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (localServer) localServer.close();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
