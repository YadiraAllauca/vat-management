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
    const text = String(raw).replace(/[^\d.,-]/g, "");
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

  const flatten = (text) =>
    text
      .replace(/\s+/g, " ")
      .replace(/(\d)[.,]00\s*%/g, "$1%")
      .toLowerCase();

  const AFTER = /^[^\d-]{0,12}(\d[\d.,]*)/;
  const BEFORE = /(\d[\d.,]*)[^\d]{0,4}$/;

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
    const match = /(?:\$|USD)\s*(\d[\d.,]*)/i.exec(text);
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

  function senderName(sender) {
    const name = String(sender || "")
      .replace(/<[^>]*>/g, "")
      .replace(/"/g, "")
      .trim();
    return name || "Emisor sin nombre";
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
    const number = fields.serie ?? fields.reference ?? null;

    const missing = [];
    if (!number) missing.push("número de la factura o de la transacción");
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
      emisor: fields.emisor || "Emisor sin nombre",
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
        emisor: senderName(email.sender),
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
    sideOf,
    reference,
    firstAmount,
    dateFrom,
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
