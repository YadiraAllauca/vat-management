// El contrato con el modelo. Puro: sin fetch, sin DOM, sin chrome.
// Se carga en el service worker (importScripts) y en los tests.
const LilaAI = (() => {
  // LilaParse y LilaClave se leen dentro de cada función, nunca al construir
  // este IIFE: el orden de carga lo fijan dos listas distintas (el manifiesto
  // y el importScripts del service worker) y no se puede depender de él.
  const parse = () => globalThis.LilaParse;
  const clave = () => globalThis.LilaClave;

  const MAX_TOKENS = 4000;

  const TRIAGE_SCHEMA = {
    type: "object",
    properties: {
      filas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            esGasto: { type: "boolean" },
            motivo: { type: "string" },
          },
          required: ["id", "esGasto", "motivo"],
          additionalProperties: false,
        },
      },
    },
    required: ["filas"],
    additionalProperties: false,
  };

  const nullable = (type) => ({ type: [type, "null"] });

  const EXTRACT_SCHEMA = {
    type: "object",
    properties: {
      esGasto: { type: "boolean" },
      motivo: { type: "string" },
      emisor: nullable("string"),
      rucEmisor: nullable("string"),
      claveAcceso: nullable("string"),
      serie: nullable("string"),
      fecha: nullable("string"),
      identificacionReceptor: nullable("string"),
      valorSinImpuestos: nullable("string"),
      iva: nullable("string"),
      importeTotal: nullable("string"),
      referenciaBanco: nullable("string"),
      fuente: { type: "string", enum: ["xml", "pdf", "texto"] },
    },
    required: ["esGasto", "motivo", "fuente"],
    additionalProperties: false,
  };

  const TRIAGE_SYSTEM = `Eres el filtro de una herramienta que registra gastos para una declaración de impuestos en Ecuador.

Recibes filas de una bandeja de Gmail: remitente, asunto y fragmento. Por cada una dices si el correo parece contener un gasto que el usuario hizo.

Sí son gastos:
- facturas electrónicas (traen RIDE, clave de acceso, "comprobante autorizado")
- avisos de banco o tarjeta por un consumo, débito, pago o retiro ya ocurrido
- recibos de servicios y suscripciones, en español o en inglés

No son gastos:
- promociones, ofertas, cupones, "aprovecha", newsletters
- avisos de seguridad, claves, inicios de sesión
- estados de cuenta o resúmenes mensuales, que no son una transacción
- recordatorios de pago o cobros futuros que todavía no ocurrieron
- facturas que el propio usuario emitió a sus clientes

Ante la duda, di que sí: un falso positivo cuesta abrir un correo; un falso negativo pierde un gasto. El motivo es una frase corta en español.`;

  const EXTRACT_SYSTEM = `Eres el lector de una herramienta que registra gastos para una declaración de impuestos en Ecuador. Recibes un correo completo —asunto, remitente, cuerpo, y a veces el XML o el PDF de la factura— y devuelves los datos del comprobante.

Decides tú de dónde sacas cada dato. Si viene el XML de la factura electrónica, mándalo él: es la fuente oficial. Si solo viene el PDF (el RIDE), léelo. Si no viene nada adjunto, usa el texto del correo.

Los campos corresponden al informe de compras del SRI:
- rucEmisor: 13 dígitos de quien emitió la factura.
- emisor: la razón social de quien VENDIÓ, no la de quien mandó el correo. En un aviso de banco, el banco es el mensajero: el emisor es el comercio ("Consumo por $7.25 en MARKET CENTRAL SUR" → MARKET CENTRAL SUR). En un correo reenviado, vale el "De:" que copia la cabecera de reenvío, no quien te lo reenvió.
- claveAcceso: los 49 dígitos, si aparecen.
- serie: formato 001-001-000000123.
- fecha: la de EMISIÓN del comprobante, en formato YYYY-MM-DD. No la de recepción del correo. Si no la encuentras, null.
- identificacionReceptor: a nombre de quién está el comprobante. 13 dígitos si es un RUC, 10 si es una cédula. Si el correo no lo dice —lo normal en un aviso de banco— devuelve null. No lo inventes.
- valorSinImpuestos, iva, importeTotal: en dólares, con punto decimal. Si el documento no menciona IVA, deja iva en null.
- referenciaBanco: número de transacción, autorización o comprobante, cuando no hay serie.

Dos trampas del texto corrido:
- La hora no es dinero. "a las 10:21 se debitó el valor de $12.60" → el total es 12.60, no 21.
- Un separador al final cierra la frase. "$12.60," son doce dólares con sesenta, no mil doscientos sesenta.

Y una del texto extraído de un PDF: el importe suele dibujarse ANTES de su etiqueta ("34.99 VALOR TOTAL"), al revés que en el cuerpo de un correo ("Total: $10.00").

Si el correo no contiene ningún gasto, devuelve esGasto false y explica por qué en motivo. No inventes ningún dato: un campo que no puedas leer va en null.`;

  const formatOf = (schema) => ({ type: "json_schema", schema });

  const base = (model, schema) => ({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "low", format: formatOf(schema) },
  });

  function triageBody(rows, { model }) {
    const listado = rows.map(({ id, sender, subject, snippet }) => ({
      id,
      remitente: sender ?? "",
      asunto: subject ?? "",
      fragmento: (snippet ?? "").slice(0, 300),
    }));
    return {
      ...base(model, TRIAGE_SCHEMA),
      system: [
        {
          type: "text",
          text: TRIAGE_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: JSON.stringify(listado) }],
        },
      ],
    };
  }

  const decode = (base64) => {
    try {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return "";
    }
  };

  function extractBody(email, { model, lessons = [] }) {
    const content = [];
    const attachments = email.attachments ?? [];

    // Los bloques document van antes del texto.
    for (const one of attachments)
      if (one.kind === "pdf")
        content.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: one.base64,
          },
        });

    for (const one of attachments)
      if (one.kind === "xml") {
        const xml = one.text ?? decode(one.base64);
        if (xml)
          content.push({
            type: "text",
            text: `XML adjunto de la factura:\n${xml}`,
          });
      }

    content.push({
      type: "text",
      text: [
        `Asunto: ${email.subject ?? ""}`,
        `Remitente: ${email.sender ?? ""}`,
        "",
        "Cuerpo:",
        email.text ?? "",
      ].join("\n"),
    });

    const system = [
      { type: "text", text: EXTRACT_SYSTEM, cache_control: { type: "ephemeral" } },
    ];
    if (lessons.length)
      system.push({
        type: "text",
        text:
          "Correcciones que el usuario ya hizo sobre correos de este mismo emisor:\n" +
          lessons.map((one) => `- ${one.nota}`).join("\n"),
      });

    return {
      ...base(model, EXTRACT_SCHEMA),
      system,
      messages: [{ role: "user", content }],
    };
  }

  function jsonOf(message) {
    const block = (message?.content ?? []).find((one) => one.type === "text");
    if (!block?.text) throw new Error("El modelo no devolvió ninguna respuesta.");
    try {
      return JSON.parse(block.text);
    } catch {
      throw new Error("El modelo no devolvió un JSON que se pueda leer.");
    }
  }

  function readTriage(message) {
    const parsed = jsonOf(message);
    if (!Array.isArray(parsed?.filas))
      throw new Error("El modelo no devolvió la lista de filas.");
    return parsed.filas
      .filter((one) => typeof one?.id === "string")
      .map((one) => ({
        id: one.id,
        esGasto: one.esGasto === true,
        motivo: typeof one.motivo === "string" ? one.motivo : "",
      }));
  }

  function readExtract(message) {
    const parsed = jsonOf(message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("El modelo no devolvió un objeto.");
    if (typeof parsed.esGasto !== "boolean")
      throw new Error("El modelo no devolvió si el correo es un gasto.");
    return parsed;
  }

  // "2026-03-15" -> "15/03/2026". Null si la fecha no existe de verdad.
  function dmyFrom(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
    if (!match) return null;
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(+year, +month - 1, +day));
    if (
      date.getUTCFullYear() !== +year ||
      date.getUTCMonth() !== +month - 1 ||
      date.getUTCDate() !== +day
    )
      return null;
    return `${day}/${month}/${year}`;
  }

  const ID = /^\d{10}(\d{3})?$/;

  function fieldsFrom(answer, email = {}) {
    const { normalizeAmount, cedulaOk } = parse();
    const text = `${email.text ?? ""}\n${email.xmlText ?? ""}`;

    // La clave de acceso es exacta: si aparece en el texto, manda sobre el
    // modelo. Si no, se acepta la que devolvió el modelo pero solo si pasa el
    // módulo 11.
    const fromText = clave().all(text).find((one) => one.tipo === "01") ?? null;
    const stated =
      !fromText && typeof answer.claveAcceso === "string"
        ? clave().parse(answer.claveAcceso)
        : null;
    const found = fromText ?? (stated?.tipo === "01" ? stated : null);

    const modelDate = dmyFrom(answer.fecha);
    const fecha = found?.fecha ?? modelDate ?? email.receivedAt ?? null;
    const guessedDate = Boolean(!found && !modelDate && fecha);

    const total = normalizeAmount(answer.importeTotal ?? "");
    const iva = normalizeAmount(answer.iva ?? "");
    const baseAmount = normalizeAmount(answer.valorSinImpuestos ?? "");

    const problems = [];
    if (baseAmount && iva && total) {
      const sum = Math.round((Number(baseAmount) + Number(iva)) * 100);
      if (Math.abs(sum - Math.round(Number(total) * 100)) > 2)
        problems.push("el importe total no cuadra con base + IVA");
    }

    const claimed =
      typeof answer.identificacionReceptor === "string" &&
      ID.test(answer.identificacionReceptor)
        ? answer.identificacionReceptor
        : null;
    const recipient =
      claimed && cedulaOk(claimed.slice(0, 10)) ? claimed : null;

    const serie =
      found?.serie ??
      (typeof answer.serie === "string" && /^\d{3}-\d{3}-\d{9}$/.test(answer.serie)
        ? answer.serie
        : null);

    return {
      serie,
      reference: serie ? null : (answer.referenciaBanco ?? null),
      fecha,
      recipient,
      base: baseAmount,
      iva,
      total,
      clave: found?.clave ?? null,
      ruc: found?.ruc ?? answer.rucEmisor ?? null,
      emisor: answer.emisor ?? null,
      guessedDate,
      source: answer.fuente ?? "texto",
      problems,
    };
  }

  return {
    TRIAGE_SCHEMA,
    EXTRACT_SCHEMA,
    TRIAGE_SYSTEM,
    EXTRACT_SYSTEM,
    MAX_TOKENS,
    triageBody,
    extractBody,
    readTriage,
    readExtract,
    fieldsFrom,
    dmyFrom,
  };
})();

globalThis.LilaAI = LilaAI;
