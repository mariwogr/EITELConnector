# EITEL Connector Desktop

Aplicacion de escritorio Electron que empaqueta la UI EITEL y levanta un proxy local. No redirige a las paginas remotas de los conectores: la consola se sirve desde la propia app y llama a los conectores por backend.

Tras el login local, la app abre la consola real del conector (`index.final.html`) servida desde la propia aplicacion. La consola incluye:

- login local de primer uso con contrasena hasheada en el perfil de usuario de Electron
- la UI EITEL completa del conector seleccionado
- un panel `P2P` inyectado en la navegacion de la UI real
- emparejamiento con codigo corto mediante un servidor rendezvous local
- prueba de comunicacion P2P entre dos nodos locales por Management API y catalogo DSP

## Ejecutar en desarrollo

```powershell
cd desktop/eitel-electron
npm install
npm start
```

## Generar .exe

```powershell
cd desktop/eitel-electron
npm run dist
```

El ejecutable portable queda en `desktop/eitel-electron/dist/`.

## Credenciales

La app guarda las credenciales en el directorio de usuario de Electron, no en el repositorio. Las credenciales por perfil se pueden guardar desde la capa de escritorio:

- API key del Management API
- token de `local-assets` / `download-sink` si es distinto

Los perfiles base estan en `src/profiles.js`.

Por defecto no hay endpoints productivos: la app apunta a `127.0.0.1:12110` y `127.0.0.1:12120`, pensados para `connectors/star-pair/docker-compose.yaml`.

## Emparejamiento P2P

El flujo de `Emparejamiento` funciona parecido a `croc`: un participante crea un codigo corto, el otro se une con ese codigo y ambos intercambian descriptores publicos de sus endpoints. No se publican API keys ni tokens.

El `.exe` arranca automaticamente un rendezvous local en `http://127.0.0.1:8765` si el puerto esta libre. Para usar un rendezvous externo o compartido en LAN/VPN, tambien puedes arrancarlo a mano:

```powershell
cd desktop/eitel-electron
npm run pairing-server
```

En otra red se puede sustituir esa URL por la direccion LAN/VPN del equipo que ejecute el rendezvous.

Para exponerlo en una LAN/VPN:

```powershell
$env:EITEL_PAIRING_HOST="0.0.0.0"
$env:EITEL_PAIRING_PORT="8765"
npm run pairing-server
```

La app escribe trazas en `desktop.log`, dentro de la carpeta de usuario de Electron.

## Prueba entre conectores

En el panel `P2P` de la consola real, elige un consumidor y un proveedor. La prueba valida:

- Management API del consumidor
- Management API del proveedor
- assets publicos del proveedor
- peticion de catalogo DSP desde consumidor hacia proveedor
