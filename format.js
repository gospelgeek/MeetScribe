// Formatos de exportación compartidos por el popup, la página de reuniones y el content script.

const SELF = /^(you|tú|tu|usted)(\s*\(.*\))?$/i;

const speakerName = (raw, myName) => (myName && SELF.test(raw) ? myName : raw);

// Color de un nombre: siempre el mismo tono (en pantalla y en el PDF).
const hueFor = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};
const colorFor = (name) => `hsl(${hueFor(name)} 60% 48%)`;

function clock(ms, start) {
  const s = Math.max(0, Math.round((ms - start) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// Sin actividad durante más de esto, se da la reunión por terminada aunque no se haya visto el cierre.
const STALE_MS = 3 * 60 * 1000;

// Nombre del evento si lo hay (o el que puso el usuario); si no, el código (reunión improvisada).
const meetingTitle = (m) => m.customTitle || m.title || m.code;

// Fin de la reunión: exacto si se detectó al colgar; aproximado (última actividad) si el navegador
// se cerró de golpe; null si sigue en curso.
function meetingEnd(m) {
  if (m.endedAt) return { at: m.endedAt, approx: false };
  const last = m.lastSeen || m.entries[m.entries.length - 1]?.ts;
  if (last && Date.now() - last > STALE_MS) return { at: last, approx: true };
  return null;
}

function duration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

// "Duración: 30 min" o "Duración aprox.: 30 min"; null si la reunión sigue en curso.
function durationLabel(m) {
  const end = meetingEnd(m);
  return end ? `Duración${end.approx ? ' aprox.' : ''}: ${duration(end.at - m.startedAt)}` : null;
}

function endLabel(m) {
  const end = meetingEnd(m);
  if (!end) return 'en curso';
  const d = new Date(end.at);
  const text = d.toDateString() === new Date(m.startedAt).toDateString() ? d.toLocaleTimeString() : d.toLocaleString();
  return end.approx ? `${text} (aprox.)` : text;
}

// Participantes = quienes aparecen en la lista de participantes (si estuvo abierta) + quienes hablaron + tú.
function attendeesOf(m, myName) {
  const seen = new Set();
  const out = [];
  const chatters = (m.chat || []).map((c) => c.speaker).filter((n) => n !== 'Sin nombre');
  for (const raw of [...(m.attendees || []), ...m.entries.map((e) => e.speaker), ...chatters, myName]) {
    if (!raw) continue;
    if (!myName && SELF.test(raw)) continue; // "You" sin saber el nombre real no es un nombre
    const name = speakerName(raw, myName);
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

function header(m, myName) {
  const title = meetingTitle(m);
  const end = meetingEnd(m);
  const people = attendeesOf(m, myName);
  return (
    [
      `Reunión: ${title}`,
      title !== m.code ? `Código: ${m.code}` : null,
      `Inicio: ${new Date(m.startedAt).toLocaleString()}`,
      `Fin: ${endLabel(m)}`,
      durationLabel(m),
      `Participantes (${people.length}): ${people.join(', ') || 'sin datos'}`,
    ]
      .filter(Boolean)
      .join('\n') + '\n\n'
  );
}

// Línea de cierre al final de la transcripción.
function footer(m) {
  const end = meetingEnd(m);
  if (!end) return '--- La reunión sigue en curso ---';
  return `--- Fin de la reunión: ${endLabel(m)} · duración ${duration(end.at - m.startedAt)} ---`;
}

// Meet pinta dos veces los mensajes propios (el envío y su confirmación, con ids distintos).
// Un mensaje propio con el mismo texto que otro propio de hace menos de 15 s es ese duplicado.
const isDuplicateChat = (list, c) =>
  SELF.test(c.speaker) &&
  list.some((o) => SELF.test(o.speaker) && o.text === c.text && Math.abs(o.ts - c.ts) < 15000);

const uniqueChat = (chat) => {
  const kept = [];
  for (const c of chat) if (!isDuplicateChat(kept, c)) kept.push(c);
  return kept;
};

// Mensajes del chat, uno por línea; vacío si no hubo chat.
function chatSection(m, myName) {
  const chat = uniqueChat(m.chat || []);
  if (!chat.length) return '';
  const lines = chat.map((c) => `[${clock(c.ts, m.startedAt)}] ${speakerName(c.speaker, myName)}: ${c.text}`);
  return `\n\n--- Chat de la reunión (${chat.length} ${chat.length === 1 ? 'mensaje' : 'mensajes'}) ---\n${lines.join('\n')}`;
}

// Resumen generado con la IA del usuario (si lo hay); vacío si no.
function summarySection(m) {
  return m.summary?.status === 'done' && m.summary.text
    ? `--- Resumen generado con IA (${m.summary.model}) ---
${m.summary.text}

--- Transcripción ---
`
    : '';
}

function asChronological(m, myName) {
  return (
    header(m, myName) +
    summarySection(m) +
    m.entries.map((e) => `[${clock(e.ts, m.startedAt)}] ${speakerName(e.speaker, myName)}: ${e.text}`).join('\n') +
    chatSection(m, myName) +
    `\n\n${footer(m)}\n`
  );
}

function meetingObject(m, myName) {
  const end = meetingEnd(m);
  return {
    title: meetingTitle(m),
    meeting: m.code,
    startedAt: new Date(m.startedAt).toISOString(),
    endedAt: end ? new Date(end.at).toISOString() : null,
    endedApprox: end ? end.approx : null,
    durationMinutes: end ? Math.round((end.at - m.startedAt) / 60000) : null,
    attendees: attendeesOf(m, myName),
    summary: m.summary?.status === 'done' ? { text: m.summary.text, model: m.summary.model, provider: m.summary.provider } : null,
    entries: m.entries.map((e) => ({
      time: clock(e.ts, m.startedAt),
      speaker: speakerName(e.speaker, myName),
      text: e.text,
    })),
    chat: uniqueChat(m.chat || []).map((c) => ({
      time: clock(c.ts, m.startedAt),
      speaker: speakerName(c.speaker, myName),
      text: c.text,
    })),
  };
}

const asJson = (m, myName) => JSON.stringify(meetingObject(m, myName), null, 2);

// Varias reuniones en un solo archivo (descarga por ventana de tiempo).
const asJsonMany = (list, myName) => JSON.stringify(list.map((m) => meetingObject(m, myName)), null, 2);

const asChronologicalMany = (list, myName) =>
  list.map((m) => asChronological(m, myName)).join(`\n${'='.repeat(60)}\n\n`);

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
