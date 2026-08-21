# Despliegue de Testra

## Plataforma requerida

El Worker, D1 y `ExamRunDO` forman una sola unidad. Un hosting de contenedores no ofrece la semántica de Durable Objects, alarmas ni WebSocket Hibernation. Por eso el runtime de producción se despliega en Cloudflare Workers. Coolify publica el dominio final mediante un proxy liviano hacia el Worker.

## 1. Cloudflare

```powershell
npx wrangler login
npx wrangler d1 create testra-db
```

Copiar el `database_id` resultante a `wrangler.jsonc` y luego:

```powershell
npm run db:migrate:remote
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy
```

El Worker queda publicado en `https://testra.testra-becode.workers.dev`. La URL pública de autenticación sigue siendo `https://testra.becode.com.ar` mediante `BETTER_AUTH_URL`.

No ejecutar `scripts/seed.sql` en producción salvo que se quiera una instalación demostrativa. `ALLOW_DEMO_AUTH` está fijado en `false` para el Worker publicado.

## 2. Coolify

La aplicación `testra` usa el Dockerfile de `deploy/proxy/Dockerfile`, expone el puerto 80 y publica `https://testra.becode.com.ar`. El proxy conserva el host público y dirige el tráfico al Worker. Esta separación permite usar la cuenta de Cloudflare del Worker aunque la zona DNS esté administrada por otra cuenta.

El chequeo de salud de Coolify está desactivado para este proxy; el estado efectivo se verifica solicitando `/login` y `/api/auth/get-session` desde el dominio público.

## 3. Google Cloud

Crear credenciales OAuth Web y autorizar:

```text
https://testra.becode.com.ar/api/auth/callback/google
```

Configurar la pantalla de consentimiento y solicitar verificación para los scopes sensibles de Classroom documentados en `docs/classroom.md`. El login inicial sólo pide `openid`, `email` y `profile`.

Para habilitar docentes, definir `TEACHER_EMAILS` como variable separada por comas o implementar el aprovisionamiento institucional correspondiente. Sin allowlist, el onboarding sólo puede asignar el rol alumno.

## 4. Comprobación posterior

1. Iniciar sesión con una cuenta de prueba docente.
2. Crear una evaluación y verificar que reaparece al recargar.
3. Crear una toma, entrar con otra cuenta y comprobar el WebSocket.
4. Guardar una respuesta, recargar y confirmar su recuperación.
5. Finalizar, corregir un desarrollo y revisar el total.
6. Vincular un curso de prueba y publicar una tarea.

Los logs de observabilidad están habilitados en `wrangler.jsonc`; no deben registrar tokens OAuth ni respuestas de alumnos.
