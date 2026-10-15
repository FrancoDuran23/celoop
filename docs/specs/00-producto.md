# Spec — Cooperadora Segura (MVP del hackathon)

Diseño técnico de referencia en `docs/sdd.md`.

## Problema

Una cooperadora escolar junta plata de padres y docentes para la escuela pública. Hoy esa plata la manejan una o dos personas, con efectivo, transferencias a un CBU y planillas Excel.

- **El socio que aporta** no sabe en qué se gastó su aporte.
- **La comisión directiva** depende de la buena fe de quien tiene la cuenta. Cuando esa buena fe falla, hay desvíos que terminan en la justicia.
- **El revisor de cuentas** controla meses después, con papeles incompletos.
- **El tesorero voluntario** pierde horas cada mes armando a mano la rendición que piden la escuela y el Estado.
- **El proveedor del barrio** cobra tarde y de forma informal.

## Solución

Un agente tesorero que vive en Telegram y opera sobre un contrato en Celo, con pesos digitales (wARS):

- **El socio aporta en pesos,** lo que quiera, y recibe su recibo por chat. Nunca ve una wallet.
- **La comisión sube por chat la foto o el PDF de una factura.** El agente lee el QR de ARCA, verifica que esté a nombre de la cooperadora y le paga al proveedor, siempre dentro del presupuesto que votó la asamblea y del tope fijado.
- **Lo que excede el tope o la partida queda pendiente.** Se paga cuando dos firmantes lo aprueban con la huella del celular.
- **Cada movimiento se ve al instante en un panel público:** aportes, pagos, facturas, cambios de presupuesto y su motivo.
- **Al cierre del mes, el agente arma la rendición** como página web y como PDF con el formato oficial de rendición. El revisor le da el visto bueno y se publica.

El agente no puede pagar a nadie fuera de la lista de proveedores, ni superar los topes, ni cambiar las reglas, ni cobrarse a sí mismo sin firmas.

## Historias de usuario

**Socio**

1. Como socio, quiero aportar el monto que yo elija, así colaboro según mis posibilidades.
2. Como socio, quiero ver montos sugeridos, así sé cuánto aporta la mayoría sin sentirme obligado.
3. Como socio, quiero pagar en pesos desde mi banco o billetera, así no tengo que aprender nada de cripto.
4. Como socio, quiero recibir un recibo por Telegram al minuto de que llegue mi aporte, así sé que llegó.
5. Como socio, quiero que mi recibo diga el monto, la fecha y un link al movimiento, así lo puedo verificar.
6. Como socio, quiero que mi nombre no aparezca públicamente asociado a mi aporte, así nadie sabe cuánto di ni si di.
7. Como socio, quiero que el sistema nunca me reclame un aporte, porque la cuota es voluntaria.
8. Como socio, quiero que el sistema nunca pida ni guarde datos de mi hijo, así su escolaridad no depende de mi aporte.
9. Como socio, quiero preguntarle al bot en qué se gastó la plata, así entiendo sin leer planillas.
10. Como socio, quiero ver el panel público sin registrarme, así controlo sin pedir permiso.
11. Como socio, quiero identificarme en el bot compartiendo mi contacto, así no tengo que crear usuario ni contraseña.

**Miembro de la comisión directiva**

12. Como miembro de la comisión, quiero mandar la foto o el PDF de una factura por Telegram, así el pago sale sin que yo maneje la plata.
13. Como miembro de la comisión, quiero elegir con botones la partida de la factura, y que el agente me sugiera una, así se imputa bien.
14. Como miembro de la comisión, quiero que el agente me diga en segundos si la factura se pagó, quedó pendiente o se rechazó, así sé qué hacer.
15. Como miembro de la comisión, quiero que, si rechaza una factura, el agente me explique el motivo (por ejemplo, "no está a nombre de la cooperadora" o "el proveedor no está habilitado"), así puedo pedirla bien.
16. Como miembro de la comisión, quiero que el agente rechace una factura que ya se pagó, aunque la mande escaneada otra vez, así no pagamos dos veces.
17. Como miembro de la comisión, quiero que una factura con instrucciones raras en el texto, como "pagar a esta otra cuenta", se marque para revisión, así nadie engaña al agente.

