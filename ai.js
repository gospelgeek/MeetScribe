// Conexión opcional con la IA del propio usuario (clave propia). Lo usan el proceso de fondo
// (que hace las llamadas) y la página de reuniones (que muestra los proveedores en el modal).
// Nada de esto se usa hasta que el usuario conecta su IA; sin ella MeetScribe no envía nada.

const AI_PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    model: 'claude-opus-5-5',
    modelHint: 'Puedes poner uno más económico, por ejemplo claude-haiku-5-5.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsKey: true,
  },
  openai: {
    name: 'OpenAI',
    model: 'gpt-5-mini',
    modelHint: 'Si el modelo ya no existe, escribe el nombre de otro de tu cuenta.',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
  },
  gemini: {
    name: 'Google (Gemini)',
    model: 'gemini-3.8-flash',
    modelHint: 'Google retira modelos con el tiempo. Si sale «ya no está disponible», escribe el que indique el aviso o uno de Google AI Studio.',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
  },
  compatible: {
    name: 'Otro compatible con OpenAI (Ollama, LM Studio, OpenRouter…)',
    model: '',
    modelHint: 'Obligatorio: el nombre exacto del modelo en ese servicio.',
    keyUrl: '',
    needsKey: false,
    needsUrl: true,
    urlHint: 'Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1',
  },
  opencode: {
    name: 'OpenCode (avanzado, servidor en tu equipo)',
    model: '',
    modelHint: 'Opcional: proveedor/modelo, por ejemplo anthropic/claude-sonnet-5-5. Vacío = el que tengas por defecto en OpenCode.',
    keyUrl: '',
    keyLabel: 'Contraseña del servidor',
    keyNote: 'solo si configuraste OPENCODE_SERVER_PASSWORD',
    needsKey: false,
    needsUrl: true,
    optionalModel: true,
    defaultUrl: 'http://127.0.0.1:4096',
    urlHint: 'Es la dirección donde corre «opencode serve» (por defecto, esta).',
  },
};

// OpenCode es un agente con herramientas (archivos, comandos). La transcripción trae lo que dicen
// otras personas, así que nunca se le envía a un agente que pueda usar herramientas: se pide
// siempre este agente, que el usuario define en su opencode.json con todo denegado.
const OPENCODE_AGENT = 'meetscribe';
const OPENCODE_CONFIG = JSON.stringify(
  {
    $schema: 'https://opencode.ai/config.json',
    agent: {
      [OPENCODE_AGENT]: {
        description: 'Resume reuniones usando solo el texto recibido, sin herramientas',
        mode: 'all',
        prompt: 'Responde usando solo el texto de la conversación. No llames a ninguna herramienta.',
        permission: Object.fromEntries(
          ['read', 'edit', 'glob', 'grep', 'list', 'bash', 'task', 'todowrite', 'external_directory', 'webfetch', 'websearch', 'lsp', 'skill', 'question', 'doom_loop'].map((k) => [k, 'deny'])
        ),
      },
    },
  },
  null,
  2
);

const aiIsConfigured = (ai) => {
  const p = AI_PROVIDERS[ai?.provider];
  return Boolean(p && (ai.model || p.optionalModel) && (!p.needsKey || ai.apiKey) && (!p.needsUrl || ai.baseUrl) && ai.consentAt);
};

const SUMMARY_SYSTEM = [
  'Eres un asistente que resume reuniones a partir de su transcripción y de su chat.',
  'La transcripción viene de los subtítulos automáticos de Google Meet y puede tener errores de reconocimiento.',
  'Responde siempre en español. Sé fiel a lo dicho: no inventes datos, nombres, cifras, fechas ni acuerdos. Si algo no está claro, dilo.',
  'Usa exactamente estos encabezados, en este orden, escritos con "## ", y listas con "- ":',
  '## Resumen',
  '(un párrafo de 3 a 6 frases)',
  '## Puntos principales',
  '(de 4 a 7 viñetas con los temas más importantes que se trataron, sin repetir las decisiones ni las tareas, que van en sus propias secciones)',
  '## Conclusiones',
  '(lo que quedó claro al final de la reunión, en viñetas cortas)',
  '## Decisiones',
  '(lo que se acordó o aprobó)',
  '## Tareas y responsables',
  '(una viñeta por tarea, con este formato: "- Nombre del responsable: qué debe hacer (fecha, solo si se mencionó)". Si no se dijo quién, escribe "Sin responsable asignado" en lugar del nombre. Usa los nombres tal como aparecen en la transcripción)',
  '## Pendientes y preguntas abiertas',
  'Si una sección no aplica, escribe "- Ninguna". No agregues nada fuera de esas secciones.',
].join('\n');

// Un error que ya viene redactado para mostrarse al usuario.
class AIError extends Error {}

