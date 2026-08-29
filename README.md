# Gmail -> Discord

Publica en un canal de Discord los mails de la lista `tpi-est-orga@listas.unq.edu.ar`.
Corre en Google Apps Script: sin servidor, sin deploy, gratis.

## Archivos

Apps Script concatena todos los `.gs` en un **único scope global**: no hay
`import`/`export`, una función definida en un archivo se llama desde cualquier otro.
La contracara es que un nombre repetido pisa al anterior en silencio, así que cada
cosa vive en un solo lugar.

| Archivo | Qué tiene | Puro? |
|---|---|---|
| [Config.gs](Config.gs) | Todas las constantes: query, horarios, formato, límites | — |
| [Main.gs](Main.gs) | `checkMail` (el trigger), el guard de horario, el cursor | — |
| [Discord.gs](Discord.gs) | Armado del embed, subida de imágenes, envío del webhook | — |
| [Markdown.gs](Markdown.gs) | HTML del mail → Markdown de Discord | sí |
| [Texto.gs](Texto.gs) | Firmas, citas, remitente, asunto, truncado | sí |
| [Debug.gs](Debug.gs) | Probar con un mail puntual. Borrable. | — |

Los dos últimos no tocan ningún servicio de Google: son JavaScript común y se
pueden testear en Node copiándolos tal cual.

## Setup

### 1. Webhook de Discord

Canal → **Editar canal → Integraciones → Webhooks → Nuevo webhook** → **Copiar URL**.

> Es una credencial: quien la tenga puede postear en el canal. No la commitees.

### 2. Proyecto de Apps Script

[script.google.com](https://script.google.com) → **Nuevo proyecto** (con la cuenta que
recibe los mails). Creá un archivo por cada `.gs` de acá (**+ → Secuencia de comandos**,
con el mismo nombre) y pegá el contenido. Borrá el `Código.gs` que viene por defecto.

