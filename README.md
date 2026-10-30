# MeetScribe

Extensión de Chrome/Edge para Google Meet: transcribe cada intervención con el nombre de quien habla, guarda el chat y screenshots, resume con tu propia IA, y comparte el PDF por Drive o correo.

## Qué hace

MeetScribe es más que un transcriptor: guarda la reunión completa y te ayuda a compartirla.

- **Transcribe en vivo** cada intervención con el nombre de quien habla y la hora, a partir de los subtítulos de Meet.
- **Guarda el contexto:** nombre de la reunión (el del calendario), hora de inicio y fin, duración, participantes y el chat.
- **Toma screenshots:** automáticos (a los 10 minutos y luego cada 30) y un botón de cámara dentro de Meet para hacer capturas cuando quieras.
- **Resumen con tu propia IA (opcional):** Anthropic, OpenAI, Gemini, un modelo compatible (Ollama, LM Studio…) u OpenCode. Genera resumen, puntos principales, conclusiones, decisiones, tareas y pendientes. Con tu propia clave y a tu costo.
- **Historial con buscador:** busca por texto, persona o nombre; renombra y borra reuniones.
- **Descargas:** `.txt`, `.json` y `.pdf` (título, participantes, resumen, screenshots, transcripción y chat), y **descarga por lotes de fechas** en un solo archivo.
- **Compartir por Google Drive:** genera el PDF, lo sube a una carpeta «MeetScribe» de tu Drive y lo comparte con los participantes que elijas; Drive les envía el aviso con el enlace. Recuerda los correos y deja el enlace en la página de la reunión.
- **Enviar por correo:** abre Gmail con el mensaje ya redactado (resumen y enlace al PDF; nunca la transcripción) y recuerda tus contactos.
- **Privado por defecto:** todo se guarda en tu navegador. Solo sale algo si tú lo decides (resumen con tu IA, compartir por Drive).
- **Comodidades:** activa los subtítulos solo, abre la transcripción al colgar y avisa cuando hay una versión nueva.

## Cómo funciona

Meet ya muestra en sus subtítulos en vivo el nombre de cada hablante. La extensión lee esos subtítulos de la página, los guarda por reunión en `chrome.storage.local` y permite exportarlos. Los datos de las reuniones nunca salen del navegador. La única conexión que hace es leer `version.json` en GitHub Pages (gospelgeek.github.io/MeetScribe) para avisar si hay una versión nueva; no envía nada tuyo.

## Instalación

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. **Cargar descomprimida** y elige esta carpeta.
3. Entra a una reunión en meet.google.com. La extensión intenta activar los subtítulos sola (hasta 3 intentos; se puede desactivar en el popup). Si siguen apagados, aparece una etiqueta roja en la que puedes hacer clic para activarlos.

## Uso

- Durante la llamada aparece una etiqueta «● Transcribiendo».
- En el popup de la extensión: botón **Ver reuniones**, tu nombre y la opción de activar subtítulos solos.
- Meet muestra «You»/«Tú» en tus propios subtítulos. La extensión intenta leer tu nombre de la cuenta de Google y lo guarda en lugar de «You». Si no lo detecta, escríbelo una vez en el popup: se aplica en tiempo real y también a las reuniones ya guardadas.

- **Ver reuniones:** abre una página con todo lo guardado en el navegador, buscador por texto y nombre, y botones para descargar (.txt, .json, .pdf), copiar o borrar cada reunión. El **.pdf** incluye todo (título, participantes, transcripción, chat y screenshots): abre el diálogo de impresión de Chrome y se elige «Guardar como PDF». Se actualiza sola mientras transcribes. La sección **Descargar por fechas** baja en un solo archivo (TXT o JSON) todas las reuniones de un rango de fechas.

- **Nombre, participantes y fin:** cada reunión se titula con el nombre del evento de calendario si Meet lo muestra; si no (reunión improvisada), con el código. Arriba se ven la hora de inicio y de fin, la duración y los participantes. Al final de la transcripción hay una línea de cierre. El botón **Renombrar** permite poner el nombre a mano.

