// Aviso de versión nueva. Lee un archivo pequeño publicado en GitHub (repositorio gospelgeek/MeetScribe); no envía ningún dato de las reuniones.

const UPDATE_URL = 'https://gospelgeek.github.io/MeetScribe/version.json';
// Mientras no haya versión nueva se vuelve a consultar cada 15 min; una vez hallada, se recuerda 6 horas.
const UPDATE_TTL_IDLE = 15 * 60 * 1000;
const UPDATE_TTL_FOUND = 6 * 60 * 60 * 1000;

// true si a es una versión mayor que b ("0.10.0" > "0.9.2")
function isNewer(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

async function checkUpdate() {
  const { updateCheck } = await chrome.storage.local.get('updateCheck');
  const current = chrome.runtime.getManifest().version;
  const found = typeof updateCheck?.info?.version === 'string' && isNewer(updateCheck.info.version, current);
  const ttl = found ? UPDATE_TTL_FOUND : UPDATE_TTL_IDLE;
  let info = updateCheck && Date.now() - updateCheck.at < ttl ? updateCheck.info : undefined;

  if (info === undefined) {
    try {
      const res = await fetch(UPDATE_URL, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      info = await res.json();
      await chrome.storage.local.set({ updateCheck: { at: Date.now(), info } });
    } catch {
      return null; // sin conexión o archivo aún no publicado: no se avisa de nada
    }
  }

  const valid =
    typeof info?.version === 'string' &&
    /^\d+(\.\d+)*$/.test(info.version) &&
    typeof info.download === 'string' &&
    info.download.startsWith('https://github.com/gospelgeek/MeetScribe/');
  return valid && isNewer(info.version, current) ? info : null;
}

// `link` es un <a hidden> que se muestra solo si hay versión nueva.
async function showUpdate(link) {
  const info = await checkUpdate();
  if (!info) return;
  link.textContent = `Hay una versión nueva: v${info.version}. Descargar`;
  link.href = info.download;
  link.title = typeof info.notes === 'string' ? info.notes : '';
  link.hidden = false;
}
