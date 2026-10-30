// Compartir el PDF de una reunión por Google Drive: se sube a la cuenta de quien usa la extensión y se
// comparte con las personas elegidas (Drive les envía el aviso por correo).
// Permiso pedido a Google: solo «drive.file» (archivos creados por MeetScribe; no puede leer el resto del Drive).
// Inicio de sesión: OAuth con un cliente web de Google Cloud y una página puente publicada en gospelgeek.com.co
// (tools/oauth.html), que devuelve el resultado a la extensión sin importar su id de instalación.

const DRIVE_CLIENT_ID = '101156711523-5644lcn1u5bds7opq4foomtsk1ateepe.apps.googleusercontent.com'; // ID de cliente OAuth (tipo «Aplicación web») del proyecto de Google Cloud
const DRIVE_RELAY = 'https://gospelgeek.com.co/desarrollo/MeetScribe/oauth.html';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

class DriveError extends Error {}

let driveToken = null; // { value, expires } solo en memoria: nunca se guarda

const driveConfigured = () => Boolean(DRIVE_CLIENT_ID);

// Texto de un error de la API ya redactado para mostrarse.
async function driveFail(res, what) {
  let detail = '';
  try {
    detail = (await res.json())?.error?.message || '';
  } catch {
    /* sin cuerpo */
  }
  if (res.status === 401) driveToken = null;
  const why =
    res.status === 401 ? 'la sesión con Google venció; vuelve a intentarlo' :
    res.status === 403 && /not been used|disabled/i.test(detail) ? 'la API de Google Drive no está activada en el proyecto de Google Cloud' :
    res.status === 403 && /quota|limit/i.test(detail) ? 'se superó un límite de Google; prueba más tarde' :
    res.status === 404 ? 'Drive no encontró el archivo' :
    detail || `error ${res.status}`;
  return new DriveError(`${what}: ${why}.`);
}

async function driveAuth() {
  if (!driveConfigured()) throw new DriveError('MeetScribe todavía no tiene configurada la conexión con Google Drive.');
  if (driveToken && driveToken.expires > Date.now() + 60000) return driveToken.value;

  const state = `${chrome.runtime.id}.${crypto.randomUUID()}`; // id de la extensión (para la página puente) + antifalsificación
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: DRIVE_CLIENT_ID,
      redirect_uri: DRIVE_RELAY,
      response_type: 'token',
      scope: DRIVE_SCOPE,
      state,
    });
  let back;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    throw new DriveError(`No se completó la conexión con Google (${e?.message || 'cancelada'}).`);
  }
  const p = new URLSearchParams(new URL(back).hash.slice(1));
  if (p.get('state') !== state) throw new DriveError('La respuesta de Google no corresponde a esta solicitud. Inténtalo de nuevo.');
  if (p.get('error')) throw new DriveError(p.get('error') === 'access_denied' ? 'No diste el permiso en Google.' : `Google rechazó la conexión (${p.get('error')}).`);
  const value = p.get('access_token');
  if (!value) throw new DriveError('Google no devolvió el permiso. Inténtalo de nuevo.');
  driveToken = { value, expires: Date.now() + Number(p.get('expires_in') || 3000) * 1000 };
  return value;
}

// Cierra la sesión local; el permiso en la cuenta de Google se retira desde myaccount.google.com/permissions.
function driveForget() {
  driveToken = null;
}

// Carpeta «MeetScribe» del Drive del usuario, donde queda todo. Se crea la primera vez; después se reutiliza
// (su id se recuerda). Con el permiso drive.file solo se ven las carpetas que creó MeetScribe, así que si el
// usuario la borró se crea otra. Devuelve el id.
async function driveFolder(token, knownId) {
  if (knownId) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(knownId)}?fields=id,trashed`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const f = await res.json();
      if (!f.trashed) return f.id;
    } else if (res.status !== 404) throw await driveFail(res, 'No se pudo revisar la carpeta de Drive');
  }
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'MeetScribe', mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw await driveFail(res, 'No se pudo crear la carpeta en Drive');
  return (await res.json()).id;
}

// Mueve un archivo (por ejemplo un PDF subido antes de que existiera la carpeta) a la carpeta.
async function driveMove(token, fileId, folderId, fromParents) {
  const q = new URLSearchParams({ addParents: folderId, fields: 'id' });
  if (fromParents?.length) q.set('removeParents', fromParents.join(','));
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${q}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw await driveFail(res, 'No se pudo mover el PDF a la carpeta');
}

// Sube el PDF (a la carpeta indicada, o a la raíz si no hay). Devuelve { id, webViewLink }.
async function driveUpload(token, name, bytes, folderId) {
  const boundary = `meetscribe${crypto.randomUUID()}`;
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: 'application/pdf', parents: folderId ? [folderId] : undefined })}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`
  );
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body: new Blob([head, bytes, enc.encode(`\r\n--${boundary}--`)]),
  });
  if (!res.ok) throw await driveFail(res, 'No se pudo subir el PDF a Drive');
  return res.json();
}

// Reemplaza el contenido de un PDF ya subido (mismo enlace y mismas personas con acceso).
// Devuelve null si ya no existe o está en la papelera: entonces conviene subir uno nuevo.
async function driveUpdate(token, fileId, bytes) {
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,webViewLink,trashed,parents`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' },
    body: new Blob([bytes]),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await driveFail(res, 'No se pudo actualizar el PDF en Drive');
  const file = await res.json();
  return file.trashed ? null : file;
}

// Da acceso a una persona; Drive le manda el correo con el enlace.
async function driveShare(token, fileId, email, role, message) {
  const q = new URLSearchParams({ sendNotificationEmail: 'true' });
  if (message) q.set('emailMessage', message);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${q}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  });
  if (!res.ok) throw await driveFail(res, `No se pudo compartir con ${email}`);
}
