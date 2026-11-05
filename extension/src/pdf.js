const LilaPdf = (() => {
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_STREAMS = 80;

  const isPdf = (bytes) =>
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;

  async function inflate(bytes) {
    for (const format of ["deflate", "deflate-raw"]) {
      const parts = [];
      let size = 0;
      try {
        const reader = new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream(format))
          .getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          size += value.length;
        }
      } catch {}
      if (!size) continue;
      const out = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    }
    return null;
  }

  function unescape(raw) {
    return raw.replace(/\\(\d{1,3}|.)/g, (match, code) => {
      if (/^\d+$/.test(code)) return String.fromCharCode(parseInt(code, 8));
      return { n: "\n", r: "\n", t: "\t", b: "", f: "" }[code] ?? code;
    });
  }

  const fromHex = (hex) => {
    const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
    let out = "";
    for (let i = 0; i + 1 < clean.length; i += 2)
      out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    return out;
  };

  const literal = (token) =>
    token.startsWith("(") ? unescape(token.slice(1, -1)) : fromHex(token.slice(1, -1));

  const GAP = -120;

  function textOf(content) {
    const parts = [];
    const tokens =
      /\[(?:[^\]\\]|\\.)*\]\s*TJ|(?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>)\s*(?:Tj|'|")|\bT\*|\bTd\b|\bTD\b|\bET\b/g;
    const piece = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?/g;

    for (const match of content.matchAll(tokens)) {
      const token = match[0];
      if (/^(?:T\*|Td|TD|ET)$/.test(token)) {
        parts.push("\n");
        continue;
      }
      if (!token.startsWith("[")) {
        parts.push(literal(token.replace(/\s*(?:Tj|'|")$/, "")), " ");
        continue;
      }
      for (const inner of token.slice(1, token.lastIndexOf("]")).matchAll(piece))
        parts.push(
          /^[(<]/.test(inner[0])
            ? literal(inner[0])
            : Number(inner[0]) < GAP
              ? " "
              : "",
        );
      parts.push(" ");
    }
    return parts.join("");
  }

  async function textFrom(bytes) {
    if (!isPdf(bytes) || bytes.length > MAX_BYTES) return "";
    const latin = new TextDecoder("latin1").decode(bytes);
    const pieces = [];
    let at = 0;
    let seen = 0;

    while (seen < MAX_STREAMS) {
      const start = latin.indexOf("stream", at);
      if (start === -1) break;
      const end = latin.indexOf("endstream", start);
      if (end === -1) break;
      seen += 1;

      const header = latin.slice(Math.max(0, start - 500), start);
      let from = start + "stream".length;
      if (latin[from] === "\r") from += 1;
      if (latin[from] === "\n") from += 1;

      const raw = bytes.subarray(from, end);
      let content = null;
      if (header.includes("/FlateDecode")) {
        const out = await inflate(raw);
        if (out) content = new TextDecoder("latin1").decode(out);
      } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|Image)/.test(header)) {
        content = new TextDecoder("latin1").decode(raw);
      }
      if (content) pieces.push(textOf(content));
      at = end + "endstream".length;
    }

    return pieces.join("\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  return { isPdf, textFrom, textOf, unescape };
})();

globalThis.LilaPdf = LilaPdf;
