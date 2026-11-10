const LilaParse = (() => {
  const clave = globalThis.LilaClave;

  const HEADER = [
    "RUC_EMISOR",
    "RAZON_SOCIAL_EMISOR",
    "TIPO_COMPROBANTE",
    "SERIE_COMPROBANTE",
    "CLAVE_ACCESO",
    "FECHA_AUTORIZACION",
    "FECHA_EMISION",
    "IDENTIFICACION_RECEPTOR",
    "VALOR_SIN_IMPUESTOS",
    "IVA",
    "IMPORTE_TOTAL",
    "NUMERO_DOCUMENTO_MODIFICADO",
  ];

  const KEYWORDS = [
    "factura",
    "facturacion",
    "facturación",
    "comprobante",
    "documento electronico",
    "documento electrónico",
    "ride",
    "sri",
    "pago",
    "pagaste",
    "pagado",
    "debito",
    "débito",
    "enviaste dinero",
    "envio de dinero",
    "envío de dinero",
    "transferencia",
    "consumo",
    "cobro",
    "retiro",
    "payment",
    "receipt",
    "invoice",
    "billing",
    "billed",
    "charged",
    "paid",
    "purchase",
    "subscription",
  ];

  const MISSING_ID = "tu cédula";

  const SERIE = /\b(\d{3})-(\d{3})-(\d{6,9})\b/;
  const FECHA = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/;
  const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/;
  const MONTHS = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  const LONG = new RegExp(
    `\\b(\\d{1,2})\\s*(?:de\\s+)?(${MONTHS.join("|")})[a-z.]*\\s*(?:de\\s+)?(\\d{4})\\b`,
    "i",
  );

  const TOTAL_LABELS = [
    "importe total",
    "valor total",
    "total a pagar",
    "total factura",
    "total",
    "amount paid",
    "amount due",
    "grand total",
  ];
  const BASE_LABELS = [
    "valor sin impuestos",
    "subtotal sin impuestos",
    "total sin impuestos",
    "subtotal iva",
    "subtotal 15%",
    "subtotal 12%",
    "subtotal",
    "base imponible",
  ];
  const IVA_LABELS = [
    "iva 15%",
    "iva 12%",
    "iva 14%",
    "impuesto al valor",
    "tax",
    "iva",
  ];
  const BANK_LABELS = [
    "debito por",
    "débito por",
    "se debito",
    "se debitó",
    "consumo por",
    "consumo de",
    "cargo por",
    "pago por",
    "monto",
    "valor de",
    "valor",
  ];

  function normalizeAmount(raw) {
    const text = String(raw)
      .replace(/[^\d.,-]/g, "")
      .replace(/[.,]+$/, "");
    if (!text || /-/.test(text)) return null;
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    let whole = text;
    let fraction = "";
    const cut = Math.max(lastComma, lastDot);
    if (cut !== -1 && text.length - cut - 1 <= 2 && text.length - cut - 1 > 0) {
      whole = text.slice(0, cut);
      fraction = text.slice(cut + 1);
    }
    whole = whole.replace(/[.,]/g, "");
    if (!/^\d+$/.test(whole)) return null;
    if (fraction && !/^\d{1,2}$/.test(fraction)) return null;
    const value = `${whole}${fraction ? `.${fraction}` : ""}`;
    return /^\d+(\.\d{1,2})?$/.test(value) ? value : null;
  }

  // Clock times sit next to the same labels as the amount: "a las 10:21 se
  // debitó ... el valor de $12.60". They are not money.
  const CLOCK = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

  const flatten = (text) =>
    text
      .replace(/\s+/g, " ")
      .replace(CLOCK, " ")
      .replace(/(\d)[.,]00\s*%/g, "$1%")
      .toLowerCase();

  // An amount starts and ends in a digit: a trailing dot or comma closes the
  // sentence, it does not open the cents.
  const NUMBER = "(\\d(?:[\\d.,]*\\d)?)";
  const AFTER = new RegExp(`^[^\\d-]{0,12}${NUMBER}`);
  const BEFORE = new RegExp(`${NUMBER}[^\\d]{0,4}$`);

  function sideOf(flat) {
    for (const label of [
      "valor total",
      "importe total",
      "total a pagar",
      "subtotal sin impuestos",
    ]) {
      const at = flat.indexOf(label);
      if (at === -1) continue;
      const before = BEFORE.test(flat.slice(Math.max(0, at - 16), at));
      const after = AFTER.test(
        flat.slice(at + label.length, at + label.length + 40),
      );
      if (before !== after) return before ? "antes" : "despues";
    }
    return "despues";
  }

  function amountFor(text, labels, side) {
    const flat = flatten(text);
    const first = side ?? sideOf(flat);
    for (const label of labels) {
      const at = flat.indexOf(label);
      if (at === -1) continue;
      const ahead = AFTER.exec(
        flat.slice(at + label.length, at + label.length + 40),
      );
      const behind = BEFORE.exec(flat.slice(Math.max(0, at - 16), at));
      const values =
        first === "antes" ? [behind, ahead] : [ahead, behind];
      for (const match of values) {
        const value = match && normalizeAmount(match[1]);
        if (value) return value;
      }
    }
    return null;
  }

  const pad = (value) => String(value).padStart(2, "0");

  function today() {
    const now = new Date();
    return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  }

  const slug = (name) =>
    String(name ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "")
      .toUpperCase()
      .slice(0, 12) || "EMISOR";

  function tag(seed) {
    let hash = 0x811c9dc5;
    for (const char of String(seed)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36).toUpperCase().slice(-4).padStart(4, "0");
  }

  // A receipt with no number of its own is named after its date and its
  // sender. The same email always yields the same number, so a repeat is
  // still recognized as a repeat.
  function serieFor(parts) {
    const day = parts.fecha || today();
    const stamp = `${day.slice(6, 10)}${day.slice(3, 5)}${day.slice(0, 2)}`;
    const seed = [
      parts.emisor,
      day,
      parts.total,
      parts.base,
      parts.iva,
      parts.ruc,
    ].join("|");
    return `SN-${stamp}-${slug(parts.emisor)}-${tag(seed)}`;
  }

  function dateFrom(text) {
    const iso = ISO.exec(text);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const numeric = FECHA.exec(text);
    if (numeric && Number(numeric[2]) <= 12)
      return `${pad(numeric[1])}/${pad(numeric[2])}/${numeric[3]}`;
    const long = LONG.exec(text);
    if (long) {
      const month = MONTHS.indexOf(long[2].toLowerCase().slice(0, 3)) + 1;
      if (month) return `${pad(long[1])}/${pad(month)}/${long[3]}`;
    }
    return null;
  }

  function firstAmount(text) {
    const match = new RegExp(`(?:\\$|USD)\\s*${NUMBER}`, "i").exec(text);
    return match ? normalizeAmount(match[1]) : null;
  }

  function recipientFrom(text, fallback) {
    const flat = text.replace(/\s+/g, " ");
    const labels =
      /(?:identificaci[oó]n|ruc|c[eé]dula|cliente|comprador|receptor)[^\d]{0,24}(\d{13}|\d{10})\b/i;
    const labelled = labels.exec(flat);
    if (labelled) return labelled[1];
    if (fallback) {
      const own = new RegExp(`\\b${fallback}\\b`).exec(flat);
      if (own) return fallback;
    }
    return null;
  }

  function reference(text) {
    const flat = text.replace(/\s+/g, " ");
    const near =
      /\b(?:n[uú]mero|nro\.?|no\.?|referencia|autorizaci[oó]n|transacci[oó]n|comprobante|secuencial|transaction|receipt|invoice|order|reference|confirmation)(?:\s*(?:id|no\.?|n[uú]mero|number|#))?[^A-Za-z0-9]{0,16}([A-Za-z0-9][A-Za-z0-9-]{3,23})/gi;
    for (const match of flat.matchAll(near)) {
      const candidate = match[1];
      if (/\d/.test(candidate)) return candidate;
    }
    return null;
  }

  const ID = /(?<!\d)(\d{13}|\d{10})(?!\d)/g;

  function cedulaOk(id) {
    if (!/^\d{10}$/.test(id)) return false;
    const province = Number(id.slice(0, 2));
    if (province < 1 || (province > 24 && province !== 30)) return false;
    if (Number(id[2]) > 5) return false;
    let total = 0;
    for (let i = 0; i < 9; i += 1) {
      const doubled = Number(id[i]) * (i % 2 === 0 ? 2 : 1);
      total += doubled > 9 ? doubled - 9 : doubled;
    }
    return (10 - (total % 10)) % 10 === Number(id[9]);
  }

  function identityCandidates(text) {
    const flat = String(text ?? "");
    const emisores = new Set(clave.all(flat).map((one) => one.ruc));
    const found = new Set();
    for (const match of flat.matchAll(ID)) {
      const value = match[0];
      if (emisores.has(value)) continue;
      if (value.length === 13 && !value.endsWith("001")) continue;
      if (!cedulaOk(value.slice(0, 10))) continue;
      found.add(value);
    }
    return [...found];
  }

  function senderName(sender) {
    const raw = String(sender || "");
    const name = raw
      .replace(/<[^>]*>/g, "")
      .replace(/["']/g, "")
      .trim()
      .replace(/^[,;:-]+|[,;:-]+$/g, "")
      .trim();
    if (name) return name;
    const mailbox = /([^\s@<>"]+)@[^\s@<>"]+/.exec(raw);
    return mailbox ? mailbox[1] : "Emisor sin nombre";
  }

  // A forwarded email is sent by whoever did you the favour, not by whoever
  // issued the receipt. The real sender is in the header the forward copies
  // into the body.
  const FORWARD =
    /(?:-{2,}\s*(?:forwarded message|mensaje reenviado|original message|mensaje original)[\s-]*-{2,}|(?:begin forwarded message|inicio del mensaje reenviado)\s*:)/i;
  const FROM_LINE =
    /(?:^|\n|\s)(?:de|from|remitente)\s*:\s*(.*?)(?:\n|(?=\s(?:para|to|cc|cco|bcc|fecha|date|enviado|sent|asunto|subject|responder a|reply-to)\s*:)|$)/i;

  // A bank notice is written by the messenger, not by the seller. The seller
  // is the name the bank prints in capitals after "en": "Consumo por $ 7.25
  // en MARKET CENTRAL SUR K".
  const SPEND = /\b(?:consumo|compra|pago|debito|d[eé]bito|transacci[oó]n)\b/i;
  const IN = /\sen\s+/g;
  const CAPS = /^[A-ZÑÁÉÍÓÚ0-9*&#/.-]+$/;
  const NOT_A_SELLER = new Set([
    "USD",
    "EUR",
    "DOLARES",
    "DÓLARES",
    "EFECTIVO",
    "LINEA",
    "LÍNEA",
    "INTERNET",
    "CUOTAS",
    "TOTAL",
    "SU",
    "EL",
    "LA",
  ]);

  function merchant(text) {
    const body = String(text ?? "").replace(/\s+/g, " ");
    const spend = body.search(SPEND);
    if (spend === -1) return null;
    const rest = body.slice(spend);
    IN.lastIndex = 0;
    for (const at of rest.matchAll(IN)) {
      const words = [];
      for (const word of rest.slice(at.index + at[0].length).split(" ")) {
        const clean = word.replace(/[.,;:]+$/, "");
        if (!clean || !CAPS.test(clean)) break;
        if (!/[A-ZÑÁÉÍÓÚ0-9]/.test(clean)) break;
        if (!words.length && !/^[A-ZÑÁÉÍÓÚ]/.test(clean)) break;
        if (NOT_A_SELLER.has(clean)) break;
        words.push(clean);
        if (words.length === 6) break;
      }
      const name = words.join(" ");
      if (name.length >= 3) return name;
    }
    return null;
  }

  function forwardedSender(text) {
    const body = String(text ?? "");
    const at = body.search(FORWARD);
    if (at === -1) return null;
    const match = FROM_LINE.exec(body.slice(at));
    if (!match) return null;
    const name = senderName(match[1]);
    return name === "Emisor sin nombre" ? null : name;
  }

  const cell = (value) =>
    String(value ?? "")
      .replace(/[\t\r\n]+/g, " ")
      .trim();

  const amount = (value) =>
    value === null || value === undefined || value === ""
      ? null
      : normalizeAmount(value);

  function finalize(fields, identity = {}) {
    const total = amount(fields.total);
    const iva = amount(fields.iva);
    let base = amount(fields.base);
    if (!base && total && iva) {
      const difference = (Number(total) * 100 - Number(iva) * 100) / 100;
      if (difference > 0) base = difference.toFixed(2);
    }
    if (!base && total && !iva) base = total;

    const stated = /^\d{10}(\d{3})?$/.test(fields.recipient ?? "")
      ? fields.recipient
      : null;
    const recipient = stated ?? identity.cedula ?? null;
    const personal = !recipient || recipient.length === 10;
    const used = personal ? total : base;
    const emisor = fields.emisor || "Emisor sin nombre";
    const found = fields.serie ?? fields.reference ?? null;
    const number =
      found ??
      serieFor({
        emisor,
        fecha: fields.fecha,
        total,
        base,
        iva,
        ruc: fields.ruc,
      });

    const missing = [];
    if (
      identity.cedula &&
      typeof fields.ruc === "string" &&
      fields.ruc.startsWith(identity.cedula)
    )
      missing.push("la emitiste tú, no es un gasto");
    if (!fields.fecha) missing.push("fecha de emisión");
    if (!recipient) missing.push(MISSING_ID);
    if (!used)
      missing.push(personal ? "importe total" : "valor sin impuestos");

    return {
      serie: number,
      fecha: fields.fecha ?? null,
      month:
        fields.month ??
        (fields.fecha
          ? `${fields.fecha.slice(6, 10)}-${fields.fecha.slice(3, 5)}`
          : null),
      recipient,
      base,
      iva,
      total,
      clave: fields.clave ?? null,
      ruc: fields.ruc ?? null,
      emisor,
      generatedSerie: !found,
      category: personal ? "GASTOS PERSONALES" : "APLICABLE IVA",
      amount: used,
      source: fields.source ?? "texto",
      guessedDate: Boolean(fields.guessedDate),
      missing,
      complete: missing.length === 0,
    };
  }

  function fromXml(xml, email = {}, identity = {}) {
    const fields = globalThis.LilaXml.parse(xml);
    if (!fields) return null;
    return finalize(
      { ...fields, emisor: fields.emisor || senderName(email.sender) },
      identity,
    );
  }

  function extract(email, identity = {}) {
    const text = `${email.subject || ""}\n${email.text || ""}`;
    const fromClave = clave.all(text).find((c) => c.tipo === "01") ?? null;
    const serieMatch = SERIE.exec(text);
    const serie = fromClave
      ? fromClave.serie
      : serieMatch
        ? `${serieMatch[1]}-${serieMatch[2]}-${serieMatch[3].padStart(9, "0")}`
        : null;

    const fecha = fromClave?.fecha ?? dateFrom(text) ?? email.receivedAt ?? null;
    const guessedDate = Boolean(!fromClave && !dateFrom(text) && fecha);

    return finalize(
      {
        serie,
        reference: serie ? null : reference(text),
        fecha,
        recipient: recipientFrom(text, identity.ruc || identity.cedula),
        base: amountFor(text, BASE_LABELS),
        iva: amountFor(text, IVA_LABELS),
        total:
          amountFor(text, TOTAL_LABELS) ??
          amountFor(text, BANK_LABELS) ??
          firstAmount(text),
        clave: fromClave?.clave ?? null,
        ruc: fromClave?.ruc ?? null,
        emisor:
          merchant(text) ?? forwardedSender(text) ?? senderName(email.sender),
        guessedDate,
      },
      identity,
    );
  }

  function row(record) {
    const personal = record.recipient.length === 10;
    const values = {
      RUC_EMISOR: record.ruc ?? "",
      RAZON_SOCIAL_EMISOR: record.emisor,
      TIPO_COMPROBANTE: "Factura",
      SERIE_COMPROBANTE: record.serie,
      CLAVE_ACCESO: record.clave ?? "",
      FECHA_AUTORIZACION: "",
      FECHA_EMISION: record.fecha,
      IDENTIFICACION_RECEPTOR: record.recipient,
      VALOR_SIN_IMPUESTOS: personal ? (record.base ?? "") : record.amount,
      IVA: record.iva ?? "",
      IMPORTE_TOTAL: personal ? record.amount : (record.total ?? ""),
      NUMERO_DOCUMENTO_MODIFICADO: "",
    };
    return HEADER.map((name) => cell(values[name])).join("\t");
  }

  function toReport(records) {
    return [HEADER.join("\t"), ...records.map(row)].join("\n");
  }

  function looksLikeInvoice({
    sender = "",
    subject = "",
    snippet = "",
    text: row = "",
  }) {
    const text = `${sender} ${subject} ${snippet} ${row}`;
    if (clave.pattern.test(text)) {
      clave.pattern.lastIndex = 0;
      return true;
    }
    clave.pattern.lastIndex = 0;
    if (SERIE.test(text)) return true;
    const flat = text.toLowerCase();
    return KEYWORDS.some((word) => flat.includes(word));
  }

  return {
    HEADER,
    KEYWORDS,
    normalizeAmount,
    amountFor,
    cedulaOk,
    identityCandidates,
    sideOf,
    reference,
    firstAmount,
    dateFrom,
    forwardedSender,
    merchant,
    MISSING_ID,
    finalize,
    extract,
    fromXml,
    row,
    toReport,
    looksLikeInvoice,
  };
})();

globalThis.LilaParse = LilaParse;
