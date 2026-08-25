# Despliegue de Testra

## Plataforma

Testra corre como un único contenedor Node en la VM de Coolify, con Postgres al
lado. La aplicación sirve las páginas, la API y los WebSockets de las tomas en
vivo desde el mismo proceso.

Antes esto vivía en Cloudflare Workers: D1 como base y un Durable Object por toma
para el reloj y las conexiones. `docs/architecture.md` explica cómo se reemplazó
cada pieza.

### Una sola réplica

El estado de una toma en vivo —quién está conectado, el reloj, los incidentes en
curso— vive en el proceso que atiende las peticiones. Esa es la razón de que todo
sea instantáneo: un heartbeat no cruza ninguna red antes de llegar al panel del
docente.

La contrapartida es que **la aplicación debe correr en una sola instancia**. Con
dos réplicas, dos alumnos del mismo examen pueden caer en procesos distintos y
dejar de verse entre sí. En Coolify hay que dejar la cantidad de réplicas en 1 y
escalar de forma vertical, dándole más CPU y memoria al contenedor.

Lo durable no depende de eso: todo lo que importa se escribe en Postgres a
medida que ocurre. Si el proceso se reinicia en mitad de una toma, el actor se
rehidrata de la base y la toma sigue.

## Capacidad

`scripts/loadtest.mjs` levanta un aula entera de sesiones de invitado reales
—cada alumno con su cookie, su WebSocket y su ritmo de guardado— contra un
servidor ya corriendo. No apuntarlo nunca a producción.

```bash
node scripts/loadtest.mjs --students=100 --seconds=30
```

Medido contra Postgres 17 en Docker, con el servidor y la base en la misma
máquina:

| Escenario | Reparto a los alumnos | Heartbeat | Cierre de la toma |
| --- | --- | --- | --- |
| 100 alumnos, 1 aula | 2 ms | 5 ms | 0,5 s |
| 300 alumnos, 1 aula | 6 ms | 12 ms | 1,3 s |
| 500 alumnos, 1 aula | 9 ms | 10 ms | 2,5 s |
| 4 aulas de 100 en paralelo | 1 ms | 2 ms | 0,5 s |

Con 400 alumnos repartidos en cuatro tomas simultáneas el proceso se mantuvo en
148 MB de memoria y consumió 6 segundos de CPU en toda la prueba. El docente vio
a los 100 participantes de cada aula.

Lo que marca el techo no es la aplicación sino el `fsync` de Postgres al
confirmar cada transacción. En el disco virtualizado de la prueba una escritura
tardaba 32 ms, contra menos de 1 ms en un SSD normal: con eso, cerrar una toma
de 300 alumnos pasó de 11,8 s a 1,3 s sin tocar una línea de código. En la VM
conviene darle a Postgres un disco decente antes que más CPU a la aplicación.

## 1. Postgres

Crear la base en Coolify, o usar el servicio `postgres` de `docker-compose.yml`.
La aplicación aplica las migraciones sola al arrancar (`npm start` corre
`scripts/migrate.mjs` antes de escuchar), así que no hay ningún paso manual.

No ejecutar `scripts/seed.sql` en producción salvo que se quiera una instalación
demostrativa.

## 2. La aplicación en Coolify

Aplicación de tipo Dockerfile, apuntando al `Dockerfile` de la raíz. Expone el
puerto 3000 y publica `https://testra.becode.com.ar`.

Variables de entorno:

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | sí | Conexión a Postgres |
| `BETTER_AUTH_URL` | sí | Dominio público con el que se firman las sesiones |
| `BETTER_AUTH_SECRET` | sí | 32 caracteres aleatorios como mínimo |
| `GOOGLE_CLIENT_ID` | no | Acceso con Google y Classroom |
| `GOOGLE_CLIENT_SECRET` | no | Ídem |
| `OPENROUTER_API_KEY` | no | Informes de integridad por IA |
| `ALLOW_DEMO_AUTH` | no | Debe quedar sin definir o en `false` |
| `DATABASE_POOL_MAX` | no | Conexiones del pool, 12 por omisión |

El chequeo de salud es `GET /api/health`, que responde 200 solo si además puede
hablar con Postgres. A diferencia del proxy anterior, ahora se puede dejar
activado.

El proxy de Coolify tiene que **permitir el upgrade a WebSocket** sobre
`/api/runs/*/socket`. Traefik lo hace por omisión; si se cambió la configuración,
hay que verificarlo antes de una toma real.

## 3. Google Cloud

Crear credenciales OAuth Web y autorizar:

```text
https://testra.becode.com.ar/api/auth/callback/google
```

El acceso principal usa Google; correo y contraseña sigue disponible como alternativa. Configurar la
pantalla de consentimiento y solicitar verificación para los scopes sensibles de
Classroom documentados en `docs/classroom.md` antes de habilitar esa integración.

Cualquier persona puede crear una cuenta docente sin organización, agrupación por
dominio ni aprobación previa. Las relaciones históricas con organizaciones se
conservan como datos opcionales.

## 4. Migrar los datos de la D1 anterior

`scripts/d1-to-postgres.mjs` copia los datos de la D1 de producción a Postgres.
Sobre D1 solo ejecuta `SELECT`: el origen no se toca.

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/d1-to-postgres.mjs --dry-run
```

El ensayo solo informa cuántas filas hay en cada tabla. Sin `--dry-run` hace la
carga real, dentro de una transacción y saltando lo que ya exista, así que se
puede repetir sin duplicar.

Hacerlo con la aplicación nueva detenida, para que nadie escriba en Postgres
mientras se copia.

## 5. Comprobación posterior

1. `GET /api/health` devuelve 200.
2. Iniciar sesión con una cuenta de prueba docente.
3. Crear una evaluación y verificar que reaparece al recargar.
4. Crear una toma, entrar con otra cuenta y comprobar el WebSocket.
5. Guardar una respuesta, recargar y confirmar su recuperación.
6. Reiniciar el contenedor con la toma en curso: el reloj y los participantes
   tienen que volver solos.
7. Finalizar, corregir un desarrollo y revisar el total.
8. Vincular un curso de prueba y publicar una tarea.

Los logs no deben registrar tokens OAuth ni respuestas de alumnos.
