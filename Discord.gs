/**
 * Gmail -> Discord :: armado y envio del mensaje
 */

/**
 * Publica un mail en el canal.
 *
 * Si el mail trae imagenes que entren en el limite del webhook, van
 * subidas como adjunto del propio request (multipart) y referenciadas
 * desde el embed con el esquema attachment://. Las URLs que trae el
 * HTML de Gmail NO sirven: las incrustadas son `cid:` (un adjunto, no
 * una URL) y las remotas pasan por el proxy de googleusercontent, que
 * le responde 403 al fetcher de Discord.
 */
function postToDiscord(webhook, msg) {
  let archivos = seleccionarArchivos(msg);
  let sueltos = [];

  // Discord ordena content, adjuntos, embeds: un PDF queda ARRIBA del
  // aviso. Con ADJUNTOS_DEBAJO lo sacamos del mensaje principal y va en
  // uno segundo, que se renderiza abajo. Las imagenes de la galeria se
  // quedan: tienen que viajar en el mismo request que su embed.
  if (ADJUNTOS_DEBAJO) {
    const galeria = galeriaDe(archivos);
    sueltos = archivos.subidos.filter(function (a) {
      return galeria.indexOf(a) === -1;
    });
    archivos = { subidos: galeria, omitidos: archivos.omitidos };
  }

  // El aviso es lo que importa; los adjuntos son un extra. Si algo del
  // envio con archivos falla por tamaño, el mensaje sale igual.
  function enviar() {
    const payload = { embeds: buildEmbeds(msg, archivos) };

    const roleId = PropertiesService.getScriptProperties()
      .getProperty('DISCORD_ROLE_ID');

    if (roleId) {
      // La mencion va en content y no adentro del embed: las menciones
      // dentro de un embed se ven en azul pero NO notifican a nadie.
      payload.content = '<@&' + roleId + '>';
      payload.allowed_mentions = { roles: [roleId] };
    }

    const blobs = archivos.subidos.map(function (a) { return a.blob; });

    return blobs.length
      ? enviarMultipart(webhook, payload, blobs)
      : enviarJson(webhook, payload);
  }

  let res = enviar();

  // 429 corto de Discord: nos dice cuanto esperar y suele ser < 1s.
  // Lo aguantamos en la misma corrida en vez de perder el mensaje.
  if (res.getResponseCode() === 429) {
    const espera = esperaSugerida(res);
    if (espera !== null && espera <= REINTENTO_MAX_ESPERA) {
      Utilities.sleep((espera + 0.5) * 1000);
      res = enviar();
    }
  }

  // Red de seguridad: si el request rebota por tamaño, reintentamos sin
  // ningun archivo. Los limites de Config.gs tendrian que evitarlo, pero
  // el overhead del multipart y los limites del servidor no son exactos,
  // y un adjunto pesado no puede costarnos el aviso entero.
  if (archivos.subidos.length && esErrorDeTamano(res)) {
    console.warn('El request no entro (' + res.getResponseCode() +
      '). Reenviando sin adjuntos.');
    archivos = {
      subidos: [],
      omitidos: archivos.omitidos.concat(
        archivos.subidos.map(function (a) { return a.original; })
      )
    };
    res = enviar();
  }

  const code = res.getResponseCode();

  if (code === 429) {
    // Sigue rebotando: nos apartamos un rato. Insistir cada minuto
    // contra un 1015 de Cloudflare solo estira el bloqueo.
    const segundos = pausar(res);
    throw new Error('Rate limit (429). En pausa ' +
      Math.round(segundos / 60) + ' min. ' + resumen(res));
  }

  if (code < 200 || code >= 300) {
    throw new Error('Discord respondio ' + code + ': ' + res.getContentText());
  }

  // El aviso ya salio. Si el segundo mensaje falla lo logueamos y
  // seguimos: tirar aca haria que la proxima corrida reenvie el mail
  // entero y quede duplicado en el canal.
  if (sueltos.length) {
    Utilities.sleep(400);
    const extra = enviarMultipart(webhook, {}, sueltos.map(function (a) {
      return a.blob;
    }));

    if (extra.getResponseCode() >= 300) {
      console.warn('El aviso salio, pero los adjuntos no (' +
        extra.getResponseCode() + '): ' + extra.getContentText().slice(0, 200));
    }
  }
}

/**
 * Cuantos segundos pide esperar la respuesta, o null si no lo dice.
 *
 * Hay dos 429 distintos y conviene no confundirlos:
 *
 *   - El de Discord: JSON con retry_after, por webhook, casi siempre
 *     menos de un segundo. Es el normal si mandas muchos seguidos.
 *
 *   - El de Cloudflare (error code: 1015): HTML, sin retry_after, por
 *     IP y no por webhook. Apps Script sale por IPs compartidas de
 *     Google, asi que el bloqueo puede no ser culpa tuya y dura desde
 *     minutos hasta una hora. Ahi devolvemos null.
 */
