# Consumo de cuota

Cuánto de la cuota diaria de Apps Script se come el script según cómo esté
configurado. Los números salen de `INTENSIDAD` y la ventana horaria de
[Config.gs](Config.gs).

## Supuestos

| | |
|---|---|
| Cuota diaria | **90 min** (cuenta gratuita; Workspace tiene 6 h) |
| Ventana horaria | 8 a 22 → **840 minutos/día** |
| Costo de un `GmailApp.search()` | **1,5 s** |

El 1,5 s es una estimación, no una medición. Si en tu caso da 2 s, multiplicá todo
por 1,33. El panel de **Ejecuciones** de Apps Script te da el número real.

## Viernes (100%)

| Trigger | Búsquedas/día | Tiempo | % de la cuota |
|---|---|---|---|
| Cada 1 min | 840 | **21 min** | 23% |
| Cada 5 min | 168 | **4,2 min** | 4,7% |

840 × 1,5 s = 1260 s = 21 min. Con trigger de 5 minutos entran 168 corridas en la
ventana → 252 s = 4,2 min.

## La semana completa (trigger cada minuto)

| Día | % | Búsquedas | Tiempo |
|---|---|---|---|
| Lunes | 10 | 84 | 2,1 min |
| Martes | 10 | 84 | 2,1 min |
| Miércoles | 10 | 84 | 2,1 min |
| Jueves | 80 | 672 | 16,8 min |
| Viernes | 100 | 840 | 21 min |
| Sábado | 5 | 42 | 1,05 min |
| Domingo | 0 | 0 | 0 |
| **Total** | | **1806** | **~45 min/semana** |

La cuota es **diaria**, así que lo que importa es el pico: el viernes, 21 min contra
90. Sobra el 77%. El total semanal es informativo nomás.

## Lo que la tabla no cuenta

**Las corridas rechazadas.** El trigger dispara igual y `esTurno()` corta enseguida,
pero el arranque del proyecto se paga:

| Trigger | Disparos/día | Rechazados |
|---|---|---|
| Cada 1 min | 1440 | 600 (fuera de la ventana horaria) |
| Cada 5 min | 288 | 120 |

Cada rechazo cuesta mucho menos que una búsqueda — leer el reloj y volver — pero no es
cero. Estimando 0,1–0,3 s, son 1–3 min extra el viernes con trigger de 1 minuto.
**No está medido**; se ve en Ejecuciones después de un día corriendo.

Viernes realista con trigger cada minuto: **~22-24 min**, no 21 clavados.

**El envío.** Todo lo de arriba es solo *buscar*. Cuando hay mails que postear se suma
`postToDiscord`: 0,4 s de `Utilities.sleep` por mensaje, más el POST, más la subida si
hay adjuntos de varios MB. Un viernes con 10 mails con imágenes puede sumar un par de
minutos. Sigue siendo ruido frente a 90.

## Conclusión

Dejá el trigger en **1 minuto**. Jueves y viernes juntos son ~38 min repartidos en dos
días distintos, ni cerca del techo. Bajar a 5 minutos ahorra 17 min de cuota que no
estás usando, a cambio de que un mail del viernes tarde hasta 5 minutos en aparecer.

## Recalcular

`diagnosticoHorario()` calcula esta misma tabla con la config que tengas puesta en ese
momento, incluida la peor demora por día. Si movés los porcentajes, corrélo en vez de
rehacer las cuentas a mano.
