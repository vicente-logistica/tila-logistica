import type { DocumentoLegalFuente } from "../tipos";

// ⚠️ BORRADOR INTERNO — NO PUBLICAR, NO MARCAR "vigente", NO RECIBIR
// ACEPTACIONES. Contiene placeholders sin completar ([MES Y AÑO DE
// PUBLICACIÓN], [NÚMERO DE VERSIÓN], [RAZÓN SOCIAL DE LA SAS], [CUIT],
// [DOMICILIO LEGAL]). El correo legal@tilalogistica.com y el sitio
// https://www.tilalogistica.com SÍ están confirmados (en uso real en
// app/privacidad/page.tsx) — no son placeholders.

export const documento: DocumentoLegalFuente = {
  tipoDocumento: "terminos",
  version: "2026-07", // placeholder técnico del nombre de archivo — el texto interno aún dice [NÚMERO DE VERSIÓN]
  titulo: "TÉRMINOS Y CONDICIONES DE USO — TILA",
  contenido: `**Última actualización:** [MES Y AÑO DE PUBLICACIÓN]
**Versión:** [NÚMERO DE VERSIÓN]

## Información importante antes de registrarte

Estos Términos y Condiciones de Uso, en adelante los "Términos", regulan el acceso y uso de la plataforma TILA por parte de todos sus usuarios, ya sea que actúen como Cliente o como Transportista.

Cuando el usuario se registre como Transportista, además de estos Términos, deberá leer y aceptar expresamente el Contrato de Adhesión para Transportistas Independientes, que regula específicamente las condiciones de la prestación del servicio de transporte. Estos Términos no reemplazan ni repiten ese contrato: donde exista una regulación específica en el Contrato de Adhesión, estos Términos remiten a él.

La aceptación de estos Términos es obligatoria para crear una cuenta, publicar una carga, aceptar un viaje o utilizar cualquier funcionalidad de la plataforma. Si no estás de acuerdo con alguna disposición, no debés completar el registro ni utilizar TILA.

La aceptación queda registrada electrónicamente junto con la identificación del usuario, la versión aceptada, la fecha, la hora y demás evidencia técnica razonablemente necesaria para acreditar el consentimiento.

## 1. Identificación de TILA

TILA — Tecnología Inteligente Logística Argentina es una plataforma tecnológica que conecta a Clientes que necesitan transportar cargas con Transportistas independientes dispuestos a realizarlas, operada por:

**Razón social:** [RAZÓN SOCIAL DE LA SAS]
**CUIT:** [CUIT]
**Domicilio legal:** [DOMICILIO LEGAL]
**Correo electrónico de contacto:** [legal@tilalogistica.com](mailto:legal@tilalogistica.com)
**Sitio web:** [https://www.tilalogistica.com](https://www.tilalogistica.com)

Hasta que se completen los datos societarios definitivos, estos campos deben mantenerse identificados como pendientes y no deben reemplazarse con información ficticia.

## 2. Definiciones

A los efectos de estos Términos se entenderá por:

**TILA o Plataforma:** la infraestructura tecnológica descripta en estos Términos, junto con sus operadores.

**Cliente:** la persona humana o jurídica que publica una solicitud de transporte de carga en la Plataforma.

**Transportista o Chofer:** la persona humana o jurídica independiente que ofrece y presta servicios de transporte por cuenta propia a través de la Plataforma.

**Usuario:** toda persona con una cuenta activa en TILA, sea en carácter de Cliente o de Transportista.

**Viaje o Carga:** la solicitud de transporte publicada por un Cliente y aceptada por un Transportista.

**Proveedor de Servicios de Pago o Pasarela de Pagos:** la entidad externa habilitada que procesa los pagos, cobros y liquidaciones vinculados con los Viajes. TILA podrá cambiar de Proveedor de Servicios de Pago sin que ello requiera modificar estos Términos, en tanto se mantengan las condiciones esenciales aquí descriptas.

**Registro de liquidaciones o Billetera:** la sección de la Plataforma donde se muestran los movimientos, comisiones e importes vinculados con los Viajes de un Transportista. No constituye una cuenta bancaria ni una cuenta de pago operada por TILA.

**Contrato de Adhesión:** el Contrato de Adhesión para Transportistas Independientes, documento separado y adicional a estos Términos, aplicable exclusivamente a los Usuarios que operan como Transportistas.

## 3. Naturaleza e intervención de la plataforma

TILA es una plataforma tecnológica de intermediación logística. Su función es conectar a Clientes y Transportistas, y poner a disposición las herramientas necesarias para publicar, coordinar, monitorear y documentar los Viajes.

TILA no es una empresa de transporte, no presta el servicio de transporte, no es propietaria ni operadora de los vehículos utilizados, y no sustituye al Transportista en el cumplimiento de las obligaciones legales propias de la actividad de transporte.

Cuando un Transportista acepta la solicitud de un Cliente, se celebra un contrato de transporte entre ambos, conforme a las condiciones informadas para ese Viaje y a la normativa aplicable. TILA no es parte de ese contrato de transporte.

TILA podrá facilitar herramientas de comunicación, geolocalización, procesamiento de pagos, gestión de reclamos y registro de evidencias. Ninguna de estas funciones convierte por sí misma a TILA en transportista, empleadora, mandataria general, aseguradora ni garante universal de las obligaciones de los Usuarios.

## 4. Registro, cuenta y seguridad

Para operar en TILA es obligatorio crear una cuenta con datos verídicos y mantenerlos actualizados. El Usuario es responsable de la confidencialidad de sus credenciales y de toda actividad realizada desde su cuenta.

TILA podrá verificar la identidad de los Usuarios y rechazar, condicionar o suspender el acceso a una cuenta cuando existan motivos razonables para hacerlo, conforme al procedimiento descripto en la Sección 23.

Los Transportistas deben completar el proceso de validación documental descripto en el Contrato de Adhesión antes de poder aceptar Viajes.

## 5. Requisitos para clientes

Para publicar una carga, el Cliente debe:

- Contar con una cuenta activa y datos de contacto verídicos.
- Describir la carga de forma completa y veraz, conforme a la Sección 7.
- Contar con un método de pago habilitado a través de la Pasarela de Pagos, cuando corresponda.
- Coordinar razonablemente el retiro y la entrega de la carga con el Transportista asignado.
- Cumplir las condiciones informadas al momento de publicar y aceptar cada Viaje.

## 6. Requisitos para transportistas

Para operar como Transportista, además de cumplir con estos Términos, es obligatorio leer y aceptar expresamente el Contrato de Adhesión, y mantener vigente la documentación habilitante allí exigida.

Las condiciones específicas de independencia, responsabilidad, documentación, seguros, GPS y demás obligaciones propias de la actividad de transporte están reguladas en el Contrato de Adhesión y no se repiten en estos Términos.

## 7. Publicación y descripción de cargas

El Cliente es responsable de describir la carga con información completa y veraz, incluyendo naturaleza, cantidad, peso, dimensiones, y cualquier característica relevante para su transporte (fragilidad, peligrosidad, necesidad de refrigeración, permisos especiales, entre otras).

La información publicada es la base sobre la cual el Transportista decide si acepta o no el Viaje. Si al momento del retiro la carga difiere sustancialmente de lo declarado, se aplica lo dispuesto en el Contrato de Adhesión respecto del derecho del Transportista a rechazar justificadamente el traslado.

## 8. Formación de la contratación del transporte

La Plataforma muestra al Transportista la información esencial de cada Viaje disponible antes de su aceptación, incluyendo lugar de retiro, lugar de entrega, características declaradas de la carga, tipo de vehículo requerido, y el precio o mecanismo para determinarlo.

La aceptación del Viaje por parte del Transportista es voluntaria y perfecciona el contrato de transporte entre el Cliente y el Transportista, en los términos informados para ese Viaje. TILA no es parte de dicho contrato ni garante de su cumplimiento, sin perjuicio de las responsabilidades que le correspondan como operadora de la Plataforma conforme a la Sección 18.

## 9. Precio, comisión, pasarela de pago y liquidación

El precio del Viaje y los importes aplicables se informan antes de la aceptación del servicio, salvo conceptos variables que no puedan determinarse anticipadamente y que hayan sido debidamente explicados.

TILA percibe una comisión por sus servicios tecnológicos y de intermediación, conforme a las condiciones informadas para cada operación en la Plataforma. Estas condiciones pueden variar; el importe aplicable es siempre el informado al momento de la operación, y no un porcentaje fijo establecido en este documento.

Los pagos se procesan a través de una Pasarela de Pagos externa. TILA no almacena datos completos de tarjetas ni ofrece por cuenta propia una cuenta bancaria, cuenta de pago o servicio financiero.

El Registro de liquidaciones (Billetera) muestra de forma informativa los movimientos, comisiones e importes correspondientes a cada Transportista. La liquidación de los importes queda sujeta a la confirmación del pago, la finalización del Viaje, las validaciones de la Pasarela de Pagos, y a la existencia de un medio de cobro válido registrado por el Transportista.

Los plazos de procesamiento y transferencia son los informados por la Pasarela de Pagos y por TILA en la Plataforma. TILA no garantiza plazos que dependan exclusivamente de terceros (bancos, billeteras virtuales, la Pasarela de Pagos u organismos públicos).

## 10. Cancelaciones, reembolsos y derecho de arrepentimiento

**Cancelación por el Cliente.** El Cliente puede cancelar un Viaje mientras se encuentre en un estado previo al retiro de la carga, conforme a lo habilitado en la Plataforma. Al cancelar, el Viaje queda en estado "Cancelado por cliente" y deja de estar activo.

Si el Viaje ya había sido pagado al momento de la cancelación, el pago queda marcado para revisión y TILA se pondrá en contacto con el Cliente para resolver la situación. Estos Términos no garantizan un reembolso automático; el tratamiento de cada caso dependerá de las circunstancias, de las políticas de la Pasarela de Pagos y de la normativa aplicable.

**Cancelación por el Transportista.** El Transportista puede cancelar un Viaje ya aceptado mientras se encuentre en un estado previo al retiro de la carga, conforme al Contrato de Adhesión. Al cancelar, el Viaje queda en estado "Cancelado por chofer" y el Transportista se desvincula de él.

La cancelación por el Transportista no vuelve a poner el Viaje a disposición de otros Transportistas de forma automática. Es el Cliente quien decide, mediante una acción expresa en la Plataforma, si republica el Viaje para que vuelva a estar disponible.

**Derecho de arrepentimiento.** Cuando la normativa de protección al consumidor resulte aplicable a la relación entre TILA y el Cliente, el derecho de arrepentimiento se ejercerá en los términos, plazos y excepciones que dicha normativa establezca. Este apartado será precisado con el asesoramiento legal correspondiente en una futura actualización de estos Términos.

## 11. Ejecución del viaje

Una vez aceptado un Viaje, la Plataforma refleja su avance a través de los estados informados por el Transportista y, cuando corresponda, por los datos de geolocalización.

El Cliente y el Transportista deben coordinar razonablemente las condiciones de retiro y entrega conforme a lo informado al momento de la publicación y aceptación del Viaje.

Las obligaciones específicas del Transportista durante la ejecución del Viaje (custodia de la carga, evidencias, comunicación, cumplimiento de la normativa de tránsito, entre otras) están reguladas en el Contrato de Adhesión.

## 12. GPS, ubicación y navegación

Durante los Viajes activos, la Plataforma utiliza datos de geolocalización del dispositivo del Transportista para mostrar el avance del Viaje al Cliente, facilitar la coordinación, y registrar el cumplimiento del servicio.

La Plataforma puede sugerir rutas u ofrecer integración con aplicaciones de navegación de terceros. Estas sugerencias son orientativas; el Transportista conserva la responsabilidad de circular conforme a la normativa de tránsito aplicable, tal como se detalla en el Contrato de Adhesión.

El uso del GPS tiene una finalidad de trazabilidad contractual y de seguridad de la operación, y no implica dirección laboral ni supervisión personal continua del Transportista.

## 13. Chat y comunicaciones

La Plataforma dispone de un canal de mensajería interno entre Clientes, Transportistas y el equipo de soporte de TILA. Las comunicaciones vinculadas a un Viaje quedan almacenadas y pueden ser utilizadas como evidencia ante una disputa o reclamo.

El Usuario acepta que sus mensajes en la Plataforma puedan ser revisados por el equipo de TILA ante un reclamo, conforme a la Política de Privacidad.

## 14. Evidencias de retiro y entrega

El Transportista registra evidencias (fotográficas y de otro tipo) del estado de la carga al momento del retiro y de la entrega, conforme a lo detallado en el Contrato de Adhesión.

Estas evidencias quedan almacenadas en la Plataforma y son accesibles para el Cliente, el Transportista involucrado y el administrador de TILA, y pueden ser utilizadas para resolver reclamos o ante un requerimiento de autoridad competente.

## 15. Mercadería permitida y prohibida

Queda prohibido publicar o transportar cargas que constituyan sustancias ilegales, armas, explosivos, material biológico peligroso, o cualquier bien cuyo transporte esté vedado por la legislación argentina.

Las cargas que requieran condiciones especiales (dinero en efectivo, documentos de valor, obras de arte, medicamentos controlados, mercadería frágil o que requiera refrigeración, entre otras) deben declararse expresamente al publicar el Viaje, y pueden requerir condiciones adicionales o autorización previa de TILA.

El Cliente es responsable de la veracidad de la descripción de la carga, conforme a la Sección 7.

## 16. Documentación de vehículos y transportistas

Para operar en TILA, el Transportista debe mantener vigente la documentación habilitante propia y de su vehículo (identificación personal, licencia de conducir, documentación del vehículo, seguro, verificación técnica vehicular, y toda otra documentación exigida por la normativa aplicable).

El detalle completo de la documentación exigida, sus condiciones de vigencia y las consecuencias de su vencimiento están regulados en el Contrato de Adhesión, al cual se remite este apartado.

## 17. Responsabilidad propia del transportista

El Transportista presta el servicio de transporte como prestador independiente, por su cuenta y riesgo, sin que exista relación de dependencia laboral con TILA.

Las condiciones de independencia, la responsabilidad del Transportista sobre la custodia y el estado de la carga, y las demás obligaciones propias de su actividad están reguladas de forma completa en el Contrato de Adhesión. Estos Términos no las repiten; ante cualquier divergencia en esta materia específica, prevalece lo dispuesto en el Contrato de Adhesión.

## 18. Responsabilidades y límites razonables de TILA

TILA responde por las obligaciones que legalmente le correspondan como operadora de la Plataforma, y por los daños que resulten directamente imputables a su propia conducta, dentro de los límites que la legislación aplicable permita.

TILA no es responsable por: el incumplimiento del contrato de transporte entre Cliente y Transportista; el estado mecánico del vehículo; la conducción del Transportista; la veracidad de la información suministrada por los Usuarios; ni por hechos exclusivamente atribuibles a terceros ajenos a la Plataforma.

Ninguna disposición de estos Términos excluye responsabilidades que la legislación considere inderogables, ni derechos que no puedan ser renunciados por los consumidores.

## 19. Fuerza mayor

Ninguna de las partes será responsable por el incumplimiento de sus obligaciones cuando este resulte de un caso fortuito o de fuerza mayor, entendiendo por tal todo hecho imprevisible o inevitable, ajeno a su control razonable, incluyendo —sin limitarse a— fallas de infraestructura de terceros, cortes de servicios de telecomunicaciones o de internet, desastres naturales, actos de autoridad pública, conflictos sociales o cualquier otro evento de similares características.

Cuando un evento de fuerza mayor afecte un Viaje en curso, el Cliente y el Transportista deben utilizar los medios razonablemente disponibles para proteger la carga, mantener la comunicación y documentar la situación en la Plataforma.

## 20. Obligaciones del cliente

Además de lo dispuesto en la Sección 5, el Cliente se obliga a:

- Actuar de buena fe y con veracidad en toda la información que suministre.
- Abonar el precio del Viaje en las condiciones informadas.
- Tratar con respeto al Transportista y a cualquier otra persona interviniente en el Viaje.
- No solicitar ni acordar el transporte de cargas prohibidas conforme a la Sección 15.
- No intentar eludir el cobro de la comisión de TILA acordando el pago del servicio por fuera de la Plataforma para un Viaje originado en ella.

## 21. Reclamos, incidentes, daños y seguros

Ante un reclamo, incidente o disputa vinculado a un Viaje, el Usuario afectado debe informarlo a través de los canales de soporte de la Plataforma, aportando la evidencia disponible.

TILA puede administrar un procedimiento de revisión interno para evaluar reclamos, incluyendo la retención preventiva de importes directamente vinculados a la operación cuestionada, en los términos detallados en el Contrato de Adhesión para el caso de los Transportistas.

La contratación de seguros sobre la carga o el vehículo es responsabilidad de la parte que corresponda conforme a lo acordado para cada Viaje o conforme al Contrato de Adhesión. TILA no actúa como aseguradora ni garantiza cobertura alguna sobre la carga o el vehículo.

## 22. Calificaciones y reputación

TILA podrá incorporar en el futuro un sistema de calificaciones entre Cliente y Transportista, con el fin de fortalecer la confianza dentro de la Plataforma. Esta funcionalidad no se encuentra implementada a la fecha de esta versión de los Términos.

Si en el futuro se implementa, una calificación baja considerada de forma aislada no generará automáticamente una sanción o restricción de la cuenta. Podrá ser considerada junto con otros elementos (reclamos documentados, incidentes verificables) conforme al procedimiento de la Sección 23.

## 23. Suspensión, bloqueo y cierre de cuentas

TILA puede restringir, suspender o dar de baja una cuenta ante incumplimientos de estos Términos, riesgos de seguridad, fraude, documentación inválida o vencida, o cualquier otra causa razonablemente vinculada al uso indebido de la Plataforma.

Cuando exista un riesgo inmediato (cuenta comprometida, fraude, documentación falsa, entre otros), la restricción puede aplicarse preventivamente y sin aviso previo, debiendo revisarse y notificarse tan pronto como sea razonablemente posible. En los demás casos, TILA procurará informar los hechos atribuidos y dar oportunidad de descargo antes de decidir.

Para los Transportistas, el procedimiento detallado de restricción preventiva, restricción ordinaria y baja definitiva está regulado en el Contrato de Adhesión, al cual se remite este apartado.

## 24. Propiedad intelectual

TILA conserva todos los derechos sobre su software, marca, diseño, bases de datos, documentación y demás contenidos y funcionalidades de la Plataforma.

La aceptación de estos Términos otorga al Usuario un permiso personal, limitado, revocable y no exclusivo para utilizar la Plataforma conforme a su finalidad. El Usuario no puede copiar, vender, licenciar, descompilar ni explotar indebidamente el software, salvo en los casos permitidos por normas imperativas.

## 25. Uso prohibido y prevención de fraude

Queda prohibido: presentar documentación falsa o adulterada; suplantar identidades o permitir que un tercero no autorizado opere una cuenta ajena; manipular la geolocalización o las evidencias registradas en la Plataforma; utilizar la Plataforma para actividades ilícitas, fraude o lavado de activos; acceder sin autorización a cuentas o sistemas de TILA; e intentar eludir el cobro de la comisión de TILA respecto de operaciones originadas en la Plataforma.

Las infracciones se evalúan según su gravedad, reiteración, evidencia disponible, y el daño o riesgo generado, conforme al procedimiento de la Sección 23.

## 26. Protección de datos y remisión a la Política de Privacidad

El tratamiento de los datos personales de los Usuarios se rige por la Política de Privacidad de TILA, disponible en la Plataforma, que forma parte integral de estos Términos.

La Política de Privacidad detalla qué datos se recolectan, con qué finalidad, por cuánto tiempo se conservan y cómo pueden ejercerse los derechos de acceso, rectificación, cancelación y oposición conforme a la normativa argentina de protección de datos personales.

## 27. Notificaciones electrónicas

Las comunicaciones entre TILA y el Usuario pueden realizarse mediante avisos dentro de la Plataforma, correo electrónico registrado, notificaciones push, o cualquier otro canal habilitado.

El Usuario debe mantener actualizados sus datos de contacto. Las comunicaciones relativas a restricciones de cuenta, pagos, reclamos o cambios sustanciales a estos Términos se realizarán por un medio que permita conservar evidencia razonable de su envío.

## 28. Vigencia, modificaciones y nueva aceptación

Estos Términos entran en vigencia desde su aceptación electrónica y permanecen vigentes mientras la cuenta del Usuario se encuentre activa.

TILA puede actualizar estos Términos por razones legales, operativas, de seguridad o de evolución de la Plataforma. Los cambios se informarán dentro de la Plataforma con anticipación razonable.

Cuando la modificación sea sustancial y afecte derechos, obligaciones, comisiones, pagos, responsabilidades o el tratamiento de datos personales, TILA solicitará una nueva aceptación expresa de la versión actualizada antes de que el Usuario pueda seguir utilizando las funcionalidades afectadas. El uso continuado de la Plataforma no sustituye la aceptación expresa cuando esta resulte necesaria.

La Plataforma conserva evidencia de la versión de estos Términos aceptada por cada Usuario, junto con la fecha, hora y demás datos técnicos razonablemente necesarios para acreditar el consentimiento.

## 29. Legislación aplicable, consumidor y jurisdicción

Estos Términos se rigen por las leyes de la República Argentina.

Cuando el Cliente revista la condición de consumidor o usuario en los términos de la Ley de Defensa del Consumidor N° 24.240, se aplicarán además las disposiciones protectorias de dicha normativa, que prevalecen sobre cualquier cláusula de estos Términos que resultara incompatible con ellas.

Las controversias se resuelven ante los tribunales competentes según la naturaleza del vínculo, el domicilio de las partes y las normas procesales aplicables. Cuando la legislación permita pactar jurisdicción y no exista un fuero inderogable, las partes podrán someterse a los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires, sin perjuicio de los fueros de consumidor u otros que resulten obligatorios.

Si alguna disposición de estos Términos fuera declarada inválida o inaplicable, las restantes continuarán plenamente vigentes.

## 30. Contacto

Para consultas sobre estos Términos: [legal@tilalogistica.com](mailto:legal@tilalogistica.com)`,
};
