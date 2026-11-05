const LilaClave = {
  pattern: /\b\d{49}\b/g,

  parse(clave) {
    if (typeof clave !== "string" || !/^\d{49}$/.test(clave)) return null;
    const take = (from, length) => clave.slice(from, from + length);
    const day = take(0, 2);
    const month = take(2, 2);
    const year = take(4, 4);
    const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCDate() !== Number(day) ||
      date.getUTCMonth() + 1 !== Number(month) ||
      Number(year) < 2000 ||
      Number(year) > 2100
    )
      return null;
    return {
      clave,
      fecha: `${day}/${month}/${year}`,
      tipo: take(8, 2),
      ruc: take(10, 13),
      serie: `${take(24, 3)}-${take(27, 3)}-${take(30, 9)}`,
    };
  },

  checkDigit(first48) {
    let total = 0;
    let weight = 2;
    for (let i = first48.length - 1; i >= 0; i -= 1) {
      total += Number(first48[i]) * weight;
      weight = weight === 7 ? 2 : weight + 1;
    }
    const computed = 11 - (total % 11);
    if (computed === 11) return 0;
    if (computed === 10) return 1;
    return computed;
  },

  valid(clave) {
    return (
      /^\d{49}$/.test(clave) &&
      this.checkDigit(clave.slice(0, 48)) === Number(clave[48])
    );
  },

  all(text) {
    const found = [];
    const seen = new Set();
    const add = (raw, strict) => {
      const parsed = this.parse(raw);
      if (!parsed || seen.has(parsed.clave)) return;
      if (strict && !this.valid(parsed.clave)) return;
      seen.add(parsed.clave);
      found.push(parsed);
    };
    const flat = String(text);
    for (const match of flat.matchAll(this.pattern)) add(match[0], false);
    const tight = flat.replace(/\s+/g, "");
    if (tight !== flat)
      for (const run of tight.matchAll(/\d{49,}/g))
        for (let i = 0; i + 49 <= run[0].length; i += 1)
          add(run[0].slice(i, i + 49), true);
    return found;
  },
};

globalThis.LilaClave = LilaClave;