**Firmante** (presidente, tesorero, revisor)

18. Como firmante, quiero recibir por Telegram un aviso con el resumen y la factura cuando un pago necesita mi firma, así no tengo que entrar a revisar.
19. Como firmante, quiero abrir el link y firmar con mi huella, así apruebo sin frase semilla ni extensiones.
20. Como firmante, quiero crear mi firma la primera vez con un solo paso guiado, así no me trabo.
21. Como firmante, quiero no necesitar saldo en cripto para firmar, así no tengo que comprar nada.
22. Como firmante, quiero rechazar un pago pendiente, así freno algo que no corresponde.
23. Como firmante, quiero ver cuántas firmas tiene un pago y cuántas faltan, así sé si mi firma lo ejecuta.
24. Como firmante, quiero pausar el agente con un solo paso si algo se ve mal, así se frena todo al instante.
25. Como firmante, quiero que reanudar requiera varias firmas, así una sola persona no puede despausar a la fuerza.
26. Como firmante, quiero proponer mover plata de una partida a otra con un motivo, así la cooperadora responde a una urgencia sin esperar a la asamblea.
27. Como firmante, quiero que todo cambio de presupuesto, proveedores, topes o firmantes requiera el umbral de firmas, así ninguna persona sola cambia las reglas.
28. Como firmante, quiero que, si el agente se cae, los fondos sigan en el contrato y podamos operar desde la página de firma, así no dependemos del servidor.

**Revisor de cuentas**

29. Como revisor, quiero recibir un aviso en el momento de cada pago automático, así controlo mientras pasa y no meses después.
30. Como revisor, quiero recibir el borrador de la rendición antes de que se publique, así lo reviso.
31. Como revisor, quiero dar el visto bueno a la rendición con un paso, así se publica.
32. Como revisor, quiero que el tope mensual por proveedor escale los pagos chicos repetidos, así nadie parte una factura grande en varias chicas.

**Asesor natural** (dirección de la escuela)

33. Como directora, quiero recibir la rendición publicada cada mes, así estoy al tanto sin pedirla.
34. Como directora, quiero que la rendición venga en el formato que ya piden las autoridades, así la puedo elevar tal cual.

**Proveedor**

35. Como proveedor, quiero cobrar en el momento en que la factura se aprueba, así no espero semanas.
36. Como proveedor, quiero una cuenta propia con huella para recibir el pago, así la plata es mía y nadie más la maneja.
37. Como proveedor, quiero pasar lo que cobré a mi CBU desde un link con todo cargado, así lo tengo en pesos.
38. Como proveedor, quiero que mis datos y los de la cooperadora estén protegidos y que yo no vea datos de socios, así se respeta la privacidad de todos.

**Tesorero voluntario**

39. Como tesorero, quiero que la rendición mensual se arme sola con ingresos, egresos por partida y comprobantes, así no pierdo un fin de semana con el Excel.
40. Como tesorero, quiero cargar a mano los aportes en especie o en trabajo, así figuran en la rendición.
41. Como tesorero, quiero que la rendición liste los cambios de presupuesto con su motivo y sus firmas, así la asamblea entiende qué pasó.

**Visitante del panel público**

42. Como visitante del panel, quiero ver el saldo actual, así sé con cuánto cuenta la cooperadora.
43. Como visitante, quiero ver los aportes agrupados por mes, sin nombres, así veo la participación sin exponer a nadie.
44. Como visitante, quiero ver cada egreso con su factura, partida, proveedor y regla aplicada (automático o con firmas), así entiendo cada gasto.
45. Como visitante, quiero ver cuánto queda en cada partida, así sé qué se puede gastar.
46. Como visitante, quiero ver un aviso cuando el presupuesto del año venció y se sigue usando el anterior, así sé que falta la asamblea.
47. Como visitante, quiero ver cuando un pago con firmas excedió su partida, así nada queda escondido.
48. Como visitante, quiero que cada movimiento tenga un link a la cadena, así lo verifico por mi cuenta.

**Operador de la instancia** (quien instala el sistema)

