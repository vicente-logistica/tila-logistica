import type { DocumentoLegalFuente } from "../tipos";

// ⚠️ BORRADOR INTERNO — NO PUBLICAR, NO MARCAR "vigente", NO RECIBIR
// ACEPTACIONES. Contiene placeholders sin completar ([MES Y AÑO DE
// PUBLICACIÓN], [NÚMERO DE VERSIÓN], [RAZÓN SOCIAL DE LA SAS], [CUIT],
// [DOMICILIO LEGAL]). Texto tomado literalmente del borrador de 34 cláusulas
// provisto para revisión — sin inventar ni completar ningún dato faltante.

export const documento: DocumentoLegalFuente = {
  tipoDocumento: "contrato_transportista",
  version: "2026-07", // placeholder técnico del nombre de archivo — el texto interno aún dice [NÚMERO DE VERSIÓN]
  titulo: "CONTRATO DE ADHESIÓN PARA TRANSPORTISTAS INDEPENDIENTES — TILA",
  contenido: `**Última actualización:** [MES Y AÑO DE PUBLICACIÓN]
**Versión:** [NÚMERO DE VERSIÓN]

## Información importante antes de registrarte

El presente Contrato de Adhesión para Transportistas Independientes, en adelante el "Contrato", regula la utilización de la plataforma TILA por parte de transportistas y conductores independientes.

Este Contrato forma parte integral de los Términos y Condiciones de TILA. Su aceptación electrónica es obligatoria para registrarse, publicar disponibilidad, aceptar solicitudes o prestar servicios mediante la plataforma.

Antes de aceptar, el transportista deberá leer íntegramente este documento. Si no está de acuerdo con alguna de sus disposiciones, no deberá completar el registro ni operar mediante TILA.

La aceptación quedará registrada electrónicamente junto con la identificación del usuario, la versión aceptada, la fecha, la hora y demás evidencias técnicas legalmente permitidas.

## 1. Identificación de TILA

TILA — Tecnología Inteligente Logística Argentina es una plataforma tecnológica de intermediación logística operada por:

**Razón social:** [RAZÓN SOCIAL DE LA SAS]
**CUIT:** [CUIT]
**Domicilio legal:** [DOMICILIO LEGAL]
**Correo electrónico de contacto:** [legal@tilalogistica.com](mailto:legal@tilalogistica.com)
**Sitio web:** [https://www.tilalogistica.com](https://www.tilalogistica.com)

Hasta que se completen los datos societarios definitivos, estos campos deberán mantenerse identificados como pendientes y no deberán reemplazarse con información ficticia.

## 2. Definiciones

A los efectos de este Contrato se entenderá por:

**TILA o Plataforma:** la infraestructura tecnológica que permite publicar, visualizar, coordinar, registrar, monitorear y gestionar solicitudes de transporte.

**Cliente:** la persona humana o jurídica que publica una solicitud de transporte de cargas.

**Transportista:** la persona humana o jurídica independiente que ofrece y presta servicios de transporte por cuenta propia.

**Conductor o Chofer:** la persona humana habilitada que conduce el vehículo utilizado para realizar el servicio. El conductor podrá coincidir o no con el titular de la actividad transportista, según lo permita la plataforma y la normativa aplicable.

**Servicio o Viaje:** la operación de transporte solicitada por un cliente y aceptada voluntariamente por un transportista.

**Proveedor de pagos:** la entidad externa autorizada que procesa pagos, transferencias, liquidaciones, contracargos y demás operaciones financieras relacionadas con los servicios.

**Registro de liquidaciones:** la sección informativa de la plataforma en la que se muestran operaciones, comisiones, importes pendientes, importes observados y liquidaciones procesadas. Podrá mostrarse comercialmente como "billetera", sin constituir una cuenta bancaria o cuenta de pago operada por TILA.

## 3. Naturaleza de la plataforma

TILA brinda servicios tecnológicos y de intermediación logística destinados a conectar clientes con transportistas independientes.

TILA no realiza materialmente el traslado de la carga, no aporta el vehículo ni sustituye al transportista en el cumplimiento de las obligaciones legales propias del transporte.

Cuando un transportista acepta una solicitud, se celebra una contratación de transporte entre el cliente y el transportista, conforme a las condiciones particulares informadas para ese servicio y a la normativa aplicable.

TILA podrá facilitar herramientas de comunicación, documentación, geolocalización, procesamiento de pagos, gestión de reclamos y registro de evidencias, sin que esas funciones conviertan por sí mismas a TILA en transportista, empleadora, mandataria general, aseguradora o garante universal de las obligaciones asumidas por los usuarios.

La intervención concreta de TILA y la distribución de responsabilidades se determinarán según la función efectivamente cumplida, las condiciones del servicio y las normas obligatorias aplicables.

## 4. Independencia del transportista

El transportista desarrolla una actividad económica independiente, por su propia cuenta, organización y riesgo.

La utilización de TILA no genera por sí misma una relación laboral, societaria, de representación, agencia, franquicia, mandato general ni asociación entre TILA y el transportista.

En particular, el transportista:

a. Decide libremente cuándo conectarse y desconectarse de la plataforma.

b. No tiene obligación de permanecer disponible durante una cantidad mínima de horas o días.

c. Puede aceptar o rechazar solicitudes libremente, sin que el rechazo de un viaje aislado genere una sanción, deuda, reducción automática de derechos o exclusión de la plataforma.

d. Puede dejar de utilizar TILA cuando lo considere conveniente, sin obligación de preaviso laboral.

e. Puede utilizar otras plataformas, trabajar para empresas competidoras, contratar directamente con terceros y desarrollar su propia cartera de clientes.

f. No está sujeto a exclusividad territorial, horaria o comercial.

g. Organiza autónomamente su actividad, descansos, disponibilidad, recursos y estructura de costos.

h. Utiliza vehículos, teléfonos, herramientas y demás recursos propios o legítimamente contratados.

i. Asume los costos y riesgos propios de su actividad, incluyendo combustible, mantenimiento, peajes, estacionamiento, reparaciones, seguros, permisos e impuestos.

j. Percibe importes vinculados con los servicios voluntariamente aceptados y efectivamente realizados, y no un salario periódico pagado por TILA.

k. No tiene garantizada una cantidad mínima de solicitudes, facturación, kilómetros, ingresos o rentabilidad.

l. No recibe de TILA vacaciones pagas, aguinaldo, licencias laborales, indemnización por despido, presentismo, horas extras ni otros beneficios propios de una relación de dependencia.

Estas previsiones describen el modelo independiente previsto por las partes. Si la operación real adoptara características distintas, se aplicarán las normas imperativas que correspondan, con independencia del nombre otorgado al vínculo.

## 5. Libertad de aceptación y condiciones del servicio

Antes de aceptar una solicitud, el transportista deberá poder consultar la información esencial disponible, que podrá incluir:

- Lugar de retiro.
- Lugar de entrega.
- Distancia estimada.
- Características declaradas de la carga.
- Tipo de vehículo requerido.
- Precio o mecanismo de determinación del precio.
- Comisión de TILA.
- Importe estimado correspondiente al transportista.
- Condiciones especiales informadas por el cliente.
- Requisitos documentales o de seguridad aplicables.

La aceptación será voluntaria y constituirá una manifestación expresa de voluntad respecto de ese servicio concreto.

Una vez aceptado el servicio, el transportista deberá cumplir las condiciones contractuales asumidas. La libertad de rechazar solicitudes antes de aceptarlas no habilita a abandonar arbitrariamente un viaje ya iniciado ni a incumplir obligaciones legales o de seguridad.

TILA podrá limitar nuevas aceptaciones cuando el transportista mantenga un viaje activo incompatible con otro servicio, cuando existan restricciones técnicas objetivas o cuando resulte necesario prevenir riesgos de seguridad.

## 6. Precio, comisión y facturación

El precio y los importes aplicables deberán ser informados antes de la aceptación del servicio, salvo conceptos variables que no puedan determinarse anticipadamente y que hayan sido debidamente explicados.

TILA percibirá la comisión o cargo correspondiente a sus servicios tecnológicos y de intermediación, conforme a la tarifa informada para cada operación.

El transportista será responsable de emitir los comprobantes fiscales correspondientes por el servicio de transporte que presta, según su condición tributaria y la normativa aplicable.

TILA emitirá los comprobantes fiscales correspondientes a su comisión o a los servicios propios que facture.

La instrumentación fiscal definitiva de los comprobantes, liquidaciones y cargos deberá ajustarse al circuito aprobado por el profesional contable de TILA y a la modalidad efectivamente habilitada por el proveedor de pagos.

Ninguna disposición de este Contrato implica que la totalidad del precio del transporte constituya un ingreso propio de TILA cuando TILA actúe exclusivamente como intermediaria.

## 7. Procesamiento y liquidación de pagos

Los pagos electrónicos serán procesados mediante el proveedor de pagos informado en la plataforma.

TILA no almacena los datos completos de tarjetas y no ofrece por cuenta propia una cuenta bancaria, cuenta de pago, caja de ahorro, depósito, captación de fondos o servicio financiero.

La sección denominada "billetera" o "registro de liquidaciones" constituye una representación informativa de operaciones, importes, comisiones y estados de pago. No representa dinero depositado en una cuenta abierta por TILA a nombre del transportista.

Las liquidaciones estarán sujetas a:

- Confirmación efectiva del pago.
- Finalización del servicio.
- Validaciones del proveedor de pagos.
- Reglas de prevención de fraude.
- Contracargos o desconocimientos.
- Reclamos directamente vinculados con la operación.
- Obligaciones legales, judiciales o administrativas.
- Datos bancarios o de cobro correctos y verificados.

El transportista deberá registrar un CBU, CVU, alias u otro medio de cobro admitido, perteneciente al titular autorizado o debidamente justificado.

Los plazos de disponibilidad y transferencia serán los informados por el proveedor de pagos y por TILA antes de la operación o solicitud de liquidación.

TILA no garantizará plazos que dependan exclusivamente de bancos, billeteras, adquirentes, proveedores de pagos o autoridades externas.

## 8. Importes observados, reclamos y contracargos

Ante un reclamo, contracargo, desconocimiento de pago o indicio objetivo de fraude, podrá disponerse la inmovilización preventiva del importe directamente relacionado con la operación cuestionada.

Salvo orden judicial, obligación legal, prevención documentada de fraude o imposibilidad técnica impuesta por el proveedor de pagos, no deberá inmovilizarse indiscriminadamente el saldo correspondiente a otros servicios no afectados por la disputa.

El transportista deberá ser informado, dentro de un plazo razonable, sobre:

- La operación observada.
- El motivo de la observación.
- El importe afectado.
- Las evidencias disponibles.
- El canal y plazo para presentar un descargo.

El transportista podrá aportar fotografías, mensajes, comprobantes, datos de geolocalización, documentación y cualquier otro elemento pertinente.

La inmovilización será provisoria y se mantendrá únicamente durante el tiempo razonablemente necesario para investigar el caso, cumplir las reglas del proveedor de pagos o atender una orden de autoridad competente.

El resultado del procedimiento interno no impedirá que las partes recurran a organismos administrativos, mediación o tribunales competentes.

## 9. Obligaciones fiscales y registrales

El transportista es responsable de:

a. Mantener su inscripción tributaria ante ARCA conforme a la actividad desarrollada.

b. Inscribirse en Ingresos Brutos y en los regímenes nacionales, provinciales o municipales que correspondan.

c. Evaluar, con asesoramiento profesional propio, si debe tributar bajo monotributo, régimen general u otra categoría.

d. Emitir facturas, recibos, cartas de porte, remitos o comprobantes exigidos para la operación.

e. Informar datos fiscales verídicos y actualizados.

f. Pagar los impuestos, tasas, aportes y obligaciones derivados de su actividad independiente.

g. Conservar la documentación respaldatoria exigida por la normativa.

TILA podrá solicitar constancias razonables para verificar que el usuario se encuentra habilitado para operar, sin asumir por ello la función de asesor fiscal ni garantizar la situación tributaria del transportista.

## 10. Vehículos y documentación habilitante

Para operar, el transportista deberá acreditar la documentación exigible según el vehículo, la carga, el recorrido y las jurisdicciones involucradas.

La documentación podrá incluir, según corresponda:

- DNI o documentación identificatoria.
- CUIT o CUIL.
- Licencia de conducir habilitante.
- Cédula de identificación del vehículo.
- Autorización para conducir, cuando corresponda.
- Seguro automotor vigente.
- Cobertura compatible con el uso comercial y el transporte realizado.
- VTV o RTO vigente.
- Habilitaciones nacionales, provinciales o municipales.
- Inscripciones o registros del transporte.
- Certificados relativos a cargas especiales.
- Documentación laboral y de seguridad social cuando el titular utilice conductores dependientes.
- Certificado de antecedentes penales cuando resulte legal, necesario, proporcional y previamente informado.
- Toda otra documentación exigida por autoridad competente.

TILA podrá verificar la legibilidad, vigencia, consistencia y aparente autenticidad de la documentación.

La aprobación realizada por TILA constituye una validación operativa basada en la información disponible y no reemplaza el control de las autoridades ni garantiza que el documento resulte suficiente para cualquier clase de carga o jurisdicción.

## 11. Actualización y vencimiento de documentación

El transportista deberá mantener actualizada la documentación necesaria para los servicios que pretenda realizar.

Cuando un documento indispensable se encuentre vencido, resulte inválido o no pueda verificarse, TILA podrá impedir temporalmente la aceptación de nuevos servicios relacionados con ese requisito.

La restricción tendrá una finalidad preventiva y de cumplimiento normativo, no disciplinaria ni laboral.

Cuando sea posible, TILA informará previamente el vencimiento. La falta de aviso no eximirá al transportista de controlar la vigencia de su propia documentación.

Una vez presentada y validada la documentación correcta, la habilitación podrá restablecerse conforme a los tiempos razonables de revisión.

## 12. Seguro y responsabilidad frente a terceros

El transportista deberá mantener vigente un seguro adecuado al vehículo, uso, jurisdicción, modalidad de transporte y riesgos de la actividad.

Un seguro de uso particular podrá resultar insuficiente cuando el vehículo se utilice comercialmente. Corresponde al transportista verificar con su aseguradora que la cobertura resulte compatible con la actividad declarada.

Cuando la naturaleza o valor de la carga requiera un seguro específico, las condiciones del servicio deberán indicar quién será responsable de contratarlo.

La plataforma podrá exigir la acreditación de coberturas adicionales para determinadas categorías de vehículos, cargas o recorridos.

TILA no actúa como aseguradora ni reemplaza las pólizas que deban contratar el cliente o el transportista.

## 13. Declaración y acondicionamiento de la carga

El cliente es responsable de describir la carga de manera completa y veraz, incluyendo:

- Naturaleza.
- Cantidad.
- Peso.
- Dimensiones.
- Valor declarado cuando corresponda.
- Fragilidad.
- Peligrosidad.
- Necesidad de refrigeración.
- Requisitos de manipulación.
- Permisos especiales.
- Embalaje.
- Cualquier circunstancia relevante.

El transportista deberá revisar la información disponible antes de aceptar.

Si al momento del retiro la carga difiere sustancialmente de lo declarado, presenta riesgos no informados, excede la capacidad del vehículo o carece de documentación obligatoria, el transportista podrá negarse justificadamente a iniciar el traslado y deberá registrar la situación mediante la plataforma.

El cliente será responsable del embalaje, identificación y acondicionamiento cuando dichas tareas no hayan sido expresamente asumidas por el transportista.

## 14. Custodia y responsabilidad sobre la carga

Desde la recepción efectiva de la carga y hasta su entrega, el transportista deberá actuar con diligencia profesional y cumplir las obligaciones de custodia previstas por la legislación aplicable y por las condiciones particulares del viaje.

La responsabilidad por pérdida, daño, robo, demora o deterioro se determinará atendiendo a:

- La causa efectiva del hecho.
- La conducta de las partes.
- La normativa aplicable.
- El estado y embalaje de la carga.
- La veracidad de la declaración del cliente.
- Las instrucciones aceptadas.
- La existencia de caso fortuito o fuerza mayor.
- La intervención de terceros.
- Los seguros contratados.
- Las evidencias disponibles.

No se considerará automáticamente responsable al transportista por daños preexistentes, vicios propios de la mercadería, embalaje defectuoso no asumido por él, información falsa u omitida por el cliente, caso fortuito, fuerza mayor o hechos ajenos que legalmente excluyan o limiten su responsabilidad.

Nada de lo dispuesto impedirá la aplicación de responsabilidades legales inderogables.

## 15. Evidencias de retiro y entrega

El transportista deberá registrar las evidencias razonablemente requeridas para acreditar:

- Estado visible de la carga.
- Cantidad o bultos.
- Condiciones de retiro.
- Incidencias detectadas.
- Entrega al destinatario.
- Fecha, hora y ubicación cuando corresponda.

Las fotografías y demás evidencias deberán limitarse a lo necesario para documentar el servicio. El transportista deberá evitar capturar imágenes irrelevantes de personas, documentos privados, domicilios o bienes ajenos.

Cuando aparezcan personas, matrículas, domicilios u otros datos personales, su tratamiento estará sujeto a la Política de Privacidad y a las finalidades de seguridad, trazabilidad, prevención de fraude y resolución de reclamos.

La ausencia injustificada de evidencias podrá ser considerada al analizar una disputa, pero no determinará automáticamente la responsabilidad del transportista.

## 16. GPS y geolocalización

La geolocalización se utilizará durante los servicios activos para:

- Mostrar el avance del viaje.
- Facilitar la coordinación entre las partes.
- Calcular distancias y tiempos estimados.
- Proteger la seguridad de la operación.
- Registrar el cumplimiento del servicio.
- Prevenir fraude.
- Resolver reclamos.

El seguimiento deberá limitarse al período razonablemente vinculado con la operación aceptada y no tendrá por finalidad controlar la vida privada, los descansos o la actividad general del transportista fuera de los viajes.

La disponibilidad general del transportista solo se mostrará cuando este decida ponerse en línea o habilitar dicha función.

El GPS es una herramienta de trazabilidad contractual y no implica, por sí mismo, dirección laboral, supervisión personal continua ni obligación de permanecer disponible.

El transportista podrá desactivar la ubicación fuera de los servicios activos. Durante un viaje aceptado, la desactivación podrá afectar la trazabilidad y deberá justificarse cuando impida cumplir una condición esencial previamente informada.

TILA no garantiza exactitud permanente, continuidad de señal ni funcionamiento ininterrumpido de servicios de geolocalización prestados por terceros.

## 17. Comunicación durante el servicio

El chat interno constituye el canal recomendado para registrar comunicaciones relacionadas con el viaje.

El transportista deberá informar por medios razonables:

- Demoras relevantes.
- Accidentes.
- Fallas mecánicas.
- Cambios inevitables de recorrido.
- Imposibilidad de acceso.
- Rechazo del destinatario.
- Riesgos detectados.
- Cualquier incidencia que afecte la entrega.

La obligación de informar tiene finalidad de coordinación y seguridad, y no implica que TILA dirija laboralmente la prestación.

Los mensajes podrán conservarse y utilizarse como evidencia conforme a la Política de Privacidad.

## 18. Organización del recorrido y seguridad vial

El transportista conserva autonomía para organizar el recorrido, siempre que respete:

- La legislación de tránsito.
- Restricciones de circulación.
- Condiciones de seguridad.
- Características del vehículo y la carga.
- Horarios de acceso previamente aceptados.
- Indicaciones obligatorias de las autoridades.
- Condiciones esenciales acordadas con el cliente.

Las rutas sugeridas por TILA, Google Maps, Waze u otros servicios tienen carácter orientativo.

El transportista no deberá obedecer ninguna sugerencia de navegación que resulte ilegal, insegura o incompatible con el vehículo o la carga.

TILA no exige infringir límites de velocidad, tiempos de descanso, restricciones de circulación ni normas de seguridad para cumplir horarios estimados.

## 19. Libertad comercial y prohibición de elusión

El transportista podrá trabajar para terceros, utilizar plataformas competidoras y captar clientes propios.

Sin embargo, no podrá utilizar información obtenida exclusivamente mediante TILA para desviar fraudulentamente una operación concreta ya publicada, aceptada o coordinada en la plataforma con el propósito de evitar la comisión aplicable.

La prohibición se limita a operaciones originadas y efectivamente gestionadas mediante TILA. No constituye exclusividad general ni impide prestar servicios a clientes obtenidos legítimamente por canales propios.

No se considerará elusión una contratación ajena a TILA cuando el transportista pueda demostrar que la relación comercial preexistía o se originó de manera independiente.

Las consecuencias de una elusión deberán ser proporcionales, fundadas en evidencias y sujetas a descargo.

## 20. Conductas prohibidas

Queda prohibido:

a. Presentar documentación falsa, adulterada o perteneciente a terceros no autorizados.

b. Suplantar identidades o permitir que otra persona opere una cuenta personal sin autorización.

c. Manipular intencionalmente la geolocalización o las evidencias.

d. Transportar cargas ilícitas o prohibidas.

e. Ocultar accidentes, daños o incidentes relevantes.

f. Amenazar, acosar, discriminar o agredir a otros usuarios.

g. Utilizar la plataforma para cometer fraude, lavado de activos, financiación ilícita o cualquier delito.

h. Intentar acceder sin autorización a cuentas, sistemas o datos.

i. Interferir con el funcionamiento técnico de TILA.

j. Desviar fraudulentamente operaciones concretamente originadas en la plataforma.

k. Transportar mercadería distinta de la declarada cuando su naturaleza genere un riesgo legal o de seguridad.

Las infracciones se evaluarán según su gravedad, reiteración, evidencia, daño y riesgo generado.

## 21. Restricciones preventivas, suspensión y baja

TILA podrá adoptar medidas proporcionales cuando existan incumplimientos contractuales, riesgos de seguridad o impedimentos legales.

### 21.1 Restricción preventiva inmediata

Podrá aplicarse temporalmente y sin aviso previo cuando existan indicios razonables de:

- Cuenta comprometida.
- Suplantación de identidad.
- Documentación aparentemente falsa.
- Fraude.
- Manipulación deliberada del GPS.
- Riesgo para personas o cargas.
- Actividad ilícita.
- Orden de autoridad competente.
- Falta de una habilitación indispensable.
- Incidente grave pendiente de investigación.

La restricción deberá revisarse y notificarse tan pronto como resulte razonablemente posible.

### 21.2 Restricción ordinaria

Para incumplimientos que no impliquen riesgo inmediato, TILA procurará:

- Informar los hechos atribuidos.
- Identificar la regla presuntamente incumplida.
- Permitir un descargo.
- Evaluar las evidencias.
- Comunicar una decisión fundada.

### 21.3 Calificaciones

TILA podrá incorporar en el futuro un sistema de calificaciones entre Cliente y Transportista. Esta funcionalidad no se encuentra implementada a la fecha de esta versión del Contrato.

Si en el futuro se implementa, las calificaciones no producirán por sí solas una suspensión automática. Podrán ser consideradas junto con reclamos documentados, incidentes verificables, incumplimientos objetivos o riesgos reiterados.

Rechazar solicitudes, desconectarse o utilizar otra plataforma no constituirá una causa válida de suspensión.

### 21.4 Baja definitiva

La baja definitiva podrá aplicarse ante fraude comprobado, actividad ilícita, falsificación grave, riesgos reiterados para terceros o incumplimientos sustanciales debidamente acreditados.

El transportista podrá solicitar la revisión de la decisión a través del canal informado por TILA, sin perjuicio de los derechos legales que le correspondan.

## 22. Conductores contratados por el transportista

Cuando el transportista sea una empresa o utilice conductores propios, será exclusivamente responsable de:

- Contratarlos conforme a la legislación aplicable.
- Registrar las relaciones laborales que correspondan.
- Pagar salarios, aportes y contribuciones.
- Contratar cobertura de riesgos del trabajo.
- Verificar licencias y aptitud.
- Cumplir convenios colectivos y jornadas.
- Proporcionar condiciones seguras.
- Mantener actualizada la documentación.

TILA podrá solicitar constancias razonables de cumplimiento cuando esos conductores accedan a la plataforma o presten servicios mediante ella.

La existencia de una relación entre el transportista y sus propios conductores no convierte automáticamente a TILA en empleadora de estos.

## 23. Protección de datos personales

Los datos del transportista serán tratados conforme a la Política de Privacidad de TILA y a la legislación argentina aplicable.

Las categorías tratadas podrán incluir:

- Identificación.
- Datos fiscales.
- Documentación habilitante.
- Datos del vehículo.
- Datos de pago.
- Geolocalización.
- Fotografías.
- Chats.
- Historial de viajes.
- Calificaciones.
- Reclamos.
- Logs técnicos y de seguridad.

TILA deberá informar las finalidades, destinatarios, proveedores tecnológicos, posibles transferencias internacionales, plazos de conservación y medios para ejercer derechos.

El tratamiento de geolocalización deberá limitarse a finalidades legítimas, adecuadas y proporcionales relacionadas con la disponibilidad voluntariamente informada y con los servicios activos.

## 24. Propiedad y uso de la plataforma

TILA conserva los derechos sobre su software, marca, diseño, bases de datos, documentación, contenidos y funcionalidades.

La aceptación de este Contrato otorga al transportista un permiso personal, limitado, revocable y no exclusivo para utilizar la plataforma conforme a sus finalidades.

El transportista no podrá copiar, vender, licenciar, descompilar, alterar o explotar indebidamente el software, salvo en los casos permitidos por normas imperativas.

El transportista conserva sus derechos sobre la información y documentación propia, otorgando a TILA las autorizaciones estrictamente necesarias para prestar el servicio, cumplir obligaciones legales y resolver disputas.

## 25. Disponibilidad y funcionamiento técnico

TILA procurará mantener la plataforma disponible, pero no garantiza funcionamiento ininterrumpido o libre de errores.

Podrán existir interrupciones por:

- Mantenimiento.
- Fallas de internet.
- Servicios de terceros.
- Proveedores de nube.
- Sistemas de mapas.
- Proveedores de pagos.
- Dispositivos de los usuarios.
- Fuerza mayor.
- Ataques o incidentes de seguridad.

Cuando una falla afecte un viaje activo, las partes deberán utilizar medios alternativos razonables para proteger la carga, completar la comunicación y documentar la operación.

## 26. Limitaciones de responsabilidad de TILA

TILA responderá por las obligaciones que legalmente le correspondan como operadora de la plataforma y por daños que resulten directamente imputables a su conducta, dentro de los límites permitidos por la legislación.

TILA no será responsable por:

- Daños causados exclusivamente por el cliente o transportista.
- Información falsa suministrada por usuarios.
- Incumplimientos del contrato de transporte entre cliente y transportista.
- Estado mecánico del vehículo.
- Conducción del transportista.
- Embalaje realizado por el cliente.
- Naturaleza no declarada de la carga.
- Fallas atribuibles exclusivamente a terceros.
- Hechos inevitables o de fuerza mayor.
- Pérdidas indirectas que legalmente puedan excluirse.

Ninguna cláusula excluirá responsabilidades que la legislación considere inderogables ni derechos que no puedan ser renunciados.

## 27. Indemnidad

Cuando resulte legalmente procedente, la parte que cause un daño mediante incumplimiento, falsedad, negligencia o conducta ilícita deberá mantener indemne a la otra frente a reclamos de terceros directamente derivados de ese hecho.

La obligación se limitará a daños comprobados y causalmente vinculados con la conducta atribuida.

No se aplicará para trasladar al transportista responsabilidades propias de TILA ni para excluir normas laborales, de consumo, transporte, protección de datos u otras disposiciones imperativas.

## 28. Duración y finalización

El Contrato entra en vigencia desde su aceptación electrónica y permanecerá vigente mientras la cuenta se encuentre activa.

El transportista podrá dejar de utilizar la plataforma y solicitar la baja de su cuenta, sujeto al cumplimiento de obligaciones pendientes, viajes activos, reclamos, facturación y plazos legales de conservación.

TILA podrá finalizar el acceso conforme al procedimiento de suspensión y baja previsto en este Contrato.

La terminación no afectará:

- Servicios ya aceptados.
- Pagos pendientes.
- Reclamos en trámite.
- Obligaciones fiscales.
- Deberes de confidencialidad.
- Conservación legal de registros.
- Responsabilidades nacidas durante la vigencia.

## 29. Modificaciones del Contrato

TILA podrá actualizar este Contrato por razones legales, operativas, de seguridad o evolución de la plataforma.

Los cambios serán informados con una anticipación razonable.

Cuando la modificación sea sustancial y afecte derechos, obligaciones, comisiones, pagos, responsabilidades o tratamiento de datos, TILA solicitará una nueva aceptación expresa antes de que el transportista pueda aceptar nuevos servicios.

La mera utilización continuada no sustituirá la aceptación expresa cuando esta resulte legalmente necesaria.

La plataforma conservará evidencia de las versiones aceptadas por cada usuario.

## 30. Notificaciones

Las comunicaciones podrán enviarse mediante:

- Avisos dentro de la plataforma.
- Correo electrónico registrado.
- Notificaciones push.
- Mensajes al número declarado.
- Otros canales habilitados.

El transportista deberá mantener actualizados sus datos de contacto.

Las comunicaciones relativas a restricciones, pagos, reclamos y cambios sustanciales deberán emitirse por un medio que permita conservar evidencia razonable de su envío.

## 31. Resolución de reclamos

Antes de iniciar un procedimiento judicial, las partes podrán intentar resolver el conflicto mediante el canal interno de soporte.

TILA podrá administrar un procedimiento técnico de revisión, pero no actuará como árbitro judicial ni impedirá recurrir a mediación, autoridades administrativas o tribunales.

La participación en el procedimiento interno no implicará renuncia a derechos.

Cuando corresponda legalmente, se cumplirá la mediación prejudicial obligatoria o el procedimiento previo aplicable en la jurisdicción competente.

## 32. Ley aplicable y jurisdicción

Este Contrato se regirá por las leyes de la República Argentina.

Las controversias serán resueltas por los tribunales que resulten competentes conforme a la naturaleza del vínculo, el domicilio de las partes, el lugar de cumplimiento y las normas procesales aplicables.

Cuando la legislación permita válidamente pactar jurisdicción y no exista una competencia inderogable, las partes podrán someterse a los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires.

Esta cláusula no limita fueros laborales, de consumo, administrativos o territoriales que resulten obligatorios.

## 33. Integridad y prevalencia normativa

Este Contrato se complementa con:

- Los Términos y Condiciones de TILA.
- La Política de Privacidad.
- Las condiciones particulares de cada viaje.
- Las reglas informadas del proveedor de pagos.
- Las normas legales aplicables.

En caso de contradicción:

1. Prevalecerán las normas obligatorias.
2. Luego, las condiciones particulares expresamente aceptadas para el viaje.
3. Después, este Contrato respecto de materias específicas del transportista.
4. Finalmente, los Términos y Condiciones generales.

La nulidad de una cláusula no afectará la validez de las restantes, siempre que el Contrato pueda subsistir razonablemente sin ella.

## 34. Aceptación electrónica

Al seleccionar la opción de aceptación, el transportista declara:

- Haber leído este Contrato.
- Haber tenido oportunidad de descargarlo o consultarlo.
- Comprender sus condiciones esenciales.
- Aceptar su contenido.
- Declarar que los datos proporcionados son verídicos.
- Actuar como prestador independiente.
- Conocer que puede consultar a profesionales legales, contables y aseguradores propios.

La aceptación será registrada con la versión del documento, fecha, hora, usuario y demás datos técnicos razonablemente necesarios para acreditar el consentimiento.`,
};
