# EITEL Connector Desktop

Aplicacion de escritorio Tauri para abrir la consola EITEL del participante seleccionado.

## Requisitos

- Node.js 22+
- Rust y Cargo (`rustup`) para compilar Tauri
- WebView2 Runtime en Windows

## Desarrollo

```powershell
cd desktop/eitel-tauri
npm install
npm run tauri:dev
```

## Build

```powershell
cd desktop/eitel-tauri
npm run tauri:build
```

El launcher incluye perfiles para UC3M, Fuenlabrada y entorno local. La UI real sigue siendo la web del conector; esta app solo le da una carcasa de escritorio ligera.
