const $ = (id) => document.getElementById(id);
let settings = { myName: '', autoCaptions: true, screenshots: true, openOnEnd: true };

async function refresh() {
  const all = await chrome.storage.local.get(null);
  settings = { ...settings, ...(all.settings || {}) };

  const meetings = Object.entries(all).filter(([k]) => k.startsWith('meet:')).map(([, m]) => m);
  const lines = meetings.reduce((sum, m) => sum + m.entries.length, 0);
  $('info').textContent = meetings.length
    ? `${meetings.length} ${meetings.length === 1 ? 'reunión guardada' : 'reuniones guardadas'} · ${lines} intervenciones`
    : 'Aún no hay reuniones guardadas.';

  $('myName').value = settings.myName;
  $('autoCaptions').checked = settings.autoCaptions;
  $('screenshots').checked = settings.screenshots;
  $('openOnEnd').checked = settings.openOnEnd;

  const connected = aiIsConfigured(all.ai);
  $('connectAI').textContent = connected ? 'Configurar mi IA' : 'Conectar mi IA';
  $('aiStatus').textContent = connected
    ? `Conectada: ${AI_PROVIDERS[all.ai.provider].name}${all.ai.auto ? ' · resumen al colgar' : ''}`
    : 'Opcional: resumen y tareas con tu propia IA.';
}

function saveSettings() {
  settings = { myName: $('myName').value.trim(), autoCaptions: $('autoCaptions').checked, screenshots: $('screenshots').checked, openOnEnd: $('openOnEnd').checked };
  chrome.storage.local.set({ settings });
}

$('viewAll').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  window.close();
});
$('connectAI').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html#ia') });
  window.close();
});
$('myName').addEventListener('input', saveSettings);
$('autoCaptions').addEventListener('change', saveSettings);
$('screenshots').addEventListener('change', saveSettings);
$('openOnEnd').addEventListener('change', saveSettings);

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

showUpdate($('update'));

refresh();
