const LilaPanel = (() => {
  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483000;
      width: min(348px, calc(100vw - 32px));
      display: flex;
      background: #fff;
      border: 1px solid #eeedf3;
      border-radius: 16px;
      box-shadow: 0 18px 44px -18px rgba(51, 47, 64, 0.38);
      overflow: hidden;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #332f40;
      text-align: left;
    }
    .rail { position: relative; width: 4px; flex: none; background: #f0ebf9; }
    .rail span {
      position: absolute;
      inset: auto 0 0 0;
      height: var(--done, 0%);
      background: linear-gradient(#835bb9, #7046aa);
      transition: height 240ms ease;
    }
    @media (prefers-reduced-motion: reduce) { .rail span { transition: none; } }
    .body { flex: 1; min-width: 0; padding: 14px 16px 16px; }
    header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .mark {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: #7046aa;
    }
    .mark i { font-style: normal; color: #b69bdc; }
    h2 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; }
    .status { margin: 0; color: #595466; }
    .hint { margin: 6px 0 0; font-size: 12px; color: #858190; }
    button {
      font: inherit;
      cursor: pointer;
      border-radius: 10px;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    button:focus-visible { outline: 3px solid #b69bdc; outline-offset: 2px; }
    button:disabled { cursor: default; opacity: 0.45; }
    .close {
      width: 28px;
      height: 28px;
      margin: -4px -6px -4px 0;
      padding: 0;
      font-size: 16px;
      background: none;
      color: #858190;
      border-radius: 8px;
    }
    .close:hover { background: #f6f4fb; color: #332f40; }
    .action {
      width: 100%;
      min-height: 40px;
      margin-top: 12px;
      padding: 0 14px;
      font-weight: 600;
      color: #fff;
      background: #7046aa;
    }
    .action:hover:not(:disabled) { background: #5d3792; }
    ul { margin: 12px 0 0; padding: 0; list-style: none; }
    li { padding: 9px 0; border-top: 1px solid #f3f2f7; }
    li:first-child { border-top: 0; }
    .line { display: flex; gap: 10px; align-items: baseline; }
    .who { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
    .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .meta {
      display: flex;
      gap: 10px;
      margin-top: 2px;
      font-size: 11px;
      color: #858190;
    }
    .meta span:first-child { flex: 1; font-variant-numeric: tabular-nums; }
    details { margin-top: 12px; font-size: 12px; }
    summary { cursor: pointer; color: #5d3792; }
    summary:focus-visible { outline: 3px solid #b69bdc; outline-offset: 2px; }
    details ul { margin-top: 6px; }
    details li { color: #858190; }
    .error { margin: 10px 0 0; color: #a3314c; }
    .ask {
      margin-top: 12px;
      padding: 12px;
      background: #f8f6fc;
      border: 1px solid #ece6f6;
      border-radius: 10px;
    }
    .ask label { display: block; font-weight: 600; margin-bottom: 6px; }
    .ask .row { display: flex; gap: 8px; }
    .ask input {
      flex: 1;
      min-width: 0;
      min-height: 36px;
      padding: 0 10px;
      font: inherit;
      color: #332f40;
      background: #fff;
      border: 1px solid #e0daec;
      border-radius: 8px;
    }
    .ask input:focus-visible {
      outline: 3px solid #b69bdc;
      outline-offset: 1px;
      border-color: #b69bdc;
    }
    .ask button {
      min-height: 36px;
      padding: 0 14px;
      font-weight: 600;
      color: #fff;
      background: #7046aa;
    }
    .ask button:hover { background: #5d3792; }
    .ask p { margin: 8px 0 0; font-size: 12px; color: #858190; }
    .ask p.bad { color: #a3314c; }
    .inline-link {
      margin-top: 8px;
      padding: 0;
      font-size: 12px;
      font-weight: 500;
      color: #5d3792;
      background: none;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .inline-link:hover { color: #44286d; }
  `;

  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  const MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const monthName = (month) =>
    month ? `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : "";
  const money = (value) =>
    `$ ${Number(value).toLocaleString("es-EC", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  class Panel {
    constructor({ onExtract, onSend, onClose, onSaveId, onIncludeSent }) {
      this.handlers = { onExtract, onSend, onClose, onSaveId, onIncludeSent };
      this.host = document.createElement("div");
      this.host.id = "lila-panel-host";
      this.root = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      this.root.append(style);
      this.frame = document.createElement("div");
      this.frame.className = "panel";
      this.frame.setAttribute("role", "complementary");
      this.frame.setAttribute("aria-label", "Lila, gastos detectados");
      this.root.append(this.frame);
      this.onKey = (event) => {
        if (event.key === "Escape") this.handlers.onClose?.();
      };
    }

    mount() {
      if (!this.host.isConnected) document.body.append(this.host);
      document.addEventListener("keydown", this.onKey, true);
    }

    unmount() {
      document.removeEventListener("keydown", this.onKey, true);
      this.host.remove();
    }

    render(state) {
      this.frame.innerHTML = `
        <div class="rail" aria-hidden="true"><span style="--done:${state.progress ?? 0}%"></span></div>
        <div class="body">
          <header>
            <span class="mark" aria-hidden="true">l<i>•</i></span>
            <h2>Gastos en tu correo</h2>
            <button class="close" type="button" aria-label="Cerrar">&times;</button>
          </header>
          ${this.content(state)}
        </div>`;
      this.frame
        .querySelector(".close")
        .addEventListener("click", () => this.handlers.onClose?.());
      this.frame
        .querySelector("#lila-close")
        ?.addEventListener("click", () => this.handlers.onClose?.());
      this.frame
        .querySelector("#lila-extract")
        ?.addEventListener("click", () => this.handlers.onExtract?.());
      this.frame
        .querySelector("#lila-send")
        ?.addEventListener("click", () => this.handlers.onSend?.());
      this.frame
        .querySelector("#lila-include")
        ?.addEventListener("click", () => this.handlers.onIncludeSent?.());
      this.frame
        .querySelector("#lila-ask")
        ?.addEventListener("submit", (event) => {
          event.preventDefault();
          const input = this.frame.querySelector("#lila-cedula");
          const note = this.frame.querySelector("#lila-ask-note");
          const value = input.value.trim();
          if (!/^\d{10}$/.test(value)) {
            note.textContent = "La cédula tiene diez dígitos.";
            note.className = "bad";
            input.focus();
            return;
          }
          this.handlers.onSaveId?.(value);
        });
    }

    content(state) {
      if (state.name === "found")
        return `<p class="status" aria-live="polite">${plural(
          state.candidates,
          "correo parece una factura",
          "correos parecen facturas",
        )}.</p>
          <p class="hint">Las abro en pestañas que no vas a ver, leo sus datos y las cierro. Tu bandeja no se mueve. Gmail las marcará como leídas.</p>
          <button class="action" type="button" id="lila-extract">Leer y extraer</button>`;

      if (state.name === "reading")
        return `<p class="status" aria-live="polite">Leyendo ${state.done} de ${state.candidates}.</p>
          <p class="hint">Sigue en lo tuyo; te aviso cuando acabe.</p>
          <button class="action" type="button" disabled>Leyendo…</button>`;

      if (state.name === "sent")
        return `<p class="status" aria-live="polite">${plural(
          state.sent,
          "factura enviada",
          "facturas enviadas",
        )} a Lila.</p>
          <p class="hint">${
            state.abierta
              ? "Lila las está guardando en su pestaña, cada una en su mes. Si alguna no cuadra, bórrala desde ahí."
              : "Quedan guardadas aquí y entrarán solas la próxima vez que abras Lila, cada una en su mes."
          }</p>
          <button class="action" type="button" id="lila-close">Listo</button>`;

      if (state.name === "error")
        return `<p class="error" role="alert">${escape(state.message)}</p>
          <p class="hint">Recarga Gmail y vuelve a intentarlo. Si sigue igual, los selectores de Gmail cambiaron.</p>
          <button class="action" type="button" id="lila-extract">Intentar de nuevo</button>`;

      const ready = state.records ?? [];
      const incomplete = state.incomplete ?? [];
      const already = state.already ?? [];
      if (!ready.length && !incomplete.length && !already.length)
        return `<p class="status">Ningún correo nuevo parece una factura.</p>
          <p class="hint">Vuelvo a mirar cuando lleguen más.</p>`;

      const exact = ready.filter((record) => record.source === "xml").length;
      return `<p class="status" aria-live="polite">${plural(
        ready.length,
        "factura lista para registrar",
        "facturas listas para registrar",
      )}.</p>
        ${exact ? `<p class="hint">${plural(exact, "viene", "vienen")} del XML adjunto, con los datos exactos.</p>` : ""}
        ${
          ready.length
            ? `<ul>${ready
                .map(
                  (record) => `<li>
                    <div class="line">
                      <span class="who">${escape(record.emisor)}</span>
                      <span class="amount">${money(record.amount)}</span>
                    </div>
                    <div class="meta">
                      <span>${escape(record.serie)}</span>
                      <span>${escape(monthName(record.month))}${
                        record.guessedDate ? " (fecha del correo)" : ""
                      }</span>
                    </div>
                  </li>`,
                )
                .join("")}</ul>`
            : ""
        }
        ${
          already.length
            ? `<details>
                <summary>${plural(
                  already.length,
                  "factura que ya enviaste antes",
                  "facturas que ya enviaste antes",
                )}</summary>
                <ul>${already
                  .map(
                    (record) =>
                      `<li>${escape(record.emisor)} · ${money(record.amount)}</li>`,
                  )
                  .join("")}</ul>
                <button class="inline-link" type="button" id="lila-include">Incluirlas igual</button>
              </details>`
            : ""
        }
        ${
          incomplete.length
            ? `<details>
                <summary>${plural(
                  incomplete.length,
                  "correo sin datos suficientes",
                  "correos sin datos suficientes",
                )}</summary>
                <ul>${incomplete
                  .map(
                    (record) =>
                      `<li>${escape(record.emisor)}: ${
                        record.failed ? "" : "falta "
                      }${escape(record.missing.join(", "))}.</li>`,
                  )
                  .join("")}</ul>
                <p class="hint">Ábrelos en Gmail y agrégalos a mano en Lila.</p>
              </details>`
            : ""
        }
        ${
          state.learned
            ? `<p class="hint">Deduje que tu identificación es <b>${escape(state.learned)}</b>, porque se repite en tus facturas. Cámbiala en los ajustes si no es tuya.</p>`
            : ""
        }
        ${
          state.needsId
            ? `<form class="ask" id="lila-ask">
                <label for="lila-cedula">Tu cédula</label>
                <div class="row">
                  <input id="lila-cedula" inputmode="numeric" maxlength="10" placeholder="0912345678" autocomplete="off">
                  <button type="submit">Guardar</button>
                </div>
                <p id="lila-ask-note">${
                  state.fixable
                    ? `Con ella, ${plural(state.fixable, "correo queda listo", "correos quedan listos")} ahora mismo.`
                    : "Se guarda en la extensión, en este navegador."
                }</p>
              </form>`
            : ""
        }
        <button class="action" type="button" id="lila-send" ${ready.length ? "" : "disabled"}>
          Enviar ${ready.length} a Lila
        </button>`;
    }
  }

  return { Panel, money, monthName };
})();

globalThis.LilaPanel = LilaPanel;
