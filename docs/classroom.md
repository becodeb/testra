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
5. Al cerrar la corrección, el docente publica los resultados desde `/resultados`. Es un solo gesto y sigue siendo explícito.
6. `studentSubmissions.patch` escribe `draftGrade` y `assignedGrade` con `updateMask=draftGrade,assignedGrade`.
7. `studentSubmissions.return` devuelve la entrega. **Sin este paso la nota existe pero el alumno no la ve**, porque `assignedGrade` sólo se le muestra a partir de que la entrega fue devuelta.

## Restricciones que no se pueden ocultar

- Una tarea sólo puede crearse en nombre de un docente del curso. Se usa su token OAuth, nunca una service account genérica.
- La tarea y sus entregas quedan asociadas al proyecto de Google Cloud que las creó. Ese proyecto debe modificar las entregas después.
- No se escribe `assignedGrade` sin escribir también `draftGrade`.
- `studentSubmissions.return` no copia notas por API; Testra escribe ambos campos y después devuelve la entrega.
- **No se exige que el alumno haya entregado en Classroom.** El que rinde en Testra entra por el enlace y nunca toca el botón de entregar, así que su entrega se queda en `CREATED`. La API permite escribir notas en cualquier estado; la restricción anterior a `TURNED_IN` dejaba al curso entero sin nota.
- El envío de notas nunca es automático porque afecta un registro académico externo. Lo dispara la publicación de resultados, que es una acción deliberada del docente y exige que no queden desarrollos sin corregir.
- Que Classroom falle no deshace la publicación: la nota ya es definitiva en Testra y el envío se puede reintentar.

Referencias: [crear CourseWork](https://developers.google.com/workspace/classroom/guides/manage-coursework), [administrar notas](https://developers.google.com/workspace/classroom/guides/classroom-api/manage-grades).

## Tokens

La cuenta de Better Auth conserva el refresh token del docente. Google suele entregar un refresh token sólo en el primer consentimiento; la configuración usa acceso offline y el producto debe explicar cómo revocar/reconectar si el token se pierde. Los tokens no se mandan nunca al navegador. **No están cifrados en reposo**: `account.encryptOAuthTokens` de better-auth está desactivado, así que `accounts.access_token` y `accounts.refresh_token` se guardan en claro y quedan protegidos sólo por el acceso a la base.

Antes de producción hay que completar la verificación OAuth de Google para scopes sensibles. Es una dependencia de lanzamiento, no una tarea de último día.
