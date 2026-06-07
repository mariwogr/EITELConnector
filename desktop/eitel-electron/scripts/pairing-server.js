const { createPairingServer } = require('../src/pairing-server');

const port = Number(process.env.EITEL_PAIRING_PORT || 8765);
const host = process.env.EITEL_PAIRING_HOST || '127.0.0.1';
const pairing = createPairingServer();

pairing.listen(port, host).then((address) => {
  const resolvedHost = address.address === '::' ? '127.0.0.1' : address.address;
  console.log(`EITEL pairing server listening on http://${resolvedHost}:${address.port}`);
});

process.on('SIGINT', async () => {
  await pairing.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pairing.close();
  process.exit(0);
});
