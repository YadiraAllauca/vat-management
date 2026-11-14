// The only piece that talks to api.anthropic.com, and it lives in the service
// worker so the key stays out of the Gmail page's reach.
const LilaClaude = (() => {
  const URL_MESSAGES = "https://api.anthropic.com/v1/messages";
  const VERSION = "2026-10-21";
  const SERVER_RETRIES = 2;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const messageOf = async (response) => {
    try {
      const body = await response.json();
      return body?.error?.message ?? "";
    } catch {
      return "";
    }
  };

  async function call(body, key, fetchImpl = globalThis.fetch) {
    if (!key) throw new Error("Falta tu key de Anthropic: ponla en las opciones de la extensión.");

    const headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };

    let serverTries = 0;
    let rateLimited = false;

    for (;;) {
      let response;
      try {
        response = await fetchImpl(URL_MESSAGES, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new Error(
          `No se pudo llegar a Anthropic desde el navegador: ${error.message}`,
        );
      }

      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Tu key de Anthropic no es válida. Revísala en las opciones de la extensión.",
        );

      if (response.status === 429) {
        if (rateLimited)
          throw new Error(
            "Anthropic está limitando las peticiones. Espera un momento y vuelve a intentar.",
          );
        rateLimited = true;
        // retry-after may be an HTTP date: Number() gives NaN and sleep(NaN)
        // retried instantly.
        const raw = Number(response.headers.get("retry-after"));
        const seconds = Number.isFinite(raw) ? Math.max(0, raw) : 2;
        await sleep(seconds * 1000);
        continue;
      }

      if (response.status >= 500) {
        if (serverTries >= SERVER_RETRIES)
          throw new Error(
            `Anthropic respondió ${response.status} y no se recuperó. Vuelve a intentar.`,
          );
        serverTries += 1;
        await sleep(serverTries * 1000);
        continue;
      }

      if (!response.ok) {
        const detail = await messageOf(response);
        throw new Error(
          `Anthropic rechazó la petición (${response.status})${detail ? `: ${detail}` : "."}`,
        );
      }

      const message = await response.json();
      if (message?.stop_reason === "refusal")
        throw new Error(
          "El modelo no quiso leer este correo. Queda sin datos suficientes.",
        );

      return { message, usage: message?.usage ?? {} };
    }
  }

  return { call, URL_MESSAGES, VERSION };
})();

globalThis.LilaClaude = LilaClaude;
