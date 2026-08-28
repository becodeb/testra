// Reemplaza el binding `env` de `cloudflare:workers`. En Coolify las variables
// llegan por el entorno del contenedor, así que se leen de `process.env`.
//
// Los accesos son perezosos a propósito: `astro build` importa estos módulos
// durante el empaquetado, cuando todavía no existe ninguna variable de entorno.
// Si se leyeran al cargar el módulo, la imagen de Docker no podría construirse.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const serverEnv = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get BETTER_AUTH_SECRET() {
    return required("BETTER_AUTH_SECRET");
  },
  get BETTER_AUTH_URL() {
    return required("BETTER_AUTH_URL");
  },
  get GOOGLE_CLIENT_ID() {
    return optional("GOOGLE_CLIENT_ID") ?? "";
  },
  get GOOGLE_CLIENT_SECRET() {
    return optional("GOOGLE_CLIENT_SECRET") ?? "";
  },
  // Inferencia en GMI Cloud (MiniMax M3). Ver `src/server/ai-client.ts`.
  get GMI_API_KEY() {
    return optional("GMI_API_KEY") ?? "";
  },
  get ALLOW_DEMO_AUTH() {
    return optional("ALLOW_DEMO_AUTH");
  },
  // Lista separada por comas. Se resuelve por correo y no por una columna en la
  // base a proposito: asi se puede dar de alta a alguien que todavia no tiene
  // cuenta, y nadie puede volverse superadmin escribiendo en la base.
  get SUPERADMIN_EMAILS() {
    return optional("SUPERADMIN_EMAILS");
  },
};

export type ServerEnv = typeof serverEnv;
