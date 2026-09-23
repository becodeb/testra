# Evaluación: detección de coincidencias entre alumnos

Método y resultados de medir si "Coincidencias entre alumnos" (`docs/vigilancia.md`) funciona,
antes de mostrárselo a un docente. Harness: `scripts/copy-eval/` (`npm run eval:copias`),
reportes completos en `scripts/copy-eval/results/`. Números de este documento tomados del
reporte más reciente de cada tipo: fragmentos/prefiltro/cerradas del
`fragmentos-prefiltro-cerradas-20260923-0308.md` (con las constantes `CLOSED_*` finales), el
intento de Jev del `fragmentos-prefiltro-cerradas-jev-20260923-0303.md`, y el juez LLM del
`fragmentos-prefiltro-cerradas-llm-20260923-0240.md`.

## Método

Dataset sintético generado con el ai-router (Groq y Gemini, 31 llamados, 199 s), guardado
como fixture (`scripts/copy-eval/dataset.json`): 6 preguntas de desarrollo × 24 respuestas cada
una (144 respuestas en total), en español, sobre distintos temas escolares.

Por pregunta, 24 respuestas se arman así:
- 14 independientes (cada alumno responde por su cuenta, sin relación con las demás).
- 3 "memorizadores": recitan la definición dictada en clase (que no es la respuesta de
  referencia que carga el docente) más un agregado propio.
- 2 que comparten una confusión común del tema, sin relación entre sí.
- 1 con un error propio y distintivo (no una confusión típica).
- 4 copias, de cuatro tipos: **verbatim** (casi textual, con retoques), **partial** (copia
  parcial más desarrollo propio), **paraphrase** (la misma idea con otras palabras) y
  **shared_error** (comparte el error distintivo de otro compañero sin copiar el texto).

Total: 24 positivos (las 4 copias × 6 preguntas) y 24 negativos difíciles (por pregunta, los 3
pares que se forman entre los memorizadores más el par que comparte la confusión común — los que
más se parecen a una copia sin serlo). El resto son negativos comunes. Todo verificado con
chequeos léxicos de sanidad antes de usarse.

## Resultados

### Señales de código en desarrollo (fragmentos compartidos)

Sobre el universo completo (1656 pares: 6 preguntas × 276 pares por pregunta):

| nivel | precisión | recall | falsos positivos |
| --- | --- | --- | --- |
| strong | 100,0 % | 29,2 % | 0 |
| review o strong | 93,8 % | 62,5 % | 1 de 1656 |

Por tipo de copia (review o strong):

| tipo de copia | recall |
| --- | --- |
| verbatim | 100,0 % |
| partial | 83,3 % |
| shared_error | 66,7 % |
| paraphrase | 0,0 % |

El 0 % en paraphrase es esperable, no una falla: el código compara fragmentos de texto
compartidos, y una respuesta reescrita con otras palabras no comparte fragmentos. Es
exactamente el trabajo que le queda a Jev (ver más abajo). El único falso positivo es un
modismo que dos alumnos usaron de manera independiente. Sobre los 18 negativos que solo
recitan la definición de clase: **0 marcados**, en ningún nivel.

### Prefiltro (a quién le conviene preguntarle a Jev)

Con el presupuesto real de producción (`max(20, 3×respondentes)` por pregunta, 72 de 276 pares
posibles en este dataset), los 24 positivos quedan **100 % dentro del presupuesto** (24/24):
ningún caso de copia se pierde por el recorte, incluidos los de paraphrase que el código no
puede marcar por sí solo pero que sí le llegan a Jev.

### Preguntas cerradas (mc/ms/tf/sa)

El primer intento (regla fija: "≥2 coincidencias raras") marcaba en promedio 19,3 pares
inocentes por clase de 30 alumnos con solo preguntas de opción múltiple — inutilizable. Se
reemplazó por un modelo de azar (binomial de Poisson sobre las preguntas que ambos fallaron,
con la probabilidad de colisión estimada a partir de lo que el resto de la clase eligió,
corregida por la cantidad de pares de la clase). Calibrado contra tres simulaciones de 200
semillas cada una (15 mc, 10 tf, un mixto de 25 con cola de respuestas cortas), probando
distintos α. Elegidas `CLOSED_ALPHA_REVIEW=1`, `CLOSED_ALPHA_STRONG=0.01` (mejor detección
promedio manteniendo como máximo 0,2 pares inocentes marcados por clase):

