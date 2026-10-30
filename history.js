const $ = (id) => document.getElementById(id);

let meetings = {}; // key -> reunión
let myName = '';
let selected = null;

// Todo el texto viene de Meet: se inserta siempre con textContent, nunca como HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Texto con los enlaces http(s) clicables; se arma con nodos, nunca con HTML.
function linkify(text) {
  const frag = document.createDocumentFragment();
  text.split(/(https?:\/\/[^\s<>"']+)/g).forEach((part, i) => {
    if (i % 2 === 0) return part && frag.append(part);
    const url = part.replace(/[.,;:!?)]+$/, '');
    const a = el('a', '', url);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    frag.append(a, part.slice(url.length));
  });
  return frag;
}

// Al preparar el PDF se ignora el buscador: el PDF lleva la reunión completa.
let printing = false;
const query = () => (printing ? '' : $('search').value.trim().toLowerCase());

function matches(m, q) {
  return (
    !q ||
    m.code.includes(q) ||
    meetingTitle(m).toLowerCase().includes(q) ||
    attendeesOf(m, myName).some((n) => n.toLowerCase().includes(q)) ||
    m.entries.some((e) => `${e.speaker} ${e.text}`.toLowerCase().includes(q))
  );
}

const sorted = () => Object.values(meetings).sort((a, b) => b.startedAt - a.startedAt);

function renderList() {
  const q = query();
  const items = sorted().filter((m) => matches(m, q));
  $('list').replaceChildren(
    ...items.map((m) => {
      const title = meetingTitle(m);
      const heading = el('div', 'code', title);
      if (!meetingEnd(m)) heading.append(el('span', 'live', 'En curso'));
      const btn = el('button');
      btn.append(heading);
      const people = attendeesOf(m, myName).length;
      btn.append(
        el('div', 'sub', new Date(m.startedAt).toLocaleString()),
        el('div', 'sub', [durationLabel(m), `${people} ${people === 1 ? 'participante' : 'participantes'}`].filter(Boolean).join(' · '))
      );
      btn.setAttribute('aria-current', String(m.code === selected));
      btn.addEventListener('click', () => {
        selected = m.code;
        render();
      });
      const li = el('li');
      li.append(btn);
      return li;
    })
  );
}

// Enlace al PDF que se subió a Drive al compartir, con quién lo tiene.
function renderDrive(m) {
  const box = $('drive');
  const d = m.drive;
  box.hidden = !d;
  if (!d) return;
  const open = el('a', '', 'Abrir');
  open.href = d.link;
  open.target = '_blank';
  open.rel = 'noopener';
  const copy = el('button', '', 'Copiar enlace');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(d.link);
    copy.textContent = 'Copiado';
    setTimeout(() => (copy.textContent = 'Copiar enlace'), 1500);
  });
  const emails = Object.keys(d.sharedWith || {});
  box.replaceChildren(
    el('b', '', 'PDF en Drive: '),
    open,
    ' · ',
    ...(d.folder ? [Object.assign(el('a', '', 'Carpeta'), { href: `https://drive.google.com/drive/folders/${d.folder}`, target: '_blank', rel: 'noopener' }), ' · '] : []),
    copy,
    document.createTextNode(` · actualizado ${new Date(d.at).toLocaleString()}${emails.length ? ` · compartido con ${emails.join(', ')}` : ''}`)
  );
}

function renderTranscript(m) {
  const q = query();
  const entries = m.entries.filter((e) => !q || `${e.speaker} ${e.text}`.toLowerCase().includes(q));
  const box = $('transcript');

  let last = null;
  box.replaceChildren(
    el('h3', 'section-title', 'Transcripción'),
    ...entries.map((e) => {
      const name = speakerName(e.speaker, myName);
      const first = name !== last;
      last = name;
      const row = el('div', first ? 'entry first' : 'entry cont');
      const body = el('div');
      if (first) {
        const who = el('div', 'speaker', name);
        who.style.color = colorFor(name);
        body.append(who);
      }
      body.append(el('div', 'text', e.text));
      row.append(el('span', 'time', clock(e.ts, m.startedAt)), body);
      return row;
    })
  );

  const chat = uniqueChat(m.chat || []).filter((c) => !q || `${c.speaker} ${c.text}`.toLowerCase().includes(q));
  if (chat.length) {
    box.append(el('h3', 'chat-title', `Chat de la reunión (${chat.length} ${chat.length === 1 ? 'mensaje' : 'mensajes'})`));
    for (const c of chat) {
      const name = speakerName(c.speaker, myName);
      const who = el('span', 'speaker', `${name} `);
      who.style.color = colorFor(name);
      const body = el('div');
      body.append(who, linkify(c.text));
      const row = el('div', 'entry');
      row.append(el('span', 'time', clock(c.ts, m.startedAt)), body);
      box.append(row);
    }
  }

  // Cierre de la reunión, siempre visible al final de la transcripción.
  const end = meetingEnd(m);
  box.append(
    end
      ? el('div', 'end', `Fin de la reunión · ${endLabel(m)} · duración ${duration(end.at - m.startedAt)}`)
      : el('div', 'end live-end', 'La reunión sigue en curso')
  );
}

