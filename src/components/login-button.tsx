import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function LoginButton({ callbackURL }: { callbackURL: string }) {
  const [loading, setLoading] = useState(false);
  return <Button type="button" className="w-full" disabled={loading} onClick={async () => { setLoading(true); await authClient.signIn.social({ provider: "google", callbackURL }); setLoading(false); }}>{loading ? "Abriendo Google…" : "Continuar con Google"}</Button>;
}
