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

  async function describe(bytes) {
    if (globalThis.LilaPdf.isPdf(bytes))
      return { kind: "pdf", text: await globalThis.LilaPdf.textFrom(bytes) };
    if (bytes[0] === 0x50 && bytes[1] === 0x4b)
      return { kind: "zip", text: "" };
    const text = new TextDecoder("utf-8").decode(bytes);
    if (/<\?xml|<factura|<autorizacion/i.test(text.slice(0, 2000)))
      return { kind: "xml", text };
    return { kind: "otro", text: text.includes("\u0000") ? "" : text };
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
    diagnose,
    wait,
  };
})();

globalThis.LilaGmail = LilaGmail;