// Miniaturas de los screenshots: una fila debajo del encabezado, antes del resumen y la transcripción.
let shotUrls = [];
let shotsReady = Promise.resolve();
let shotsRun = 0;

async function renderShots(m) {
  const run = ++shotsRun;
  let shots = [];
  try {
    shots = await ShotsDB.list(m.code);
  } catch {
    return;
  }
  if (run !== shotsRun || !shots.length) return;

  const section = el('div', 'shots');
  section.append(el('h3', 'shots-title', `Screenshots de la reunión (${shots.length})`));
  const grid = el('div', 'shot-grid');
  for (const s of shots) {
    const url = URL.createObjectURL(s.blob);
    shotUrls.push(url);
    const img = el('img');
    img.src = url;
    img.alt = `Screenshot a los ${clock(s.ts, m.startedAt)}`;
    const btn = el('button', 'shot');
    btn.title = 'Ampliar';
    btn.append(img, el('span', '', clock(s.ts, m.startedAt)));
    btn.addEventListener('click', () => openShot(url, img.alt));
    grid.append(btn);
  }
  section.append(grid);
  $('shots').replaceChildren(section); // entre el encabezado y el resumen
}

function openShot(url, alt) {
  const overlay = el('div', 'lightbox');
  const img = el('img');
  img.src = url;
  img.alt = alt;
  overlay.append(img);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

function render() {
  $('aiOpen').textContent = aiIsConfigured(ai) ? 'Configurar mi IA' : 'Conectar mi IA (opcional)';
  renderList();
  updateRange();
  const m = meetings[`meet:${selected}`];
  $('empty').hidden = Boolean(m);
  $('detail').hidden = !m;
  if (!m) return;

  const people = attendeesOf(m, myName);
  $('title').textContent = meetingTitle(m);
  $('meta').textContent = [`Inicio: ${new Date(m.startedAt).toLocaleString()}`, `Fin: ${endLabel(m)}`, durationLabel(m)]
    .filter(Boolean)
    .join(' · ');
  $('people').replaceChildren(el('b', '', `Participantes (${people.length}): `), document.createTextNode(people.join(', ') || 'sin datos'));
  renderDrive(m);
  shotUrls.forEach((u) => URL.revokeObjectURL(u));
  shotUrls = [];
  $('shots').replaceChildren();
  renderTranscript(m);
  shotsReady = renderShots(m);
  renderSummary(m);
}

async function load() {
  const all = await chrome.storage.local.get(null);
  myName = all.settings?.myName || '';
  meetings = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('meet:')));
  // El nombre que se pone a mano vive en su propia clave, para que la captura en curso no lo pise.
  ai = all.ai || null;
  contacts = Array.isArray(all.contacts) ? all.contacts : [];
  knownEmails = all.people && typeof all.people === 'object' ? all.people : {};
  driveFolderId = typeof all.driveFolder === 'string' ? all.driveFolder : '';
  if (mailDialog.open) renderContacts();
  for (const m of Object.values(meetings)) {
    m.customTitle = all[`title:${m.code}`] || '';
    m.summary = all[`summary:${m.code}`] || null;
    m.drive = all[`drive:${m.code}`] || null;
  }
  const wanted = location.hash.slice(1);
  if (!selected && meetings[`meet:${wanted}`]) selected = wanted;
  if (!meetings[`meet:${selected}`]) selected = sorted()[0]?.code ?? null;
  render();
}

// Al colgar, la extensión abre esta página con #codigo-de-la-reunión.
function selectFromHash() {
  const code = location.hash.slice(1);
  if (meetings[`meet:${code}`]) {
    selected = code;
    render();
  }
}
window.addEventListener('hashchange', async () => {
  await load();
  selectFromHash();
  autoSummaryIfNeeded();
  if (location.hash === '#ia') openAI();
});

const current = () => meetings[`meet:${selected}`];

