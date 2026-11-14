const LilaGmail = (() => {
  const SELECTORS = {
    list: ['div[role="main"]'],
    row: ["tr.zA", 'div[role="main"] tr[jsmodel]'],
    subject: [".bog", "span[data-thread-id] span"],
    snippet: [".y2", "span.y2"],
    sender: ["span[email]", ".yW span", ".bA4 span[email]"],
    body: ["div.a3s", 'div[data-message-id] div[dir="ltr"]'],
    attachment: [
      'a[href*="view=att"]',
      "[download_url]",
      'a[href*="attid="]',
      "span.aZo a",
      "div.aQH a",
    ],
    date: ["td.xW span[title]", "span.xW span[title]", "td[role] span[title]"],
  };

  const MAX_ATTACHMENTS = 3;
  const MAX_SIZE = 4 * 1024 * 1024;

  const first = (root, names) => {
    for (const name of names) {
      const found = root.querySelector(name);
      if (found) return found;
    }
    return null;
  };

  const all = (root, names) => {
    for (const name of names) {
      const found = root.querySelectorAll(name);
      if (found.length) return Array.from(found);
    }
    return [];
  };

  const text = (node) => (node?.innerText ?? node?.textContent ?? "").trim();

  const wait = (check, timeout = 8000) =>
    new Promise((resolve, reject) => {
      const found = check();
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const result = check();
        if (!result) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(result);
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Gmail tardó demasiado en mostrar el correo."));
      }, timeout);
      observer.observe(document.body, { childList: true, subtree: true });
    });

  function onList() {
    const hash = location.hash || "#inbox";
    const parts = hash.replace(/^#/, "").split("/");
    const deep = parts.length > 1 && parts[parts.length - 1].length > 8;
    return Boolean(first(document, SELECTORS.list)) && !deep;
  }

  function threadIdOf(row) {
    const legacy =
      row.closest("[data-legacy-thread-id]") ??
      row.querySelector("[data-legacy-thread-id]");
    const hex = legacy?.getAttribute("data-legacy-thread-id");
    if (hex) return hex;
    const holder =
      row.closest("[data-thread-id]") ?? row.querySelector("[data-thread-id]");
    const decimal = /thread-f:(\d+)/.exec(
      holder?.getAttribute("data-thread-id") ?? "",
    );
    if (!decimal) return null;
    try {
      return BigInt(decimal[1]).toString(16);
    } catch {
      return null;
    }
  }

  const urlFor = (threadId) =>
    `${location.origin}${location.pathname.replace(/\/?$/, "/")}#all/${threadId}`;

  function rows() {
    const main = first(document, SELECTORS.list);
    if (!main) return [];
    return all(main, SELECTORS.row).map((row, index) => {
      const senderNode = first(row, SELECTORS.sender);
      const threadId = threadIdOf(row);
      return {
        index,
        id: threadId ?? row.id ?? `fila-${index}`,
        threadId,
        url: threadId ? urlFor(threadId) : null,
        sender:
          senderNode?.getAttribute("name") ||
          senderNode?.getAttribute("email") ||
          text(senderNode),
        subject: text(first(row, SELECTORS.subject)),
        text: text(row).slice(0, 400),
        snippet: text(first(row, SELECTORS.snippet)).replace(/^[\s\-–—]+/, ""),
        received: first(row, SELECTORS.date)?.getAttribute("title") ?? "",
      };
    });
  }

  async function waitForBody() {
    const nodes = await wait(() => {
      const found = all(document, SELECTORS.body);
      return found.length ? found : null;
    }, 15000);
    const content = nodes
      .map(text)
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 20000);
    if (!content) throw new Error("El correo se abrió vacío.");
    return content;
  }

  const base64Of = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + 0x8000),
      );
    return btoa(binary);
  };

  const looksXml = (text) =>
    /<\?xml|<factura|<autorizacion/i.test(text.slice(0, 2000));

  // Issuers often zip the XML. First entry only: an invoice does not ship two.
  async function fromZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x04034b50) throw new Error("no es un zip");
    const method = view.getUint16(8, true);
    const compressed = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const start = 30 + nameLength + extraLength;
    const end = compressed ? start + compressed : bytes.length;
    if (start >= bytes.length) throw new Error("zip vacío");
    const payload = bytes.subarray(start, end);
    if (method === 0) return payload;
    if (method !== 8) throw new Error("compresión no soportada");
    const stream = new Blob([payload])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function describe(bytes) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
      return { kind: "pdf", base64: base64Of(bytes) };

    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      try {
        const inner = await fromZip(bytes);
        const text = new TextDecoder("utf-8").decode(inner);
        if (looksXml(text))
          return { kind: "xml", base64: base64Of(inner), text };
      } catch {}
      return { kind: "otro", base64: base64Of(bytes) };
    }

    const text = new TextDecoder("utf-8").decode(bytes);
    if (looksXml(text)) return { kind: "xml", base64: base64Of(bytes), text };
    return { kind: "otro", base64: base64Of(bytes) };
  }

  function attachmentUrls() {
    const found = [];
    for (const name of SELECTORS.attachment)
      for (const node of document.querySelectorAll(name)) {
        const dragged = node.getAttribute("download_url");
        const url = dragged ? dragged.split(":").slice(2).join(":") : null;
        if (url) found.push(url);
        const href = node.getAttribute("href");
        if (href && /view=att|attid=/.test(href)) found.push(href);
      }
    return [...new Set(found)];
  }

  async function readAttachments() {
    const links = await wait(() => {
      const urls = attachmentUrls();
      return urls.length ? urls : null;
    }, 3000).catch(() => []);

    const found = [];
    for (const href of links.slice(0, MAX_ATTACHMENTS)) {
      const tries = [...new Set([href, href.replace("disp=safe", "disp=attd")])];
      for (const url of tries) {
        try {
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) continue;
          const buffer = await response.arrayBuffer();
          if (!buffer.byteLength || buffer.byteLength > MAX_SIZE) break;
          found.push(await describe(new Uint8Array(buffer)));
          break;
        } catch {}
      }
    }
    return found;
  }

  function diagnose() {
    const report = { enLista: onList(), direccion: location.hash || "(ninguna)" };
    for (const [name, names] of Object.entries(SELECTORS))
      report[name] = names.find((one) => document.querySelector(one)) ?? null;
    const found = rows();
    report.filas = found.length;
    report.adjuntos = attachmentUrls().length;
    report.conIdentificador = found.filter((one) => one.threadId).length;
    report.ejemplo = found[0]
      ? {
          remitente: found[0].sender,
          asunto: found[0].subject,
          fragmento: found[0].snippet.slice(0, 80),
          hilo: found[0].threadId,
        }
      : null;
    return report;
  }

  return {
    SELECTORS,
    onList,
    rows,
    waitForBody,
    readAttachments,
    describe,
    diagnose,
    wait,
  };
})();

globalThis.LilaGmail = LilaGmail;
