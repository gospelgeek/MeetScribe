// Genera el PDF de una reunión dentro de la extensión, sin pasar por el diálogo de imprimir, para poder
// compartirlo como archivo. Usa pdf-lib (MIT, pdf-lib.min.js) y necesita format.js. Orden del documento:
// encabezado, screenshots, resumen de la IA, transcripción, chat. El pie con el enlace va en cada hoja.
// La letra es Helvetica estándar: solo admite caracteres latinos (acentos y ñ sí); el resto sale como «?».

const PDF_SITE = 'https://gospelgeek.github.io/MeetScribe/';

// Cualquier carácter que Helvetica (WinAnsi) no sabe dibujar se cambia por «?».
const pdfSafe = (s) =>
  String(s)
    .normalize('NFC')
    .replace(/\r/g, '')
    .replace(/\t/g, '    ')
    .replace(/[^\n\x20-\x7E\xA0-\xFF‘’“”•–—…€]/gu, '?');

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// Imagen reducida y en JPEG: los screenshots originales pesan mucho para un PDF que se envía.
async function pdfShotJpeg(blob, maxWidth = 900) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('imagen no legible'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return { bytes: new Uint8Array(await out.arrayBuffer()), width: canvas.width, height: canvas.height };
}

async function buildMeetingPdf(m, myName, shots, version) {
  const { PDFDocument, StandardFonts, PDFName, PDFString, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 42; // margen lateral y superior
  const FOOT = 52; // alto reservado abajo para el pie
  const CW = W - 2 * M;
  const INK = rgb(0.13, 0.13, 0.14);
  const MUTED = rgb(0.37, 0.39, 0.41);
  const LINE = rgb(0.85, 0.86, 0.88);

  let page;
  let y;
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h) => {
    if (y - h < FOOT) newPage();
  };

  // Parte un texto en líneas que caben en `width`.
  const wrap = (text, font, size, width) => {
    const lines = [];
    for (const para of pdfSafe(text).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) {
          line = tryLine;
          continue;
        }
        if (line) lines.push(line);
        line = '';
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let n = rest.length;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  };

  // Dibuja un párrafo ajustado; devuelve cuántas líneas usó.
  const paragraph = (text, { font = regular, size = 10, color = INK, x = M, width = CW, gap = 0 } = {}) => {
    const lh = size * 1.4;
    const lines = wrap(text, font, size, width);
    for (const line of lines) {
      ensure(lh);
      y -= lh;
      if (line) page.drawText(line, { x, y: y + size * 0.28, size, font, color });
    }
    y -= gap;
    return lines.length;
  };

  const sectionTitle = (text) => {
    ensure(40);
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    y -= 6;
    paragraph(text, { font: bold, size: 12, gap: 4 });
  };

  newPage();

  // --- Encabezado ---
  const title = meetingTitle(m);
  paragraph(title, { font: bold, size: 19, gap: 4 });
  const end = meetingEnd(m);
  const meta = [`Inicio: ${new Date(m.startedAt).toLocaleString()}`, `Fin: ${endLabel(m)}`, durationLabel(m)].filter(Boolean).join(' · ');
  paragraph(meta, { size: 9.5, color: MUTED, gap: 3 });
  const people = attendeesOf(m, myName);
  paragraph(`Participantes (${people.length}): ${people.join(', ') || 'sin datos'}`, { size: 9.5 });

  // --- Screenshots ---
  if (shots.length) {
    sectionTitle(`Screenshots de la reunión (${shots.length})`);
    const colW = (CW - 12) / 2;
    let col = 0;
    let rowTop = y;
    let rowH = 0;
    for (const s of shots) {
      let img;
      try {
        const j = await pdfShotJpeg(s.blob);
        img = { ref: await doc.embedJpg(j.bytes), ratio: j.height / j.width };
      } catch {
        continue; // una imagen dañada no debe impedir el PDF
      }
      const h = colW * img.ratio;
      if (col === 0) {
        ensure(h + 22);
        rowTop = y;
        rowH = 0;
      }
      const x = M + col * (colW + 12);
      page.drawImage(img.ref, { x, y: rowTop - h - 4, width: colW, height: h });
      page.drawText(clock(s.ts, m.startedAt), { x, y: rowTop - h - 15, size: 8, font: regular, color: MUTED });
      rowH = Math.max(rowH, h + 22);
      if (col === 1) {
        y = rowTop - rowH;
        col = 0;
      } else col = 1;
    }
    if (col === 1) y = rowTop - rowH;
  }

  // --- Resumen de la IA ---
  if (m.summary?.status === 'done' && m.summary.text) {
    sectionTitle('Resumen generado con IA');
    paragraph(`Generado con ${m.summary.model}. Puede contener errores: revísalo.`, { size: 8.5, color: MUTED, gap: 2 });
    for (const raw of m.summary.text.split('\n')) {
      const line = raw.trim().replace(/\*\*/g, '');
      if (!line) continue;
      if (line.startsWith('## ')) {
        y -= 5;
        ensure(30);
        paragraph(line.slice(3).toUpperCase(), { font: bold, size: 9, color: MUTED, gap: 1 });
      } else if (line.startsWith('- ')) {
        ensure(14);
        const first = y;
        const own = page; // el punto puede continuar en la hoja siguiente; la viñeta va en la hoja donde empieza
        paragraph(line.slice(2), { x: M + 14, width: CW - 14 });
        own.drawText('•', { x: M + 3, y: first - 10 * 1.4 + 10 * 0.28, size: 10, font: regular, color: INK });
      } else paragraph(line, { gap: 2 });
    }
  }

  // --- Transcripción ---
  sectionTitle('Transcripción');
  const TIME_W = 52;
  let last = null;
  const colorOf = (name) => {
    const [r, g, b] = hslToRgb(hueFor(name), 0.6, 0.4);
    return rgb(r, g, b);
  };
  for (const e of m.entries) {
    const name = speakerName(e.speaker, myName);
    const first = name !== last;
    last = name;
    const lines = wrap(e.text, regular, 10, CW - TIME_W);
    ensure((first ? 14 : 0) + 14 * Math.min(lines.length, 2));
    if (first) {
      y -= 4;
      paragraph(name, { font: bold, size: 10, color: colorOf(name), x: M + TIME_W, width: CW - TIME_W });
    }
    ensure(14);
    const top = y;
    const own = page;
    paragraph(e.text, { x: M + TIME_W, width: CW - TIME_W });
    own.drawText(clock(e.ts, m.startedAt), { x: M, y: top - 14 + 3, size: 8, font: regular, color: MUTED });
  }

  // --- Chat ---
  const chat = uniqueChat(m.chat || []);
  if (chat.length) {
    sectionTitle(`Chat de la reunión (${chat.length} ${chat.length === 1 ? 'mensaje' : 'mensajes'})`);
    for (const c of chat) {
      const name = speakerName(c.speaker, myName);
      ensure(14);
      const top = y;
      const own = page;
      paragraph(`${name}: ${c.text}`, { x: M + TIME_W, width: CW - TIME_W });
      own.drawText(clock(c.ts, m.startedAt), { x: M, y: top - 14 + 3, size: 8, font: regular, color: MUTED });
    }
  }

  y -= 10;
  paragraph(
    end ? `Fin de la reunión · ${endLabel(m)} · duración ${duration(end.at - m.startedAt)}` : 'La reunión sigue en curso',
    { font: bold, size: 9.5, color: MUTED }
  );

  // --- Pie en cada hoja: datos de MeetScribe y enlace ---
  const pages = doc.getPages();
  const prefix = pdfSafe(`Transcripción generada con MeetScribe v${version} · Desarrollado por GospelGeek · `);
  const url = 'gospelgeek.github.io/MeetScribe';
  const fs = 8.5;
  const wPrefix = regular.widthOfTextAtSize(prefix, fs);
  const wUrl = regular.widthOfTextAtSize(url, fs);
  const x0 = (W - wPrefix - wUrl) / 2;
  const BLUE = rgb(0.1, 0.45, 0.91);
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: LINE });
    p.drawText(prefix, { x: x0, y: 27, size: fs, font: regular, color: MUTED });
    p.drawText(url, { x: x0 + wPrefix, y: 27, size: fs, font: regular, color: BLUE });
    p.drawLine({ start: { x: x0 + wPrefix, y: 25.5 }, end: { x: x0 + wPrefix + wUrl, y: 25.5 }, thickness: 0.5, color: BLUE });
    const num = `${i + 1} / ${pages.length}`;
    p.drawText(num, { x: (W - regular.widthOfTextAtSize(num, 8)) / 2, y: 14, size: 8, font: regular, color: MUTED });
    const link = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [x0 + wPrefix, 22, x0 + wPrefix + wUrl, 37],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(PDF_SITE) },
      })
    );
    p.node.set(PDFName.of('Annots'), doc.context.obj([link]));
  });

  doc.setTitle(`${pdfSafe(title)} - ${isoDayOf(m.startedAt)}`);
  doc.setCreator('MeetScribe · GospelGeek');
  doc.setProducer('MeetScribe');
  return doc.save();
}

function isoDayOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
