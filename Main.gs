/**
 * Gmail -> Discord :: entrada
 *
 * checkMail() es la funcion del trigger. Todo lo demas es soporte.
 */

/**
 * La del trigger por tiempo. Se auto-rechaza fuera de horario ANTES de
 * tocar Gmail, que es la parte cara de la corrida.
 */
function checkMail() {
  if (!esTurno()) return;
  if (enPausa()) return;
  procesarMails();
}

/**
 * ¿Estamos aguantando un 429? Si Discord (o el Cloudflare que tiene
 * adelante) nos corto, no tiene sentido seguir golpeando cada minuto:
 * eso estira el bloqueo en vez de acortarlo.
 *
 * La pausa la escribe pausar() en Discord.gs. limpiarPausa() la saca a
 * mano si querés forzar un intento.
 */
function enPausa() {
  const hasta = Number(PropertiesService.getScriptProperties()
    .getProperty('PAUSA_HASTA'));
  if (!hasta) return false;

  const faltan = hasta - Math.floor(Date.now() / 1000);
  if (faltan <= 0) return false;

  console.log('En pausa por rate limit: faltan ' +
    Math.ceil(faltan / 60) + ' min.');
  return true;
}

/** Levanta la pausa de rate limit a mano. */
function limpiarPausa() {
  PropertiesService.getScriptProperties().deleteProperty('PAUSA_HASTA');
  console.log('Pausa levantada.');
}

/**
 * Igual que checkMail pero ignorando el horario. Para correr a mano un
 * martes a la noche sin que te devuelva nada.
 *
 * (Es una funcion aparte y no un parametro `checkMail(forzar)` a
 * proposito: los triggers por tiempo invocan la funcion con un objeto
 * de evento como primer argumento, que es truthy y activaria el forzado
 * en cada corrida.)
 */
function checkMailAhora() {
  // La pausa por rate limit si se respeta: saltearla es justo lo que
  // estira el bloqueo. Para forzar de verdad, limpiarPausa() primero.
  if (enPausa()) return;
  procesarMails();
}

/**
 * ¿Vale la pena mirar Gmail en este minuto?
 *
 * Cada dia tiene una intensidad en % (ver INTENSIDAD en Config.gs) que
 * dice en que fraccion de los minutos de la ventana horaria buscamos.
 *
 * El reparto es deterministico y parejo, no un Math.random(): con 10%
 * se mira 1 de cada 10 minutos siempre, no "a veces tres seguidos y
 * despues media hora nada". El truco es el acumulador de abajo, que
 * deja pasar exactamente `pct` de cada 100 minutos.
 *
 * Se lee la hora con la TZ del script explicita, no con getDay(), que
 * depende de la zona horaria del proyecto y es facil de tener mal.
 */
function esTurno() {
  const tz = Session.getScriptTimeZone();
  const ahora = new Date();

  const dia = Number(Utilities.formatDate(ahora, tz, 'u')); // 1=lun .. 7=dom
  const hora = Number(Utilities.formatDate(ahora, tz, 'H'));
  const minuto = Number(Utilities.formatDate(ahora, tz, 'm'));

  if (hora < HORA_DESDE || hora >= HORA_HASTA) return false;

  return tocaEnElMinuto(hora * 60 + minuto, INTENSIDAD[dia]);
}

/**
 * ¿Este minuto del dia cae dentro del `pct`% que se mira?
 *
 * Pensalo como una rueda de 100 casilleros. Cada minuto avanzas `pct`
 * casilleros; cuando pasas por el cero, toca. Como avanzas pct por
 * minuto, das la vuelta cada 100/pct minutos: con pct=10 toca cada 10
 * minutos, con pct=1.67 cada hora. Queda repartido parejo todo el dia,
 * no se queman los turnos al principio.
 *
 * (m * pct) % 100 es en que casillero estas. Si es menor que pct, en
 * este minuto cruzaste el cero.
 *
 * pct=100 siempre da true y pct=0 siempre false, sin casos especiales.
 *
 * El epsilon es por los porcentajes con decimales: 1000 * 5.2 da
 * 5199.999999999999 en binario, no 5200, y sin el margen el minuto
 * siguiente cae en 5.199999999999818 < 5.2 y dispara dos veces
 * seguidas. Con pct enteros no cambia nada.
 */
function tocaEnElMinuto(minutoDelDia, pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return ((minutoDelDia * p) % 100) < p - 1e-9;
}

