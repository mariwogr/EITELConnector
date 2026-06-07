const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const source = path.join(root, 'caas', 'edc-ui', 'public');
const target = path.resolve(__dirname, '..', 'ui-dist');

if (!fs.existsSync(source)) {
  throw new Error(`No existe la UI EITEL en ${source}`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

console.log(`UI copiada a ${target}`);
