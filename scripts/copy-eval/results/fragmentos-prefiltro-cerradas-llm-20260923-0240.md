# Evaluación de detección de copia entre alumnos



Generado: 2026-09-23T02:40:29.961Z. Dataset: `scripts/copy-eval/dataset.json` (6 preguntas × 24 respuestas, 24 positivos, 24 negativos difíciles).

Métodos evaluados en esta corrida: fragmentos, prefiltro, cerradas, llm.



## 1. Señales de código en desarrollo (`computeFragmentSignals`)

Universo: 1656 pares (6 preguntas × 276), 24 positivos, 24 negativos difíciles, 1608 otros negativos.

| nivel | precisión | recall | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| strong | 100.0% | 29.2% | 7 | 0 | 17 |
| review_or_strong | 93.8% | 62.5% | 15 | 1 | 9 |

### Recall por `copyKind`

| copyKind | positivos | recall (strong) | recall (review+strong) |
| --- | --- | --- | --- |
| verbatim | 6 | 100.0% | 100.0% |
| partial | 6 | 16.7% | 83.3% |
| paraphrase | 6 | 0.0% | 0.0% |
| shared_error | 6 | 0.0% | 66.7% |

### Falsos positivos por tipo de negativo

| nivel | tipo | FP | total | tasa |
| --- | --- | --- | --- | --- |
| strong | class_definition | 0 | 18 | 0.0% |
| strong | common_misconception | 0 | 6 | 0.0% |
| strong | otros negativos | 0 | 1608 | 0.0% |
| review_or_strong | class_definition | 0 | 18 | 0.0% |
| review_or_strong | common_misconception | 0 | 6 | 0.0% |
| review_or_strong | otros negativos | 1 | 1608 | 0.1% |

### Falsos positivos, uno por uno

- [review_or_strong] FP (otro par) — q4 q4-s05 ~ q4-s14 (level=review)

### Falsos negativos, uno por uno

- [strong] FN — q1 q1-s21 ~ q1-s12 (copyKind=partial)
- [strong] FN — q1 q1-s15 ~ q1-s20 (copyKind=paraphrase)
- [strong] FN — q1 q1-s22 ~ q1-s14 (copyKind=shared_error)
- [strong] FN — q2 q2-s07 ~ q2-s10 (copyKind=partial)
- [strong] FN — q2 q2-s08 ~ q2-s20 (copyKind=paraphrase)
- [strong] FN — q2 q2-s19 ~ q2-s22 (copyKind=shared_error)
- [strong] FN — q3 q3-s21 ~ q3-s01 (copyKind=partial)
- [strong] FN — q3 q3-s14 ~ q3-s12 (copyKind=paraphrase)
- [strong] FN — q3 q3-s11 ~ q3-s16 (copyKind=shared_error)
- [strong] FN — q4 q4-s23 ~ q4-s14 (copyKind=partial)
- [strong] FN — q4 q4-s13 ~ q4-s07 (copyKind=paraphrase)
- [strong] FN — q4 q4-s18 ~ q4-s24 (copyKind=shared_error)
- [strong] FN — q5 q5-s13 ~ q5-s24 (copyKind=paraphrase)
- [strong] FN — q5 q5-s14 ~ q5-s10 (copyKind=shared_error)
- [strong] FN — q6 q6-s06 ~ q6-s20 (copyKind=partial)
- [strong] FN — q6 q6-s04 ~ q6-s02 (copyKind=paraphrase)
- [strong] FN — q6 q6-s09 ~ q6-s13 (copyKind=shared_error)
- [review_or_strong] FN — q1 q1-s21 ~ q1-s12 (copyKind=partial)
- [review_or_strong] FN — q1 q1-s15 ~ q1-s20 (copyKind=paraphrase)
- [review_or_strong] FN — q2 q2-s08 ~ q2-s20 (copyKind=paraphrase)
- [review_or_strong] FN — q2 q2-s19 ~ q2-s22 (copyKind=shared_error)
- [review_or_strong] FN — q3 q3-s14 ~ q3-s12 (copyKind=paraphrase)
- [review_or_strong] FN — q4 q4-s13 ~ q4-s07 (copyKind=paraphrase)
- [review_or_strong] FN — q5 q5-s13 ~ q5-s24 (copyKind=paraphrase)
- [review_or_strong] FN — q5 q5-s14 ~ q5-s10 (copyKind=shared_error)
- [review_or_strong] FN — q6 q6-s04 ~ q6-s02 (copyKind=paraphrase)

