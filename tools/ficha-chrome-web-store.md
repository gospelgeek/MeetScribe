# Ficha de MeetScribe para la Chrome Web Store

Textos listos para copiar en el panel de desarrolladores. Idioma principal: español.

## Nombre
MeetScribe

## Descripción corta (máx. 132 caracteres; va también en `description` del manifiesto)
Transcribe tus reuniones de Google Meet con el nombre de quien habla. Guarda chat y capturas, resume con tu IA y comparte el PDF.

## Categoría
Productividad

## Descripción larga

MeetScribe transcribe tus reuniones de Google Meet con el nombre de quien habla y las guarda en tu navegador. Es gratis, de código abierto y no tiene cuentas ni suscripciones.

QUÉ HACE
• Transcribe en vivo cada intervención, con quién habla y a qué hora, a partir de los subtítulos de Meet. Los activa por ti al entrar a la llamada.
• Guarda el contexto: nombre de la reunión (el del calendario), hora de inicio y fin, duración, participantes y el chat.
• Toma capturas de pantalla: automáticas (a los 10 minutos y luego cada 30) y un botón de cámara dentro de Meet para hacer capturas cuando quieras.
• Resume con tu propia IA (opcional): Anthropic, OpenAI, Gemini, un modelo local u OpenCode. Genera resumen, puntos principales, decisiones, tareas y pendientes. Usas tu propia clave y pagas tú a tu proveedor.
• Historial con buscador: busca por palabra, persona o nombre; renombra y borra reuniones.
• Descarga en .txt, .json o .pdf (con resumen, capturas, transcripción y chat), y por lotes de fechas en un solo archivo.
• Comparte el PDF por Google Drive: lo sube a una carpeta «MeetScribe» de tu Drive y lo comparte con los participantes que elijas; Drive les envía el aviso con el enlace.
• Envía por correo: abre Gmail con el mensaje ya redactado (resumen y enlace al PDF; nunca la transcripción).

TUS DATOS SON TUYOS
Todo se guarda en tu navegador. No hay servidores de MeetScribe y no recibimos nada. Solo sale información si tú lo decides: el resumen con tu IA (va a tu proveedor) o compartir por Drive (va a tu Drive). El permiso de Google que se pide es solo sobre los archivos que crea la propia extensión, no sobre el resto de tu Drive.

IMPORTANTE
• MeetScribe lee los subtítulos de Meet: si están apagados, no hay transcripción.
• Informa a los participantes de que la reunión se transcribe; en muchos lugares es obligatorio.
• MeetScribe es un proyecto independiente y no está afiliado a Google. «Google Meet» y «Google Drive» son marcas de Google LLC.

Código abierto (licencia MIT): https://github.com/gospelgeek/MeetScribe
Desarrollado por Gospel Geek.

## Propósito único (una frase)
Transcribir las reuniones de Google Meet a partir de sus subtítulos y guardarlas, con su chat y capturas, para consultarlas, descargarlas y compartirlas.

## Justificación de cada permiso

- **storage** y **unlimitedStorage**: guardar en el navegador las transcripciones, el chat, los ajustes y las capturas (IndexedDB). Las reuniones largas con capturas superan el límite normal.
- **tabs**: abrir la página propia de la extensión («Ver reuniones») o reutilizarla si ya está abierta.
- **identity**: iniciar sesión con Google solo cuando el usuario pulsa «Compartir por Drive», para subir el PDF a su Drive con el permiso `drive.file` (solo archivos creados por la extensión). El token queda solo en memoria.
- **Acceso a meet.google.com**: leer los subtítulos y el chat de la reunión y mostrar la etiqueta de estado dentro de la página.
- **Acceso a todos los sitios (`<all_urls>`)**: (1) `captureVisibleTab` para capturar la pestaña de Meet en la que está el usuario; (2) enviar el resumen al proveedor de IA que el usuario configure (incluido un servidor propio o local) y llamar a la API de Google Drive. Ninguna de las dos cosas ocurre sin acción del usuario; no se lee ningún otro sitio.

## Uso de datos (formulario)
- Datos que se tratan: contenido del sitio (subtítulos y chat de Meet) y, si el usuario lo decide, correos de las personas con quien comparte.
- Todo queda en el navegador del usuario. No se vende ni se transfiere a terceros fuera de las acciones explícitas del usuario (IA propia, Drive).
- No se usa para fines ajenos a la función principal ni para decisiones crediticias.
- Código remoto: no. Todo el código va incluido en el paquete.

## URL de la política de privacidad
https://gospelgeek.com.co/desarrollo/MeetScribe/privacidad.html

## Sitio web / soporte
https://gospelgeek.github.io/MeetScribe/  ·  https://github.com/gospelgeek/MeetScribe/issues

## Imágenes (en `tools/store/`)
- `captura-1-main.png` a `captura-5-pdf.png`: capturas de 1280×800 (PNG sin transparencia). Usan datos y personas inventados.
- `promo-440x280.png`: imagen promocional pequeña.