Si preferís no copiar y pegar, saltá a [Trabajar local](#trabajar-local-con-clasp).

### 3. Zona horaria

**Configuración del proyecto** (engranaje) → **Zona horaria** →
`(GMT-03:00) Buenos Aires`.

No es opcional: el filtro por día del guard de horario depende de esto. Con la TZ
por defecto (`America/Los_Angeles`) tu viernes queda corrido 4-5 horas.

### 4. Webhook en propiedades

Misma pantalla, abajo, **Propiedades del script** → **Añadir propiedad**:

| Propiedad | Valor |
|---|---|
| `DISCORD_WEBHOOK_URL` | la URL del paso 1 |
| `DISCORD_ROLE_ID` | *(opcional)* ID del rol a arrobar. Ver abajo. |

### 5. Autorizar

Elegí la función **`testWebhook`** → **Ejecutar**.

Va a aparecer "Google no ha verificado esta aplicación" → **Configuración avanzada** →
**Ir a (no seguro)**. Es tu propio script, es normal. Aceptá los permisos.

Si llega "Test desde Apps Script" al canal, andamos bien.

### 6. Probar con un mail real

Por defecto la primera corrida solo mira 10 minutos hacia atrás, así que no vas a ver
nada. Para probar con mails existentes:

1. `BOOTSTRAP_MINUTES = 2880` (2 días)
2. Ejecutá **`checkMailAhora`** → revisá Discord y el **Registro de ejecución**
3. Volvé a `10` y ejecutá **`resetEstado`**

Ojo: usá `checkMailAhora` y no `checkMail`, que se auto-rechaza fuera de horario.

### 7. Trigger

Ícono del **reloj** (Activadores) → **Añadir activador**:

- Función: `checkMail`
- Origen: **Según tiempo** → **Temporizador por minutos** → **Cada minuto**
- Errores: **Notificarme inmediatamente**

Listo, queda corriendo solo.

## Cuándo mira Gmail

El trigger dispara cada minuto, pero la lista manda casi siempre los viernes. Cada
corrida hace un `GmailApp.search()` que cuesta ~1-2s, y 1440 corridas diarias se
comen media cuota gratuita buscando en el vacío. `esTurno()` corta **antes** de tocar
Gmail, así que las corridas descartadas cuestan milisegundos.

Cuánto se mira cada día se configura en `INTENSIDAD` ([Config.gs](Config.gs)), en
porcentaje de los minutos de la ventana horaria:

```js
const INTENSIDAD = {
  1: 10,   // lunes
  2: 10,   // martes
  3: 10,   // miercoles
  4: 80,   // jueves
  5: 100,  // viernes
  6: 5,    // sabado
  7: 0     // domingo
};
```

Si un sábado te llegan más mails de los que esperabas, subile el número al sábado.
Es la única perilla.

| % | Cada cuánto mira | Peor demora de un mail |
|---|---|---|
| 100 | cada minuto | 1 min |
| 80 | 4 de cada 5 minutos | 2 min |
| 50 | 1 de cada 2 minutos | 2 min |
| 10 | 1 de cada 10 minutos | 10 min |
| 5 | 1 de cada 20 minutos | 20 min |
| 0 | nunca | — |

No es azar: el reparto es determinístico y parejo dentro de la hora, no un
`Math.random()` que a veces dispara tres seguidos y después nada por media hora.
El peor caso de demora es siempre `100 / porcentaje` minutos.

Además hay una ventana horaria dura, `HORA_DESDE` a `HORA_HASTA` (8 a 22), fuera de
la cual no se busca ningún día sin importar la intensidad.

Ejecutá **`diagnosticoHorario`** para ver la zona horaria, si toca ahora, cuántas
búsquedas por día implica cada intensidad y cuánta cuota semanal es eso.

Los números con la config actual están en **[CUOTA.md](CUOTA.md)**: cuánto consume cada
día, el pico del viernes, y qué cambia si el trigger va cada 1 o cada 5 minutos.

## El filtro

```
list:(<tpi-est-orga.listas.unq.edu.ar>) to:(tpi-est-orga@listas.unq.edu.ar)
```

- `list:` → pasó por la lista. Ancla estable: el remitente cambia, el `List-Id` no.
- `to:` → la lista es el destinatario. Deja afuera las respuestas a un alumno
  puntual que llevan la lista en copia.

Se edita en la constante `QUERY` de [Config.gs](Config.gs). Probá cualquier cambio
en la barra de búsqueda de Gmail antes de pegarlo: es la misma sintaxis.

## Funciones

| Función | Para qué |
|---|---|
| `checkMail` | El trabajo real. Es la que va en el trigger. Respeta `INTENSIDAD`. |
| `checkMailAhora` | Lo mismo pero ignorando el horario. Para correr a mano. |
| `diagnosticoHorario` | Muestra la TZ, si toca ahora, y el costo de cada intensidad. |
| `testWebhook` | Verifica que el webhook responde. |
| `previsualizar` | Muestra en el log cómo quedaría el último mail, sin postear. Para iterar el formato sin ensuciar el canal. |
| `resetEstado` | Borra el cursor y el historial de enviados. |

Y en [Debug.gs](Debug.gs), para probar con un mail puntual:

| Función | Para qué |
|---|---|
| `listarUltimos(n)` | Los últimos N mails que matchean, con el detalle de cada adjunto y qué haría el script con él. De acá sacás el `msgId`. |
| `previsualizarId(id)` | El embed de ese mail en el log, sin postear. |
| `postearId(id)` | Postea ese mail al canal de verdad. La única forma de ver las imágenes. |

### Probar un mail puntual

**El id de la URL de Gmail no sirve.** El que sale de
`mail.google.com/.../#inbox/FMfcgzQ...` es el permalink del Gmail nuevo; `GmailApp`
usa otro formato (el hexadecimal de `thread.getId()`). El flujo es:

1. Ejecutá **`listarUltimos`** → te imprime cada mail con su `msgId` y una línea por
   adjunto: tipo, tamaño, si es inline, y si se sube o solo se lista por nombre.
2. Pegá ese `msgId` en la constante `ID_PRUEBA` de [Debug.gs](Debug.gs) y ejecutá
   **`previsualizarPrueba`**. (El editor de Apps Script solo corre funciones sin
   argumentos, por eso el id va en una constante y no como parámetro.)
3. **`postearPrueba`** para verlo en el canal. `previsualizarPrueba` te muestra el
   JSON, pero el `attachment://` recién resuelve cuando el archivo viaja en el
   request — las imágenes solo se ven posteando.

`postearId` no toca el cursor ni el historial: si el mail es reciente, el trigger
puede volver a postearlo. Con un mail de hace más de `BOOTSTRAP_MINUTES` no hay riesgo.

También podés pasarle el **Message-ID** de RFC (el que tiene arroba, sale de *Mostrar
original* en Gmail) en vez del `msgId`: lo resuelve igual.

## Notas

- **Duplicados:** guarda un cursor de tiempo + los últimos 300 IDs enviados. Si algo
  se descontrola, `resetEstado`.
- **Si Discord falla:** frena y reintenta en la próxima corrida. No pierde mails.
- **Si sale 429:** ver abajo.
- **Cuota:** ~90 min/día de ejecución en cuentas gratuitas. El viernes, que es el día
  pico, se usan ~21 min. Las cuentas en [CUOTA.md](CUOTA.md); `diagnosticoHorario` las
  recalcula con la config que tengas puesta.
- **El link del embed** apunta a `mail.google.com/u/0`. Si usás varias cuentas en el
  navegador, cambiá el `u/0` por el índice que corresponda.

## Los dos 429

Cuando el envío rebota con 429 hay que mirar el cuerpo, porque son dos cosas
distintas con el mismo código:

| | Discord | Cloudflare |
|---|---|---|
| Cuerpo | JSON con `retry_after` | HTML con `error code: 1015` |
| Alcance | por webhook | **por IP** |
| Dura | menos de 1 segundo | de minutos a una hora |
| Causa | mandaste muchos seguidos | la IP quedó marcada |

El 1015 es el molesto. Apps Script sale a internet por **IPs compartidas de Google**,
así que la que te tocó puede estar limitada por lo que hicieron otros scripts, no
necesariamente por vos. No se puede cambiar de IP ni pedir excepción: se destraba solo.

El script maneja los dos:

- Si viene `retry_after` y es menor a `REINTENTO_MAX_ESPERA` (10s), espera y reintenta
  en la misma corrida.
- Si no, guarda una pausa en `PAUSA_HASTA` y `checkMail` no vuelve a intentar hasta
  que venza (`PAUSA_429_DEFAULT`, 15 min). Insistir cada minuto contra un 1015 **estira
  el bloqueo**, no lo acorta.

`limpiarPausa()` la levanta a mano si querés forzar un intento. `resetEstado()` también
la borra.

## Formato del mensaje

El cuerpo se toma del **HTML** del mail, no del texto plano: `getPlainBody()` rompe
las listas (deja el bullet solo en un renglón y el texto en el siguiente) y pierde
negritas, itálicas y links. `htmlToMarkdown()` lo convierte a Markdown de Discord.

Las entidades HTML se traducen con la tabla de `decodeEntities()`, que incluye
acentos, tipografía, flechas, griegas y símbolos de lógica/matemática
(`&and;` → ∧, `&oplus;` → ⊕). Si alguna vez ves un `&loquesea;` crudo en Discord,
es que falta en esa tabla: agregala ahí.

Para retocar el formato, editá `buildEmbeds()` y probá con `previsualizar()`.
Constantes útiles: `COLOR`, `MAX_BODY`, `SUBJECT_PREFIX`, `FIRMA`.

### Adjuntos

Se sube **todo lo que entre**, no solo imágenes. Van como adjunto del mismo request
(multipart) y Discord los renderiza según el tipo:

| Tipo | Cómo se ve |
|---|---|
| Imagen | Dentro del embed, hasta `MAX_IMAGENES` (4). Las que sobran, abajo. |
| PDF | Tarjeta con vista previa de la primera página |
| `.txt`, `.md`, código | Recuadro con las primeras líneas |
| Video (mp4, webm, mov) | Reproductor, debajo del embed |
| Resto (zip, docx, xlsx) | Chip de descarga |

Solo las imágenes pueden ir **dentro** del embed, con `attachment://`. El resto viaja
en el mismo mensaje pero se muestra debajo — no es un mensaje aparte.

No hay atajo por markdown: los embeds ignoran `![alt](url)` por completo. Y las URLs
que trae el HTML de Gmail no sirven: las incrustadas son `cid:` (un adjunto, no una
URL) y las remotas pasan por el proxy de `googleusercontent`, que le contesta 403 al
fetcher de Discord. Por eso hay que subir el byte.

Se toman con `getAttachments({ includeInlineImages: true })` — el `getAttachments()`
pelado deja afuera justo las incrustadas, que suelen ser las que uno quiere ver.

#### Límites

En [Config.gs](Config.gs):

- `MAX_ARCHIVOS` (10): tope de Discord por mensaje.
- `MAX_ARCHIVO_BYTES` (7 MB): por archivo.
- `PRESUPUESTO_ARCHIVOS` (7 MB): sumando todos. El webhook corta en 8 MiB por request
  en servidores sin boost; el resto es aire para el JSON y el overhead del multipart.

**Un adjunto pesado nunca puede costarte el aviso.** Hay dos redes:

1. Se mide antes de mandar. Lo que no entra ni se intenta: queda listado por nombre en
   un field del embed (*Sin adjuntar, muy pesados*) con la nota de que están en el mail.
2. Si aun así el request rebota por tamaño (413, o un 400 quejándose del archivo), se
   reenvía **sin ningún adjunto**. El mensaje sale igual.

Cuando el presupuesto se agota, las imágenes tienen prioridad sobre todo lo demás:
son lo único que se puede mostrar dentro del embed, y un PDF listado por nombre se
pierde menos que un flyer.

#### Video, en concreto

Técnicamente funciona: un `.mp4` de menos de 7 MB se sube y Discord le pone un
reproductor. **En la práctica casi ningún video de un mail entra** en ese presupuesto,
así que lo normal va a ser que quede listado por nombre.

Lo que *no* se puede hacer es meterlo dentro del embed: `embed.video` es de solo
lectura, Discord lo llena únicamente para links que él mismo resuelve (YouTube,
Vimeo). Si el mail trae un link de YouTube en el cuerpo, va a quedar como link en la
descripción del embed — y los links dentro de un embed **no se despliegan**. Para que
Discord muestre el reproductor, la URL tiene que ir en `content`, fuera del embed.
Hoy no se hace; si te aparecen mails con videos linkeados, se agrega.

### Firma institucional

`FIRMA` es una lista de patrones que marcan dónde arranca el pie del mail
(nombre del docente, departamento, dirección postal). Se corta en el primero que
aparezca, pero **solo si cae en la mitad final del cuerpo** — así un mail que
mencione a la facultad al pasar no queda mutilado.

Si aparece una firma nueva, agregá su patrón al array.

### Arrobar un rol

1. **Ajustes de usuario → Avanzado → Modo desarrollador** (activar)
2. **Ajustes del servidor → Roles** → click derecho en el rol → **Copiar ID**
3. Pegá ese número en la propiedad `DISCORD_ROLE_ID`

Sin la propiedad, no arroba a nadie.

> La mención va en `content`, no adentro del embed: las menciones dentro de un
> embed se ven en azul pero **no notifican**. Es la trampa clásica de los webhooks.

## Trabajar local (con clasp)

`clasp` es el CLI oficial de Google. Sincroniza esta carpeta con el proyecto de
Apps Script, así no hay que copiar y pegar.

```bash
pnpm add -g @google/clasp     # o sin instalar: pnpm dlx @google/clasp <cmd>
clasp login
clasp clone <SCRIPT_ID>       # el ID sale de la URL del proyecto
clasp push                    # local -> nube
clasp pull                    # nube -> local
clasp push --watch            # auto-push al guardar
```

Antes hay que habilitar la Apps Script API una sola vez en
[script.google.com/home/usersettings](https://script.google.com/home/usersettings).

Dos avisos para el `clasp clone` en esta carpeta:

- Se queja si el directorio no está vacío. Como acá ya están los `.gs`, conviene
  `clasp clone` en una carpeta aparte para quedarte con el `.clasp.json`, moverlo acá,
  y después `clasp push` (que sobrescribe la nube con lo local, que es lo que querés).
- `.clasp.json` lleva el `scriptId`: no es un secreto grave, pero tampoco hace falta
  commitearlo.

[appsscript.json](appsscript.json) es el manifiesto: fija la zona horaria, el runtime
V8 y los permisos mínimos (leer Gmail + salir a internet). Al pushearlo por primera
vez Google puede pedirte reautorizar.

`clasp run <funcion>` ejecuta en la nube desde la terminal, útil para
`previsualizar()` sin volver al navegador. Necesita un proyecto de GCP propio.

### Coloreado de `.gs`

`.gs` es JavaScript, solo cambia la extensión. [.vscode/settings.json](.vscode/settings.json)
ya lo asocia:

```json
{ "files.associations": { "*.gs": "javascript" } }
```

Para autocompletado de los servicios de Google: `npm i -D @types/google-apps-script`.

### Correr local

No hay emulador: `GmailApp`, `PropertiesService`, `UrlFetchApp` y `Utilities` viven
en la infraestructura de Google. Lo que sí se puede es testear [Markdown.gs](Markdown.gs)
y [Texto.gs](Texto.gs) en Node — son funciones puras y ahí está el 70% de la lógica
que uno realmente itera.

### Qué no es JavaScript común

Con el runtime V8 el lenguaje es ES2020 (clases, arrow functions, destructuring,
optional chaining). Lo que falta es el entorno:

| No hay | En su lugar |
|---|---|
| `import` / `require` / npm | scope global compartido entre archivos |
| `window`, DOM | por eso `htmlToMarkdown` va con regex |
| `fetch` | `UrlFetchApp.fetch()`, **síncrono** |
| `setTimeout` | `Utilities.sleep(ms)`, bloquea de verdad |
| event loop | `async`/`await` existen pero no sirven de nada |
| `process`, `fs`, `Buffer` | nada de Node |

Y un límite del entorno: **6 minutos** máximo por ejecución. Por eso el cursor avanza
solo hasta donde llegamos bien.
