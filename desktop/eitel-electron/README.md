# EITEL Connector Desktop

Aplicacion de escritorio Electron que empaqueta la UI EITEL y levanta un proxy local. No redirige a las paginas remotas de los conectores: la consola se sirve desde la propia app y llama a los conectores por backend.

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
