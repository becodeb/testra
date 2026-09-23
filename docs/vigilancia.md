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

## Coincidencias entre alumnos

Además de las señales de arriba, desde la pestaña "Análisis" de resultados el docente puede comparar a los alumnos de una toma entre sí. Es una comparación explícita, bajo demanda: no corre sola ni en tiempo real, y no es parte de la vigilancia durante la evaluación.

### Qué compara y cómo

- **Opción múltiple, selección múltiple, verdadero/falso y respuesta corta**: si dos alumnos fallaron la misma pregunta con exactamente la misma respuesta incorrecta, y esa coincidencia es más de lo que el azar explica dado lo que respondió el resto de la clase. No es un umbral fijo de "coincidieron dos veces": es una probabilidad calculada pregunta por pregunta a partir de lo que el resto de la clase realmente eligió, y corregida por la cantidad de pares que tiene la toma (comparar a más gente da más oportunidades de coincidir por azar).
- **Respuestas de desarrollo, por código**: fragmentos de texto que dos alumnos comparten y que casi nadie más de la clase escribió, excluyendo lo que ya está en la consigna o en la respuesta de referencia (una definición que memorizó medio curso no cuenta como coincidencia).
- **Respuestas de desarrollo, con Jev**: para lo que el código no puede distinguir por sí solo —una redacción poco común compartida, el mismo error específico, o una respuesta reescrita a partir de la otra—, se le pregunta a Jev (el modelo "System One" de TypeSafe AI, servido por Vercel AI Gateway) por cada par y cada pregunta de desarrollo, con un presupuesto acotado por toma. El informe de texto existente que resume la toma entera con un modelo de lenguaje sigue aparte: esto no lo reemplaza ni lo modifica.

### Qué se le manda a Jev y qué nunca

Por cada llamado: la consigna, la respuesta de referencia (si el docente cargó una) y las dos respuestas de los alumnos, con una nota fija de contexto sobre qué es esperable en una evaluación escolar. Nunca nombres, correos ni ids: los dos alumnos llegan como "respuesta 1" y "respuesta 2", sin ninguna forma de identificarlos del lado de Jev ni del ai-router. El pedido va con retención cero de datos (`zeroDataRetention` en el gateway).

### Costo, orden de magnitud

Con el precio publicado por Vercel AI Gateway para Jev (US$ 0,042 cada millón de tokens de entrada; la salida no tiene costo por ahora) y el presupuesto de esta función (hasta unos cientos de llamados por toma, cada uno con un estado breve), comparar una toma completa cuesta centavos de dólar en el peor caso, normalmente menos. Todavía no hay un número medido con tráfico real, porque la cuenta del gateway no tiene una tarjeta cargada: ver `docs/coincidencias-evaluacion.md`.

### Límites

- Una redacción parafraseada solo la detecta Jev; el código por sí solo no distingue una idea propia de una copiada con otras palabras.
- Compartir una respuesta incorrecta en verdadero/falso no es evidencia de nada: con una sola forma posible de estar mal, coincidir no dice nada.
- En una clase chica no hay con qué comparar: las preguntas cerradas necesitan un mínimo de respondentes para que la estimación de azar sea estable, y las de desarrollo necesitan al menos dos respuestas elegibles.
- Si dos alumnos recibieron variantes distintas de una pregunta (sorteo del pozo, adecuaciones) o un subconjunto distinto de la toma, nunca se comparan entre sí: cada uno se compara solo contra quienes respondieron exactamente la misma pregunta.

Como el resto de las señales de este documento: esto marca coincidencias para que el docente las revise, nunca decide ni prueba que una respuesta fue copiada.

## Qué Testra no hace

- No usa webcam ni micrófono.
- No captura pantalla.
- No registra teclas escritas.
- No lee el contenido del portapapeles para almacenarlo.
- No detecta "IA" en las respuestas.
- La comparación entre alumnos (arriba) marca coincidencias para revisar; nunca decide ni prueba que una respuesta fue copiada o escrita por otra persona.
- No bloquea DevTools ni promete impedir que un cliente modificado llame a la API.
- No calcula una sanción o nota desde los incidentes.

## Riesgo residual

Las señales del cliente son falsificables. Con una sesión válida, una persona técnicamente capaz podría enviar respuestas fuera de la interfaz y omitir todos los eventos del navegador. El heartbeat, la sesión única y los timestamps del servidor reducen algunos huecos, pero no convierten Testra en un entorno inviolable.

Por eso el panel docente debe presentar los incidentes como contexto revisable, con su fuente y hora, y nunca como un veredicto.