$('search').addEventListener('input', render);
$('dlTxt').addEventListener('click', () => download(`${selected}.txt`, asChronological(current(), myName), 'text/plain'));
$('dlJson').addEventListener('click', () => download(`${selected}.json`, asJson(current(), myName), 'application/json'));
// PDF: se arma la reunión completa en esta misma página y se abre el diálogo de impresión de
// Chrome (destino «Guardar como PDF»). Los estilos @media print de history.css dejan solo la reunión.
$('dlPdf').addEventListener('click', async () => {
  const m = current();
  if (!m) return;
  printing = true;
  render();
  await shotsReady;
  await Promise.all([...document.images].map((img) => img.complete || new Promise((r) => (img.onload = img.onerror = r))));
  const title = document.title;
  document.title = `${meetingTitle(m)} - ${isoDay(new Date(m.startedAt))}`; // Chrome lo propone como nombre del archivo
  const done = () => {
    window.removeEventListener('afterprint', done);
    printing = false;
    document.title = title;
    render();
  };
  window.addEventListener('afterprint', done);
  window.print();
});
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(asChronological(current(), myName));
  const btn = $('copy');
  btn.classList.add('ok');
  btn.title = 'Copiado';
  setTimeout(() => {
    btn.classList.remove('ok');
    btn.title = 'Copiar transcripción';
  }, 1500);
});
$('rename').addEventListener('click', async () => {
  const name = prompt('Nombre de la reunión (déjalo vacío para volver al nombre automático):', meetingTitle(current()));
  if (name === null) return;
  if (name.trim()) await chrome.storage.local.set({ [`title:${selected}`]: name.trim() });
  else await chrome.storage.local.remove(`title:${selected}`);
});
$('remove').addEventListener('click', async () => {
  if (!confirm(`¿Borrar la transcripción de «${meetingTitle(current())}»?`)) return;
  await ShotsDB.remove(selected);
  await chrome.storage.local.remove([`meet:${selected}`, `title:${selected}`, `summary:${selected}`, `drive:${selected}`]);
});

// --- Descarga por ventana de tiempo ---

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'YYYY-MM-DD' -> milisegundos de las 00:00 locales (con plus=1, las del día siguiente)
function dayMs(value, plus = 0) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d + plus).getTime();
}

// Reuniones cuya hora de inicio cae en [desde, hasta], de la más antigua a la más reciente.
function rangeMeetings() {
  const from = $('from').value ? dayMs($('from').value) : -Infinity;
  const to = $('to').value ? dayMs($('to').value, 1) : Infinity;
  return sorted().filter((m) => m.startedAt >= from && m.startedAt < to).reverse();
}

function updateRange() {
  const list = rangeMeetings();
  const scope = $('from').value || $('to').value ? 'en el rango' : '(sin filtro de fechas)';
  $('rangeInfo').textContent = `${list.length} ${list.length === 1 ? 'reunión' : 'reuniones'} ${scope}`;
  $('dlRange').disabled = list.length === 0;
}

for (const btn of document.querySelectorAll('.presets button')) {
  btn.addEventListener('click', () => {
    if (btn.dataset.days === 'all') {
      $('from').value = '';
      $('to').value = '';
    } else {
      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Number(btn.dataset.days) - 1));
      $('from').value = isoDay(first);
      $('to').value = isoDay(today);
    }
    updateRange();
  });
}
$('from').addEventListener('input', updateRange);
$('to').addEventListener('input', updateRange);

$('dlRange').addEventListener('click', () => {
  const list = rangeMeetings();
  const json = $('rangeFormat').value === 'json';
  const name =
    $('from').value || $('to').value
      ? `reuniones_${$('from').value || 'inicio'}_a_${$('to').value || 'hoy'}`
      : 'reuniones_todas';
  download(
    `${name}.${json ? 'json' : 'txt'}`,
    json ? asJsonMany(list, myName) : asChronologicalMany(list, myName),
    json ? 'application/json' : 'text/plain'
  );
});

// --- Resumen con la IA del usuario (opcional) ---
// La configuración vive en la clave `ai` de chrome.storage; las llamadas al proveedor las hace
// background.js. Todo lo que muestra el resumen entra como texto, nunca como HTML.

let ai = null; // { provider, apiKey, model, baseUrl, auto, consentAt }

// Texto con encabezados "## " y listas "- " a nodos del DOM.
function renderSummaryText(text, box) {
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/\*\*/g, '');
    if (!line) {
      list = null;
    } else if (line.startsWith('## ')) {
      list = null;
      box.append(el('h4', '', line.slice(3)));
    } else if (/^[-*•]\s+/.test(line)) {
      if (!list) {
        list = el('ul');
        box.append(list);
      }
      list.append(el('li', '', line.replace(/^[-*•]\s+/, '')));
    } else {
      list = null;
      box.append(el('p', '', line));
    }
  }
}

