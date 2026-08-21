import { env } from "cloudflare:workers";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { drizzle } from "drizzle-orm/d1";

import { accounts, sessions, users, verifications } from "@/server/db/schema";

const runtimeEnv = env as unknown as CloudflareEnv;
const db = drizzle(runtimeEnv.DB);

export const auth = betterAuth({
  appName: "Testra",
  baseURL: runtimeEnv.BETTER_AUTH_URL,
  secret: runtimeEnv.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  socialProviders: {
    google: {
      clientId: runtimeEnv.GOOGLE_CLIENT_ID,
      clientSecret: runtimeEnv.GOOGLE_CLIENT_SECRET,
      accessType: "offline",
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
    },
  },
  user: {
    additionalFields: {
      role: {
        type: ["teacher", "student"],
        required: true,
        defaultValue: "student",
        input: false,
      },
      orgId: {
        type: "string",
        required: false,
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