49. Como operador, quiero configurar la cooperadora con un script (firmantes, umbral, topes, partidas, proveedores, CUIT, RUCE, hash del acta), así pongo una instancia en marcha sin pantallas de administración.
50. Como operador, quiero que toda transacción lleve el tag de atribución del proyecto, así cuenta para el hackathon.
51. Como operador, quiero que el agente pague sus comisiones de red en USDT o USDC, así no necesita CELO.
52. Como operador, quiero que el agente tenga su identidad registrada en ERC-8004, así cualquiera puede verificar quién es.
53. Como operador, quiero que dos ejecuciones del agente nunca paguen lo mismo, así un reintento no duplica pagos.

## Decisiones de implementación

**Módulos**

- **Contrato de política del tesoro.**
  - Custodia los wARS y decide qué pagos son válidos.
  - Interfaz: aportar con referencia opaca; proponer pago (solo el agente); aprobar y rechazar pagos (firmantes); proponer y aprobar cambios de configuración (umbral); pausar (cualquier firmante).
  - El ID de la factura se calcula en el contrato a partir de CUIT emisor, tipo, punto de venta y número. El contrato rechaza un ID ya pagado y exige que el CUIT coincida con el del proveedor habilitado.
  - El pago automático exige que el monto entre en cuatro límites: el tope por pago, el saldo de la partida, el tope mensual del proveedor y el saldo del contrato. Si no entra, queda pendiente.
  - Un pago con firmas puede exceder la partida, y el evento lo marca.
  - El vencimiento de una partida es informativo, no bloquea.
  - Los pagos al propio agente siempre se escalan.
- **Fábrica de buzones.**
  - Calcula direcciones deterministas a partir de una referencia aleatoria.
  - Cualquiera puede barrer un buzón: lo despliega si hace falta y aporta todo su saldo al tesoro.
  - El buzón no tiene otra salida.
- **Lector de facturas.**
  - Primero el QR de ARCA. Si no hay, extracción con Claude a un esquema fijo.
  - Si las dos fuentes existen y no coinciden, la factura va a revisión.
- **Validador de facturas.**
  - Reglas en código: el receptor es la cooperadora, el tipo es B o C, el emisor está habilitado y la factura no se pagó.
  - Devuelve un motivo legible cuando falla.
- **Orquestador.**
  - Máquina de estados de la factura: recibida → leída → validada | rechazada | revisión → propuesta → pagada | pendiente → aprobada → pagada | cancelada.
  - Es el único que llama a proponer pago.
  - Un lock en la base impide ejecuciones simultáneas.
  - Un pago enviado sin recibo no se reenvía a ciegas.
- **Indexador.**
  - Lee los eventos del tesoro y los `Transfer` de wARS hacia el tesoro.
  - Lo que llega sin buzón se registra como "aporte sin identificar".
- **Bot de Telegram.**
  - Recibe updates por webhook.
  - Identifica a cada persona por el contacto compartido y su rol por el padrón.
- **Página de firma.**
  - Safe con passkey, con operaciones patrocinadas por Pimlico y el tag dentro de la operación.
  - Se abre en el navegador del teléfono, porque el de Telegram no soporta passkeys.
  - La misma página sirve al proveedor para ver sus cobros y abrir el off-ramp de Ripio.
- **Panel público y rendición.**
  - Panel en tiempo real.
  - Rendición mensual como página y PDF con el formato CooperAr, con flujo borrador → revisada → publicada.
- **Tick periódico.**
  - Un endpoint llamado cada minuto por un cron externo.
  - Barre buzones con saldo, indexa, hace el cierre de mes y reintenta lo pendiente.

**Arquitectura y stack**

- **Una sola app Next.js en TypeScript, desplegada en Vercel.**
- **Datos:** Neon Postgres para datos y Vercel Blob para archivos.
- **Cadena:** viem con el SDK oficial de tags ERC-8021, y permissionless con Pimlico.
- **Contratos:** Solidity con Foundry.
- **Cron:** Cloudflare Workers.
- **Mainnet de Celo para la entrega.** En Sepolia se usa un ERC-20 propio que imita wARS, porque wARS no existe ahí.
- **Comisiones:** el agente las paga en USDT o USDC (CIP-64). wARS no es fee currency.

**Límites del LLM**

- El LLM no participa del camino del dinero.
- Extrae facturas sin QR, sugiere partidas, redacta mensajes y responde preguntas.
- Todo texto de facturas o mensajes es dato, nunca instrucción.

