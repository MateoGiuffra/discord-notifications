/**
 * Gmail -> Discord :: HTML -> Markdown
 *
 * Todo este archivo es JavaScript puro: no toca ningun servicio de
 * Google. Se puede copiar tal cual a Node y testear localmente.
 */

/** Convierte el HTML de un mail a Markdown de Discord. */
function htmlToMarkdown(html) {
  let s = html;

  // Fuera lo que no es contenido.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Links antes de romper los tags, que necesitamos el href.
  s = s.replace(
    /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    function (_, href, texto) {
      const label = stripTags(texto).trim();
      if (!label) return '';
      if (href.indexOf('mailto:') === 0) return label;
      // Si el texto ya es la URL, no repetimos.
      if (label === href) return href;
      return '[' + label + '](' + href + ')';
    }
  );

  // Formato inline.
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, '__$1__');
  s = s.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Titulos: Discord no tiene h1-h6 dentro de embeds, van en negrita.
  s = s.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n**$1**\n');

  // Listas: el bullet y su texto tienen que quedar en la MISMA linea.
  s = s.replace(/<li\b[^>]*>/gi, '\n\u0001');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n');

  // Citas.
  s = s.replace(/<blockquote\b[^>]*>/gi, '\n> ');
  s = s.replace(/<\/blockquote>/gi, '\n');

  // Saltos de linea y bloques.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|table)>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n');

  s = stripTags(s);
  s = decodeEntities(s);

  // Ahora si: cada marca de <li> se come los saltos que la separan de
  // su texto y queda un bullet de Discord bien formado.
  s = s.replace(/\u0001[\s\n]*/g, '- ');

  return compactLists(tidy(s));
}

/**
 * Saca los renglones en blanco ENTRE items de una lista. Gmail separa
 * cada <li> con divs vacios y sin esto la lista queda a doble espacio.
 * El blanco que precede al primer item se respeta: separa del parrafo.
 */
function compactLists(s) {
  const lines = s.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const anterior = out.length ? out[out.length - 1] : '';
    const siguiente = lines[i + 1] || '';
    const entreItems = /^- /.test(anterior) && /^- /.test(siguiente);

    if (lines[i].trim() === '' && entreItems) continue;
    out.push(lines[i]);
  }

  return out.join('\n');
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

function decodeEntities(s) {
  const named = {
    nbsp: " ", amp: "&", lt: "<", gt: ">",
    quot: "\"", apos: "'", aacute: "á", eacute: "é",
    iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ",
    uuml: "ü", agrave: "à", Aacute: "Á", Eacute: "É",
    Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ",
    Uuml: "Ü", iquest: "¿", iexcl: "¡", ordm: "º",
    ordf: "ª", laquo: "«", raquo: "»", middot: "·",
    deg: "°", sect: "§", para: "¶", copy: "©",
    reg: "®", trade: "™", euro: "€", pound: "£",
    yen: "¥", cent: "¢", frac12: "½", frac14: "¼",
    frac34: "¾", sup2: "²", sup3: "³", hellip: "…",
    mdash: "—", ndash: "–", bull: "•", lsquo: "‘",
    rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚",
    bdquo: "„", dagger: "†", Dagger: "‡", permil: "‰",
    prime: "′", Prime: "″", oline: "‾", and: "∧",
    or: "∨", not: "¬", oplus: "⊕", otimes: "⊗",
    forall: "∀", exist: "∃", empty: "∅", isin: "∈",
    notin: "∉", ni: "∋", cap: "∩", cup: "∪",
    sub: "⊂", sup: "⊃", nsub: "⊄", sube: "⊆",
    supe: "⊇", equiv: "≡", ne: "≠", le: "≤",
    ge: "≥", asymp: "≈", cong: "≅", prop: "∝",
    ang: "∠", perp: "⊥", sdot: "⋅", lowast: "∗",
    there4: "∴", plusmn: "±", times: "×", divide: "÷",
    minus: "−", frasl: "⁄", infin: "∞", sum: "∑",
    prod: "∏", radic: "√", int: "∫", part: "∂",
    nabla: "∇", micro: "µ", larr: "←", uarr: "↑",
    rarr: "→", darr: "↓", harr: "↔", lArr: "⇐",
    uArr: "⇑", rArr: "⇒", dArr: "⇓", hArr: "⇔",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ",
    epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ",
    pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
    phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ",
    Omega: "Ω", Phi: "Φ", Lambda: "Λ", Gamma: "Γ",
    Pi: "Π"
  };

  return s
    .replace(/&#(\d+);/g, function (_, n) {
      return String.fromCharCode(Number(n));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/&([a-z]+);/gi, function (m, name) {
      return named[name] !== undefined ? named[name] : m;
    });
}

/** Normaliza espacios en blanco sin aplastar la estructura. */
function tidy(s) {
  return s
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(function (line) { return line.replace(/[ \t]+$/, ''); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
