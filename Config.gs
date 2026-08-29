/**
 * Gmail -> Discord :: configuracion
 *
 * Todos los .gs de un proyecto de Apps Script comparten un unico scope
 * global: estas constantes se ven desde cualquier archivo sin importar
 * nada. La contracara es que un nombre repetido en otro archivo pisa a
 * este en silencio, asi que conviene que las constantes vivan solo aca.
 *
 * Propiedades del script (Configuracion del proyecto > Propiedades):
 *   DISCORD_WEBHOOK_URL  (obligatoria)
 *   DISCORD_ROLE_ID      (opcional) ID del rol a arrobar en cada aviso
 */

// ---------------------------------------------------------------- Gmail

// Query de busqueda de Gmail. Misma sintaxis que la barra de busqueda,
// asi que conviene probarla ahi antes de pegarla aca.
//
// Dos condiciones en AND (espacio = AND en Gmail):
//
//   list:  el header List-Id de la lista. Ancla estable: el remitente
//          cambia (Flavia, otro docente) pero esto no. El valor exacto
//          lo da Gmail con el link 'Filtrar los mensajes de esta lista'.
//
//   to:    que la lista sea el DESTINATARIO, no solo que el mail haya
//          pasado por ella. Deja afuera las respuestas dirigidas a un
//          alumno puntual que llevan la lista en copia.
const QUERY = 'list:(<tpi-est-orga.listas.unq.edu.ar>) ' +
  'to:(tpi-est-orga@listas.unq.edu.ar)';

// Al primer run, cuantos minutos hacia atras mirar. Evita que te dispare
// 500 mensajes viejos de golpe.
// 2880 = 2 dias, para poder probar con mails que ya estan en la casilla.
// Bajalo a 10 cuando dejes el trigger corriendo en serio.
const BOOTSTRAP_MINUTES = 2880;

// Margen de solapamiento al buscar, por si un mail entra con delay.
const OVERLAP_SECONDS = 120;

const PROCESSED_CACHE_SIZE = 300;

// -------------------------------------------------------------- Horario

// El trigger corre cada minuto, pero la lista manda casi siempre los
// viernes. Cada corrida hace un GmailApp.search() que cuesta ~1-2s, y
// 1440 corridas por dia se comen media cuota diaria buscando en el
// vacio. esTurno() (Main.gs) corta antes de tocar Gmail.
//
// OJO con la zona horaria del PROYECTO (Configuracion del proyecto >
// Zona horaria): si quedo en America/Los_Angeles, tu viernes arranca
// con 4-5 horas de corrimiento. esTurno() usa la TZ del script de forma
// explicita, pero la TZ tiene que estar bien puesta igual.

// Cuanto miramos cada dia, en porcentaje de los minutos de la ventana
// horaria. Es la unica perilla: si un sabado llegan mas mails de los
// que esperabas, subile el numero al sabado y listo.
//
//   100 -> cada minuto          20 -> 1 de cada 5 minutos
//    80 -> 4 de cada 5 minutos  10 -> 1 de cada 10 minutos
//    50 -> 1 de cada 2 minutos   5 -> 1 de cada 20 minutos
//     0 -> nunca
//
// No es azar: el reparto es deterministico y parejo dentro de la hora,
// asi que el peor caso de demora de un mail es 100/porcentaje minutos.
// Con 5% son 20 minutos; si eso te parece mucho para el sabado, subilo.
const INTENSIDAD = {
  1: 10,   // lunes
  2: 10,   // martes
  3: 10,   // miercoles
  4: 80,   // jueves
  5: 100,  // viernes
  6: 5,    // sabado
  7: 0     // domingo
};

// Ventana horaria (hora local del script). Fuera de esto no se busca
// ningun dia, sin importar la intensidad. HORA_HASTA es exclusiva:
// 22 = ultima corrida posible 21:59.
const HORA_DESDE = 8;
const HORA_HASTA = 22;

// -------------------------------------------------------------- Formato

// Prefijo que la lista agrega al asunto. Se saca del titulo porque se
// repite en todos los mensajes y solo ocupa lugar. '' para desactivar.
const SUBJECT_PREFIX = '[tpi-est-orga]';