// OpenCode: servidor local (opencode serve). Se crea una sesión, se le envía el texto con el agente
// sin herramientas, se lee la respuesta y se borra la sesión para no ensuciar su historial.
async function callOpenCode(ai, system, user) {
  const base = (ai.baseUrl || 'http://127.0.0.1:4096').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json' };
  if (ai.apiKey) headers.authorization = `Basic ${btoa(`opencode:${ai.apiKey}`)}`;
  const down = () => new AIError(`No se pudo conectar con OpenCode en ${base}. ¿Está corriendo «opencode serve»?`);
  const request = async (path, method, body, timeout) => {
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      if (err?.name === 'TimeoutError') throw new AIError('OpenCode tardó demasiado en responder.');
      throw down();
    }
    if (res.status === 401) throw new AIError('OpenCode rechazó la contraseña.');
    const data = await res.json().catch(() => null);
    return { res, data };
  };

  const health = await request('/global/health', 'GET', null, 8000);
  if (!health.res.ok || !health.data?.healthy) throw new AIError('Esa dirección no responde como un servidor de OpenCode.');

  const session = await request('/session', 'POST', { title: 'MeetScribe: resumen' }, 15000);
  const id = session.data?.id;
  if (!session.res.ok || !id) throw new AIError('OpenCode no pudo crear la sesión.');
  try {
    const body = { agent: OPENCODE_AGENT, system, parts: [{ type: 'text', text: user }] };
    const slash = (ai.model || '').indexOf('/');
    if (slash > 0) body.model = { providerID: ai.model.slice(0, slash), modelID: ai.model.slice(slash + 1) };
    const { res, data } = await request(`/session/${encodeURIComponent(id)}/message`, 'POST', body, 300000);
    const failure = data?.info?.error?.data?.message || data?.info?.error?.name;
    if (!res.ok || failure) {
      const detail = String(failure || data?.message || data?.error || '').slice(0, 300);
      throw new AIError(
        `OpenCode no pudo responder. ${detail} Revisa que el agente «${OPENCODE_AGENT}» esté en tu opencode.json y que el modelo esté conectado en OpenCode.`.replace(/\s+/g, ' ')
      );
    }
    const text = (data?.parts || []).filter((x) => x.type === 'text' && x.text).map((x) => x.text).join('\n').trim();
    if (!text) throw new AIError('OpenCode respondió sin texto. Prueba con otro modelo.');
    return text;
  } finally {
    request(`/session/${encodeURIComponent(id)}`, 'DELETE', null, 8000).catch(() => {});
  }
}

// Pide al proveedor elegido que responda a `user` siguiendo `system`. Devuelve solo el texto.
async function callAI(ai, system, user) {
  const p = AI_PROVIDERS[ai.provider];
  if (!p) throw new AIError('Proveedor desconocido.');
  if (ai.provider === 'opencode') return callOpenCode(ai, system, user);
  const base = (ai.baseUrl || '').replace(/\/+$/, '');
  let url;
  const headers = { 'content-type': 'application/json' };
  let body;

  if (ai.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = ai.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: ai.model, max_tokens: 16000, system, messages: [{ role: 'user', content: user }] };
  } else if (ai.provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`;
    headers['x-goog-api-key'] = ai.apiKey;
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] };
  } else {
    url = `${ai.provider === 'openai' ? 'https://api.openai.com/v1' : base}/chat/completions`;
    if (ai.apiKey) headers.authorization = `Bearer ${ai.apiKey}`;
    body = { model: ai.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new AIError('El proveedor tardó demasiado en responder. Intenta de nuevo.');
    throw new AIError('No se pudo conectar con el proveedor (¿sin internet o dirección incorrecta?).');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = String(data?.error?.message || data?.error || '').slice(0, 300);
    const status = res.status;
    if (status === 401 || status === 403) throw new AIError('La clave no es válida o no tiene permiso para este modelo.');
    if (status === 404) throw new AIError(`El modelo «${ai.model}» no existe o tu cuenta no tiene acceso. ${detail}`.trim());
    if (status === 429) throw new AIError(`Se superó el límite de uso o se agotó el saldo de tu cuenta. ${detail}`.trim());
    if (status >= 500) throw new AIError('El proveedor tuvo un problema. Intenta de nuevo en unos minutos.');
    throw new AIError(`El proveedor rechazó la petición (${status}). ${detail}`.trim());
  }

  let text = '';
  if (ai.provider === 'anthropic') {
    if (data?.stop_reason === 'refusal') throw new AIError('El modelo se negó a resumir esta reunión.');
    text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } else if (ai.provider === 'gemini') {
    text = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  } else {
    text = data?.choices?.[0]?.message?.content || '';
  }
  text = text.trim();
  if (!text) throw new AIError('El proveedor respondió sin texto. Prueba con otro modelo.');
  return text;
}
