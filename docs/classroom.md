# Integración con Google Classroom

## V1: tarea con enlace

La primera versión crea una tarea de Classroom cuyo material es un enlace a la toma de Testra. No requiere una licencia paga de Classroom. El add-on embebido queda documentado como fase 2 porque depende de ediciones de pago y de un dominio de prueba compatible.

## Autorización incremental

El login inicial pide sólo identidad (`openid`, `email`, `profile`). Los permisos de Classroom se solicitan cuando el docente conecta o usa una función concreta. Better Auth conserva scopes ya otorgados en flujos posteriores.

Scopes verificados el 21/08/2026:

```text
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.rosters.readonly
https://www.googleapis.com/auth/classroom.profile.emails
https://www.googleapis.com/auth/classroom.coursework.students
```

Referencia oficial: [Choose Google Classroom API scopes](https://developers.google.com/workspace/classroom/guides/auth).

## Flujo

1. `courses.list` muestra los cursos accesibles para el docente.
2. `courses.students.list` congela el padrón esperado para la toma y permite mostrar quién falta por nombre.
3. `courses.courseWork.create` publica una tarea `ASSIGNMENT` con un material `Link` a la URL de Testra.
4. Testra guarda `classroom_course_id` y `classroom_coursework_id` en `runs`.
5. Después de corregir, el botón explícito “Enviar notas a Classroom” muestra una previsualización por alumno.
6. Tras confirmación, `studentSubmissions.patch` escribe `draftGrade` y `assignedGrade` con `updateMask=draftGrade,assignedGrade`.

## Restricciones que no se pueden ocultar

- Una tarea sólo puede crearse en nombre de un docente del curso. Se usa su token OAuth, nunca una service account genérica.
- La tarea y sus entregas quedan asociadas al proyecto de Google Cloud que las creó. Ese proyecto debe modificar las entregas después.
- No se escribe `assignedGrade` sin escribir también `draftGrade`.
- `studentSubmissions.return` no copia notas por API; Testra debe escribir ambos campos.
- Sólo se devuelve una entrega que el alumno ya entregó.
- El envío de notas nunca es automático porque afecta un registro académico externo.

Referencias: [crear CourseWork](https://developers.google.com/workspace/classroom/guides/manage-coursework), [administrar notas](https://developers.google.com/workspace/classroom/guides/classroom-api/manage-grades).

## Tokens

La cuenta de Better Auth conserva el refresh token del docente. Google suele entregar un refresh token sólo en el primer consentimiento; la configuración usa acceso offline y el producto debe explicar cómo revocar/reconectar si el token se pierde. Los tokens se cifran en reposo y nunca se mandan al navegador.

Antes de producción hay que completar la verificación OAuth de Google para scopes sensibles. Es una dependencia de lanzamiento, no una tarea de último día.