// Pies que NO son ambiguos: ningun mail de la lista va a tener esto
// como contenido real, asi que se corta apenas aparecen, sin importar
// en que parte del cuerpo esten.
//
// Son los bloques que agregan las plataformas cuando mandan el mail por
// vos: Google Sheets, Drive, listas de correo.
const PIE_FIJO = [
  /^.{0,2}Does this item look suspicious/i,
  /^.{0,2}Este (elemento|archivo) parece sospechoso/i,
  /^You have received this email because/i,
  /^(Has|Ha) recibido este (correo|mensaje|email)/i,
  /^Recibiste este (correo|mensaje|email)/i,
  /^Google LLC, 1600 Amphitheatre/,
  /^Para darte de baja/i
];

// Firmas de persona. Estas SI son ambiguas (un mail puede nombrar a la
// facultad al pasar), asi que solo cortan si caen en la mitad final del
// cuerpo.
const FIRMA = [
  /^(Lic|Dr|Dra|Ing|Mg|Prof|Esp)\.\s/,
  /^Vicedirectora?$/,
  /Departamento de Ciencia y Tecnolog/,
  /Universidad Nacional de Quilmes/,
  /Roque S[aá]enz Pe[nñ]a 352/
];

// Cuanto texto del cuerpo mandamos (Discord corta el embed en 4096).
const MAX_BODY = 3800;

// Color de la barra lateral del embed.
const COLOR = 0x5865f2;

// ----------------------------------------------------------- Rate limit

// Hay dos 429 distintos y se tratan distinto:
//
//   Discord: JSON con retry_after, por webhook, casi siempre < 1s. Si
//   entra dentro de esta espera lo aguantamos en la misma corrida.
const REINTENTO_MAX_ESPERA = 10; // segundos

//   Cloudflare (error code: 1015): HTML, sin retry_after, por IP. Apps
//   Script sale por IPs compartidas de Google, asi que el bloqueo puede
//   no ser culpa nuestra. No dice cuanto dura, asi que nos apartamos
//   este rato: insistir cada minuto solo estira el bloqueo.
const PAUSA_429_DEFAULT = 15 * 60; // segundos

// Cuantos mails como maximo salen en una misma corrida.
//
// Importa despues de una pausa: si estuvimos cortados 15 minutos y se
// juntaron mails, largarlos todos de una es la mejor forma de ganarse
// otro bloqueo. Con el trigger cada minuto, 5 por corrida vacia una
// cola de 20 en 4 minutos, que para un aviso de catedra sobra.
const MAX_POR_CORRIDA = 5;

// Espera entre envios. El webhook admite ~5 requests cada 2s, o sea uno
// cada 400ms: dejamos margen porque ese limite se comparte con
// cualquier otra cosa que postee en el mismo canal.
const ESPERA_ENTRE_ENVIOS = 600; // ms

// ------------------------------------------------------------- Adjuntos

// Se sube TODO lo que entre, no solo imagenes: Discord previsualiza los
// PDF, muestra las primeras lineas de los .txt, reproduce los videos y
// al resto le pone una tarjeta de descarga.

// Cuantas imagenes se muestran DENTRO del embed. Discord las agrupa en
// galeria cuando varios embeds comparten la misma `url`, y hasta 4 se
// ve bien. Las que sobran igual se suben, aparecen abajo.
const MAX_IMAGENES = 4;

// Tope de Discord: 10 archivos por mensaje.
const MAX_ARCHIVOS = 10;

// Limite del webhook: 8 MiB por request en servidores sin boost.
// Dejamos aire para el JSON y el overhead del multipart.
//
// Lo que no entra NO se manda, pero el aviso sale igual y el archivo
// queda listado por nombre en el embed. Un adjunto pesado nunca puede
// costarnos el mensaje.
const MAX_ARCHIVO_BYTES = 7 * 1024 * 1024;   // por archivo
const PRESUPUESTO_ARCHIVOS = 7 * 1024 * 1024; // sumando todos

// Discord renderiza siempre en el mismo orden: content, adjuntos,
// embeds. No es aleatorio, pero significa que un PDF o un xlsx queda
// ARRIBA del aviso, que se lee raro.
//
// En true, los archivos que no entran en el embed (todo lo que no sea
// imagen de la galeria) se mandan en un SEGUNDO mensaje, y ahi si
// quedan abajo. El costo: dos requests por mail en vez de uno, o sea
// el doble de superficie para comerse un rate limit, y si el segundo
// falla el aviso ya salio sin sus adjuntos (queda avisado en el log).
const ADJUNTOS_DEBAJO = false;