- **Chat:** si el panel de chat de Meet está abierto, MeetScribe guarda los mensajes (quién, hora y texto) junto a la reunión. Salen en un apartado «Chat de la reunión» en la página y en las descargas, y los enlaces se pueden abrir con un clic.
- **Resumen con tu propia IA (opcional):** en el popup, «Conectar mi IA» abre un modal donde se elige proveedor (Anthropic, OpenAI, Google Gemini, otro compatible con OpenAI como Ollama o LM Studio, u OpenCode en tu equipo), se pega la clave de API propia y se acepta explícitamente que la transcripción se enviará a ese proveedor. Al colgar se genera solo un resumen con decisiones y tareas, que aparece arriba de la reunión, en el PDF y en las descargas. Con OpenCode (opción avanzada) la extensión solo habla con un agente llamado `meetscribe` que el usuario define sin ninguna herramienta, porque OpenCode es un agente con acceso a archivos y terminal y la transcripción trae lo que dicen otras personas; el modal muestra la configuración para copiar. Sin conectar nada, MeetScribe no envía nada a ninguna IA. La clave queda en el navegador, sin cifrar, y el costo lo paga cada usuario al proveedor (una suscripción de ChatGPT/Claude no incluye API).
- **Al colgar:** MeetScribe abre la página de reuniones con la transcripción de esa reunión ya a la vista (si ya tenías esa página abierta, la reutiliza). Se apaga en el popup («Abrir la transcripción al colgar»).
- **Screenshots:** a los 10 minutos de empezar la reunión y luego cada 30, MeetScribe toma una captura de la pestaña y la guarda (IndexedDB) junto a la reunión; salen en miniatura al final del reporte, con clic para ampliar. Además, dentro de la reunión hay un botón de cámara, justo antes del primer botón de la barra, para tomar un screenshot cuando quieras. Los automáticos se apagan en el popup («Screenshots automáticos»). No van en las descargas .txt/.json.

## Limitaciones

- **Chat:** Meet solo muestra los mensajes en la página mientras el panel de chat está abierto; con el panel cerrado no se guarda nada.
- **Screenshots:** Chrome solo permite capturar la pestaña que está a la vista; si en el momento previsto estás en otra, se toma al volver. Reuniones de menos de 10 minutos no tienen. Las capturas incluyen caras y lo que se comparta en pantalla. Chrome exige el permiso «leer todos los sitios» (`<all_urls>`) para poder capturar la pestaña desde la extensión; MeetScribe solo captura la pestaña de Meet en la que estás y suena un obturador al guardar.

- **Participantes:** salen de quienes hablaron y de la lista de participantes de Meet, que solo está disponible mientras el panel «Personas» está abierto. Quien no habló y no apareció en ese panel no se registra.
- **Fin de la reunión:** se marca al colgar, al ver la pantalla de «volver a unirte» o al cerrar la pestaña. Si el navegador se cierra de golpe, se muestra la última actividad como fin aproximado.

- **El idioma de la transcripción es el de los subtítulos de Meet.** Configúralo en Meet (Configuración → Subtítulos) a español.
- Solo captura lo que Meet muestra en pantalla; si los subtítulos se apagan, no se registra nada. Al entrar a la llamada (no en la vista previa de la cámara) la extensión tarda un par de segundos en activarlos sola; si no lo logra aparece la etiqueta roja «Subtítulos apagados», y hay que hacer clic en ella o en el botón CC de Meet.
- El nombre de quien habla es el que Meet asigna (el de su cuenta o el que puso al entrar).
- Meet cambia su HTML con frecuencia. Si deja de capturar, ajusta `SELECTORS` y `parseRow()` en `content.js`.
- **Aviso legal:** informa a los participantes de que la reunión se transcribe; en muchos lugares es obligatorio.

## Publicar una versión

1. Sube el número de versión en `manifest.json`.
2. Ejecuta `powershell -File tools/release.ps1 -Notes "Qué cambió"`. Genera `dist/` (los zip) y actualiza `docs/` (la página y `version.json`).
3. Haz commit y push de los cambios (incluida `docs/`, que publica GitHub Pages).
4. Crea la Release con los zip: `gh release create v<versión> dist/meetscribe-<versión>.zip dist/meetscribe.zip --title "v<versión>" --notes "Qué cambió"`. Quien tenga la extensión verá el aviso «Hay una versión nueva» en el popup y en la página de reuniones.

`tools/oauth.html` y `tools/privacidad.html` siguen publicadas en gospelgeek.com.co: Google tiene registrada esa dirección para el inicio de sesión de Drive.

## Contribuir

MeetScribe es de código abierto y toda ayuda es bienvenida: errores, ideas y pull requests. Lee [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

[MIT](LICENSE). Incluye `pdf-lib` (MIT, ver `pdf-lib.LICENSE.md`).

---

Desarrollado por [Gospel Geek](https://gospelgeek.com.co).
