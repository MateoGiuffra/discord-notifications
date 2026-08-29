/**
 * Gmail -> Discord :: limpieza de texto
 *
 * Como Markdown.gs: JavaScript puro, sin servicios de Google.
 */

/** Saca firmas y respuestas citadas para que el embed no sea un muro. */
function stripQuoted(text) {
  return text
    .split(/^On .+ wrote:$|^El .+ escribi\u00f3:$|^\s*>.*$/m)[0]
    .split(/^-- $/m)[0]
    .trim();
}

/**
 * Corta la firma institucional del pie. Ignora las marcas de Markdown
 * al comparar, porque el nombre suele venir en negrita.
 */
function stripSignature(text) {
  const lines = text.split('\n');
  const desde = Math.floor(lines.length * 0.5);

  for (let i = desde; i < lines.length; i++) {
    const plano = lines[i].replace(/[*_~`]/g, '').trim();
    if (!plano) continue;

    const esFirma = FIRMA.some(function (re) { return re.test(plano); });
    if (esFirma) return lines.slice(0, i).join('\n').trim();
  }

  return text.trim();
}

/**
 * 'Flavia E. Saldana <x@y.com>' -> 'Flavia E. Saldana'
 *
 * El nombre puede venir con comillas anidadas y escapadas, porque la
 * lista reenvia y vuelve a escapar lo que ya estaba entre comillas:
 *
 *   "\"Federico Salguero (via Google Sheets)\"" <tpi-est-orga@...>
 *
 * Por eso primero separamos por el <...> del final (que es lo unico
 * confiable) y recien despues limpiamos el nombre.
 */
function parseSender(from) {
  const s = String(from || '').trim();

  const m = s.match(/^([\s\S]*?)\s*<([^>]+)>\s*$/);
  if (!m) return desescapar(s); // sin <>: suele ser la direccion pelada

  return desescapar(m[1]) || m[2].trim();
}

/**
 * Saca las comillas que envuelven un nombre y deshace los escapes.
 * Itera porque pueden venir varias capas, una por reenvio.
 */
function desescapar(texto) {
  let t = String(texto).trim();

  for (let i = 0; i < 3 && /^"[\s\S]*"$/.test(t); i++) {
    t = t.slice(1, -1).replace(/\\(["\\])/g, '$1').trim();
  }

  return t.replace(/\\(["\\])/g, '$1').trim();
}

/** Saca el prefijo que la lista repite en todos los asuntos. */
function cleanSubject(subject) {
  const s = (subject || '(sin asunto)').trim();
  if (SUBJECT_PREFIX && s.indexOf(SUBJECT_PREFIX) === 0) {
    return s.slice(SUBJECT_PREFIX.length).trim() || '(sin asunto)';
  }
  return s;
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  // Cortamos en un salto de linea para no partir una palabra al medio.
  const cut = str.slice(0, max - 20);
  const nl = cut.lastIndexOf('\n');
  return (nl > max * 0.6 ? cut.slice(0, nl) : cut) + '\n\n\u2026';
}
