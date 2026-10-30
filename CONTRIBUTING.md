# Cómo aportar a MeetScribe

¡Gracias por querer mejorar MeetScribe! Es una extensión de Chrome (Manifest V3) sin paso de compilación: JavaScript, HTML y CSS planos.

## Probar tus cambios

1. Clona el repositorio.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y usa **Cargar descomprimida** sobre la carpeta del proyecto.
3. Tras editar, pulsa el botón de recargar de la extensión y recarga la pestaña de Meet.

## Ideas y errores

- Abre un **issue** describiendo qué pasa o qué propones. Si Meet cambió su HTML y dejó de capturar, indica el navegador y adjunta lo que veas en la consola.
- Para un cambio de código, abre un **pull request** pequeño y enfocado, con una descripción de qué hace y cómo lo probaste.

## Estilo

- Sigue el estilo del código que rodea tu cambio (nombres, comentarios, idioma de los textos en español).
- Sin dependencias nuevas salvo que sean imprescindibles; la única incluida es `pdf-lib` (licencia MIT, en `pdf-lib.LICENSE.md`).
- Los datos de las reuniones no deben salir del navegador salvo por una acción explícita del usuario (resumen con su IA, compartir por Drive).

## Privacidad de tus pruebas

No subas transcripciones reales, capturas de reuniones, claves de API ni correos de otras personas.

## Licencia

Al aportar aceptas que tu contribución se publique bajo la licencia MIT del proyecto.
