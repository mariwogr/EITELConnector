const out = document.getElementById('result');
const tenantsOut = document.getElementById('tenantsOut');

async function call(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

function show(data) { out.textContent = JSON.stringify(data, null, 2); }

document.getElementById('tenantForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await call('/v1/tenants', {
      method: 'POST',
      body: JSON.stringify({
        tenant: document.getElementById('tenant').value.trim(),
        display_name: document.getElementById('displayName').value.trim(),
      }),
    });
    show(data);
  } catch (err) {
    show({ error: String(err) });
  }
});

document.getElementById('planForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      participant_id: document.getElementById('participantId').value.trim() || null,
    };
    const tenant = document.getElementById('planTenant').value.trim();
    const data = await call(`/v1/tenants/${tenant}/connector-plan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    show(data);
  } catch (err) {
    show({ error: String(err) });
  }
});

document.getElementById('exportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const id = document.getElementById('planId').value;
    const data = await call(`/v1/plans/${id}/export-compose`, { method: 'POST' });
    show(data);
  } catch (err) {
    show({ error: String(err) });
  }
});

document.getElementById('refreshTenants').addEventListener('click', async () => {
  try {
    const data = await call('/v1/tenants');
    tenantsOut.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    tenantsOut.textContent = JSON.stringify({ error: String(err) }, null, 2);
  }
});
