# Testra

Testra permite que un docente cree evaluaciones, lance una toma en vivo, supervise el progreso, corrija desarrollos y devuelva notas a Google Classroom. Docentes y alumnos pueden crear una cuenta con correo y contraseña, entrar a una sala y trabajar con reloj y autosave controlados por el servidor.

## Alcance implementado

- CRUD y duplicación de evaluaciones con editor de cinco tipos de pregunta.
- Importación desde texto, reordenamiento, puntaje total, validación y borradores incompletos.
- Tomas con copia congelada de preguntas y código sin caracteres ambiguos.
- Sala, inicio forzado, ajuste de tiempo, cierre manual y cierre por alarma.
- Runtime del alumno con recuperación de respuestas, reconexión, entrega manual o automática.
- Vigilancia transparente de navegador y señales de servidor; nunca modifica la nota.
- Autocorrección en servidor y cola de corrección manual con override docente.
- Registro e inicio de sesión con correo y contraseña; Google OAuth queda disponible para integraciones cuando haya credenciales válidas.
- Google Classroom Opción A: cursos, roster, tarea con link y devolución explícita de notas.
- Postgres, WebSockets en proceso para las tomas en vivo, CI, Vitest, Playwright y Axe.

## Desarrollo local

Requiere Node.js 22.12 o posterior.

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run db:setup
npm run dev
```

Con `ALLOW_DEMO_AUTH=true`, el entorno local ofrece identidades de docente y alumno sin depender de credenciales externas. Datos de ejemplo:

- Panel docente: `http://127.0.0.1:4321/evaluaciones`
- Toma activa: `http://127.0.0.1:4321/tomas/run-biology-demo`
- Alumno: `http://127.0.0.1:4321/rendir/demo`
- Corrección manual: `http://127.0.0.1:4321/correcciones`

En producción `ALLOW_DEMO_AUTH` debe permanecer en `false`.

## Verificación

```powershell
npm run check
npm test
npm run test:e2e
npm run build
```

Para probar la imagen de producción tal cual la va a correr Coolify:

```powershell
docker compose up --build
```

## Detección de copia entre alumnos

Compara a los alumnos de una toma entre sí (ver
[docs/vigilancia.md](docs/vigilancia.md#coincidencias-entre-alumnos) y
[docs/coincidencias-evaluacion.md](docs/coincidencias-evaluacion.md)). Las señales de código no
necesitan nada extra; la parte semántica usa Jev (TypeSafe AI) vía Vercel AI Gateway:

- `AI_GATEWAY_API_KEY` en `.env` (ver `.env.example`). **Vercel exige una tarjeta cargada en la
  cuenta del gateway incluso para el uso gratuito**: sin eso, el gateway responde
  `billing_required` y el panel avisa que la revisión de redacción no está disponible por ahora,
  mostrando igual las señales de código.
- `npm run eval:copias` corre el harness de evaluación contra el dataset fijo
  (`scripts/copy-eval/`).
- `npm run db:seed:coincidencias` carga una toma de demostración con 24 alumnos
  (`http://127.0.0.1:4321/resultados?run=run-coincidencias-demo`).

## Producción

Testra corre como un solo contenedor Node en la VM de Coolify, con Postgres al
lado. La guía completa está en [docs/deployment.md](docs/deployment.md).

Resumen:

1. Crear la base Postgres en Coolify.
2. Desplegar la aplicación desde el `Dockerfile` de la raíz, en **una sola
   réplica**: el estado de las tomas en vivo vive en el proceso.
3. Configurar `DATABASE_URL`, `BETTER_AUTH_URL` y `BETTER_AUTH_SECRET`; si se
   habilita Google, además `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
4. Autorizar `https://testra.becode.com.ar/api/auth/callback/google` en Google
   Cloud antes de mostrar el acceso con Google.
5. Verificar que el proxy permita el upgrade a WebSocket en `/api/runs/*/socket`.

Las migraciones se aplican solas al arrancar el contenedor.

Nunca publiques `.env`, tokens de Coolify, credenciales de Postgres ni claves de proveedores de IA.

## SEO e indexación

- El indexado es fail-closed: `PUBLIC_ROUTES` en `src/server/site.ts` es la
  única fuente de verdad tanto para el `robots` de cada página como para el
  sitemap.
- Después de deployar cambios en páginas públicas, corré
  `node scripts/indexnow.mjs` para avisarle a Bing, Yandex, Seznam y Naver.
  Google no usa IndexNow: para Google, el sitemap
  (`https://testra.becode.com.ar/sitemap.xml`) se carga en Search Console.
- Los íconos y la tarjeta social se regeneran con
  `node scripts/generate-icons.mjs`.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Vigilancia y límites](docs/vigilancia.md)
- [Evaluación de coincidencias entre alumnos](docs/coincidencias-evaluacion.md)
- [Google Classroom](docs/classroom.md)
- [Despliegue](docs/deployment.md)
- [Convenciones visuales](CONTRIBUTING.md)
