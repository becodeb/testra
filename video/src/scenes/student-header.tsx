import { TESTRA_MARK as testraMark } from "../assets";

/** StudentLayout header, logged out (so it offers "Entrar"). */
export function StudentHeader() {
  return (
    <header className="border-b bg-paper">
      <div className="mx-auto flex h-[3.75rem] max-w-[1020px] items-center justify-between px-4 lg:px-6">
        <a className="flex items-center gap-2.5" aria-label="Testra, inicio"><span className="testra-mark" aria-hidden="true"><img src={testraMark} alt="" width={128} height={128} /></span><span className="font-bold tracking-[-.025em] text-brand-deep">Testra</span></a>
        <nav className="flex items-center gap-4 text-xs font-medium text-muted" aria-label="Navegación">
          <a>Acerca de</a>
          <a>Qué se registra</a>
          <a className="inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-white">Entrar</a>
        </nav>
      </div>
    </header>
  );
}

