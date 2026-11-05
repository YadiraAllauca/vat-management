(() => {
  const {
    looksLikeInvoice,
    extract,
    fromXml,
    toReport,
    dateFrom,
    identityCandidates,
    MISSING_ID,
  } = globalThis.LilaParse;
  const gmail = globalThis.LilaGmail;
  const { Panel } = globalThis.LilaPanel;

  const DISMISSED = "lila-panel-cerrado";
  let panel = null;
  let state = null;
  let working = false;
  let reading = null;
  let done = null;
  let identity = {};
  let sent = new Set();
  let announced = false;
  let learned = null;
  let watchdog;

  function arm() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (!reading) return;
      working = false;
      reading = null;
      show({
        name: "error",
        message: "La lectura se quedó sin respuesta.",
        progress: 0,
      });
    }, 45000);
  }

  const readable = (error) =>
    /Extension context invalidated|message port closed/i.test(error.message)
      ? "La extensión se actualizó: recarga Gmail para seguir."
      : error.message;

  const keyOf = (record) => record.clave ?? `${record.serie}|${record.month}`;
  const nameOf = (row) =>
    row.sender || row.subject || "Correo sin remitente";

  function show(next) {
    state = next;
    if (!panel) {
      panel = new Panel({
        onExtract: extractAll,
        onSend: send,
        onClose: close,
        onSaveId: saveId,
        onIncludeSent: () => recompute(true),
      });
      panel.mount();
    }
    panel.render(state);
  }

  function close() {
    sessionStorage.setItem(DISMISSED, "1");
    panel?.unmount();
    panel = null;
    state = null;
  }

  function scan() {
    if (working || state || sessionStorage.getItem(DISMISSED)) return;
    if (!gmail.onList()) return;
    const rows = gmail.rows();
    const candidates = rows.filter(looksLikeInvoice);
    if (!announced) {
      announced = true;
      console.info(
        `[Lila] bandeja leída: ${rows.length} filas, ${candidates.length} parecen facturas.` +
          (rows.length ? "" : " Si esto dice 0 filas, los selectores de Gmail cambiaron: usa lila.revisar()."),
      );
    }
    if (!candidates.length) return;
    show({ name: "found", candidates: candidates.length, rows: candidates });
  }

  async function extractAll() {
    if (working) return;
    working = true;
    const rows = state.rows;
    const readable = rows.filter((row) => row.url);
    const unreadable = rows
      .filter((row) => !row.url)
      .map((row) => ({
        emisor: nameOf(row),
        missing: ["Gmail no expuso el identificador del correo"],
        complete: false,
        failed: true,
      }));
    reading = {
      rows: new Map(readable.map((row) => [row.id, row])),
      total: readable.length,
      unreadable,
    };

    if (!readable.length) return finish([]);
    show({ name: "reading", candidates: readable.length, done: 0, progress: 0 });
    try {
      const answer = await chrome.runtime.sendMessage({
        type: "leer",
        candidatos: readable.map((row) => ({ id: row.id, url: row.url })),
      });
      if (!answer?.ok)
        throw new Error(answer?.error ?? "No se pudieron abrir las pestañas.");
      arm();
    } catch (error) {
      working = false;
      reading = null;
      show({ name: "error", message: readable(error), progress: 0 });
    }
  }

  function finish(results) {
    done = { rows: reading.rows, unreadable: reading.unreadable, results };
    clearTimeout(watchdog);
    working = false;
    reading = null;
    recompute();
  }

  const textOf = (result) =>
    [
      result.text,
      ...(result.attachments ?? [])
        .filter((one) => one.kind === "pdf")
        .map((one) => one.text),
    ]
      .filter(Boolean)
      .join("\n");

  function learnIdentity() {
    const stated = [];
    const votes = new Map();
    for (const result of done.results) {
      if (result.error) continue;
      const xml = (result.attachments ?? []).find((one) => one.kind === "xml");
      const fromXmlId = xml && globalThis.LilaXml.parse(xml.text)?.recipient;
      if (fromXmlId) {
        stated.push(fromXmlId);
        continue;
      }
      for (const value of new Set(identityCandidates(textOf(result))))
        votes.set(value, (votes.get(value) ?? 0) + 1);
    }
    for (const value of stated) votes.set(value, (votes.get(value) ?? 0) + 10);

    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    if (!best || best[1] < 2) return;
    if (ranked[1] && ranked[1][1] === best[1]) return;

    const cedula = best[0].slice(0, 10);
    learned = best[0];
    identity = {
      cedula,
      ruc: best[0].length === 13 ? best[0] : `${cedula}001`,
    };
    void chrome.storage.local.set(identity);
    console.info(`[Lila] deduje tu identificación: ${learned}`);
  }

  function recompute(includeSent = false) {
    if (!identity.cedula) learnIdentity();
    const ready = [];
    const incomplete = [...done.unreadable];
    const already = [];
    for (const result of done.results) {
      const row = done.rows.get(result.id) ?? {};
      if (result.error) {
        incomplete.push({
          emisor: nameOf(row),
          missing: [result.error],
          complete: false,
          failed: true,
        });
        continue;
      }
      const attachments = result.attachments ?? [];
      let record = null;
      for (const attachment of attachments) {
        if (attachment.kind !== "xml") continue;
        record = fromXml(attachment.text, row, identity);
        if (record) break;
      }
      if (!record) {
        const extra = attachments
          .filter((one) => one.kind === "pdf" && one.text)
          .map((one) => one.text)
          .join("\n");
        record = extract(
          {
            text: extra ? `${result.text}\n${extra}` : result.text,
            sender: row.sender,
            subject: row.subject,
            receivedAt: dateFrom(row.received ?? ""),
          },
          identity,
        );
        if (extra) record.source = "pdf";
      }
      if (!record.complete) {
        console.info(
          `[Lila] incompleto · ${nameOf(row)} · falta ${record.missing.join(", ")} · ` +
            `texto ${(result.text ?? "").length} car. · adjuntos ${
              attachments
                .map((one) => `${one.kind}(${one.text?.length ?? 0})`)
                .join(", ") || "ninguno"
            }`,
        );
        incomplete.push(record);
      }
      else if (ready.some((one) => keyOf(one) === keyOf(record))) continue;
      else if (!includeSent && sent.has(keyOf(record))) already.push(record);
      else ready.push(record);
    }
    show({
      name: "ready",
      records: ready,
      incomplete,
      progress: 100,
      already,
      needsId: !identity.cedula && incomplete.some(missingId),
      learned,
      fixable: incomplete.filter(
        (record) => record.missing.length === 1 && missingId(record),
      ).length,
    });
  }

  const missingId = (record) => record.missing?.includes(MISSING_ID);

  async function saveId(cedula) {
    await chrome.storage.local.set({ cedula });
    identity = { ...identity, cedula };
    if (done) recompute();
  }

  async function send() {
    if (working) return;
    working = true;
    const records = state.records ?? [];
    try {
      const answer = await chrome.runtime.sendMessage({
        type: "enviar",
        report: toReport(records),
        keys: records.map(keyOf),
      });
      if (!answer?.ok) throw new Error(answer?.error ?? "No se pudo abrir Lila.");
      for (const record of records) sent.add(keyOf(record));
      show({ name: "sent", sent: records.length, progress: 100 });
    } catch (error) {
      show({ name: "error", message: readable(error), progress: 0 });
    } finally {
      working = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!reading) return;
    arm();
    if (message?.type === "progreso")
      show({
        name: "reading",
        candidates: reading.total,
        done: message.done,
        progress: Math.round((message.done / reading.total) * 100),
      });
    if (message?.type === "cuerpos") finish(message.results);
  });

  async function readAndReport() {
    try {
      const text = await gmail.waitForBody();
      const attachments = await gmail.readAttachments();
      await chrome.runtime.sendMessage({ type: "cuerpo", text, attachments });
    } catch (error) {
      await chrome.runtime.sendMessage({ type: "cuerpo", error: error.message });
    }
  }

  async function start() {
    let reader = false;
    try {
      reader =
        (await chrome.runtime.sendMessage({ type: "lector?" }))?.lector === true;
    } catch {}
    if (reader) return readAndReport();

    console.info("[Lila] extensión activa en Gmail.");
    const stored = await chrome.storage.local.get(["cedula", "ruc", "sent"]);
    identity = { cedula: stored.cedula, ruc: stored.ruc };
    sent = new Set(stored.sent ?? []);

    let scheduled = false;
    const rescan = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        scan();
      }, 900);
    };

    window.addEventListener("hashchange", () => {
      if (working) return;
      sessionStorage.removeItem(DISMISSED);
      announced = false;
      if (panel) close();
      rescan();
    });
    new MutationObserver(() => {
      if (!working && !state) rescan();
    }).observe(document.body, { childList: true, subtree: true });
    rescan();
  }

  globalThis.lila = {
    revisar: () => gmail.diagnose(),
    probar: (texto) => looksLikeInvoice({ subject: String(texto) }),
    escanear: () => {
      sessionStorage.removeItem(DISMISSED);
      announced = false;
      scan();
    },
  };
  void start();
})();