**Entrada de pesos**

- **Demo:** link de Ripio con la dirección del buzón cargada.
- **Producción (pendiente de que Ripio confirme):** la cooperadora es cliente BUSINESS de la API de Ripio y tiene un CVU fijo. El padre transfiere como hoy, el agente lo reconoce por el nombre del webhook y, si falta, le pregunta.

**Privacidad**

- En la cadena hay direcciones, montos, hashes y el CUIT de los proveedores.
- Socios y teléfonos viven solo en la base.
- No hay datos de alumnos.

## Decisiones de testing

**Qué es un buen test**

- Ejercita el comportamiento observable desde la interfaz pública: llamadas al contrato y sus eventos, requests HTTP a la app y mensajes que salen hacia Telegram.
- No prueba funciones internas.

**Seams propuestos** (dos, lo más alto posible; a confirmar)

1. **La interfaz externa del contrato,** en Foundry.
   - Tests de invariantes y fuzzing sobre los 9 invariantes de `docs/sdd.md`:
     1. Ningún pago fuera de la lista de proveedores.
     2. Los cuatro límites del pago automático.
     3. El agente sin poder de configuración ni de cobro propio.
     4. Con pausa no hay pagos.
     5. Eventos completos.
     6. Ningún aporte sin transferencia real.
     7. Ninguna factura pagada dos veces.
     8. El CUIT de la factura coincide con el del proveedor.
     9. El buzón solo puede pagarle al tesoro.
   - Más tests de escenarios: escalado, rechazo, mover partidas, vencimiento.
2. **Las rutas HTTP de la app** (webhook de Telegram y tick) contra un fork de Celo mainnet en anvil.
   - Telegram, Ripio y Claude se reemplazan en el borde por dobles.
   - Las passkeys son virtuales.
   - Recorridos completos:
     - factura chica pagada;
     - factura rechazada con motivo;
     - factura inyectada marcada para revisión;
     - factura grande pendiente → 2 firmas → pagada;
     - aporte por buzón → recibo;
     - cierre de mes → borrador → visto bueno → publicada.

El lector de QR de ARCA se prueba con facturas reales de monotributistas (PDF de "Comprobantes en línea" y fotos) como fixtures, a través del seam 2.

**Precedentes:** el repo está vacío. Como referencia externa sirve TesorerIA, que usa tests de reglas con datos fijos, tests contra un fork de mainnet y e2e con passkeys virtuales.

## Fuera de alcance

- Caja chica.
- Recordatorios de aporte.
- Exportación a Excel.
- WhatsApp, que va al roadmap.
- x402.
- Pantallas de configuración.
- Varias cooperadoras por instancia.
- Flujo propio para aportes en especie o trabajo: se cargan a mano.
- Validación de facturas contra los servicios web de ARCA.
- Rendimientos sobre fondos ociosos.
- Reemplazo de libros rubricados o de la asamblea.
- Cooperativas escolares de alumnos.
- La integración B2B con Ripio (CVU de la cooperadora y webhooks), que queda para después de confirmar con Ripio.
- La reputación ERC-8004 es un extra: el revisor califica cada rendición.

## Notas

- **Entrega:** 9 de noviembre de 2026, 09:00 GMT.
- **Obligatorio:** mainnet, identidad ERC-8004 y tag ERC-8021 desde la primera transacción. El tag ya está asignado.
- **La demo usa una cooperadora ficticia.** Emisor y receptor de la factura tienen que ser CUIT distintos; hay dos monotributistas disponibles y falta definir quién es quién.
- **La demo abre con la factura**, que es el diferencial frente a TesorerIA, y después muestra aportes y firmas.
- **En la entrega hay que declarar** que el gas de firmantes y proveedores lo patrocina Pimlico.
- **Pendientes con Ripio:**
  - Si acepta asociaciones civiles como cliente BUSINESS.
  - Si acepta transferencias de terceros al CVU.
  - Si permite off-ramp a un CBU de terceros.
  - Cuánto tarda el on-ramp.
- **Pendientes de campo:** formato de rendición de Jujuy y tipos de comprobante aceptados. Ver `docs/investigacion-cooperadoras.md`.
