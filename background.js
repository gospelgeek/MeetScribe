// Atiende a la página de la reunión (content.js) y a la página de reuniones (history.js):
// toma los screenshots, abre la transcripción al colgar y, si el usuario conectó su IA,
// genera el resumen.
// Chrome solo deja capturar la pestaña que está a la vista; si no lo está, se rechaza
// y la página lo vuelve a intentar más tarde. captureVisibleTab exige el permiso <all_urls>
// (o activeTab, que solo se concede al pulsar el icono de la extensión, no desde la página).

importScripts('shots.js', 'format.js', 'ai.js');

// Al colgar: abre la página de reuniones con esa reunión seleccionada (o reutiliza la que ya esté abierta).
async function showMeeting(code) {
  const base = chrome.runtime.getURL('history.html');
  const url = `${base}#${code}`;
  const [open] = await chrome.tabs.query({ url: `${base}*` });
  if (open) {
    await chrome.tabs.update(open.id, { url, active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// --- Resumen con la IA del usuario ---
// El estado vive en chrome.storage (clave summary:<código>) para que la página de reuniones lo
// muestre en vivo: { status: 'working' | 'done' | 'error', text, error, at, provider, model, basis }.
// `basis` es cuánto contenido tenía la reunión al resumirla, para no repetir el resumen (ni el gasto).

const basisOf = (m) => m.entries.length + (m.chat || []).length;

async function generateSummary(code, { auto = false } = {}) {
  const key = `summary:${code}`;
  const all = await chrome.storage.local.get([`meet:${code}`, `title:${code}`, 'ai', 'settings', key]);
  const ai = all.ai;
  const m = all[`meet:${code}`];
  if (!aiIsConfigured(ai)) return { ok: false, error: 'Tu IA no está conectada.' };
  if (!m || basisOf(m) < 3) return { ok: false, error: 'La reunión tiene muy poco contenido para resumir.' };

  const current = all[key];
  if (current?.status === 'working' && Date.now() - current.at < 5 * 60000) return { ok: true };
  if (auto && current?.status === 'done' && current.basis === basisOf(m)) return { ok: true };

  const meta = { provider: ai.provider, model: ai.model, basis: basisOf(m), at: Date.now() };
  await chrome.storage.local.set({ [key]: { ...meta, status: 'working' } });
  try {
    m.customTitle = all[`title:${code}`] || '';
    const text = await callAI(ai, SUMMARY_SYSTEM, asChronological(m, all.settings?.myName || ''));
    await chrome.storage.local.set({ [key]: { ...meta, status: 'done', text, at: Date.now() } });
    return { ok: true };
  } catch (err) {
    const error = err instanceof AIError ? err.message : 'Ocurrió un error inesperado al generar el resumen.';
    if (!(err instanceof AIError)) console.warn('[MeetScribe] resumen:', err);
    await chrome.storage.local.set({ [key]: { ...meta, status: 'error', error } });
    return { ok: false, error };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'ended' && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(msg.code)) {
    showMeeting(msg.code);
    // Un momento para que content.js termine de guardar la reunión antes de leerla.
    setTimeout(async () => {
      const { ai } = await chrome.storage.local.get('ai');
      if (aiIsConfigured(ai) && ai.auto) generateSummary(msg.code, { auto: true });
    }, 1500);
    return;
  }

  // Solo las páginas de la propia extensión (reuniones, popup) pueden pedir un resumen o probar la
  // conexión; la página de Meet (content.js) solo puede pedir screenshots y avisar del fin.
  if (sender.url?.startsWith(chrome.runtime.getURL(''))) {
    if (msg?.type === 'summarize' && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(msg.code)) {
      generateSummary(msg.code, { auto: Boolean(msg.auto) }).then(respond);
      return true;
    }
    if (msg?.type === 'ai-test') {
      callAI(msg.config, 'Responde solo con la palabra: ok', 'Prueba de conexión')
        .then(() => respond({ ok: true }))
        .catch((err) => respond({ ok: false, error: err instanceof AIError ? err.message : 'Error inesperado en la prueba.' }));
      return true;
    }
  }

  if (msg?.type !== 'shot' || !sender.tab) return;
  (async () => {
    try {
      if (!sender.tab.active) return respond({ ok: false, reason: 'pestaña oculta' });
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 60 });
      const blob = await (await fetch(dataUrl)).blob();
      await ShotsDB.add(msg.code, Date.now(), blob);
      respond({ ok: true });
    } catch (err) {
      console.warn('[MeetScribe] no se pudo tomar el screenshot:', err);
      respond({ ok: false, reason: String(err?.message || err) });
    }
  })();
  return true; // la respuesta es asíncrona
});
