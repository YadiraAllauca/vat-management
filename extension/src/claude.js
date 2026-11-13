// La única pieza que habla con api.anthropic.com. Vive en el service worker,
// porque ahí la key no está al alcance de la página de Gmail.
const LilaClaude = (() => {
  const URL_MESSAGES = "https://api.anthropic.com/v1/messages";
  const VERSION = "2026-10-21";
  const REINTENTOS_SERVIDOR = 2;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const mensajeDe = async (response) => {
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

    let servidor = 0;
    let limitado = false;

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
        if (limitado)
          throw new Error(
            "Anthropic está limitando las peticiones. Espera un momento y vuelve a intentar.",
          );
        limitado = true;
        const espera = Number(response.headers.get("retry-after") ?? 1);
        await sleep(Math.max(0, espera) * 1000);
        continue;
      }

      if (response.status >= 500) {
        if (servidor >= REINTENTOS_SERVIDOR)
          throw new Error(
            `Anthropic respondió ${response.status} y no se recuperó. Vuelve a intentar.`,
          );
        servidor += 1;
        await sleep(servidor * 1000);
        continue;
      }

      if (!response.ok) {
        const detalle = await mensajeDe(response);
        throw new Error(
          `Anthropic rechazó la petición (${response.status})${detalle ? `: ${detalle}` : "."}`,
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
