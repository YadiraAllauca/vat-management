importScripts("src/clave.js", "src/parse.js", "src/ai.js", "src/claude.js");

// Optional and local: `key.local.js` defines globalThis.LILA_KEY. It is
// gitignored; if absent, importScripts throws and we carry on without it.
try {
  importScripts("key.local.js");
} catch {}

const LEGACY_URL = "http://localhost:5173/";
const MODEL_DEFAULT = "claude-sonnet-5-5";
const GMAIL_URL = "https://mail.google.com/mail/u/0/#inbox";
const AT_A_TIME = 2;
const TAB_TIMEOUT = 25000;

const readers = new Map();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const tabId = sender.tab?.id;

  if (message?.type === "lector?") {
    respond({ lector: readers.has(tabId) });
    return true;
  }
  if (message?.type === "cuerpo") {
    readers.get(tabId)?.(message.error, {
      text: message.text,
      attachments: message.attachments ?? [],
    });
    respond({ ok: true });
    return true;
  }
  if (message?.type === "leer") {
    readAll(message.candidatos ?? [], tabId);
    respond({ ok: true });
    return true;
  }
  if (message?.type === "lila-aqui") {
    void chrome.storage.local.set({ lastLila: message.url });
    respond({ ok: true });
    return true;
  }
  if (message?.type === "opciones") {
    chrome.runtime.openOptionsPage();
    respond({ ok: true });
    return true;
  }
  if (message?.type === "clasificar") {
    clasificar(message.rows ?? [])
      .then((payload) => respond({ ok: true, ...payload }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "extraer") {
    extraer(message.email ?? {})
      .then((payload) => respond({ ok: true, ...payload }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "enviar") {
    queue(message)
      .then((abierta) => respond({ ok: true, abierta }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

function settings() {
  const key = globalThis.LILA_KEY ?? "";
  return {
    key: key === "sk-ant-..." ? "" : key,
    model: globalThis.LILA_MODEL || MODEL_DEFAULT,
  };
}

async function clasificar(rows) {
  const { key, model } = settings();
  const body = LilaAI.triageBody(rows, { model });
  const { message, usage } = await LilaClaude.call(body, key);
  return { filas: LilaAI.readTriage(message), usage };
}

async function extraer(email) {
  const { key, model } = settings();
  const body = LilaAI.extractBody(email, { model });
  const { message, usage } = await LilaClaude.call(body, key);
  return { answer: LilaAI.readExtract(message), usage };
}

function readOne(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }).then((tab) => {
      let settled = false;
      const settle = (error, payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        readers.delete(tab.id);
        chrome.tabs.remove(tab.id).catch(() => {});
        if (error) reject(new Error(error));
        else resolve(payload);
      };
      const timer = setTimeout(
        () => settle("El correo tardó demasiado en abrirse."),
        TAB_TIMEOUT,
      );
      readers.set(tab.id, settle);
    }, reject);
  });
}

async function readAll(candidates, inboxTabId) {
  const queueOf = [...candidates];
  const results = [];
  let done = 0;

  const tell = async (payload) => {
    try {
      await chrome.tabs.sendMessage(inboxTabId, payload);
    } catch {}
  };

  const worker = async () => {
    while (queueOf.length) {
      const item = queueOf.shift();
      try {
        results.push({ id: item.id, ...(await readOne(item.url)) });
      } catch (error) {
        results.push({ id: item.id, error: error.message });
      }
      done += 1;
      await tell({ type: "progreso", done, total: candidates.length });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(AT_A_TIME, candidates.length) }, worker),
  );
  await tell({ type: "cuerpos", results });
}

async function queue({ report, keys }) {
  if (typeof report !== "string" || !report.includes("\t"))
    throw new Error("El informe llegó vacío.");
  const stored = await chrome.storage.local.get([
    "lilaUrl",
    "lastLila",
    "pending",
    "sent",
  ]);
  const pending = [
    ...(stored.pending ?? []),
    { report, at: new Date().toISOString() },
  ];
  const sent = [...new Set([...(stored.sent ?? []), ...(keys ?? [])])].slice(
    -3000,
  );
  await chrome.storage.local.set({ pending, sent });

  for (const value of [stored.lilaUrl, stored.lastLila].filter(Boolean)) {
    let origin;
    try {
      origin = new URL(value).origin;
    } catch {
      continue;
    }
    const open = await chrome.tabs.query({ url: `${origin}/*` });
    if (open.length) return true;
  }
  return false;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  readers.get(tabId)?.("La pestaña se cerró antes de leer el correo.");
});

async function inboxTab(clicked) {
  if (
    clicked?.id !== undefined &&
    !readers.has(clicked.id) &&
    (clicked.url ?? "").startsWith("https://mail.google.com/")
  )
    return clicked;
  const open = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  return open.find((one) => !readers.has(one.id)) ?? null;
}

chrome.action.onClicked.addListener(async (clicked) => {
  const inbox = await inboxTab(clicked);
  if (!inbox) {
    await chrome.tabs.create({ url: GMAIL_URL });
    return;
  }
  if (!inbox.active) {
    await chrome.tabs.update(inbox.id, { active: true });
    await chrome.windows.update(inbox.windowId, { focused: true });
  }
  try {
    await chrome.tabs.sendMessage(inbox.id, { type: "escanear" });
  } catch {
    await chrome.tabs.reload(inbox.id);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const { lilaUrl } = await chrome.storage.local.get("lilaUrl");
  if (lilaUrl === LEGACY_URL) await chrome.storage.local.remove("lilaUrl");
});
