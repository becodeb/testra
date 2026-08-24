import { afterEach, describe, expect, it } from "vitest";

import { getActor, isSuperadmin } from "@/server/actors";

const original = process.env.SUPERADMIN_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.SUPERADMIN_EMAILS;
  else process.env.SUPERADMIN_EMAILS = original;
});

function localsFor(email: string) {
  return {
    user: { id: "u1", email, name: "Alguien", role: "teacher" },
    session: null,
  } as unknown as App.Locals;
}

// El superadmin ve la plataforma entera, asi que quien queda adentro de la
// lista es un limite de seguridad y no una preferencia de interfaz.
describe("superadmin", () => {
  it("reconoce un correo de la lista", () => {
    process.env.SUPERADMIN_EMAILS = "jefe@escuela.edu,otra@escuela.edu";
    expect(isSuperadmin(getActor(localsFor("jefe@escuela.edu")))).toBe(true);
  });

  it("no reconoce a nadie si la lista esta vacia", () => {
    process.env.SUPERADMIN_EMAILS = "";
    expect(isSuperadmin(getActor(localsFor("jefe@escuela.edu")))).toBe(false);
  });

  it("no reconoce a nadie si la variable no existe", () => {
    delete process.env.SUPERADMIN_EMAILS;
    expect(isSuperadmin(getActor(localsFor("jefe@escuela.edu")))).toBe(false);
  });

  it("ignora mayusculas y espacios sobrantes", () => {
    process.env.SUPERADMIN_EMAILS = "  JEFE@Escuela.edu , otra@escuela.edu ";
    expect(isSuperadmin(getActor(localsFor("jefe@escuela.edu")))).toBe(true);
  });

  it("rechaza un correo que solo se parece", () => {
    process.env.SUPERADMIN_EMAILS = "jefe@escuela.edu";
    for (const impostor of ["jefe@escuela.edu.ar", "xjefe@escuela.edu", "jefe@escuela.ed", "jefe@otra.edu"]) {
      expect(isSuperadmin(getActor(localsFor(impostor))), impostor).toBe(false);
    }
  });

  it("un docente comun no es superadmin", () => {
    process.env.SUPERADMIN_EMAILS = "jefe@escuela.edu";
    const actor = getActor(localsFor("docente@escuela.edu"));
    expect(actor?.role).toBe("teacher");
    expect(actor?.superadmin).toBe(false);
    expect(isSuperadmin(actor)).toBe(false);
  });
});
