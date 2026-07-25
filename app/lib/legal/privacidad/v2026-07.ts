import type { DocumentoLegalFuente } from "../tipos";

// ⚠️ BORRADOR INTERNO — NO PUBLICAR, NO MARCAR "vigente", NO RECIBIR
// ACEPTACIONES. Contiene placeholders sin completar ([MES Y AÑO DE
// PUBLICACIÓN], [NÚMERO DE VERSIÓN], [RAZÓN SOCIAL DE LA SAS], [CUIT],
// [DOMICILIO LEGAL]). El correo legal@tilalogistica.com y el sitio
// https://www.tilalogistica.com SÍ están confirmados (en uso real en
// app/privacidad/page.tsx) — no son placeholders.

export const documento: DocumentoLegalFuente = {
  tipoDocumento: "privacidad",
  version: "2026-07", // placeholder técnico del nombre de archivo — el texto interno aún dice [NÚMERO DE VERSIÓN]
  titulo: "POLÍTICA DE PRIVACIDAD — TILA",
  contenido: `**Última actualización:** [MES Y AÑO DE PUBLICACIÓN]
**Versión:** [NÚMERO DE VERSIÓN]

## Información importante antes de registrarte

Esta Política de Privacidad, en adelante la "Política", describe cómo TILA — Tecnología Inteligente Logística Argentina trata los datos personales de sus Usuarios, ya sea que actúen como Cliente o como Transportista.

Esta Política forma parte integral de los Términos y Condiciones de Uso de TILA. Cuando el Usuario acepta los Términos, acepta también esta Política.

Los Transportistas están además sujetos al Contrato de Adhesión para Transportistas Independientes, que regula aspectos operativos específicos de su actividad. Esta Política no repite lo ya regulado allí; donde corresponda, remite a ese documento.

La aceptación de esta Política queda registrada electrónicamente junto con la identificación del usuario, la versión aceptada, la fecha, la hora y demás evidencia técnica razonablemente necesaria para acreditar el consentimiento.

## 1. Identificación del responsable del tratamiento

**Razón social:** [RAZÓN SOCIAL DE LA SAS]
**CUIT:** [CUIT]
**Domicilio legal:** [DOMICILIO LEGAL]
**Correo electrónico de contacto:** [legal@tilalogistica.com](mailto:legal@tilalogistica.com)
**Sitio web:** [https://www.tilalogistica.com](https://www.tilalogistica.com)

Hasta que se completen los datos societarios definitivos, estos campos deben mantenerse identificados como pendientes y no deben reemplazarse con información ficticia.

## 2. Alcance de esta Política

Esta Política aplica a todos los Usuarios de la Plataforma, diferenciando cuando corresponda entre Cliente y Transportista.

Los datos tratados y las finalidades varían según el rol del Usuario y según las funcionalidades que efectivamente utilice dentro de la Plataforma.

## 3. Datos que recolectamos

**Datos comunes a todos los Usuarios:**

- Identificación: nombre y apellido, correo electrónico, número de teléfono, DNI.
- Datos técnicos: dirección IP y user-agent del navegador, capturados por el servidor al momento de aceptar los documentos legales de la Plataforma.
- Historial de uso: viajes publicados o realizados, mensajes de chat, calificación de la cuenta ante reclamos.

**Datos adicionales del Cliente:**

- Datos de las cargas publicadas: origen, destino, tipo y descripción de la mercadería, precio.
- Datos de pago: los que resulten necesarios para operar con la Pasarela de Pagos utilizada por la Plataforma. TILA no almacena datos completos de tarjetas ni instrumentos de pago; solo recibe del Proveedor de Servicios de Pago un identificador de la operación, su estado y el monto.

**Datos adicionales del Transportista:**

- Datos fiscales: CUIT/CUIL.
- Datos del vehículo: patente, marca, modelo, año, tipo de vehículo, capacidad.
- Documentación habilitante: DNI, licencia de conducir, certificado de antecedentes penales, cédula verde, seguro, verificación técnica vehicular, y fotografías del vehículo.
- Datos de cobro: alias CBU/CVU, banco o billetera virtual, titular de la cuenta.
- Datos de geolocalización durante los Viajes activos (ver Sección 6).
- Datos técnicos del dispositivo durante un Viaje activo: nivel de batería y si se encuentra cargando.
- Datos operativos: estado y avance de los Viajes, evidencias fotográficas de retiro y entrega, movimientos registrados en la Billetera.

## 4. Origen de los datos

Algunos datos son suministrados directamente por el Usuario (identificación, datos fiscales, datos del vehículo, documentación, datos de cobro).

Otros datos se generan automáticamente por el uso de la Plataforma: geolocalización durante un Viaje activo, nivel de batería del dispositivo, estados del Viaje, mensajes de chat, evidencias fotográficas con su fecha y hora, movimientos de la Billetera, e IP/user-agent al momento de aceptar los documentos legales.

## 5. Finalidades del tratamiento

Los datos son tratados para:

- Permitir el registro y la operación de las cuentas de Cliente y Transportista.
- Verificar la identidad y la documentación habilitante de los Transportistas.
- Publicar, coordinar y realizar el seguimiento de los Viajes.
- Procesar pagos y liquidar los importes correspondientes a cada Transportista.
- Habilitar la comunicación entre Cliente y Transportista, y con el soporte de TILA.
- Registrar evidencias que permitan resolver reclamos o disputas.
- Cumplir obligaciones legales y requerimientos de autoridades competentes.
- Dejar constancia de la aceptación de los documentos legales de la Plataforma.
- Mantener la seguridad y el correcto funcionamiento técnico de la Plataforma.

TILA no vende, cede ni comercializa datos personales a terceros con fines de marketing.

## 6. Geolocalización (GPS)

La Plataforma utiliza datos de geolocalización del dispositivo del Transportista durante los Viajes activos, con el fin de mostrar el avance del Viaje al Cliente, facilitar la coordinación entre las partes y registrar el cumplimiento del servicio.

Antes de aceptar un Viaje, la Plataforma puede solicitar una única lectura puntual de la ubicación del Transportista para mostrar una vista previa del recorrido; esto no implica un seguimiento continuo.

Durante un Viaje activo, la ubicación se actualiza de forma continua mientras el Transportista mantenga la aplicación en uso y la geolocalización habilitada en su dispositivo. Junto con la ubicación, la Plataforma también registra el nivel de batería del dispositivo, con el fin de anticipar posibles interrupciones en el seguimiento del Viaje.

TILA no realiza seguimiento de ubicación fuera de los Viajes activos, y no utiliza los datos de geolocalización para controlar la actividad general o la vida privada del Transportista.

## 7. Documentación y evidencias fotográficas

Los Transportistas suben a la Plataforma copias de su documentación habilitante y fotografías de su vehículo. Durante cada Viaje, también se registran evidencias fotográficas del estado de la carga al momento del retiro y de la entrega.

Estos archivos se almacenan en servicios de almacenamiento en la nube provistos por un tercero (ver Sección 10) y se accede a ellos mediante un enlace correspondiente a cada archivo. TILA no publica estos enlaces ni los comparte con terceros ajenos a la operación o al proceso de validación, pero el Usuario debe tener en cuenta que la seguridad de acceso a estos archivos depende de que dicho enlace no sea difundido, y no de un mecanismo de autenticación adicional. TILA trabaja para reforzar estos controles de acceso.

Las fotografías y demás evidencias son accesibles para el Cliente y el Transportista involucrados en el Viaje correspondiente, y para el equipo de TILA a los fines de validación, soporte y resolución de reclamos.

## 8. Datos de pago y liquidaciones

Los pagos se procesan a través de un Proveedor de Servicios de Pago externo (Pasarela de Pagos). TILA no almacena datos completos de tarjetas ni instrumentos de pago; recibe del Proveedor de Servicios de Pago únicamente un identificador de la operación, su estado y el monto correspondiente.

Los datos de cobro del Transportista (alias, CBU/CVU, banco o billetera virtual, titular de la cuenta) se utilizan exclusivamente para liquidar los importes generados por los Viajes realizados.

## 9. Chat y comunicaciones internas

La Plataforma dispone de un canal de mensajería interno entre Cliente, Transportista y el equipo de soporte de TILA. El contenido de estas comunicaciones se almacena y puede ser utilizado como evidencia ante una disputa o reclamo, o revisado por el equipo de TILA cuando resulte necesario para atenderlo.

## 10. Proveedores tecnológicos

Para operar, TILA utiliza los siguientes proveedores tecnológicos, que tratan datos personales en su carácter de encargados del tratamiento:

- **Infraestructura de base de datos y almacenamiento:** utilizada para almacenar la información descripta en esta Política, incluyendo documentos y fotografías.
- **Plataforma de mapas y geolocalización:** utilizada para calcular rutas, distancias y para el funcionamiento del mapa dentro de la aplicación.
- **Proveedor de Servicios de Pago:** utilizado para procesar los pagos de los Viajes, en los términos descriptos en la Sección 8.
- **Proveedor de hosting:** utilizado para alojar y ejecutar la aplicación.

TILA podrá incorporar o reemplazar proveedores tecnológicos en el futuro, siempre que ello sea compatible con las finalidades descriptas en esta Política.

## 11. Transferencias internacionales

Los proveedores tecnológicos descriptos en la Sección 10 pueden operar con infraestructura ubicada fuera de la República Argentina. En la medida en que esto implique una transferencia internacional de datos personales, TILA procurará que dichos proveedores ofrezcan garantías adecuadas de protección de datos conforme a la normativa aplicable.

## 12. Conservación de los datos

Los datos personales se conservan mientras la cuenta del Usuario se encuentre activa y durante el tiempo adicional que resulte razonablemente necesario para cumplir las finalidades descriptas en esta Política, atender reclamos en trámite, y cumplir las obligaciones legales, fiscales o contables aplicables.

## 13. Seguridad de la información

TILA implementa medidas técnicas y organizativas razonables para proteger los datos personales contra accesos no autorizados, pérdida o alteración. Sin embargo, ningún sistema es completamente seguro. Ante una brecha de seguridad que afecte datos personales, TILA notificará a los Usuarios afectados conforme a la normativa vigente.

## 14. Derechos del titular de los datos

Conforme a la normativa argentina de protección de datos personales, el titular de los datos tiene derecho a acceder, rectificar, actualizar, cancelar y oponerse al tratamiento de su información personal.

Para ejercer estos derechos, el Usuario debe enviar una solicitud escrita a [legal@tilalogistica.com](mailto:legal@tilalogistica.com), indicando nombre completo, DNI y el derecho que desea ejercer. La solicitud será evaluada y respondida por TILA.

La Dirección Nacional de Protección de Datos Personales (DNPDP) es el organismo de control en la materia.

## 15. Relación con los Términos y el Contrato de Adhesión

Esta Política se complementa con los Términos y Condiciones de Uso y, para los Transportistas, con el Contrato de Adhesión para Transportistas Independientes. Ante cualquier divergencia sobre el tratamiento de datos específicamente regulado en alguno de esos documentos, prevalece lo allí dispuesto sobre esta Política, en lo que a esa materia específica se refiere.

## 16. Modificaciones a esta Política

TILA puede actualizar esta Política por razones legales, operativas, de seguridad o de evolución de la Plataforma. Los cambios se informarán dentro de la Plataforma con anticipación razonable.

Cuando la modificación sea sustancial y afecte las finalidades, los datos tratados, los proveedores tecnológicos o los derechos del titular, TILA solicitará una nueva aceptación expresa de la versión actualizada antes de que el Usuario pueda seguir utilizando las funcionalidades afectadas. El uso continuado de la Plataforma no sustituye la aceptación expresa cuando esta resulte necesaria.

La Plataforma conserva evidencia de la versión de esta Política aceptada por cada Usuario, junto con la fecha, hora y demás datos técnicos razonablemente necesarios para acreditar el consentimiento.

Si alguna disposición de esta Política fuera declarada inválida o inaplicable, las restantes continuarán plenamente vigentes.

## 17. Contacto

Para consultas sobre esta Política: [legal@tilalogistica.com](mailto:legal@tilalogistica.com)`,
};
