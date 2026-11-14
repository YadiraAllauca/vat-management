(() => {
  const { finalize, toReport, dateFrom, MISSING_ID } = globalThis.LilaParse;
  const LilaAI = globalThis.LilaAI;
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
  let dropped = new Set();
  let includeSent = false;
  let watchdog;
  let spend = [];
  let cases = new Map();
  let rejected = new Set();
  let model = "claude-opus-5-5";
  let consented = false;

  const MAX_CASES = 500;

  // The hash covers what the model saw, so a changed body or attachment is
  // read again instead of served from cache.
  async function hashOf(email) {
    const seed = [
      email.sender ?? "",
      email.subject ?? "",
      email.text ?? "",
      // Attachment content, not its length: a monthly invoice from the same
      // issuer has the same subject, body and XML size every month, and
      // comparing lengths served last month's answer for this month's bill.
      (email.attachments ?? []).map((one) => `${one.kind}:${one.base64 ?? ""}`).join(","),
    ].join("\u0000");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(seed),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  const rememberCases = () =>
    chrome.storage.local
      .set({
        aiCases: Object.fromEntries([...cases].slice(-MAX_CASES)),
        aiRejected: [...rejected].slice(-MAX_CASES),
      })
      .catch(() => {});

  const PRICES = {
    "claude-opus-5-5": [4, 20],
    "claude-sonnet-5-5": [2, 10],
    "claude-haiku-5-5": [0.1, 0.5],
  };

  function costOf(model) {
    const [input, output] = PRICES[model] ?? PRICES["claude-opus-5-5"];
    let dolares = 0;
    for (const usage of spend)
      dolares +=
        ((usage?.input_tokens ?? 0) * input +
          (usage?.output_tokens ?? 0) * output) /
        1_000_000;
    return dolares;
  }

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
        onIncludeSent: () => {
          includeSent = true;
          recompute();
        },
        onRescan: rescanNow,
        onDrop: drop,
        onRestoreDropped: restoreDropped,
        onEdit: edit,
        onConsent: consent,
        onOptions: () =>
          chrome.runtime.sendMessage({ type: "opciones" }).catch(() => {}),
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

  // Only entry point. No automatic scanning: looking at the inbox costs
  // money.
  async function rescanNow() {
    if (working) return;
    if (!consented) {
      panel?.unmount();
      panel = null;
      state = null;
      show({ name: "consent" });
      return;
    }
    working = true;
    sessionStorage.removeItem(DISMISSED);
    state = null;
    done = null;
    panel?.unmount();
    panel = null;
    if (!gmail.onList()) {
      working = false;
      show({ name: "nada", fuera: true });
      return;
    }

    const rows = gmail.rows();
    show({ name: "triaging", candidates: rows.length });

    try {
      const answer = await chrome.runtime.sendMessage({
        type: "clasificar",
        rows: rows.map(({ id, sender, subject, snippet }) => ({
          id,
          sender,
          subject,
          snippet,
        })),
      });
      if (!answer?.ok) throw new Error(answer?.error ?? "No se pudo clasificar la bandeja.");

      spend = [answer.usage];
      const expenses = new Map(
        answer.filas.filter((one) => one.esGasto).map((one) => [one.id, one.motivo]),
      );
      const candidates = rows.filter((row) => expenses.has(row.id));
      console.info(
        `[Lila] bandeja leída: ${rows.length} filas, ${candidates.length} parecen expenses.` +
          (rows.length ? "" : " Si esto dice 0 filas, los selectores de Gmail cambiaron: usa lila.revisar()."),
      );
      show(
        candidates.length
          ? { name: "found", candidates: candidates.length, rows: candidates }
          : { name: "nada" },
      );
    } catch (error) {
      show({
        name: "error",
        message: readable(error),
        progress: 0,
        fixable: /key/i.test(error.message) ? "key" : null,
      });
    } finally {
      working = false;
    }
  }

  async function extractAll() {
    if (working) return;
    if (!state?.rows?.length) return rescanNow();
    working = true;
    includeSent = false;
    const rows = state.rows;
    const withUrl = rows.filter((row) => row.url);
    const unreadable = rows
      .filter((row) => !row.url)
      .map((row) => ({
        emisor: nameOf(row),
        missing: ["Gmail no expuso el identificador del correo"],
        complete: false,
        failed: true,
      }));
    reading = {
      rows: new Map(withUrl.map((row) => [row.id, row])),
      total: withUrl.length,
      unreadable,
    };

    if (!withUrl.length) return finish([]);
    show({ name: "reading", candidates: withUrl.length, done: 0, progress: 0 });
    try {
      const answer = await chrome.runtime.sendMessage({
        type: "leer",
        candidatos: withUrl.map((row) => ({ id: row.id, url: row.url })),
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
    reading = null;
    // `working` stays true: recompute() calls the model once per email, and
    // until it ends the panel must not accept another pass.
    show({ name: "asking", candidates: results.length });
    void recompute().finally(() => {
      working = false;
    });
  }

  async function askAll() {
    const answers = new Map();
    for (const result of done.results) {
      if (result.error) continue;
      const row = done.rows.get(result.id) ?? {};
      const email = {
        subject: row.subject,
        sender: row.sender,
        text: result.text,
        attachments: (result.attachments ?? []).map(({ kind, base64, text }) => ({
          kind,
          base64,
          text,
        })),
      };
      const hash = await hashOf(email);
      if (cases.has(hash)) {
        answers.set(result.id, { answer: cases.get(hash), hash });
        continue;
      }
      try {
        const got = await chrome.runtime.sendMessage({ type: "extraer", email });
        if (!got?.ok) throw new Error(got?.error ?? "El modelo no respondió.");
        spend.push(got.usage);
        cases.set(hash, got.answer);
        answers.set(result.id, { answer: got.answer, hash });
      } catch (error) {
        answers.set(result.id, { error: error.message, hash });
      }
    }
    void rememberCases();
    return answers;
  }

  // recompute makes N network calls, so every caller must take `working`:
  // otherwise two passes overlap and the second finds done=null.
  function refresh() {
    if (working || !done) return;
    working = true;
    void recompute().finally(() => {
      working = false;
    });
  }

  async function recompute() {
    const answers = await askAll();
    const ready = [];
    const incomplete = [...done.unreadable];
    const already = [];
    const discarded = [];
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
      const got = answers.get(result.id) ?? {};
      if (got.error) {
        incomplete.push({
          emisor: nameOf(row),
          missing: [got.error],
          complete: false,
          failed: true,
        });
        continue;
      }
      const answer = got.answer;
      if (answer.esGasto === false) {
        rejected.add(got.hash);
        incomplete.push({
          emisor: answer.emisor || nameOf(row),
          missing: [answer.motivo || "el modelo dice que no es un gasto"],
          complete: false,
          rejected: true,
        });
        continue;
      }

      const attachments = result.attachments ?? [];
      const xmlText = attachments
        .filter((one) => one.kind === "xml" && one.text)
        .map((one) => one.text)
        .join("\n");
      const record = finalize(
        LilaAI.fieldsFrom(answer, {
          text: result.text,
          xmlText,
          receivedAt: dateFrom(row.received ?? ""),
        }),
        identity,
      );
      if (!record.complete) {
        console.info(
          `[Lila] incompleto · ${nameOf(row)} · falta ${record.missing.join(", ")} · ` +
            `texto ${(result.text ?? "").length} car. · adjuntos ${
              attachments
                .map((one) => `${one.kind}(${one.base64?.length ?? 0}b64)`)
                .join(", ") || "ninguno"
            }`,
        );
        incomplete.push(record);
      }
      else if (ready.some((one) => keyOf(one) === keyOf(record))) continue;
      else if (dropped.has(keyOf(record))) discarded.push(record);
      else if (!includeSent && sent.has(keyOf(record))) already.push(record);
      else ready.push(record);
    }
    show({
      name: "ready",
      records: ready,
      incomplete,
      progress: 100,
      already,
      dropped: discarded,
      needsId: !identity.cedula && incomplete.some(missingId),
      cost: costOf(model),
      fixable: incomplete.filter(
        (record) => record.missing.length === 1 && missingId(record),
      ).length,
    });
  }

  const missingId = (record) => record.missing?.includes(MISSING_ID);

  const remember = () =>
    chrome.storage.local
      .set({ dropped: [...dropped].slice(-3000) })
      .catch(() => {});

  // Dropping an invoice says it is not an expense you want recorded, so it is
  // remembered: later passes stop offering it.
  function drop(index) {
    const record = (state?.records ?? [])[index];
    if (!record || working) return;
    dropped.add(keyOf(record));
    console.info(`[Lila] quitada · ${record.emisor} · ${keyOf(record)}`);
    void remember();
    refresh();
  }

  function restoreDropped() {
    if (working) return;
    for (const record of state?.dropped ?? []) dropped.delete(keyOf(record));
    void remember();
    refresh();
  }

  // What you type wins over the model, even if it breaks the arithmetic:
  // you saw the invoice, the model did not.
  function edit(index, field, value) {
    const records = state?.records ?? [];
    const record = records[index];
    if (!record || working) return;

    const fields = {
      serie: record.generatedSerie ? null : record.serie,
      fecha: record.fecha,
      recipient: record.recipient,
      base: record.base,
      iva: record.iva,
      total: record.total,
      clave: record.clave,
      ruc: record.ruc,
      emisor: record.emisor,
      source: record.source,
      guessedDate: record.guessedDate,
    };

    if (field === "emisor") fields.emisor = value || record.emisor;
    if (field === "amount") {
      const amount = globalThis.LilaParse.normalizeAmount(value);
      if (!amount) return show({ ...state });
      // Rewrite BOTH sides of the pair: the TSV has separate columns, and
      // leaving the other one stale reports a total and a base that disagree.
      if (record.category === "GASTOS PERSONALES") {
        fields.total = amount;
        fields.base = fields.iva
          ? ((Number(amount) * 100 - Number(fields.iva) * 100) / 100).toFixed(2)
          : amount;
      } else {
        fields.base = amount;
        fields.total = fields.iva
          ? ((Number(amount) * 100 + Number(fields.iva) * 100) / 100).toFixed(2)
          : amount;
      }
    }

    const fixed = finalize(fields, identity);
    fixed.corrected = true;
    records[index] = fixed;
    show({ ...state, records });
  }

  async function consent() {
    await chrome.storage.local.set({ aiConsent: true });
    consented = true;
    void rescanNow();
  }

  async function saveId(cedula) {
    await chrome.storage.local.set({ cedula });
    identity = { ...identity, cedula };
    refresh();
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
      if (!answer?.ok)
        throw new Error(answer?.error ?? "No se pudieron entregar las facturas.");
      for (const record of records) sent.add(keyOf(record));
      show({
        name: "sent",
        sent: records.length,
        abierta: answer.abierta === true,
        progress: 100,
      });
    } catch (error) {
      show({ name: "error", message: readable(error), progress: 0 });
    } finally {
      working = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "escanear") {
      rescanNow();
      return;
    }
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

    console.info(
      "[Lila] extensión activa en Gmail. Pulsa el icono de Lila para buscar expenses: " +
        "ya no se escanea solo, porque cada repaso cuesta dinero.",
    );
    const stored = await chrome.storage.local.get([
      "cedula",
      "ruc",
      "sent",
      "dropped",
      "model",
      "aiCases",
      "aiRejected",
      "aiConsent",
    ]);
    identity = { cedula: stored.cedula, ruc: stored.ruc };
    sent = new Set(stored.sent ?? []);
    dropped = new Set(stored.dropped ?? []);
    model = stored.model || "claude-opus-5-5";
    cases = new Map(Object.entries(stored.aiCases ?? {}));
    rejected = new Set(stored.aiRejected ?? []);
    consented = stored.aiConsent === true;

    // No MutationObserver. Gmail mutates the DOM constantly — hovering a row
    // injects its toolbar — and closing the panel there erased it milliseconds
    // after it opened, throwing away a query just paid for.
    window.addEventListener("hashchange", () => {
      if (working) return;
      close();
    });
  }

  async function saveCorpus() {
    if (!done) return "Primero haz un repaso con «Leer y extraer».";
    let saved = 0;
    for (const result of done.results) {
      if (result.error) continue;
      const row = done.rows.get(result.id) ?? {};
      const email = {
        subject: row.subject,
        sender: row.sender,
        receivedAt: row.received,
        text: result.text,
        attachments: (result.attachments ?? []).map(({ kind, base64 }) => ({
          kind,
          base64,
        })),
      };
      const hash = await hashOf(email);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(email, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `correo-${hash.slice(0, 12)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      saved += 1;
    }
    return `${saved} correos descargados. Muévelos a tests/fixtures/correos/.`;
  }

  globalThis.lila = {
    revisar: () => gmail.diagnose(),
    escanear: rescanNow,
    guardar: saveCorpus,
    discarded: () => [...dropped],
    forgetDiscarded: () => {
      dropped = new Set();
      void remember();
      refresh();
      return "Vuelven a aparecer en el próximo repaso.";
    },
  };
  void start();
})();
