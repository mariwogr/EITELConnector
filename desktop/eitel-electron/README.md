# EITEL Connector Desktop

Aplicacion de escritorio Electron que empaqueta la UI EITEL y levanta un proxy local. No redirige a las paginas remotas de los conectores: la consola se sirve desde la propia app y llama a los conectores por backend.

La pantalla inicial funciona como un panel de control local:

- login local de primer uso con contrasena hasheada en el perfil de usuario de Electron
- configuracion de credenciales por conector
- laboratorio para probar comunicacion P2P entre dos nodos locales por Management API y catalogo DSP
- acceso a la consola completa del conector seleccionado

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

La app guarda las credenciales en el directorio de usuario de Electron, no en el repositorio. La pantalla inicial permite configurar:

- API key del Management API
- token de `local-assets` / `download-sink` si es distinto

Los perfiles base estan en `src/profiles.js`.

Por defecto no hay endpoints productivos: la app apunta a `127.0.0.1:12110` y `127.0.0.1:12120`, pensados para `connectors/star-pair/docker-compose.yaml`. Desde `Conectores` puedes cambiar la URL local del nodo, prefijo, ID del peer y endpoint DSP para probar otros equipos en LAN/VPN.

## Prueba entre conectores

En `Comunicacion`, elige un consumidor y un proveedor. La prueba valida:

- Management API del consumidor
- Management API del proveedor
- assets publicos del proveedor
- peticion de catalogo DSP desde consumidor hacia proveedor
