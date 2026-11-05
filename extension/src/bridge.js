(() => {
  let ready = false;
  let buried = false;

  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  function bury() {
    if (buried) return;
    buried = true;
    delete document.documentElement.dataset.lilaExtension;
    document.dispatchEvent(new Event("lila:extension-gone"));
  }

  async function ask(work) {
    if (buried || !alive()) {
      bury();
      return false;
    }
    try {
      await work();
      return true;
    } catch {
      bury();
      return false;
    }
  }

  const announce = () =>
    ask(async () => {
      const { version } = chrome.runtime.getManifest();
      const { cedula = "", ruc = "" } = await chrome.storage.local.get([
        "cedula",
        "ruc",
      ]);
      document.documentElement.dataset.lilaExtension = version;
      void chrome.runtime.sendMessage({
        type: "lila-aqui",
        url: `${location.origin}${location.pathname}`,
      });
      document.dispatchEvent(
        new CustomEvent("lila:extension-ready", {
          detail: { version, cedula, ruc },
        }),
      );
    });

  document.addEventListener("lila:extension-ping", () => void announce());

  document.addEventListener("lila:extension-identity", (event) => {
    const { cedula = "", ruc = "" } = event.detail ?? {};
    void ask(async () => {
      await chrome.storage.local.set({
        cedula: String(cedula),
        ruc: String(ruc),
      });
      await announce();
    });
  });

  document.addEventListener("lila:extension-options", () => {
    void ask(() => chrome.runtime.sendMessage({ type: "opciones" }));
  });

  const flush = () =>
    ask(async () => {
      if (!ready) return;
      const { pending } = await chrome.storage.local.get("pending");
      if (!pending?.length) return;
      await chrome.storage.local.remove("pending");
      const text = pending
        .map(({ report }, index) =>
          index === 0 ? report : report.split("\n").slice(1).join("\n"),
        )
        .join("\n");
      document.dispatchEvent(
        new CustomEvent("lila:gmail-report", {
          detail: { text, name: "Facturas detectadas en Gmail.txt" },
        }),
      );
    });

  document.addEventListener("lila:ready", () => {
    ready = true;
    void flush();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.pending) void flush();
    });
  } catch {
    bury();
  }

  void announce();
})();
