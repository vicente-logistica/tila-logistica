import Link from "next/link";

export const metadata = {
  title: "Contrato de Adhesión para Transportistas Independientes — TILA",
  description: "Contrato de adhesión para transportistas independientes que operan en la plataforma TILA.",
};

export default function ContratoTransportistaPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        <Link href="/" className="text-zinc-500 hover:text-yellow-400 text-sm">← Inicio</Link>

        <h1 className="text-3xl md:text-4xl font-black text-yellow-400 mt-4">
          Contrato de Adhesión para Transportistas Independientes
        </h1>

        <div className="bg-zinc-900 border border-yellow-400/30 rounded-2xl p-5 text-sm text-zinc-300 leading-relaxed">
          <p className="font-black text-yellow-400 mb-2">Importante — leé esto antes de registrarte</p>
          <p>Este contrato forma parte integral de los <Link href="/terminos" className="text-yellow-400 hover:underline">Términos y Condiciones de TILA</Link>. Al registrarte como transportista y aceptar los términos durante el registro, estás aceptando también las condiciones específicas de este contrato. Si no estás de acuerdo con alguna de estas cláusulas, no completes el registro.</p>
        </div>

        <p className="text-zinc-400 text-sm">Última actualización: Junio 2025</p>

        <Section titulo="1. Relación entre las partes — No relación laboral">
          <p>El transportista registrado en TILA actúa en todo momento como <strong className="text-white">prestador independiente de servicios de transporte</strong>. No existe entre el transportista y TILA ninguna relación de dependencia laboral, ni relación de empleo, ni sociedad de hecho.</p>
          <p className="mt-2">TILA no es empleadora del transportista. No está obligada a pagar cargas sociales, aportes previsionales, indemnizaciones laborales ni ninguna otra prestación propia de una relación de dependencia.</p>
          <p className="mt-2">El transportista reconoce expresamente esta condición al aceptar el presente contrato.</p>
        </Section>

        <Section titulo="2. Carácter independiente — Obligaciones del transportista">
          <p>Como transportista independiente, sos el único responsable de:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Inscribirte y mantenerte al día en AFIP (monotributo o responsable inscripto según corresponda).</li>
            <li>Emitir los comprobantes fiscales que la normativa exija.</li>
            <li>Pagar los impuestos que correspondan a tus ingresos como autónomo.</li>
            <li>Mantener vigente el seguro de responsabilidad civil de tu vehículo.</li>
            <li>Contratar y mantener un seguro de carga si el tipo de mercadería lo requiere.</li>
            <li>Cumplir toda la normativa de tránsito, transporte y seguridad vial vigente.</li>
          </ul>
        </Section>

        <Section titulo="3. Responsabilidad sobre la carga">
          <p>Desde el momento en que retirás la carga hasta su entrega, sos el único responsable de su custodia, integridad y seguridad. Cualquier pérdida, daño, robo o deterioro ocurrido durante el transporte es de tu exclusiva responsabilidad, salvo que puedas acreditar fehacientemente que el daño preexistía al retiro.</p>
          <p className="mt-2">TILA no cubre ni garantiza daños a la mercadería. Te recomendamos contratar un seguro de carga apropiado para cada tipo de servicio.</p>
          <p className="mt-2">Las evidencias fotográficas de retiro y entrega son tu principal herramienta de defensa ante reclamos. Subílas siempre a la plataforma.</p>
        </Section>

        <Section titulo="4. Prohibición de elusión de la plataforma">
          <p>Queda absolutamente prohibido acordar con los clientes de TILA el pago de servicios por fuera de la plataforma con la intención de evadir las comisiones. Esta conducta constituye una violación grave del presente contrato y dará lugar a la suspensión inmediata de la cuenta y a la retención de los fondos disponibles en la billetera.</p>
          <p className="mt-2">Del mismo modo, está prohibido utilizar los datos de contacto de los clientes obtenidos a través de TILA para ofrecerles servicios de transporte por canales ajenos a la plataforma.</p>
        </Section>

        <Section titulo="5. Documentación obligatoria y su vigencia">
          <p>Para operar en TILA debés mantener vigente y en condiciones la siguiente documentación:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong className="text-white">DNI</strong> frente y dorso.</li>
            <li><strong className="text-white">Licencia de conducir</strong> habilitante para la categoría del vehículo.</li>
            <li><strong className="text-white">Cédula verde</strong> del vehículo.</li>
            <li><strong className="text-white">Seguro de responsabilidad civil</strong> vigente.</li>
            <li><strong className="text-white">VTV / RTO</strong> vigente.</li>
            <li><strong className="text-white">Certificado de antecedentes penales</strong> vigente.</li>
          </ul>
          <p className="mt-2">El vencimiento de cualquiera de estos documentos puede generar la suspensión automática de tu cuenta hasta que presentes la documentación actualizada. TILA se reserva el derecho de rechazar documentación que considere ilegible, adulterada o inválida.</p>
        </Section>

        <Section titulo="6. GPS, tracking y evidencias durante el viaje">
          <p>Al aceptar un viaje, te comprometés a:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Mantener activa la ubicación GPS durante todo el trayecto para que el cliente pueda hacer seguimiento.</li>
            <li>Fotografiar el estado de la carga al momento del retiro y de la entrega, y subir esas imágenes a la plataforma.</li>
            <li>Actualizar el estado del viaje en la plataforma conforme avanzan las etapas.</li>
            <li>Notificar al cliente a través del chat interno ante cualquier novedad.</li>
          </ul>
          <p className="mt-2">El incumplimiento reiterado de estas obligaciones puede ser causal de suspensión.</p>
        </Section>

        <Section titulo="7. Billetera y liquidación de pagos">
          <p>Una vez finalizado el viaje y confirmado el pago por parte del cliente, el importe correspondiente al <strong className="text-white">pago_chofer</strong> se acredita en tu billetera virtual dentro de la plataforma.</p>
          <p className="mt-2">Para solicitar la liquidación, debés tener registrado un método de cobro válido (alias CBU/CVU, banco o billetera digital) y el saldo mínimo que la plataforma establezca.</p>
          <p className="mt-2">TILA se reserva un plazo de procesamiento de hasta <strong className="text-white">5 días hábiles</strong> desde la solicitud de retiro. Los fondos pueden retenerse preventivamente ante reclamos activos o indicios de fraude.</p>
        </Section>

        <Section titulo="8. Suspensión por fraude o documentación vencida">
          <p>Tu cuenta puede ser suspendida de forma inmediata, sin notificación previa, ante cualquiera de los siguientes supuestos:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Documentación vencida, inválida o adulterada.</li>
            <li>Manipulación de la ubicación GPS.</li>
            <li>Acuerdo de pagos por fuera de la plataforma.</li>
            <li>Reclamos graves de clientes con evidencia suficiente.</li>
            <li>Calificaciones reiteradamente bajas que afecten la confianza en la plataforma.</li>
            <li>Cualquier conducta que TILA considere fraudulenta, abusiva o contraria a estos términos.</li>
          </ul>
          <p className="mt-2">Durante la suspensión, los fondos en billetera quedarán retenidos hasta que se resuelva la situación. En caso de fraude comprobado, TILA puede proceder a la baja definitiva de la cuenta y retener los fondos hasta cubrir los daños causados.</p>
        </Section>

        <Section titulo="9. Modificaciones al contrato">
          <p>TILA puede actualizar este contrato. Las modificaciones serán notificadas dentro de la plataforma. El uso continuado del servicio tras la entrada en vigencia de los cambios implica la aceptación de las nuevas condiciones.</p>
        </Section>

        <Section titulo="10. Jurisdicción">
          <p>Ante cualquier controversia derivada de este contrato, las partes se someten a la jurisdicción de los Tribunales Ordinarios de la Ciudad Autónoma de Buenos Aires, con renuncia a todo otro fuero.</p>
        </Section>

        <div className="border-t border-zinc-800 pt-6 text-zinc-500 text-sm space-y-1">
          <p>TILA — Tecnología Inteligente Logística Argentina</p>
          <div className="flex flex-wrap gap-4 mt-3">
            <Link href="/terminos" className="text-yellow-400 hover:underline">Términos y Condiciones</Link>
            <Link href="/privacidad" className="text-yellow-400 hover:underline">Política de Privacidad</Link>
            <Link href="/" className="hover:text-white">Inicio</Link>
          </div>
        </div>

      </div>
    </main>
  );
}

function Section({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-black text-yellow-400 mb-2">{titulo}</h2>
      <div className="text-zinc-300 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
