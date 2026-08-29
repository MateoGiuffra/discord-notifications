/**
 * Gmail -> Discord :: herramientas de prueba
 *
 * Nada de esto corre solo. Es para ejecutar a mano desde el editor
 * cuando querés ver que hace el script con un mail puntual.
 *
 * Se puede borrar el archivo entero sin romper nada.
 */

// El editor de Apps Script solo ejecuta funciones SIN argumentos, asi
// que el mail a probar se fija aca y se corren los wrappers de abajo.
// Sacas el id de listarUltimos(): es el msgId, no el FMfcgz... de la URL.
const ID_PRUEBA = '1a045e7004504a67';

/** Previsualiza ID_PRUEBA. Elegí esta funcion en el editor y Ejecutar. */
function previsualizarPrueba() {
  previsualizarId(ID_PRUEBA);
}

/** Postea ID_PRUEBA al canal, de verdad. Es la que muestra las imagenes. */
function postearPrueba() {
  postearId(ID_PRUEBA);
}

/**
 * Lista los ultimos mails que matchean QUERY, con el detalle de sus
 * adjuntos y que haria el script con cada imagen.
 *
 * Es el punto de entrada: de aca sacas el ID que necesitan las otras
 * funciones. El id de la URL de Gmail (FMfcgz...) NO sirve, es el
 * permalink del Gmail nuevo y GmailApp usa otro formato.
 */
function listarUltimos(cuantos) {
  const n = cuantos || 10;
  const threads = GmailApp.search(QUERY, 0, n);

  if (!threads.length) return console.log('Sin resultados para: ' + QUERY);

  const tz = Session.getScriptTimeZone();

  threads.forEach(function (thread) {
    const msgs = thread.getMessages();
    const msg = msgs[msgs.length - 1];

    console.log('');
    console.log('==================================================');
    console.log(Utilities.formatDate(msg.getDate(), tz, 'dd/MM/yyyy HH:mm') +
      '  ' + cleanSubject(msg.getSubject()));
    console.log('  de:       ' + parseSender(msg.getFrom()));
    console.log('  threadId: ' + thread.getId());
    console.log('  msgId:    ' + msg.getId());
    describirAdjuntos(msg);
  });

  console.log('');
  console.log('Para ver uno:      previsualizarId("<msgId>")');
  console.log('Para postearlo:    postearId("<msgId>")');
}

/**
 * Que trae el mail y que decide seleccionarArchivos() con cada cosa.
 *
 * Lo importante es la columna inline: las imagenes incrustadas en el
 * cuerpo no aparecen en getAttachments() pelado, y son casi siempre
 * las que uno quiere ver en Discord.
 */
function describirAdjuntos(msg) {
  const todos = msg.getAttachments({ includeInlineImages: true });
  const reales = msg.getAttachments().map(function (a) { return a.getName(); });

  if (!todos.length) return console.log('  adjuntos: ninguno');

  const archivos = seleccionarArchivos(msg);
  const suben = archivos.subidos.map(function (a) { return a.original; });

  // Las primeras MAX_IMAGENES imagenes son las unicas que se ven
  // adentro del embed; el resto aparece como adjunto abajo.
  const enGaleria = archivos.subidos
    .filter(function (a) { return a.esImagen; })
    .slice(0, MAX_IMAGENES)
    .map(function (a) { return a.original; });

  console.log('  adjuntos: ' + todos.length);
  todos.forEach(function (a) {
    const kb = Math.round(a.getSize() / 1024);
    const inline = reales.indexOf(a.getName()) === -1;

    let destino;
    if (enGaleria.indexOf(a.getName()) !== -1) destino = 'SE SUBE, dentro del embed';
    else if (suben.indexOf(a.getName()) !== -1) destino = 'SE SUBE, como adjunto';
    else if (a.getSize() > MAX_ARCHIVO_BYTES) destino = 'muy pesado, solo el nombre';
    else destino = 'no entra (tope de ' + MAX_ARCHIVOS + ' o presupuesto)';

    console.log('    - ' + a.getName() +
      '  [' + a.getContentType() + ', ' + kb + ' KB' +
      (inline ? ', inline' : '') + ']  -> ' + destino);
  });
}

