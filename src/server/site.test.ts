import { beforeAll, describe, expect, it } from "vitest";

import { PUBLIC_ROUTES, isPublicRoute, normalizePath, publicUrl } from "@/server/site";

beforeAll(() => {
  process.env.BETTER_AUTH_URL = "https://testra.becode.com.ar";
});

describe("normalizePath", () => {
  it("deja una sola forma por ruta", () => {
    expect(normalizePath("/acerca")).toBe("/acerca");
    // Sin esto, `/acerca` y `/acerca/` son dos URL con el mismo contenido y la
    // segunda ni siquiera matchearía contra PUBLIC_ROUTES.
    expect(normalizePath("/acerca/")).toBe("/acerca");
    expect(normalizePath("/acerca///")).toBe("/acerca");
  });

  it("conserva la raíz", () => {
    expect(normalizePath("/")).toBe("/");
  });
});

describe("isPublicRoute", () => {
  it("reconoce las páginas públicas", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(isPublicRoute(route.path), route.path).toBe(true);
      expect(isPublicRoute(`${route.path}/`), `${route.path}/`).toBe(true);
    }
  });

  // La razón de ser de todo esto. `/rendir/<codigo>` sirve 200 sin sesión y usa
  // el mismo layout que las páginas públicas: si la indexación fuera opt-out,
  // el examen de un alumno terminaría en un buscador porque alguien se olvidó
  // de una prop.
  it("NO considera pública una toma en vivo", () => {
    expect(isPublicRoute("/rendir/K7M4QH")).toBe(false);
    expect(isPublicRoute("/rendir/K7M4QH/")).toBe(false);
  });

  it("NO considera públicas las pantallas del panel docente", () => {
    for (const path of ["/evaluaciones", "/sesiones/abc", "/correcciones", "/resultados", "/admin", "/onboarding"]) {
      expect(isPublicRoute(path), path).toBe(false);
    }
  });

  it("NO considera pública la raíz, que para un anónimo es un redirect", () => {
    expect(isPublicRoute("/")).toBe(false);
  });

  it("no se deja engañar por un prefijo compartido", () => {
    expect(isPublicRoute("/acercade")).toBe(false);
    expect(isPublicRoute("/login-falso")).toBe(false);
  });
});

describe("publicUrl", () => {
  it("arma URL absolutas sobre el dominio público", () => {
    expect(publicUrl("/acerca")).toBe("https://testra.becode.com.ar/acerca");
    expect(publicUrl("/")).toBe("https://testra.becode.com.ar/");
  });

  it("normaliza antes de publicar", () => {
    expect(publicUrl("/acerca/")).toBe("https://testra.becode.com.ar/acerca");
  });
});

describe("PUBLIC_ROUTES", () => {
  it("no tiene duplicados", () => {
    const paths = PUBLIC_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("guarda rutas ya normalizadas, que es lo que se compara", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route.path, route.path).toBe(normalizePath(route.path));
      expect(route.path.startsWith("/"), route.path).toBe(true);
    }
  });
});