| clase | detección strong | detección review+strong | pares inocentes/clase (media) |
| --- | --- | --- | --- |
| 15 mc (4 opciones) | 0,5 % | 12,0 % | 0,045 |
| 10 tf | 0,0 % | 0,0 % | 0,000 |
| 25 mixta (mc + tf + respuesta corta) | 17,3 % | 50,5 % | 0,120 |

Dos límites estructurales, no de calibración: **verdadero/falso solo no detecta nada** (con una
sola forma posible de estar mal, coincidir no dice nada: la probabilidad de colisión da 1) y
**opción múltiple con 4 opciones tiene un piso matemático**:
con solo 3 respuestas incorrectas posibles, la suma de probabilidades al cuadrado nunca baja de
1/3, así que hacen falta muchas coincidencias seguidas para separarse del azar (por eso la
detección de "15 mc" sola es baja incluso con la mejor calibración). Una clase con preguntas de
respuesta corta de cola larga (muchas respuestas incorrectas distintas posibles) detecta mucho
mejor, porque ahí sí hay margen para que una coincidencia sea rara de verdad.

### Comparación: juez LLM por par, vía el ai-router (gratis)

Mismo contexto que Jev recibiría (consigna, referencia, las dos respuestas), pero con un modelo
de lenguaje de propósito general pidiéndole un juicio de copia/no copia con probabilidad,
sobre una muestra de 120 pares:

| precisión | recall | fallas de parseo o transporte | latencia p50 | latencia p95 |
| --- | --- | --- | --- | --- |
| 58,3 % | 87,5 % | 21 de 120 (17,5 %) | 629 ms | 2522 ms |

**Lo que no funcionó**: el juez LLM marca copia en **13 de los 18 pares de alumnos que solo
recitaron la definición de clase** (72,2 %), aun con el mismo contexto de qué es esperable. Es
el error exacto que este feature necesita evitar. Las señales de código no marcaron ninguno de
esos 18. Ese recall más alto (87,5 % contra el 62,5 % de fragmentos) no compensa una precisión
de 58,3 % con ese patrón de falsos positivos.

Por eso el juicio semántico se diseñó distinto: preguntas atómicas por par (misma redacción poco
común, mismo error, reescritura) con el contexto de qué es esperable dentro del estado. Si Jev
lo hace mejor que el juez LLM **todavía no está medido**: es justamente lo que falta (ver abajo).
La variante `no_context` del harness mide además cuánto aporta ese contexto.

### Jev: todavía no medido

El gateway respondió `403 customer_verification_required` (`billing_required` en los tipos de
este repo) desde el primer llamado: Vercel exige una tarjeta cargada en la cuenta incluso para
uso gratuito. El intento de evaluación (4 llamados, concurrencia 4) se cortó de inmediato sin
completar ningún par — el harness no fabrica ningún número para Jev en esta situación. Falta
T8 (`odd/tasks/jev-copy-detection.md`) una vez que la cuenta tenga la tarjeta cargada:
`EVAL_JEV=1 EVAL_JEV_VARIANTS=base,no_context,es npm run eval:copias`, más la comparación con el
juez LLM sobre los mismos 120 pares, para calibrar `SEMANTIC_STRONG_PROBABILITY` y
`SEMANTIC_REVIEW_PROBABILITY` con datos reales en vez de los valores de partida (0,9 y 0,7).

## Qué queda claro con esto

- Las señales de código son precisas (93,8–100 %) pero ciegas al parafraseo: por diseño, no por
  un error a corregir.
- El modelo de azar para preguntas cerradas evita el falso positivo masivo de un umbral fijo,
  a costa de que verdadero/falso y opción múltiple de pocas opciones aporten poco por sí solos.
- Un juez LLM genérico sería más simple de implementar, pero falla exactamente donde más
  importa no fallar: los alumnos que estudiaron y repitieron la definición de clase. Que Jev
  no caiga en lo mismo es una hipótesis hasta medirlo.
- Jev es la pieza que falta medir. Hasta entonces, el panel se lo dice al docente con
  honestidad ("no disponible ahora") en vez de mostrar un número inventado.