/**
 * Muestra en el log como quedaria un mail puntual, sin postear.
 *
 * Acepta el msgId o el threadId que imprime listarUltimos(). Tambien
 * prueba con el rfc822 Message-ID (el de 'Mostrar original' en Gmail,
 * el que va entre < >), por si preferis sacarlo de ahi.
 */
function previsualizarId(id) {
  const msg = resolverMensaje(id);
  if (!msg) return;

  const archivos = seleccionarArchivos(msg);
  const embeds = buildEmbeds(msg, archivos);

  console.log('Asunto: ' + cleanSubject(msg.getSubject()));
  describirAdjuntos(msg);
  console.log('');
  console.log('Se suben: ' + (archivos.subidos.map(function (a) {
    return a.blob.getName();
  }).join(', ') || 'nada'));
  console.log('Quedan afuera: ' + (archivos.omitidos.join(', ') || 'nada'));
  console.log('');
  console.log(JSON.stringify(embeds, null, 2));
  console.log('');
  console.log('--- description ---');
  console.log(embeds[0].description);
}

/**
 * Postea un mail puntual al canal, de verdad.
 *
 * Es la unica forma de ver las imagenes: previsualizarId() te muestra
 * el JSON, pero el attachment:// recien resuelve cuando el archivo
 * viaja en el request.
 *
 * No toca el CURSOR ni PROCESSED, asi que si el mail todavia cae
 * dentro de la ventana del trigger lo vas a ver dos veces. Para un
 * mail de hace mas de BOOTSTRAP_MINUTES no hay riesgo.
 */
function postearId(id) {
  const msg = resolverMensaje(id);
  if (!msg) return;

  const webhook = PropertiesService.getScriptProperties()
    .getProperty('DISCORD_WEBHOOK_URL');
  if (!webhook) throw new Error('Falta la propiedad DISCORD_WEBHOOK_URL');

  // Si venimos de un 429, insistir a mano empeora las cosas.
  if (enPausa()) {
    console.log('Espera a que termine, o corre limpiarPausa() si sabes ' +
      'lo que haces.');
    return;
  }

  postToDiscord(webhook, msg);
  console.log('Posteado: ' + cleanSubject(msg.getSubject()));
}

/**
 * Encuentra un mensaje a partir de lo que le pases: msgId, threadId o
 * rfc822 Message-ID. Devuelve null y explica si no da con nada.
 */
function resolverMensaje(id) {
  if (!id) {
    console.log('Pasa un id. Corre listarUltimos() para ver cuales hay.');
    return null;
  }

  const limpio = String(id).replace(/^</, '').replace(/>$/, '').trim();

  // rfc822: el Message-ID siempre tiene arroba.
  if (limpio.indexOf('@') !== -1) {
    const t = GmailApp.search('rfc822msgid:' + limpio, 0, 1);
    if (t.length) return ultimoMensaje(t[0]);
    console.log('Ningun mail con rfc822msgid: ' + limpio);
    return null;
  }

  try {
    const msg = GmailApp.getMessageById(limpio);
    if (msg) return msg;
  } catch (e) { /* no era un msgId, probamos como thread */ }

  try {
    const thread = GmailApp.getThreadById(limpio);
    if (thread) return ultimoMensaje(thread);
  } catch (e) { /* tampoco */ }

  console.log('No encontre nada con el id "' + limpio + '".');
  console.log('Si lo sacaste de la URL de Gmail (empieza con FMfcg, ' +
    'QgrcJ o thread-f), ese formato no le sirve a GmailApp.');
  console.log('Corre listarUltimos() y usa el msgId que imprime, o abri ' +
    'el mail > Mostrar original y pasa el Message-ID.');
  return null;
}

function ultimoMensaje(thread) {
  const msgs = thread.getMessages();
  return msgs[msgs.length - 1];
}
