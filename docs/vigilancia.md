# Vigilancia transparente en Testra

Testra no es un sistema de proctoring. Registra señales limitadas para ayudar a un docente a conversar sobre situaciones ocurridas durante una evaluación. Las señales no prueban fraude y nunca producen una desaprobación automática.

## Qué registra el navegador

Sólo mientras la toma está en estado `running`, el alumno empezó y todavía no entregó:

| Señal | Qué suele significar | Limitación |
|---|---|---|
| Página oculta | Cambio de pestaña, aplicación, ventana minimizada o pantalla bloqueada | El navegador no dice cuál de esas acciones ocurrió |
| Ventana sin foco | Otra ventana tomó el foco, incluso en otro monitor | Un aviso del sistema también puede quitar el foco |
| F12 | Se presionó esa tecla | No demuestra que DevTools se haya abierto |
| Copiar, cortar o pegar | Evento real del portapapeles, incluyendo la cantidad de caracteres | No se guarda el texto copiado o pegado |
| Salida de pantalla completa | El alumno salió después de haber aceptado entrar | Pantalla completa es opcional y el navegador puede negarla |
| Página oculta o cerrada | Beacon de ciclo de vida desde `visibilitychange` o `pagehide` | No todos los cierres se distinguen de una suspensión móvil |

Las ausencias por visibilidad y foco se deduplican. Testra mide desde la primera señal de pérdida hasta que la página vuelve a estar visible y enfocada; el tipo se reconcilia con todas las señales observadas durante el intervalo.

Cada incidente se muestra de inmediato al alumno con su duración o metadatos. Copiar o pegar registra la acción y la cantidad de caracteres, nunca el contenido.

## Qué observa el servidor

Estas señales no dependen del autorreporte del navegador:

- Heartbeat cada 5 segundos. Si faltan durante 20 segundos, el actor de la toma marca al participante como desconectado.
- Una sola sesión WebSocket activa por participante. Una segunda conexión registra `sesion-duplicada`.
- Cambio de dirección IP o user-agent durante una toma.
- Timestamps de servidor en cada guardado de respuesta, útiles para analizar cadencias improbables.
- Identidad OIDC de Google en vez de un nombre tipeado.

Los incidentes guardan `source=client` o `source=server`; la interfaz del docente debe diferenciarlos. Una señal del servidor suele ser más resistente a manipulación, pero tampoco prueba por sí sola una conducta.

## Qué Testra no hace

- No usa webcam ni micrófono.
- No captura pantalla.
- No registra teclas escritas.
- No lee el contenido del portapapeles para almacenarlo.
- No detecta “IA” ni decide si una respuesta fue escrita por otra persona.
- No bloquea DevTools ni promete impedir que un cliente modificado llame a la API.
- No calcula una sanción o nota desde los incidentes.

## Riesgo residual

Las señales del cliente son falsificables. Con una sesión válida, una persona técnicamente capaz podría enviar respuestas fuera de la interfaz y omitir todos los eventos del navegador. El heartbeat, la sesión única y los timestamps del servidor reducen algunos huecos, pero no convierten Testra en un entorno inviolable.

Por eso el panel docente debe presentar los incidentes como contexto revisable, con su fuente y hora, y nunca como un veredicto.
