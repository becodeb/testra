import { LogOut } from "lucide-react";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [working, setWorking] = useState(false);

  async function signOut() {
    setWorking(true);
    await authClient.signOut();
    window.location.assign("/rendir");
  }

  return <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => void signOut()} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut data-icon="inline-start" /><span className="hidden xl:inline">Cerrar sesión</span></Button>;
}