function esperaSugerida(res) {
  const header = res.getAllHeaders()['Retry-After'] ||
    res.getAllHeaders()['retry-after'];
  if (header) return Number(header);

  try {
    const body = JSON.parse(res.getContentText());
    if (body && body.retry_after !== undefined) return Number(body.retry_after);
  } catch (e) { /* no era JSON: es el HTML de Cloudflare */ }

  return null;
}

/** Guarda hasta cuando no hay que volver a intentar. Devuelve segundos. */
function pausar(res) {
  const sugerida = esperaSugerida(res);
  const segundos = sugerida !== null
    ? Math.max(sugerida, 60)
    : PAUSA_429_DEFAULT;

  PropertiesService.getScriptProperties().setProperty(
    'PAUSA_HASTA',
    String(Math.floor(Date.now() / 1000) + segundos)
  );

  return segundos;
}

/**
 * ¿Rebote por tamaño del request?
 *
 * 413 es el claro. Discord tambien contesta 400 con un mensaje sobre el
 * archivo cuando el multipart pasa el limite del servidor, asi que
 * miramos el cuerpo antes de darlo por perdido.
 */
function esErrorDeTamano(res) {
  const code = res.getResponseCode();
  if (code === 413) return true;
  if (code !== 400) return false;

  const texto = res.getContentText().toLowerCase();
  return texto.indexOf('too large') !== -1 ||
    texto.indexOf('payload') !== -1 ||
    texto.indexOf('max_file_size') !== -1 ||
    texto.indexOf('entity too') !== -1;
}

/** Distingue de un vistazo cual de los dos 429 fue. */
function resumen(res) {
  const texto = res.getContentText();
  if (texto.indexOf('1015') !== -1) {
    return 'Es Cloudflare (1015), por IP: Apps Script sale por IPs ' +
      'compartidas de Google. Se destraba solo.';
  }
  return texto.slice(0, 200);
}

function enviarJson(webhook, payload) {
  return UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

/**
 * Mismo POST, pero con archivos.
 *
 * Cuando el payload es un objeto con Blobs adentro, Apps Script arma el
 * multipart/form-data solo. Es clave NO pasar contentType: si lo forzas
 * a application/json, manda el objeto serializado mal y Discord tira
 * 400 sin explicar mucho.
 */
function enviarMultipart(webhook, payload, blobs) {
  const form = { payload_json: JSON.stringify(payload) };
  blobs.forEach(function (blob, i) {
    form['files[' + i + ']'] = blob;
  });

  return UrlFetchApp.fetch(webhook, {
    method: 'post',
    payload: form,
    muteHttpExceptions: true
  });
}

/**
 * Elige que adjuntos del mail subir a Discord.
 *
 * Sube de todo, no solo imagenes: Discord le da una vista previa a los
 * PDF, muestra las primeras lineas de los .txt, reproduce los videos y
 * a lo demas le pone una tarjeta de descarga. Todo mejor que un nombre
 * en un field.
 *
 * includeInlineImages trae las incrustadas en el cuerpo, que por
 * defecto getAttachments() deja afuera: son justo las que uno quiere
 * ver (el flyer, la captura, el diagrama).
 *
 * Devuelve { subidos, omitidos }, donde subidos es
 * [{ blob, original, esImagen }] y omitidos son los nombres de lo que
 * no entro, para listarlos en el embed.
 */
function seleccionarArchivos(msg) {
  const todos = msg.getAttachments({ includeInlineImages: true });

  // Por prioridad, no por orden de aparicion: si el presupuesto se
  // agota, que se pierda el PDF (que igual queda listado por nombre) y
  // no la imagen, que es lo unico que se puede mostrar DENTRO del embed.
  const orden = todos.slice().sort(function (a, b) {
    return prioridad(a) - prioridad(b);
  });

  const subidos = [];
  const omitidos = [];
  let acumulado = 0;

  orden.forEach(function (adj) {
    const bytes = adj.getSize();
    const entra = subidos.length < MAX_ARCHIVOS &&
      bytes <= MAX_ARCHIVO_BYTES &&
      acumulado + bytes <= PRESUPUESTO_ARCHIVOS;

    if (!entra) return omitidos.push(adj.getName());

    acumulado += bytes;
    subidos.push({
      blob: adj.copyBlob()
        .setName(nombreSeguro(adj.getName(), subidos.length, adj.getContentType())),
      original: adj.getName(),
      esImagen: esImagen(adj)
    });
  });

  return { subidos: subidos, omitidos: omitidos };
}

function esImagen(adj) {
  return adj.getContentType().indexOf('image/') === 0;
}

/**
 * Los archivos que se ven DENTRO del embed.
 *
 * Solo imagenes, y hasta MAX_IMAGENES: son las unicas que se pueden
 * referenciar con attachment://. Todo lo demas (PDF, xlsx, txt, video)
 * es un adjunto suelto del mensaje.
 */
function galeriaDe(archivos) {
  return archivos.subidos
    .filter(function (a) { return a.esImagen; })
    .slice(0, MAX_IMAGENES);
}

/** Imagen primero, despues video, despues todo lo demas. */
function prioridad(adj) {
  if (esImagen(adj)) return 0;
  if (adj.getContentType().indexOf('video/') === 0) return 1;
  return 2;
}

/**
 * attachment:// referencia el archivo por nombre, asi que el nombre
 * tiene que sobrevivir a la URL y ser unico dentro del request. Las
 * imagenes de Gmail suelen llamarse todas 'image001.png'.
 *
 * La extension importa: es de lo que se agarra Discord para decidir si
 * previsualiza, reproduce o solo ofrece descargar.
 */
function nombreSeguro(nombre, indice, contentType) {
  const limpio = String(nombre || 'adjunto')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-60);

  if (/\.[A-Za-z0-9]{1,5}$/.test(limpio)) return indice + '_' + limpio;

  // Sin extension, la deducimos del content type: image/png -> .png
  const ext = String(contentType || '').split('/')[1];
  return indice + '_' + limpio + (ext ? '.' + ext.split(';')[0].trim() : '');
}

