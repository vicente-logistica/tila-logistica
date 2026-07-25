import type { DocumentoLegalFuente } from "../tipos";

// Extraído fielmente de app/privacidad/page.tsx (versión vigente en
// producción al momento de esta extracción). Sin resumir, corregir ni
// modernizar — solo se cambió la representación técnica (de JSX a texto
// plano/Markdown) para separar el contenido legal de la presentación visual.

export const documento: DocumentoLegalFuente = {
  tipoDocumento: "privacidad",
  version: "2025-06",
  titulo: "Política de Privacidad — TILA",
  contenido: `Última actualización: Junio 2025

TILA (Tecnología Inteligente Logística Argentina) trata los datos personales de sus usuarios con absoluto respeto a la Ley de Protección de los Datos Personales N° 25.326 de la República Argentina. Esta política describe qué datos recolectamos, con qué finalidad, cómo los protegemos y cuáles son sus derechos.

## 1. Datos recolectados

Recolectamos los siguientes tipos de datos:

- **Datos de identificación:** nombre y apellido, DNI, CUIT/CUIL, correo electrónico, número de teléfono.
- **Datos de vehículo (transportistas):** patente, tipo de vehículo, marca, modelo, año, categoría legal.
- **Datos de pago:** alias CBU/CVU, banco o billetera virtual, titular de cuenta. No almacenamos datos de tarjetas de crédito o débito.
- **Datos operativos:** origen y destino de viajes, tipo y descripción de carga, precios, estado del viaje, historial de servicios.
- **Datos técnicos:** dirección IP, tipo de dispositivo, sistema operativo, navegador, logs de acceso y actividad en la plataforma.

## 2. Finalidades del tratamiento

Los datos son tratados exclusivamente para:

- Prestar el servicio de intermediación logística.
- Verificar la identidad y documentación de los transportistas.
- Procesar y liquidar pagos.
- Gestionar disputas y reclamos.
- Cumplir obligaciones legales y requerimientos de autoridades competentes.
- Mejorar la calidad y seguridad del servicio.
- Comunicar cambios en la plataforma o en los términos.

No vendemos, cedemos ni comercializamos datos personales a terceros con fines de marketing.

## 3. Datos de ubicación GPS

Durante los viajes activos, la plataforma recolecta datos de geolocalización del dispositivo del transportista en tiempo real. Estos datos son utilizados para:

- Mostrar al cliente la posición del vehículo en el mapa.
- Registrar el trayecto realizado como evidencia del servicio.
- Calcular velocidad y tiempos estimados.

Los datos de ubicación se almacenan durante el viaje y quedan asociados al registro del mismo. El transportista puede desactivar la ubicación en cualquier momento, lo que afectará la visibilidad del tracking para el cliente.

## 4. Documentación de transportistas

Los transportistas suben al sistema copias de documentos identificatorios y habilitantes (DNI, licencia, VTV/RTO, seguro, cédula verde, certificado de antecedentes penales). Estos documentos son tratados con máxima confidencialidad y son accesibles únicamente por el equipo de validación de TILA y, cuando sea requerido, por autoridades competentes.

Los documentos son conservados durante la vigencia de la cuenta y por el período adicional que exija la normativa aplicable.

## 5. Evidencias fotográficas

Las fotografías subidas como evidencia de retiro y entrega de cargas quedan almacenadas en los servidores de TILA y son accesibles por el cliente, el transportista y el administrador de la plataforma. Pueden ser utilizadas en procesos de reclamo o ante requerimiento judicial.

## 6. Mensajes y chats

El contenido de los chats internos de la plataforma (entre clientes y transportistas, y con el soporte de TILA) es almacenado y forma parte del registro auditable del viaje. Estos mensajes pueden ser revisados por el equipo de TILA ante disputas o reclamos, y suministrados a autoridades ante requerimiento formal.

## 7. Datos de pagos

Los pagos son procesados por **Mercado Pago**. TILA recibe confirmación del resultado del pago y el identificador de la transacción, pero no tiene acceso a los datos de instrumentos de pago del cliente (tarjetas, cuentas bancarias). Los datos de pago son tratados conforme a la política de privacidad de Mercado Pago.

## 8. Logs técnicos

La plataforma registra automáticamente eventos técnicos como intentos de acceso, errores de sistema, llamadas a la API y actividad del usuario. Estos registros se utilizan exclusivamente para mantenimiento, seguridad y diagnóstico técnico.

## 9. Conservación de datos

Los datos personales son conservados durante la vigencia de la cuenta del usuario y por un período mínimo de **5 años** tras su baja, o el tiempo que exija la normativa fiscal, laboral o judicial aplicable. Transcurrido ese plazo, los datos son anonimizados o eliminados de forma segura.

## 10. Derechos ARCO — Ley 25.326

Conforme a la Ley 25.326, el titular de los datos personales tiene derecho a:

- **Acceso:** conocer qué datos personales propios almacena TILA.
- **Rectificación:** corregir datos inexactos o desactualizados.
- **Cancelación:** solicitar la eliminación de datos cuando ya no sean necesarios.
- **Oposición:** oponerse al tratamiento de sus datos en determinadas circunstancias.

Para ejercer estos derechos, enviar una solicitud escrita a: legal@tilalogistica.com indicando nombre completo, DNI y el derecho que desea ejercer. La solicitud será respondida dentro del plazo legal vigente.

La Dirección Nacional de Protección de Datos Personales (DNPDP) es el organismo de control en la materia.

## 11. Seguridad de los datos

TILA implementa medidas técnicas y organizativas para proteger los datos personales contra acceso no autorizado, pérdida, alteración o divulgación. Sin embargo, ningún sistema es 100% seguro. Ante una brecha de seguridad que afecte datos personales, TILA notificará a los usuarios afectados conforme a la normativa vigente.

## 12. Modificaciones a esta política

TILA puede modificar esta Política de Privacidad. Los cambios serán publicados en esta página con indicación de la fecha de actualización. El uso continuado de la plataforma tras la publicación de los cambios implica su aceptación.

## 13. Contacto

Para consultas sobre privacidad y protección de datos personales: legal@tilalogistica.com

Jurisdicción: República Argentina.`,
};
