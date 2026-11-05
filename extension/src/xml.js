const LilaXml = (() => {
  const unescape = (text) =>
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  function tag(text, name) {
    const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(text);
    return match ? match[1].trim() : null;
  }

  const looksLikeInvoice = (text) =>
    /<infoFactura>/.test(text) || /<factura\b/.test(text);

  function parse(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    const text = raw.includes("&lt;") ? unescape(raw) : raw;
    if (!looksLikeInvoice(text)) return null;

    const estab = tag(text, "estab");
    const ptoEmi = tag(text, "ptoEmi");
    const secuencial = tag(text, "secuencial");
    const fecha = tag(text, "fechaEmision");
    if (!estab || !ptoEmi || !secuencial || !fecha) return null;

    const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
    if (!date) return null;

    return {
      serie: `${estab.padStart(3, "0")}-${ptoEmi.padStart(3, "0")}-${secuencial.padStart(9, "0")}`,
      fecha,
      month: `${date[3]}-${date[2]}`,
      recipient: tag(text, "identificacionComprador"),
      base: tag(text, "totalSinImpuestos"),
      iva: tag(text, "valorImpuesto") ?? tag(text, "valor"),
      total: tag(text, "importeTotal"),
      clave: tag(text, "claveAcceso"),
      ruc: tag(text, "ruc"),
      emisor: tag(text, "razonSocial"),
      source: "xml",
    };
  }

  return { parse, tag, unescape, looksLikeInvoice };
})();

globalThis.LilaXml = LilaXml;
