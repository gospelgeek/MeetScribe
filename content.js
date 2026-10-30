// Lee los subtítulos en vivo de Google Meet (que ya incluyen el nombre de quien habla)
// y los guarda en chrome.storage.local, uno por reunión.
//
// Si Google cambia el HTML de Meet, ajustar SELECTORS y parseRow().

(() => {
  console.log('[Transcriptor] cargado en', location.href);

  const SELECTORS = {
    region: 'div[role="region"][aria-label*="aption" i], div[role="region"][aria-label*="ubtítulo" i]',
    row: '.nMcdL',
  };

  // Meet es una SPA: entrar a la llamada cambia la URL sin recargar, así que el código
  // de reunión se lee en cada escaneo. Formatos: /abc-defg-hij y /meet/abc-defg-hij
  const currentCode = () =>
    location.pathname.match(/(?:^|\/)([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/)?.[1];

  let meeting = null;
  let loadingFor = null;
  let wasInCall = false; // se vio la llamada en curso (necesario para dar por terminada una reunión)
  let leaveTimer = null;

  function syncMeeting() {
    const code = currentCode();
    if (!code) {
      markEnded('salió de la página de la reunión');
      meeting = null;
      return false;
    }
    if (meeting?.code === code) return true;
    if (meeting) markEnded('cambió de reunión');
    if (loadingFor === code) return false;
    loadingFor = code;
    chrome.storage.local.get(`meet:${code}`, (data) => {
      // reingreso a la misma reunión: se continúa donde quedó
      meeting = data[`meet:${code}`] || { code, startedAt: Date.now(), entries: [] };
      meeting.attendees ||= [];
      meeting.chat ||= [];
      loadingFor = null;
      console.log('[Transcriptor] reunión', code);
      scan();
    });
    return false;
  }

  const rowEntries = new WeakMap(); // fila del DOM -> entrada guardada
  let saveTimer = null;
  let scanTimer = null;
  let settings = { autoCaptions: true, screenshots: true, openOnEnd: true };

  // Screenshot automático: el primero a los 10 min de empezar y luego uno cada 30 min.
  // Si en ese momento la pestaña no está a la vista, se reintenta en cuanto vuelva a estarlo.
  const FIRST_SHOT_MS = 10 * 60000;
  const NEXT_SHOT_MS = 30 * 60000;
  let lastShotTry = 0;

  function shotTick() {
    if (!settings.screenshots || !meeting || !wasInCall || document.visibilityState !== 'visible') return;
    meeting.nextShot ||= meeting.startedAt + FIRST_SHOT_MS;
    const now = Date.now();
    if (now < meeting.nextShot || now - lastShotTry < 30000) return;
    lastShotTry = now;
    const m = meeting;
    try {
      chrome.runtime.sendMessage({ type: 'shot', code: m.code }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          console.warn('[Transcriptor] screenshot automático no guardado:', chrome.runtime.lastError?.message || res?.reason);
          return;
        }
        playShutter();
        m.nextShot = Date.now() + NEXT_SHOT_MS;
        m.shots = (m.shots || 0) + 1;
        if (m === meeting) scheduleSave();
        console.log('[Transcriptor] screenshot guardado');
      });
    } catch {
      // Contexto de la extensión invalidado (se recargó); la página debe refrescarse.
    }
  }

  const badge = document.createElement('div');
  badge.style.cssText =
    'position:fixed;left:12px;bottom:84px;z-index:2147483647;padding:6px 12px;border-radius:12px;' +
    'background:#202124;color:#e8eaed;font:12px system-ui,sans-serif;opacity:.9;display:none';
  document.documentElement.appendChild(badge);
  badge.addEventListener('click', () => {
    if (badge.dataset.state === 'prompt') {
      const btn = findCaptionsButton();
      if (btn) btn.click();
      else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
    }
    console.log('[Transcriptor] botón CC:', findCaptionsButton() || 'no encontrado');
  });

  // state: 'capturing' | 'prompt' (subtítulos apagados) | 'hidden' (no hay llamada)
  function updateBadge(state) {
    badge.dataset.state = state;
    badge.style.display = state === 'hidden' ? 'none' : 'block';
    badge.style.pointerEvents = state === 'prompt' ? 'auto' : 'none';
    badge.style.cursor = state === 'prompt' ? 'pointer' : 'default';
    badge.style.background = state === 'prompt' ? '#b3261e' : '#202124';
    badge.textContent =
      state === 'capturing'
        ? `● Transcribiendo (${meeting.entries.length} intervenciones)`
        : '○ Subtítulos apagados: clic aquí (o pulsa la tecla C) para activarlos y transcribir';
  }

  // Botón CC de Meet, solo si los subtítulos están apagados. Se reconoce por su etiqueta o, si la
  // etiqueta no dice nada, por el icono de Material que lleva dentro (texto «closed_caption…»).
  function findCaptionsButton() {
    return [...document.querySelectorAll('button, [role="button"]')].find((b) => {
      const label = b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '';
      if (/setting|configuraci|language|idioma/i.test(label)) return false;
      if (/caption|subt[ií]tulo/i.test(label)) {
        return b.getAttribute('aria-pressed') === 'false' || /turn on|activar/i.test(label);
      }
      return /closed_caption/.test(b.textContent || '') && b.getAttribute('aria-pressed') !== 'true';
    });
  }

  // Para el diagnóstico en consola: etiqueta e icono de cada botón de la página.
  const describeButtons = () =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => {
        const label = b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '';
        const icon = (b.querySelector('i, [class*="material"]')?.textContent || '').trim().slice(0, 30);
        return [label, icon && `[${icon}]`].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .slice(0, 60);

  // Botón para tomar un screenshot cuando se quiera. Flota junto al primer botón de la barra de
  // la reunión (Meet reconstruye esa barra, así que no se inserta dentro de ella). Si no la halla,
  // queda abajo a la izquierda. Aparece mientras se está en la llamada.
  const SVG = 'http://www.w3.org/2000/svg';
  const shotBtn = document.createElement('button');
  shotBtn.type = 'button';
  shotBtn.title = 'Tomar screenshot';
  shotBtn.setAttribute('aria-label', 'Tomar screenshot');
  shotBtn.style.cssText =
    'position:fixed;z-index:2147483647;width:48px;height:48px;padding:0;border:0;border-radius:50%;' +
    'display:none;align-items:center;justify-content:center;background:#3c4043;color:#e8eaed;' +
    'cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4)';
  const icon = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', fill: 'currentColor' })) icon.setAttribute(k, v);
  const lens = document.createElementNS(SVG, 'circle');
  for (const [k, v] of Object.entries({ cx: '12', cy: '13', r: '3.5' })) lens.setAttribute(k, v);
  const body = document.createElementNS(SVG, 'path');
  body.setAttribute('d', 'M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 15.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z');
  icon.append(body, lens);
  shotBtn.append(icon);
  shotBtn.addEventListener('mouseenter', () => { shotBtn.style.background = '#4a4d51'; });
  shotBtn.addEventListener('mouseleave', () => { shotBtn.style.background = '#3c4043'; });
  document.documentElement.appendChild(shotBtn);

  // Primer botón del grupo de controles: el ancestro más cercano al de «salir» con 5+ botones.
  function firstToolbarButton() {
    for (let el = findLeaveButton()?.parentElement; el && el !== document.body; el = el.parentElement) {
      const buttons = el.querySelectorAll('button');
      if (buttons.length >= 5) return buttons[0];
    }
    return null;
  }

  function placeShotButton() {
    const show = Boolean(meeting && isInCall());
    shotBtn.style.display = show ? 'flex' : 'none';
    if (!show) return;
    const r = firstToolbarButton()?.getBoundingClientRect();
    if (r && r.width > 0 && r.top < innerHeight - 8) {
      shotBtn.style.left = `${Math.max(8, r.left - 56)}px`;
      shotBtn.style.top = `${r.top + r.height / 2 - 24}px`;
      shotBtn.style.bottom = 'auto';
    } else {
      shotBtn.style.left = '12px';
      shotBtn.style.top = 'auto';
      shotBtn.style.bottom = '16px';
    }
  }

  // Sonido de obturador, sintetizado (dos clics cortos de ruido filtrado): confirma que se guardó.
  function playShutter() {
    try {
      const ctx = new AudioContext();
      const rate = ctx.sampleRate;
      const buf = ctx.createBuffer(1, Math.round(rate * 0.2), rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        const hit = t < 0.045 ? 1 - t / 0.045 : t > 0.09 && t < 0.15 ? 1 - (t - 0.09) / 0.06 : 0;
        data[i] = (Math.random() * 2 - 1) * hit * hit;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2800;
      const gain = ctx.createGain();
      gain.gain.value = 0.6;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.onended = () => ctx.close();
      src.start();
    } catch {
      // Sin audio disponible: el aviso visual basta.
    }
  }

  function flashShotButton(ok, message) {
    shotBtn.style.background = ok ? '#188038' : '#b3261e';
    shotBtn.title = message;
    setTimeout(() => {
      shotBtn.style.background = '#3c4043';
      shotBtn.title = 'Tomar screenshot';
    }, 1800);
  }

  shotBtn.addEventListener('click', () => {
    const m = meeting;
    if (!m) return;
    // El botón se esconde un instante para que no salga en la captura.
    shotBtn.style.visibility = 'hidden';
    setTimeout(() => {
      try {
        chrome.runtime.sendMessage({ type: 'shot', code: m.code }, (res) => {
          shotBtn.style.visibility = 'visible';
          if (chrome.runtime.lastError || !res?.ok) {
            const why = chrome.runtime.lastError?.message || res?.reason || 'sin respuesta';
            console.warn('[Transcriptor] screenshot no guardado:', why);
            return flashShotButton(false, `No se pudo tomar el screenshot: ${why}`);
          }
          playShutter();
          m.shots = (m.shots || 0) + 1;
          if (m === meeting) scheduleSave();
          flashShotButton(true, 'Screenshot guardado');
        });
      } catch {
        shotBtn.style.visibility = 'visible';
        flashShotButton(false, 'Recarga la pestaña de Meet para seguir tomando screenshots');
      }
    }, 120);
  });
  window.addEventListener('resize', placeShotButton);

  function save() {
    if (!meeting) return;
    try {
      chrome.storage.local.set({ [`meet:${meeting.code}`]: meeting });
    } catch {
      // Contexto de la extensión invalidado (se recargó); la página debe refrescarse.
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1000);
  }

  function getRows(region) {
    const known = [...region.querySelectorAll(SELECTORS.row)];
    if (known.length) return known;
    // Alternativa estructural: cada fila tiene el avatar (img) junto al nombre.
    return [...region.querySelectorAll('img')]
      .map((img) => img.parentElement?.parentElement)
      .filter(Boolean);
  }

  // Fila = [bloque con avatar + nombre] [bloque con el texto]
  function parseRow(row) {
    const first = row.firstElementChild;
    const last = row.lastElementChild;
    if (!first || !last || first === last) return null;
    const name = (first.textContent || '').trim();
    const text = (last.innerText || last.textContent || '').trim();
    return name && text ? { name, text } : null;
  }

  // Meet reescribe el texto de la fila mientras la persona habla: crece, se corrige
  // o pierde palabras del inicio cuando es muy largo. Combina sin perder texto.
  function mergeText(oldText, newText) {
    if (newText === oldText || oldText.startsWith(newText)) return oldText;
    if (newText.startsWith(oldText)) return newText;
    const a = oldText.split(/\s+/);
    const b = newText.split(/\s+/);
    for (let k = Math.min(a.length, b.length); k >= 2; k--) {
      if (a.slice(-k).join(' ') === b.slice(0, k).join(' ')) {
        return [...a, ...b.slice(k)].join(' ');
      }
    }
    return newText; // corrección de palabras: se reemplaza
  }

  // Lee el nombre de la cuenta de Google desde el botón de cuenta de Meet
  // ("Cuenta de Google: Nombre Apellido (correo)") y lo guarda como "mi nombre".
  function detectMyName() {
    if (settings.myName) return;
    for (const node of document.querySelectorAll('[aria-label*="Google Account" i], [aria-label*="Cuenta de Google" i]')) {
      const found = node.getAttribute('aria-label').match(/(?:Google Account|Cuenta de Google)\s*:\s*([^\n(]+)/i)?.[1]?.trim();
      if (!found) continue;
      settings.myName = found;
      try {
        chrome.storage.local.get('settings', (data) =>
          chrome.storage.local.set({ settings: { ...data.settings, myName: found } })
        );
      } catch {
        // Contexto invalidado
      }
      return;
    }
  }

  // --- Nombre de la reunión, participantes y fin ---

  const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

  // Reunión de calendario: la pestaña lleva el nombre del evento ("Nombre - Google Meet").
  // Improvisada: lleva el código o solo "Meet"; en ese caso no hay nombre y se usa el código.
  function readTitle() {
    const t = document.title
      .replace(/^Meet\s*[–—-]\s*/i, '')
      .replace(/\s*[–—-]\s*(Google\s+)?Meet$/i, '')
      .trim();
    return t && !CODE_RE.test(t) && !/^(google\s+)?meet$/i.test(t) ? t : null;
  }

  // Lista de participantes de Meet: solo existe en el DOM cuando el panel «Personas» está abierto.
  function collectAttendees() {
    let added = false;
    const known = new Set(meeting.attendees.map((n) => n.toLowerCase()));
    for (const node of document.querySelectorAll('[role="list"][aria-label*="articipa" i] [role="listitem"]')) {
      const name = (node.getAttribute('aria-label') || '')
        .replace(/\s*\((you|tú|tu)\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!name || name.length > 80 || SELF.test(name) || known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());
      meeting.attendees.push(name);
      added = true;
    }
    return added;
  }

  // --- Chat de la reunión ---
  // Los mensajes solo existen en el DOM mientras el panel de chat está abierto. Cada mensaje es un
  // div[data-message-id] con el texto en [jsname="dTKtvb"]. El id termina en microsegundos desde 1970:
  // sirve de hora exacta y para no guardar dos veces el mismo mensaje.
  const groupSender = new WeakMap(); // grupo de mensajes del DOM -> nombre de quien escribe
  const warned = new WeakSet(); // grupos para los que ya se avisó en consola que falta el nombre

  // Estructura de un grupo de mensajes (visto en Meet):
  //   [img avatar]  <- solo en mensajes de otras personas
  //   div.aops0b > div.HNucUd > ( div.poVWob = nombre , div[jsname=biJjHb] = hora )
  //              > div.beTDc > div[data-message-id] ...
  // Tus propios mensajes no traen ni nombre ni avatar.
  // Devuelve el nombre, 'Tú' (mensaje propio) o null (otra persona, pero sin nombre a la vista).
  function findSender(group) {
    const head = group.firstElementChild;
    const named =
      group.querySelector('.poVWob')?.textContent.trim() ||
      [...(head?.children || [])].find((c) => c.getAttribute('jsname') !== 'biJjHb' && c.textContent.trim())?.textContent.trim();
    if (named) return named;
    return group.previousElementSibling?.tagName === 'IMG' ? null : 'Tú';
  }

  function collectChat() {
    let added = false;
    const known = new Set(meeting.chat.map((c) => c.id));
    for (const node of document.querySelectorAll('div[data-message-id]')) {
      const id = node.getAttribute('data-message-id');
      const body = node.querySelector('[jsname="dTKtvb"]');
      if (!body || known.has(id)) continue;
      const text = (body.innerText || body.textContent || '').trim();
      if (!text) continue;

      // div[data-message-id] > div.beTDc > div.aops0b
      const group = node.closest('.aops0b') || node.parentElement?.parentElement;
      let sender = group && groupSender.get(group);
      if (!sender && group) {
        sender = findSender(group);
        if (sender) {
          groupSender.set(group, sender);
        } else {
          // Otra persona cuyo nombre no se ve (grupo de continuación): se usa la última que escribió.
          sender = [...meeting.chat].reverse().find((c) => !SELF.test(c.speaker) && c.speaker !== 'Sin nombre')?.speaker;
          if (!sender && !warned.has(group)) {
            warned.add(group);
            console.warn('[Transcriptor] chat: no encontré el nombre. HTML del contenedor:', group.parentElement?.outerHTML.slice(0, 1500));
          }
        }
      }

      const micros = Number(id.split('/').pop());
      const ts = micros > 1e15 && micros < (Date.now() + 864e5) * 1000 ? Math.round(micros / 1000) : Date.now();
      known.add(id);
      const msg = { id, ts, speaker: sender || 'Sin nombre', text };
      if (isDuplicateChat(meeting.chat, msg)) continue;
      meeting.chat.push(msg);
      added = true;
    }
    if (added) meeting.chat.sort((a, b) => a.ts - b.ts);
    return added;
  }

  const findLeaveButton = () =>
    [...document.querySelectorAll('button[aria-label]')].find((b) =>
      /leave call|abandonar (la )?llamada|salir de la llamada|dejar la llamada|colgar/i.test(b.getAttribute('aria-label'))
    );

  // Pantalla posterior a colgar: Meet ofrece volver a entrar.
  const findRejoin = () =>
    [...document.querySelectorAll('button')].find((b) =>
      /rejoin|volver a unirte|volver a entrar|unirse de nuevo/i.test(b.getAttribute('aria-label') || b.textContent || '')
    );

  const isInCall = () => Boolean(findLeaveButton() || document.querySelector(SELECTORS.region));

  // Al colgar se abre la página de reuniones con esta transcripción a la vista.
  let lastShown = 0;
  function showTranscript(code) {
    if (!settings.openOnEnd || Date.now() - lastShown < 60000) return; // una sola vez por salida
    lastShown = Date.now();
    try {
      chrome.runtime.sendMessage({ type: 'ended', code });
    } catch {
      // Contexto de la extensión invalidado (se recargó); la página debe refrescarse.
    }
  }

  function markEnded(reason, colgo = false) {
    if (!meeting || !wasInCall) return; // nunca se vio la llamada (p. ej. se quedó en la sala de espera)
    wasInCall = false;
    clearTimeout(leaveTimer);
    leaveTimer = null;
    meeting.endedAt = Date.now();
    console.log('[Transcriptor] fin de la reunión:', reason);
    save();
    if (colgo) showTranscript(meeting.code);
  }

  function trackCall() {
    if (isInCall()) {
      wasInCall = true;
      clearTimeout(leaveTimer);
      leaveTimer = null;

      let dirty = false;
      const now = Date.now();
      if (meeting.endedAt) {
        meeting.endedAt = null; // volvió a entrar
        dirty = true;
      }
      if (now - (meeting.lastSeen || 0) > 30000) {
        meeting.lastSeen = now;
        dirty = true;
      }
      const title = readTitle();
      if (title && title !== meeting.title) {
        meeting.title = title;
        dirty = true;
      }
      if (collectAttendees()) dirty = true;
      if (dirty) scheduleSave();
      return;
    }
    if (!wasInCall) return;
    if (findRejoin()) {
      markEnded('pantalla de «volver a unirte»', true);
    } else if (!leaveTimer) {
      // Margen por si la barra de controles se oculta un instante.
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (!isInCall()) markEnded('la llamada ya no está en pantalla', true);
      }, 6000);
    }
  }

  function scan() {
    detectMyName();
    if (!syncMeeting()) {
      updateBadge('hidden');
      placeShotButton();
      return;
    }
    trackCall();
    placeShotButton();
    if (collectChat()) scheduleSave();
    const region = document.querySelector(SELECTORS.region);
    if (!region) {
      // Sin subtítulos visibles se avisa, aunque no se halle el botón, pero solo ya dentro de la
      // llamada: en la vista previa de la cámara (antes de entrar) no hay nada que activar.
      updateBadge(isInCall() ? 'prompt' : 'hidden');
      return;
    }
    updateBadge('capturing');

    let changed = false;
    for (const row of getRows(region)) {
      const parsed = parseRow(row);
      if (!parsed) continue;

      // raw = nombre tal como lo muestra Meet ("You"/"Tú" para uno mismo);
      // speaker = nombre real, que es el que se guarda.
      let entry = rowEntries.get(row);
      if (!entry || entry.raw !== parsed.name) {
        entry = {
          raw: parsed.name,
          speaker: speakerName(parsed.name, settings.myName),
          text: parsed.text,
          ts: Date.now(),
        };
        meeting.entries.push(entry);
        rowEntries.set(row, entry);
        changed = true;
      } else {
        const speaker = speakerName(entry.raw, settings.myName);
        if (speaker !== entry.speaker) {
          entry.speaker = speaker; // el nombre se detectó con la reunión ya en curso
          changed = true;
        }
        const merged = mergeText(entry.text, parsed.text);
        if (merged !== entry.text) {
          entry.text = merged;
          changed = true;
        }
      }
    }
    if (changed) {
      updateBadge('capturing');
      scheduleSave();
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 200);
  }

  // Activa los subtítulos una vez dentro de la llamada (no en la sala de espera, donde los
  // intentos se gastaban sin efecto). Hasta 4 intentos por reunión, separados 4 s, y deja de
  // insistir por si la persona los apagó a propósito; queda la etiqueta de recordatorio.
  let autoTries = 0;
  let autoFor = null;
  let lastAuto = 0;
  let autoLogged = false;
  let autoKey = false;
  let autoSince = 0;
  function autoEnableTick() {
    if (!settings.autoCaptions || !meeting || !wasInCall) return;
    if (autoFor !== meeting.code) {
      autoFor = meeting.code;
      autoTries = 0;
      autoLogged = false;
      autoKey = false;
      autoSince = Date.now();
    }
    if (autoTries >= 4 || document.querySelector(SELECTORS.region)) return;
    if (Date.now() - lastAuto < 4000) return;
    const btn = findCaptionsButton();
    if (!btn) {
      if (!autoLogged) {
        autoLogged = true;
        console.warn('[Transcriptor] no encuentro el botón de subtítulos. Botones de la página:', describeButtons());
      }
      // Respaldo: el atajo de Meet para los subtítulos es la tecla C (una sola vez por reunión).
      if (!autoKey && Date.now() - autoSince > 8000) {
        autoKey = true;
        console.log('[Transcriptor] probando la tecla C para activar los subtítulos');
        for (const type of ['keydown', 'keyup']) {
          document.body.dispatchEvent(new KeyboardEvent(type, { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
        }
      }
      return;
    }
    autoTries++;
    lastAuto = Date.now();
    console.log(`[Transcriptor] activando subtítulos (intento ${autoTries})`);
    btn.click();
  }

  chrome.storage.local.get('settings', (data) => {
    settings = { ...settings, ...(data.settings || {}) };

    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scan();
    setInterval(autoEnableTick, 3000);
    setInterval(shotTick, 15000);
    document.addEventListener('visibilitychange', shotTick);
  });

  // Si cambias tu nombre en el popup, se aplica a la reunión en curso.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
    }
  });

  // Al colgar, Meet puede pedir confirmación («Salir de la llamada» / «Finalizar para todos»).
  // La transcripción se abre cuando se pulsa uno de esos botones del diálogo, no antes. Si no
  // hay diálogo, el botón de salir termina la llamada y se detecta a los ~1,2 s.
  const LEAVE_CHOICE = /abandon|salir|leave|finaliz|terminar|end (the )?(call|meeting)|for everyone|para todos/i;
  const ABOUT_CALL = /llamada|reuni[oó]n|call|meeting|everyone|todos/i;
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target instanceof Element && e.target.closest('button');
      if (!btn) return;
      const label = `${btn.getAttribute('aria-label') || ''} ${btn.textContent || ''}`;
      if (btn.closest('[role="dialog"], [role="alertdialog"]')) {
        if (LEAVE_CHOICE.test(label) && ABOUT_CALL.test(label) && !/cancel/i.test(label)) markEnded('confirmó salir de la llamada', true);
      } else if (btn === findLeaveButton()) {
        setTimeout(() => {
          if (!isInCall()) markEnded('pulsó salir de la llamada', true);
        }, 1200);
      }
    },
    true
  );

  window.addEventListener('pagehide', () => {
    markEnded('cerró o recargó la pestaña');
    save();
  });
})();