function summaryButton(label, code) {
  const wrap = el('div', 'summary-actions');
  const btn = el('button', 'primary-btn', label);
  const why = el('p', 'error');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Generando…';
    why.textContent = '';
    // El estado (trabajando / listo / error) llega por chrome.storage y vuelve a dibujar el cuadro;
    // aquí solo se atienden las respuestas que no dejan estado (p. ej. muy poco contenido).
    const res = await chrome.runtime.sendMessage({ type: 'summarize', code }).catch(() => null);
    if (!res) why.textContent = 'No hubo respuesta de la extensión. Recarga la extensión en chrome://extensions e inténtalo de nuevo.';
    else if (!res.ok) why.textContent = res.error;
    if (!res?.ok) {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  wrap.append(btn, why);
  return wrap;
}

function renderSummary(m) {
  const box = $('summary');
  const s = m.summary;
  const connected = aiIsConfigured(ai);
  const enough = m.entries.length + (m.chat || []).length >= 3;
  if (!s && !connected) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren(el('h3', '', 'Resumen con IA'));

  if (!s) {
    box.append(
      el('p', 'meta', enough ? 'Aún no hay resumen de esta reunión.' : 'Esta reunión tiene muy poco contenido para resumir.')
    );
    if (enough) box.append(summaryButton('Generar resumen', m.code));
  } else if (s.status === 'working' && Date.now() - s.at < 5 * 60000) {
    box.append(el('p', 'meta', `Generando el resumen con ${AI_PROVIDERS[s.provider]?.name || 'tu IA'}… puede tardar un minuto.`));
  } else if (s.status === 'done') {
    box.append(el('p', 'meta', `${AI_PROVIDERS[s.provider]?.name || 'IA'} · ${s.model || 'modelo por defecto'} · ${new Date(s.at).toLocaleString()} · Generado por IA: puede tener errores, revísalo.`));
    renderSummaryText(s.text, box);
    if (connected && enough) box.append(summaryButton('Regenerar', m.code));
  } else {
    const reason = s.status === 'error' ? s.error : 'La generación se interrumpió.';
    box.append(el('p', 'error', `No se pudo generar el resumen: ${reason}`));
    if (connected && enough) box.append(summaryButton('Reintentar', m.code));
  }
}

// Al abrir la reunión que acaba de terminar, si falta el resumen y la IA está en automático, se pide
// desde aquí también (no depende de que el proceso de fondo siga despierto). Si ya hay uno en
// marcha o hecho, background.js lo ignora.
function autoSummaryIfNeeded() {
  const code = location.hash.slice(1);
  const m = meetings[`meet:${code}`];
  if (!m || !m.endedAt || m.summary || !ai?.auto || !aiIsConfigured(ai)) return;
  chrome.runtime.sendMessage({ type: 'summarize', code, auto: true }).catch(() => {});
}

// --- Modal «Conectar mi IA» ---

const aiDialog = $('aiDialog');
const setAIMsg = (text, kind = '') => {
  $('aiMsg').textContent = text;
  $('aiMsg').className = `aimsg ${kind}`.trim();
};

function syncProviderFields(resetModel) {
  const p = AI_PROVIDERS[$('aiProvider').value];
  $('aiUrlRow').hidden = !p.needsUrl;
  $('aiUrlHint').textContent = p.urlHint || '';
  $('aiModel').placeholder = p.model || (p.optionalModel ? 'proveedor/modelo (opcional)' : 'nombre del modelo');
  if (resetModel) {
    $('aiModel').value = p.model;
    $('aiUrl').value = p.defaultUrl || '';
  }
  $('aiModelHint').textContent = p.modelHint;
  $('aiKeyLabel').textContent = p.keyLabel || 'Clave de API';
  $('aiKey').placeholder = p.keyLabel ? 'Déjalo vacío si no pusiste contraseña' : 'Pega aquí tu clave';
  $('aiOpenCodeBox').hidden = $('aiProvider').value !== 'opencode';
  $('aiOpenCodeConfig').textContent = OPENCODE_CONFIG;
  const link = $('aiKeyLink');
  link.replaceChildren();
  if (p.keyNote) {
    link.append(`· ${p.keyNote}`);
  } else if (p.keyUrl) {
    const a = el('a', '', 'Obtener una clave');
    a.href = p.keyUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    link.append('· ', a);
  } else {
    link.append('· opcional en servicios locales');
  }
}

function openAI() {
  if (aiDialog.open) return;
  $('aiProvider').replaceChildren(
    ...Object.entries(AI_PROVIDERS).map(([id, p]) => {
      const o = el('option', '', p.name);
      o.value = id;
      return o;
    })
  );
  const cfg = ai || {};
  $('aiProvider').value = cfg.provider || 'anthropic';
  syncProviderFields(false);
  $('aiKey').value = cfg.apiKey || '';
  $('aiKey').type = 'password';
  $('aiShowKey').textContent = 'Mostrar';
  $('aiUrl').value = cfg.baseUrl || AI_PROVIDERS[$('aiProvider').value].defaultUrl || '';
  $('aiModel').value = cfg.model ?? AI_PROVIDERS[$('aiProvider').value].model;
  $('aiAuto').checked = cfg.auto !== false;
  $('aiConsent').checked = Boolean(cfg.consentAt);
  $('aiDisconnect').hidden = !ai;
  $('aiTitleText').textContent = aiIsConfigured(ai) ? 'Configurar mi IA' : 'Conectar mi IA';
  $('aiTitleOpt').hidden = aiIsConfigured(ai);
  setAIMsg('');
  aiDialog.showModal();
}

// Lee el formulario; devuelve { config } o { error } con el motivo en español.
function readAIForm() {
  const provider = $('aiProvider').value;
  const p = AI_PROVIDERS[provider];
  const config = {
    provider,
    apiKey: $('aiKey').value.trim(),
    model: $('aiModel').value.trim(),
    baseUrl: $('aiUrl').value.trim().replace(/\/+$/, ''),
    auto: $('aiAuto').checked,
    consentAt: ai?.consentAt || Date.now(),
  };
  if (!$('aiConsent').checked) return { error: 'Marca la casilla de consentimiento para continuar.' };
  if (p.needsKey && !config.apiKey) return { error: 'Pega tu clave de API.' };
  if (!config.model && !p.optionalModel) return { error: 'Escribe el nombre del modelo.' };
  if (p.needsUrl) {
    if (!/^https?:\/\//i.test(config.baseUrl)) return { error: 'La dirección debe empezar por http:// o https://.' };
    // Una clave nunca debe viajar sin cifrar a un servidor remoto.
    if (/^http:\/\//i.test(config.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(config.baseUrl)) {
      return { error: 'Fuera de tu equipo (localhost) la dirección debe ser https://.' };
    }
  } else {
    config.baseUrl = '';
  }
  return { config };
}

function setAIBusy(busy) {
  for (const id of ['aiTest', 'aiSave', 'aiDisconnect', 'aiClose']) $(id).disabled = busy;
}

$('aiOpen').addEventListener('click', openAI);
$('aiClose').addEventListener('click', () => aiDialog.close());
$('aiProvider').addEventListener('change', () => syncProviderFields(true));
$('aiCopyConfig').addEventListener('click', async () => {
  await navigator.clipboard.writeText(OPENCODE_CONFIG);
  $('aiCopyConfig').textContent = 'Copiado ✓';
  setTimeout(() => ($('aiCopyConfig').textContent = 'Copiar configuración'), 1500);
});
$('aiShowKey').addEventListener('click', () => {
  const hidden = $('aiKey').type === 'password';
  $('aiKey').type = hidden ? 'text' : 'password';
  $('aiShowKey').textContent = hidden ? 'Ocultar' : 'Mostrar';
});

$('aiTest').addEventListener('click', async () => {
  const { config, error } = readAIForm();
  if (error) return setAIMsg(error, 'err');
  setAIBusy(true);
  setAIMsg('Probando la conexión…');
  const res = await chrome.runtime.sendMessage({ type: 'ai-test', config }).catch(() => null);
  setAIBusy(false);
  if (res?.ok) setAIMsg('✓ Conexión correcta. La prueba pudo costar una fracción de centavo.', 'ok');
  else setAIMsg(res?.error || 'No se pudo probar la conexión.', 'err');
});

$('aiSave').addEventListener('click', async () => {
  const { config, error } = readAIForm();
  if (error) return setAIMsg(error, 'err');
  await chrome.storage.local.set({ ai: config });
  setAIMsg('Guardado. La próxima reunión que cuelgues se resumirá' + (config.auto ? ' sola.' : ' cuando pulses «Generar resumen».'), 'ok');
  setTimeout(() => aiDialog.close(), 1400);
});

$('aiDisconnect').addEventListener('click', async () => {
  if (!confirm('¿Desconectar tu IA? Se borra la clave guardada. Los resúmenes ya hechos se conservan.')) return;
  await chrome.storage.local.remove('ai');
  aiDialog.close();
});

// --- Compartir el PDF por Google Drive ---
// El PDF se genera aquí mismo (pdf.js), se sube al Drive del usuario y se comparte con quienes marque.
// Meet solo da nombres, no correos: el correo de cada persona se escribe una vez y queda en la clave
// `people` (nombre en minúsculas -> correo) para las próximas reuniones.

const shareDialog = $('shareDialog');
let knownEmails = {};
let driveFolderId = ''; // carpeta «MeetScribe» del Drive del usuario
let shareBusy = false;

const EMAIL_OK = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

async function makePdf(m, withShots) {
  const shots = withShots ? await ShotsDB.list(m.code).catch(() => []) : [];
  return buildMeetingPdf(m, myName, shots, chrome.runtime.getManifest().version);
}

const pdfFileName = (m) => `${meetingTitle(m)} - ${isoDay(new Date(m.startedAt))}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');

function shareRow(name, email, checked, extra = false) {
  const row = el('label', 'share-row');
  row.dataset.name = name;
  row.dataset.extra = extra ? '1' : '';
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  const input = el('input');
  input.type = 'email';
  input.value = email;
  input.placeholder = 'correo@ejemplo.com';
  input.spellcheck = false;
  input.setAttribute('aria-label', `Correo de ${name}`);
  input.addEventListener('input', () => (box.checked = Boolean(input.value.trim())));
  row.append(box, el('span', '', name), input);
  return row;
}

// Quienes se marcaron, con su correo: [{ name, email, extra }]
const chosenRecipients = () =>
  [...$('shareRows').children]
    .filter((row) => row.querySelector('input[type=checkbox]').checked)
    .map((row) => ({ name: row.dataset.name, email: row.querySelector('input[type=email]').value.trim(), extra: Boolean(row.dataset.extra) }));

function shareStatus(text, kind = '') {
  $('shareStatus').textContent = text;
  $('shareStatus').className = `aimsg ${kind}`.trim();
}

$('share').addEventListener('click', () => {
  const m = current();
  if (!m) return;
  const others = attendeesOf(m, myName).filter((n) => n.toLowerCase() !== myName.toLowerCase());
  $('shareRows').replaceChildren(
    ...others.map((n) => {
      const email = knownEmails[n.toLowerCase()] || '';
      return shareRow(n, email, Boolean(email));
    })
  );
  $('shareExtra').value = '';
  $('shareMsgText').value = '';
  $('shareResult').replaceChildren();
  $('shareMain').hidden = false;
  $('shareDone').hidden = true;
  $('shareSetup').hidden = driveConfigured();
  $('shareGo').disabled = !driveConfigured();
  shareStatus('');
  shareDialog.showModal();
});

$('shareAddBtn').addEventListener('click', () => {
  const email = $('shareExtra').value.trim();
  if (!EMAIL_OK.test(email)) return shareStatus('Escribe un correo válido para añadir a esa persona.', 'err');
  shareStatus('');
  $('shareRows').append(shareRow(email, email, true, true));
  $('shareExtra').value = '';
});
$('shareExtra').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('shareAddBtn').click();
  }
});
// Texto del correo de Drive (solo admite texto plano): franja en degradado, datos de la reunión. El enlace no va: Drive ya pone su botón «Abrir».
// Si hay nota personal va arriba. Los saltos de línea los conserva Drive; los emojis y bloques son Unicode.
function driveMessage(m, note) {
  const start = new Date(m.startedAt);
  const end = meetingEnd(m);
  const day = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const hour = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return [
    '░░░▒▒▒▓▓▓███  MEETSCRIBE  ███▓▓▓▒▒▒░░░',
    note ? `\n${note}` : '',
    '\nTe comparto la transcripción y el resumen de la reunión:',
    `✦ ${meetingTitle(m)} ✦`,
    `📅  ${day} · ${hour}`,
    end ? `⏱  ${duration(end.at - m.startedAt)}` : '',
    '\nTranscripción creada con:',
    '░░░▒▒▒▓▓▓███  MEETSCRIBE  ███▓▓▓▒▒▒░░░',
    'https://gospelgeek.github.io/MeetScribe/',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

$('shareForm').addEventListener('submit', (e) => e.preventDefault());
$('shareClose').addEventListener('click', () => shareDialog.close());

$('shareDownload').addEventListener('click', async () => {
  const m = current();
  if (!m || shareBusy) return;
  shareBusy = true;
  shareStatus('Generando el PDF…');
  try {
    download(pdfFileName(m), await makePdf(m, $('shareShots').checked), 'application/pdf');
    shareStatus('PDF descargado.', 'ok');
  } catch (e) {
    shareStatus(`No se pudo generar el PDF: ${e.message}`, 'err');
  } finally {
    shareBusy = false;
  }
});

$('shareGo').addEventListener('click', async () => {
  const m = current();
  if (!m || shareBusy) return;
  const chosen = chosenRecipients();
  const bad = chosen.find((r) => !EMAIL_OK.test(r.email));
  if (!chosen.length) return shareStatus('Marca al menos a una persona y escribe su correo.', 'err');
  if (bad) return shareStatus(`Falta un correo válido para ${bad.name}.`, 'err');
  const unique = [...new Map(chosen.map((r) => [r.email.toLowerCase(), r])).values()];
  const role = $('shareRole').value;
  const list = unique.map((r) => `• ${r.name === r.email ? r.email : `${r.name} (${r.email})`}`).join('\n');
  const again = m.drive ? 'Ya hay un PDF de esta reunión en tu Drive: se actualizará con el contenido actual, con el mismo enlace.\n\n' : '';
  if (!confirm(`${again}Se subirá el PDF de la reunión a la carpeta MeetScribe de tu Google Drive y se compartirá con:\n\n${list}\n\nQuien no tuviera acceso recibirá un correo de Drive con el enlace. ¿Continuar?`)) return;

  shareBusy = true;
  $('shareGo').disabled = true;
  $('shareResult').replaceChildren();
  try {
    shareStatus('Generando el PDF…');
    const bytes = await makePdf(m, $('shareShots').checked);
    shareStatus('Conectando con Google…');
    const token = await driveAuth();
    // Si la reunión ya tiene su PDF en Drive se actualiza el mismo archivo (mismo enlace y mismos accesos).
    shareStatus(m.drive ? 'Actualizando el PDF en tu Drive…' : 'Subiendo el PDF a tu Drive…');
    const folder = await driveFolder(token, driveFolderId);
    if (folder !== driveFolderId) await chrome.storage.local.set({ driveFolder: folder });
    let file = m.drive ? await driveUpdate(token, m.drive.id, bytes) : null;
    const had = file ? { ...m.drive.sharedWith } : {};
    const out = el('ul');
    if (!file) file = await driveUpload(token, pdfFileName(m), bytes, folder);
    else if (!file.parents?.includes(folder)) {
      // PDF subido antes de que existiera la carpeta: se pasa a ella (el enlace no cambia).
      try {
        await driveMove(token, file.id, folder, file.parents);
      } catch (e) {
        out.append(el('li', 'bad', e.message));
      }
    }

    const shared = [];
    let failed = 0;
    const note = driveMessage(m, $('shareMsgText').value.trim());
    for (const [i, r] of unique.entries()) {
      shareStatus(`Compartiendo (${i + 1} de ${unique.length})…`);
      const key = r.email.toLowerCase();
      if (had[key] === role) {
        shared.push(r);
        out.append(el('li', '', `${r.email} ya tenía acceso`));
        continue;
      }
      try {
        await driveShare(token, file.id, r.email, role, note);
        shared.push(r);
        had[key] = role;
        out.append(el('li', '', `Compartido con ${r.email}`));
      } catch (e) {
        failed++;
        out.append(el('li', 'bad', e.message));
      }
    }
    // El enlace queda guardado con la reunión y se muestra en su página.
    await chrome.storage.local.set({ [`drive:${m.code}`]: { id: file.id, link: file.webViewLink, name: file.name, folder, at: Date.now(), sharedWith: had } });
    // Se recuerdan los correos de los participantes a quienes sí se compartió (nombre -> correo).
    const learned = { ...knownEmails };
    for (const r of shared) if (!r.extra) learned[r.name.toLowerCase()] = r.email;
    await chrome.storage.local.set({ people: learned });

    const link = el('a', '', 'Abrir el PDF en Drive');
    link.href = file.webViewLink;
    link.target = '_blank';
    link.rel = 'noopener';
    // La ventana cambia a un resumen: lo hecho, el enlace y cerrar (con «Volver» si algo falló).
    const done = $('shareDone');
    const closeBtn = el('button', 'primary-btn', 'Cerrar');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => shareDialog.close());
    const actions = el('div', 'dialog-actions');
    actions.append(el('span', 'spacer'));
    if (failed) {
      const back = el('button', '', 'Volver');
      back.type = 'button';
      back.addEventListener('click', () => {
        $('shareResult').replaceChildren();
        shareStatus('');
        $('shareDone').hidden = true;
        $('shareMain').hidden = false;
      });
      actions.append(back);
    }
    actions.append(closeBtn);
    done.replaceChildren(
      el('div', failed ? 'share-mark bad' : 'share-mark', failed ? '!' : '✓'),
      el('h2', '', failed ? 'Quedó compartido, con avisos' : 'Listo, quedó compartido'),
      out,
      link,
      actions
    );
    $('shareMain').hidden = true;
    done.hidden = false;
    closeBtn.focus();
  } catch (e) {
    shareStatus(e instanceof DriveError ? e.message : `No se pudo compartir: ${e.message}`, 'err');
  } finally {
    shareBusy = false;
    $('shareGo').disabled = !driveConfigured();
  }
});

// --- Enviar por correo ---
// Abre Gmail con el correo ya redactado; el usuario lo envía desde su cuenta. La transcripción nunca va
// en el mensaje (solo, si se quiere, el resumen de la IA). Los contactos viven en la clave `contacts`.

const mailDialog = $('mailDialog');
const MAIL_BODY_MAX = 6000; // el mensaje viaja en la URL de Gmail: más largo se corta
let contacts = [];
let mailField = $('mailTo');
let mailEdited = false;

// Acepta «a@x.com, b@y.com» y también «Nombre <a@x.com>» (como las copia Gmail).
const addressesOf = (text) =>
  text
    .split(/[,;]+/)
    .flatMap((part) => {
      const angled = part.match(/<([^<>]*)>/);
      return angled ? [angled[1]] : part.split(/\s+/);
    })
    .map((s) => s.trim())
    .filter(Boolean);
const isEmail = (s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

function summaryPlain(m) {
  return m.summary.text
    .split('\n')
    .map((raw) => raw.trim().replace(/\*\*/g, ''))
    .map((line) => (line.startsWith('## ') ? `\n${line.slice(3)}:` : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mailDraft() {
  const m = current();
  const day = new Date(m.startedAt).toLocaleDateString();
  const pdf = m.drive ? `\nTranscripción en PDF: ${m.drive.link}\n` : '';
  if (!$('mailSummary').checked || m.summary?.status !== 'done') return `Hola,\n\nTe escribo sobre la reunión «${meetingTitle(m)}» del ${day}.\n${pdf}`;
  return `Hola,\n\nTe comparto el resumen de la reunión «${meetingTitle(m)}» del ${day}.\n\n${summaryPlain(m)}\n${pdf}`;
}

function renderContacts() {
  $('mailContacts').replaceChildren(
    ...contacts.map((email) => {
      const chip = el('span', 'contact');
      const add = el('button', '', email);
      add.type = 'button';
      add.title = 'Añadir al correo';
      add.addEventListener('click', () => {
        const list = addressesOf(mailField.value);
        if (!list.includes(email)) list.push(email);
        mailField.value = list.join(', ');
        mailField.focus();
      });
      const del = el('button', 'del', '×');
      del.type = 'button';
      del.title = 'Quitar de los contactos guardados';
      del.setAttribute('aria-label', `Quitar ${email}`);
      del.addEventListener('click', () => chrome.storage.local.set({ contacts: contacts.filter((c) => c !== email) }));
      chip.append(add, del);
      return chip;
    })
  );
}

$('mail').addEventListener('click', () => {
  const m = current();
  if (!m) return;
  const hasSummary = m.summary?.status === 'done' && Boolean(m.summary.text);
  $('mailTo').value = '';
  $('mailCc').value = '';
  mailField = $('mailTo');
  $('mailSubject').value = `${meetingTitle(m)} - ${isoDay(new Date(m.startedAt))}`;
  $('mailSummaryRow').hidden = !hasSummary;
  $('mailSummary').checked = hasSummary;
  $('mailBody').value = mailDraft();
  mailEdited = false;
  $('mailMsg').textContent = '';
  $('mailMsg').className = 'aimsg';
  renderContacts();
  mailDialog.showModal();
  $('mailTo').focus();
});
$('mailForm').addEventListener('submit', (e) => e.preventDefault()); // Enter en un campo no cierra el diálogo
$('mailTo').addEventListener('focus', () => (mailField = $('mailTo')));
$('mailCc').addEventListener('focus', () => (mailField = $('mailCc')));
$('mailBody').addEventListener('input', () => (mailEdited = true));
$('mailSummary').addEventListener('change', () => {
  if (mailEdited && !confirm('Esto reemplaza el mensaje que editaste. ¿Continuar?')) {
    $('mailSummary').checked = !$('mailSummary').checked;
    return;
  }
  $('mailBody').value = mailDraft();
  mailEdited = false;
});
$('mailTxt').addEventListener('click', () => $('dlTxt').click());
$('mailPdf').addEventListener('click', () => $('dlPdf').click());
$('mailClose').addEventListener('click', () => mailDialog.close());

$('mailOpen').addEventListener('click', async () => {
  const msg = $('mailMsg');
  const fail = (text) => {
    msg.textContent = text;
    msg.className = 'aimsg err';
  };
  const to = addressesOf($('mailTo').value);
  const cc = addressesOf($('mailCc').value);
  const bad = [...to, ...cc].filter((a) => !isEmail(a));
  if (!to.length) return fail('Escribe a quién se lo envías en «Para».');
  if (bad.length) return fail(`Esta dirección no parece válida: ${bad[0]}`);

  let body = $('mailBody').value;
  let cut = false;
  if (body.length > MAIL_BODY_MAX) {
    body = `${body.slice(0, body.lastIndexOf('\n', MAIL_BODY_MAX) > 0 ? body.lastIndexOf('\n', MAIL_BODY_MAX) : MAIL_BODY_MAX)}\n[…]`;
    cut = true;
  }
  const url =
    'https://mail.google.com/mail/?view=cm&fs=1' +
    `&to=${encodeURIComponent(to.join(','))}` +
    (cc.length ? `&cc=${encodeURIComponent(cc.join(','))}` : '') +
    `&su=${encodeURIComponent($('mailSubject').value)}` +
    `&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank', 'noopener');

  const known = [...new Set([...contacts, ...to, ...cc])];
  if (known.length !== contacts.length) await chrome.storage.local.set({ contacts: known });
  msg.textContent = cut ? 'Gmail se abrió, pero el mensaje era muy largo y se recortó. Revísalo antes de enviar.' : 'Se abrió Gmail en otra pestaña. Revisa el correo y envíalo desde allí.';
  msg.className = cut ? 'aimsg err' : 'aimsg ok';
});

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('printVersion').textContent = $('version').textContent;
showUpdate($('update'));

// Se actualiza sola mientras se transcribe una reunión.
chrome.storage.onChanged.addListener(load);

load().then(() => {
  selectFromHash();
  autoSummaryIfNeeded();
  if (location.hash === '#ia') openAI(); // el popup abre esta página con #ia
});
