const DEFAULT_URL = "http://localhost:5173/";
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
  if (message?.type === "enviar") {
    queue(message)
      .then(() => respond({ ok: true }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

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

  const known = [stored.lilaUrl, stored.lastLila].filter(Boolean);
  for (const value of known) {
    let origin;
    try {
      origin = new URL(value).origin;
    } catch {
      continue;
    }
    const open = await chrome.tabs.query({ url: `${origin}/*` });
    if (!open.length) continue;
    const tab = open.find((one) => one.active) ?? open[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: known[0] ?? DEFAULT_URL });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  readers.get(tabId)?.("La pestaña se cerró antes de leer el correo.");
});

chrome.runtime.onInstalled.addListener(async () => {
  const { lilaUrl } = await chrome.storage.local.get("lilaUrl");
  if (lilaUrl === DEFAULT_URL) await chrome.storage.local.remove("lilaUrl");
});
