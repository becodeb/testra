import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/node-postgres";

import { getPool } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import { serverEnv } from "@/server/env";

function createAuth() {
  const db = drizzle(getPool());

  return betterAuth({
    appName: "Testra",
    baseURL: serverEnv.BETTER_AUTH_URL,
    secret: serverEnv.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    socialProviders: {
      google: {
        clientId: serverEnv.GOOGLE_CLIENT_ID,
        clientSecret: serverEnv.GOOGLE_CLIENT_SECRET,
        accessType: "offline",
        prompt: "select_account consent",
        scope: ["openid", "email", "profile"],
        // Actualiza nombre y foto en cada acceso desde el perfil de Google.
        overrideUserInfoOnSignIn: true,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        requireLocalEmailVerified: false,
        allowDifferentEmails: true,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: ["teacher", "student"],
          required: true,
          defaultValue: "teacher",
          input: false,
        },
        orgId: {
          type: "string",
          required: false,
          input: false,
        },
        orgAdmin: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
        },
        googleSub: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

export function getAuth(): Auth {
  if (!instance) instance = createAuth();
  return instance;
}

// La instancia se crea al primer uso, no al importar el módulo. `astro build`
// importa este archivo durante el empaquetado y ahí todavía no existen
// BETTER_AUTH_SECRET ni DATABASE_URL: construirla al vuelo rompería la imagen
// de Docker. El proxy conserva la forma de siempre (`auth.handler`,
// `auth.api.getSession`) para no tocar las llamadas existentes.
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, property, receiver) {
    return Reflect.get(getAuth(), property, receiver);
  },
});