/**
 * Los embeds del mensaje.
 *
 * El primero lleva todo el contenido; los siguientes existen solo para
 * mostrar las imagenes de mas. Discord agrupa en galeria los embeds que
 * comparten la misma `url`, por eso todos apuntan al mismo hilo.
 */
function buildEmbeds(msg, archivos) {
  archivos = archivos || { subidos: [], omitidos: [] };

  const url = 'https://mail.google.com/mail/u/0/#inbox/' + msg.getThread().getId();

  const embed = {
    author: { name: truncate(parseSender(msg.getFrom()), 256) },
    title: truncate(cleanSubject(msg.getSubject()), 256),
    url: url,
    description: truncate(bodyToMarkdown(msg), MAX_BODY) || '_(cuerpo vacio)_',
    timestamp: msg.getDate().toISOString(),
    color: COLOR,
    footer: { text: 'Abrir en Gmail' }
  };

  // Lo que subimos ya se ve solo (Discord lo muestra debajo del
  // mensaje), asi que en el field va unicamente lo que NO fue: si no,
  // el aviso no dice en ningun lado que existia.
  if (archivos.omitidos.length) {
    const nombres = archivos.omitidos.map(function (n) { return '`' + n + '`'; });
    embed.fields = [{
      name: 'Sin adjuntar, muy pesados (' + nombres.length + ')',
      value: truncate(nombres.join('\n') + '\nEstan en el mail.', 1024)
    }];
  }

  const embeds = [embed];

  const imagenes = galeriaDe(archivos);

  if (imagenes.length) {
    embed.image = { url: 'attachment://' + imagenes[0].blob.getName() };
    // Discord agrupa en galeria los embeds que comparten la misma `url`.
    for (let i = 1; i < imagenes.length; i++) {
      embeds.push({
        url: url,
        color: COLOR,
        image: { url: 'attachment://' + imagenes[i].blob.getName() }
      });
    }
  }

  return embeds;
}

/**
 * Cuerpo del mail listo para Discord.
 *
 * Preferimos el HTML: getPlainBody() rompe las listas (deja el bullet
 * solo en un renglon y el texto en el siguiente) y pierde negritas,
 * itálicas y links. Caemos al texto plano solo si no hay HTML.
 */
function bodyToMarkdown(msg) {
  const html = msg.getBody();
  const raw = html ? htmlToMarkdown(html) : msg.getPlainBody();
  return stripSignature(stripQuoted(raw));
}

/** Corre esto una vez a mano para verificar que el webhook anda. */
function testWebhook() {
  const webhook = PropertiesService.getScriptProperties()
    .getProperty('DISCORD_WEBHOOK_URL');
  const res = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ content: 'Test desde Apps Script' }),
    muteHttpExceptions: true
  });
  console.log(res.getResponseCode(), res.getContentText());
}

/**
 * Muestra en el log como quedaria el ultimo mail que matchea QUERY,
 * sin postear nada. Para iterar el formato sin ensuciar el canal.
 */
function previsualizar() {
  const threads = GmailApp.search(QUERY, 0, 1);
  if (!threads.length) return console.log('Sin resultados para: ' + QUERY);

  const msgs = threads[0].getMessages();
  const msg = msgs[msgs.length - 1];

  const archivos = seleccionarArchivos(msg);
  const embeds = buildEmbeds(msg, archivos);

  console.log('Se suben: ' + (archivos.subidos.map(function (a) {
    return a.original;
  }).join(', ') || 'nada'));
  console.log('Quedan afuera: ' + (archivos.omitidos.join(', ') || 'nada'));
  console.log(JSON.stringify(embeds, null, 2));
  console.log('\n--- description ---\n' + embeds[0].description);
}
