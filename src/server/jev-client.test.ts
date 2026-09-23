import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateWithJev, jevConfigured, type JevEvaluateRequest } from "@/server/jev-client";

const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;

function setKey(value: string | undefined) {
  if (value === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setKey(ORIGINAL_KEY);
});

const sampleRequest: JevEvaluateRequest = {
  state: { texto: "hola" },
  questions: {
    es_reembolso: { type: "boolean", instructions: "¿Es un reembolso?" },
    categoria: { type: "choice", criteria: { billing: "Facturación", shipping: "Envío" } },
    puntaje: { type: "score", criteria: ["bajo", "medio", "alto"] },
  },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("jevConfigured", () => {
  it("da falso sin AI_GATEWAY_API_KEY", () => {
    setKey(undefined);
    expect(jevConfigured()).toBe(false);
  });

  it("da verdadero con la clave puesta", () => {
    setKey("test-key");
    expect(jevConfigured()).toBe(true);
  });
});

describe("evaluateWithJev", () => {
  it("no llama a fetch sin clave configurada", async () => {
    setKey(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest)).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parsea boolean, choice y score, y manda el cuerpo esperado", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "typesafe-ai/jev",
        answers: {
          es_reembolso: { type: "boolean", probability: 0.98 },
          categoria: { type: "choice", choice: "billing", probabilities: { billing: 1, shipping: 0 } },
          puntaje: { type: "score", score: 2.97, probabilities: { "0": 0, "1": 0, "2": 0.02, "3": 0.98 } },
        },
        usage: { inputTokens: 275, outputTokens: 20 },
        providerMetadata: {
          gateway: {
            routing: { originalModelId: "typesafe-ai/jev", resolvedProvider: "typesafe-ai" },
            cost: "0.00001155",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateWithJev(sampleRequest, { baseDelayMs: 0 });

    expect(result.answers.es_reembolso).toEqual({ type: "boolean", probability: 0.98 });
    expect(result.answers.categoria).toEqual({ type: "choice", choice: "billing", probabilities: { billing: 1, shipping: 0 } });
    expect(result.answers.puntaje).toMatchObject({ type: "score", score: 2.97 });
    expect(result.usage).toEqual({ inputTokens: 275, outputTokens: 20 });
    expect(result.costUsd).toBeCloseTo(0.00001155, 10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://ai-gateway.vercel.sh/v1/evaluate");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sentBody.model).toBe("typesafe-ai/jev");
    expect(sentBody.questions).toEqual(sampleRequest.questions);
    expect(sentBody.state).toEqual(sampleRequest.state);
    expect(sentBody.providerOptions).toEqual({ gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } });
  });

  // Medido contra la clave real (2026-09-23): esto es exactamente lo que
  // contesta hoy `POST /v1/evaluate`, aun para pedidos gratuitos.
  it("un 403 customer_verification_required es billing_required, sin reintentar", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { message: "AI Gateway requires a valid credit card on file…", type: "customer_verification_required" } },
        403,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({
      code: "billing_required",
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un 401 sin la firma de facturación es unauthorized", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "invalid token" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reintenta un 429 y tiene éxito en el segundo intento", async () => {
    setKey("test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "too many requests" } }, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(
        jsonResponse({
          answers: {
            es_reembolso: { type: "boolean", probability: 0.5 },
            categoria: { type: "choice", choice: "billing", probabilities: { billing: 1, shipping: 0 } },
            puntaje: { type: "score", score: 1, probabilities: { "0": 0, "1": 1, "2": 0 } },
          },
          usage: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateWithJev(sampleRequest, { baseDelayMs: 0 });
    expect(result.answers.es_reembolso).toMatchObject({ probability: 0.5 });
    expect(result.usage).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("agota los reintentos con 500 repetido: unavailable", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "boom" } }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({ code: "unavailable" });
    // Primer intento + 2 reintentos por defecto = 3 llamados.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("un error de red también agota reintentos como unavailable", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("una respuesta sin una de las preguntas pedidas es invalid_response", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ answers: { es_reembolso: { type: "boolean", probability: 0.5 } } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("una respuesta con el tipo equivocado para una pregunta es invalid_response", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        answers: {
          es_reembolso: { type: "score", score: 1, probabilities: { "0": 1 } },
          categoria: { type: "choice", choice: "billing", probabilities: { billing: 1, shipping: 0 } },
          puntaje: { type: "score", score: 1, probabilities: { "0": 1 } },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("una probabilidad fuera de [0,1] es invalid_response", async () => {
    setKey("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        answers: {
          es_reembolso: { type: "boolean", probability: 1.5 },
          categoria: { type: "choice", choice: "billing", probabilities: { billing: 1, shipping: 0 } },
          puntaje: { type: "score", score: 1, probabilities: { "0": 1 } },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(evaluateWithJev(sampleRequest, { baseDelayMs: 0 })).rejects.toMatchObject({ code: "invalid_response" });
  });
});
