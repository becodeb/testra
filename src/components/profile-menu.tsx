import { ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";

interface ProfileMenuProps {
  name: string;
  email: string;
  role: string;
  image?: string | null;
}

export function ProfileMenu({ name, email, role, image }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const showImage = Boolean(image) && !imageFailed;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnNavigation = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeKeyboard);
    document.addEventListener("astro:before-preparation", closeOnNavigation);
    window.addEventListener("popstate", closeOnNavigation);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeKeyboard);
      document.removeEventListener("astro:before-preparation", closeOnNavigation);
      window.removeEventListener("popstate", closeOnNavigation);
    };
  }, [open]);

  async function signOut() {
    setWorking(true);
    await authClient.signOut();
    window.location.assign("/rendir");
  }

  return <div ref={rootRef} className="relative">
    <button type="button" aria-label={`${name}, ${role}. Abrir menú de perfil`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((current) => !current)} className="flex items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-inset">
      <span className="grid size-8 overflow-hidden rounded-full bg-brand-soft text-xs font-bold text-brand">
        {showImage ? <img src={image!} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setImageFailed(true)} /> : <span className="grid place-items-center">{initials || "T"}</span>}
      </span>
      <span className="hidden text-right sm:block"><span className="block max-w-40 truncate text-sm font-semibold text-ink">{name}</span><span className="block text-xs text-muted">{role}</span></span>
      <ChevronDown className={`hidden size-3.5 text-muted transition-transform sm:block ${open ? "rotate-180" : ""}`} />
    </button>
    {open ? <div role="menu" className="absolute right-0 z-40 mt-2 w-64 rounded-lg border bg-paper p-2 shadow-[0_14px_36px_rgba(5,24,81,.14)]">
      <div className="border-b px-2 py-2"><p className="truncate text-sm font-semibold text-ink">{name}</p><p className="mt-0.5 truncate text-xs text-muted">{email}</p></div>
      <button role="menuitem" type="button" disabled={working} onClick={() => void signOut()} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold text-alert hover:bg-alert/5 disabled:opacity-50"><LogOut className="size-4" />{working ? "Cerrando…" : "Cerrar sesión"}</button>
    </div> : null}
  </div>;
}
