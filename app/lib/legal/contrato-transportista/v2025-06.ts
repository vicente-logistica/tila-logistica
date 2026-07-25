import type { DocumentoLegalFuente } from "../tipos";

// Extraído fielmente de app/contrato-transportista/page.tsx (versión vigente
// en producción al momento de esta extracción). Sin resumir, corregir ni
// modernizar — solo se cambió la representación técnica (de JSX a texto
// plano/Markdown) para separar el contenido legal de la presentación visual.

export const documento: DocumentoLegalFuente = {
  tipoDocumento: "contrato_transportista",
  version: "2025-06",
  titulo: "Contrato de Adhesión para Transportistas Independientes",
  contenido: `**Importante — leé esto antes de registrarte**

Este contrato forma parte integral de los Términos y Condiciones de TILA. Al registrarte como transportista y aceptar los términos durante el registro, estás aceptando también las condiciones específicas de este contrato. Si no estás de acuerdo con alguna de estas cláusulas, no completes el registro.

Última actualización: Junio 2025

## 1. Relación entre las partes — No relación laboral

El transportista registrado en TILA actúa en todo momento como **prestador independiente de servicios de transporte**. No existe entre el transportista y TILA ninguna relación de dependencia laboral, ni relación de empleo, ni sociedad de hecho.

TILA no es empleadora del transportista. No está obligada a pagar cargas sociales, aportes previsionales, indemnizaciones laborales ni ninguna otra prestación propia de una relación de dependencia.

El transportista reconoce expresamente esta condición al aceptar el presente contrato.

## 2. Carácter independiente — Obligaciones del transportista

Como transportista independiente, sos el único responsable de:

- Inscribirte y mantenerte al día en AFIP (monotributo o responsable inscripto según corresponda).
- Emitir los comprobantes fiscales que la normativa exija.
- Pagar los impuestos que correspondan a tus ingresos como autónomo.
- Mantener vigente el seguro de responsabilidad civil de tu vehículo.
- Contratar y mantener un seguro de carga si el tipo de mercadería lo requiere.
- Cumplir toda la normativa de tránsito, transporte y seguridad vial vigente.

## 3. Responsabilidad sobre la carga

Desde el momento en que retirás la carga hasta su entrega, sos el único responsable de su custodia, integridad y seguridad. Cualquier pérdida, daño, robo o deterioro ocurrido durante el transporte es de tu exclusiva responsabilidad, salvo que puedas acreditar fehacientemente que el daño preexistía al retiro.

TILA no cubre ni garantiza daños a la mercadería. Te recomendamos contratar un seguro de carga apropiado para cada tipo de servicio.

Las evidencias fotográficas de retiro y entrega son tu principal herramienta de defensa ante reclamos. Subílas siempre a la plataforma.

## 4. Prohibición de elusión de la plataforma

Queda absolutamente prohibido acordar con los clientes de TILA el pago de servicios por fuera de la plataforma con la intención de evadir las comisiones. Esta conducta constituye una violación grave del presente contrato y dará lugar a la suspensión inmediata de la cuenta y a la retención de los fondos disponibles en la billetera.

Del mismo modo, está prohibido utilizar los datos de contacto de los clientes obtenidos a través de TILA para ofrecerles servicios de transporte por canales ajenos a la plataforma.

## 5. Documentación obligatoria y su vigencia

Para operar en TILA debés mantener vigente y en condiciones la siguiente documentación:

- **DNI** frente y dorso.
- **Licencia de conducir** habilitante para la categoría del vehículo.
- **Cédula verde** del vehículo.
- **Seguro de responsabilidad civil** vigente.
- **VTV / RTO** vigente.
- **Certificado de antecedentes penales** vigente.

El vencimiento de cualquiera de estos documentos puede generar la suspensión automática de tu cuenta hasta que presentes la documentación actualizada. TILA se reserva el derecho de rechazar documentación que considere ilegible, adulterada o inválida.

## 6. GPS, tracking y evidencias durante el viaje

Al aceptar un viaje, te comprometés a:

- Mantener activa la ubicación GPS durante todo el trayecto para que el cliente pueda hacer seguimiento.
- Fotografiar el estado de la carga al momento del retiro y de la entrega, y subir esas imágenes a la plataforma.
- Actualizar el estado del viaje en la plataforma conforme avanzan las etapas.
- Notificar al cliente a través del chat interno ante cualquier novedad.

El incumplimiento reiterado de estas obligaciones puede ser causal de suspensión.

## 7. Billetera y liquidación de pagos

Una vez finalizado el viaje y confirmado el pago por parte del cliente, el importe correspondiente al **pago_chofer** se acredita en tu billetera virtual dentro de la plataforma.

Para solicitar la liquidación, debés tener registrado un método de cobro válido (alias CBU/CVU, banco o billetera digital) y el saldo mínimo que la plataforma establezca.

TILA se reserva un plazo de procesamiento de hasta **5 días hábiles** desde la solicitud de retiro. Los fondos pueden retenerse preventivamente ante reclamos activos o indicios de fraude.

## 8. Suspensión por fraude o documentación vencida

Tu cuenta puede ser suspendida de forma inmediata, sin notificación previa, ante cualquiera de los siguientes supuestos:

- Documentación vencida, inválida o adulterada.
- Manipulación de la ubicación GPS.
- Acuerdo de pagos por fuera de la plataforma.
- Reclamos graves de clientes con evidencia suficiente.
- Calificaciones reiteradamente bajas que afecten la confianza en la plataforma.
- Cualquier conducta que TILA considere fraudulenta, abusiva o contraria a estos términos.

Durante la suspensión, los fondos en billetera quedarán retenidos hasta que se resuelva la situación. En caso de fraude comprobado, TILA puede proceder a la baja definitiva de la cuenta y retener los fondos hasta cubrir los daños causados.

## 9. Modificaciones al contrato

TILA puede actualizar este contrato. Las modificaciones serán notificadas dentro de la plataforma. El uso continuado del servicio tras la entrada en vigencia de los cambios implica la aceptación de las nuevas condiciones.

## 10. Jurisdicción

Ante cualquier controversia derivada de este contrato, las partes se someten a la jurisdicción de los Tribunales Ordinarios de la Ciudad Autónoma de Buenos Aires, con renuncia a todo otro fuero.`,
};