/**
 * Busca lo nuevo y lo publica.
 *
 * El cursor solo avanza hasta donde llegamos bien: si Discord falla en
 * el mensaje N, el cursor queda justo antes de N y la proxima corrida
 * reintenta desde ahi. No se pierden mails.
 */
function procesarMails() {
  const props = PropertiesService.getScriptProperties();
  const webhook = props.getProperty('DISCORD_WEBHOOK_URL');
  if (!webhook) throw new Error('Falta la propiedad DISCORD_WEBHOOK_URL');

  const now = Math.floor(Date.now() / 1000);
  const cursor = Number(props.getProperty('CURSOR')) ||
    now - BOOTSTRAP_MINUTES * 60;

  const processed = JSON.parse(props.getProperty('PROCESSED') || '[]');
  const seen = new Set(processed);

  const query = QUERY + ' after:' + (cursor - OVERLAP_SECONDS);
  const threads = GmailApp.search(query, 0, 50);

  // Aplanamos a mensajes y ordenamos por fecha ascendente: si algo falla,
  // frenamos ahi y el cursor no avanza mas alla del mensaje perdido.
  const messages = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const ts = Math.floor(msg.getDate().getTime() / 1000);
      if (ts <= cursor - OVERLAP_SECONDS) return;
      if (seen.has(msg.getId())) return;
      messages.push(msg);
    });
  });
  messages.sort(function (a, b) { return a.getDate() - b.getDate(); });

  let newCursor = now;
  let enviados = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Freno de mano para las colas. Si estuvimos en pausa un rato y se
    // juntaron mails, mandarlos todos de golpe es la mejor forma de
    // ganarse otro rate limit y volver a empezar. Salen de a poco.
    if (enviados >= MAX_POR_CORRIDA) {
      console.log('Quedan ' + (messages.length - i) +
        ' mails para la proxima corrida.');
      newCursor = Math.floor(msg.getDate().getTime() / 1000) - 1;
      break;
    }

    try {
      postToDiscord(webhook, msg);
      seen.add(msg.getId());
      enviados++;
      Utilities.sleep(ESPERA_ENTRE_ENVIOS);
    } catch (err) {
      console.error('Fallo enviando ' + msg.getId() + ': ' + err);
      // Reintentamos este y los siguientes en la proxima corrida. El
      // cursor no pasa de aca, asi que el mail no se pierde.
      newCursor = Math.floor(msg.getDate().getTime() / 1000) - 1;
      break;
    }
  }

  props.setProperty('CURSOR', String(newCursor));
  props.setProperty(
    'PROCESSED',
    JSON.stringify(Array.from(seen).slice(-PROCESSED_CACHE_SIZE))
  );
}

/** Borra el estado guardado: la proxima corrida arranca de cero. */
function resetEstado() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('CURSOR');
  props.deleteProperty('PROCESSED');
  props.deleteProperty('PAUSA_HASTA');
  console.log('Estado reseteado');
}

/**
 * Para chequear a mano como quedo la configuracion de horarios: imprime
 * la TZ, si toca ahora, y cuantas corridas por dia implica cada
 * intensidad dentro de la ventana.
 */
function diagnosticoHorario() {
  const tz = Session.getScriptTimeZone();
  const ahora = new Date();
  const dias = ['', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes',
    'sabado', 'domingo'];

  console.log('Zona horaria del script: ' + tz);
  console.log('Ahora: ' + Utilities.formatDate(ahora, tz, 'EEEE dd/MM/yyyy HH:mm'));
  console.log('Ventana: ' + HORA_DESDE + ':00 a ' + HORA_HASTA + ':00');
  console.log('esTurno(): ' + esTurno());
  console.log('');

  let total = 0;
  for (let d = 1; d <= 7; d++) {
    const pct = INTENSIDAD[d] || 0;
    let corridas = 0;
    for (let m = HORA_DESDE * 60; m < HORA_HASTA * 60; m++) {
      if (tocaEnElMinuto(m, pct)) corridas++;
    }
    total += corridas;
    console.log(pad(dias[d], 11) + pad(pct + '%', 6) +
      corridas + ' busquedas/dia' +
      (pct > 0 ? '  (peor demora: ' + Math.ceil(100 / pct) + ' min)' : ''));
  }

  // ~1.5s por busqueda contra los ~90 min/dia de cuota gratuita.
  console.log('');
  console.log('Total semanal: ' + total + ' busquedas (~' +
    Math.round(total * 1.5 / 60) + ' min de cuota).');
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}