## 2. Prefiltro (orden real: fragmentos primero, después TF-IDF; presupuesto por pregunta)

Presupuesto por pregunta: `max(20, 3×respondentes)` = 72 de 276 pares posibles.

Recall de los 24 positivos dentro del presupuesto: **100.0%** (24/24).

| pregunta | par | copyKind | rank (1-based) | ¿entra al presupuesto? |
| --- | --- | --- | --- | --- |
| q1 | q1-s02 ~ q1-s19 | verbatim | 1 | sí |
| q1 | q1-s21 ~ q1-s12 | partial | 11 | sí |
| q1 | q1-s15 ~ q1-s20 | paraphrase | 14 | sí |
| q1 | q1-s22 ~ q1-s14 | shared_error | 2 | sí |
| q2 | q2-s23 ~ q2-s16 | verbatim | 2 | sí |
| q2 | q2-s07 ~ q2-s10 | partial | 1 | sí |
| q2 | q2-s08 ~ q2-s20 | paraphrase | 9 | sí |
| q2 | q2-s19 ~ q2-s22 | shared_error | 6 | sí |
| q3 | q3-s19 ~ q3-s15 | verbatim | 3 | sí |
| q3 | q3-s21 ~ q3-s01 | partial | 1 | sí |
| q3 | q3-s14 ~ q3-s12 | paraphrase | 7 | sí |
| q3 | q3-s11 ~ q3-s16 | shared_error | 2 | sí |
| q4 | q4-s10 ~ q4-s01 | verbatim | 1 | sí |
| q4 | q4-s23 ~ q4-s14 | partial | 3 | sí |
| q4 | q4-s13 ~ q4-s07 | paraphrase | 8 | sí |
| q4 | q4-s18 ~ q4-s24 | shared_error | 4 | sí |
| q5 | q5-s22 ~ q5-s12 | verbatim | 2 | sí |
| q5 | q5-s11 ~ q5-s02 | partial | 1 | sí |
| q5 | q5-s13 ~ q5-s24 | paraphrase | 7 | sí |
| q5 | q5-s14 ~ q5-s10 | shared_error | 6 | sí |
| q6 | q6-s15 ~ q6-s17 | verbatim | 3 | sí |
| q6 | q6-s06 ~ q6-s20 | partial | 1 | sí |
| q6 | q6-s04 ~ q6-s02 | paraphrase | 8 | sí |
| q6 | q6-s09 ~ q6-s13 | shared_error | 2 | sí |

## 5. Preguntas cerradas, simulación sin IA (calibra `CLOSED_*`)

30 alumnos, modelo logístico de habilidad/dificultad (1 parámetro), 2 pares que coluden copiando la respuesta del otro con 70% de probabilidad por pregunta, 200 semillas.

| clase | instancias colusoras (2×200) | detección strong | detección review+strong | falsos flags/clase (media) | falsos flags/clase (p95) | otros pares/clase |
| --- | --- | --- | --- | --- | --- | --- |
| 15 mc (4 opciones, distractores 60/25/15) | 400 | 7.8% | 55.0% | 19.33 | 32.00 | 433 |
| 10 tf | 400 | 0.0% | 1.0% | 1.17 | 6.00 | 433 |

## 4. Juez LLM pairwise vía el ai-router (`EVAL_LLM=1`)



Muestra: 120 pares (24 positivos + 24 negativos difíciles + 72 otros negativos al azar, semilla fija), secuencial, ~1s entre llamados.



| precisión | recall | TP | FP | FN | fallas de parseo/transporte | latencia p50 | latencia p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 58.3% | 87.5% | 21 | 15 | 3 | 21/120 | 629 ms | 2522 ms |



### Falsos positivos en negativos difíciles



| kind | FP | total | tasa |
| --- | --- | --- | --- |
| class_definition | 13 | 18 | 72.2% |
| common_misconception | 2 | 6 | 33.3% |



### Consistencia (20 pares fijos re-evaluados)

Acuerdo en `copia`: 100.0%. Diferencia absoluta de `probabilidad`: media 0.025, máxima 0.100.

### Comparación con Jev

Jev no corrió (o se cortó antes de reunir datos): no hay tabla comparativa para esta corrida.