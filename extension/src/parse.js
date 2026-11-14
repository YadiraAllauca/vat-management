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

  const MISSING_ID = "tu cédula";

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

  const cell = (value) =>
    String(value ?? "")
      .replace(/[\t\r\n]+/g, " ")
      .trim();

  const amount = (value) =>
    value === null || value === undefined || value === ""
      ? null
      : normalizeAmount(value);

  // A date reader, not an issuer heuristic: turns what Gmail paints in the
  // row ("4 de noviembre de 2026") into the DD/MM/YYYY the rest expects.
  const pad = (value) => String(value).padStart(2, "0");
  const FECHA = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/;
  const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/;
  const MONTHS = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const LONG = new RegExp(
    `\\b(\\d{1,2})\\s*(?:de\\s+)?(${MONTHS.join("|")})[a-z.]*\\s*(?:de\\s+)?(\\d{4})\\b`,
    "i",
  );

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
    missing.push(...(fields.problems ?? []));

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

  return {
    HEADER,
    MISSING_ID,
    normalizeAmount,
    cedulaOk,
    dateFrom,
    finalize,
    row,
    toReport,
  };
})();

globalThis.LilaParse = LilaParse;
