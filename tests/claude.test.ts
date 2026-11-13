import assert from "node:assert/strict";
import test from "node:test";
import "../extension/src/claude.js";

const claude = (globalThis as any).LilaClaude;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

test("manda los cuatro encabezados obligatorios", async () => {
  let visto: any = null;
  const falso = async (_url: string, init: any) => {
    visto = init;
    return ok({ content: [], usage: {} });
  };
  await claude.call({ model: "claude-opus-5-5" }, "sk-ant-x", falso as any);
  assert.equal(visto.headers["anthropic-version"], "2026-10-21");
  assert.equal(
    visto.headers["anthropic-dangerous-direct-browser-access"],
    "true",
  );
  assert.equal(visto.headers["x-api-key"], "sk-ant-x");
  assert.equal(visto.headers["content-type"], "application/json");
});

test("un 401 se traduce a un mensaje sobre la key", async () => {
  const falso = async () =>
    new Response(
      JSON.stringify({ error: { type: "authentication_error", message: "x" } }),
      { status: 401 },
    );
  await assert.rejects(() => claude.call({}, "mala", falso as any), /key/i);
});

test("un 429 reintenta una vez y después se rinde", async () => {
  let veces = 0;
  const falso = async () => {
    veces += 1;
    return new Response("{}", {
      status: 429,
      headers: { "retry-after": "0" },
    });
  };
  await assert.rejects(() => claude.call({}, "k", falso as any));
  assert.equal(veces, 2);
});

test("sin key la llamada ni sale", async () => {
  const falso = (() => {
    throw new Error("no debió llamar");
  }) as any;
  await assert.rejects(() => claude.call({}, "", falso), /falta tu key/i);
});

test("un rechazo del modelo se distingue de un error de red", async () => {
  const falso = async () =>
    ok({ content: [], stop_reason: "refusal", usage: {} });
  await assert.rejects(() => claude.call({}, "k", falso as any), /no quiso/i);
});

test("devuelve el mensaje y el uso para poder contar el gasto", async () => {
  const falso = async () =>
    ok({
      content: [{ type: "text", text: "{}" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  const { message, usage } = await claude.call({}, "k", falso as any);
  assert.equal(message.content[0].text, "{}");
  assert.equal(usage.input_tokens, 10);
});
