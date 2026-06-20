import Link from "next/link";

export const metadata = {
  title: "Términos y Condiciones — TILA",
  description: "Términos y Condiciones de Uso de la plataforma TILA.",
};

export default function TerminosPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        <Link href="/" className="text-zinc-500 hover:text-yellow-400 text-sm">← Inicio</Link>

        <h1 className="text-3xl md:text-4xl font-black text-yellow-400 mt-4">
          Términos y Condiciones de Uso — TILA
        </h1>

        <p className="text-zinc-400 text-sm">Última actualización: Junio 2025</p>

        <Section titulo="1. Naturaleza de la plataforma">
          <p>TILA (Tecnología Inteligente Logística Argentina) es una plataforma tecnológica de intermediación logística que conecta a clientes que necesitan transportar cargas con transportistas independientes (choferes) disponibles para realizar el servicio.</p>
          <p className="mt-2">TILA no es una empresa de transporte ni empleadora de los choferes. Su función es exclusivamente la de intermediación tecnológica, poniendo a disposición la infraestructura digital para coordinar, monitorear y registrar los servicios de flete.</p>
        </Section>

        <Section titulo="2. Definiciones">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">TILA:</strong> la plataforma tecnológica y sus operadores.</li>
            <li><strong className="text-white">Cliente:</strong> persona física o jurídica que publica una solicitud de carga en la plataforma.</li>
            <li><strong className="text-white">Transportista / Chofer:</strong> persona física que presta el servicio de flete de forma independiente.</li>
            <li><strong className="text-white">Usuario:</strong> todo aquel con cuenta activa en TILA, sea cliente o transportista.</li>
            <li><strong className="text-white">Viaje / Carga:</strong> solicitud de servicio de transporte publicada por un cliente y aceptada por un transportista.</li>
          </ul>
        </Section>

        <Section titulo="3. Registro y acceso">
          <p>Para operar en TILA es obligatorio crear una cuenta con datos verídicos. El usuario es responsable de mantener la confidencialidad de sus credenciales. TILA se reserva el derecho de verificar la identidad de los usuarios y rechazar o suspender cuentas sin expresión de causa.</p>
          <p className="mt-2">Los transportistas deben completar un proceso de validación documental antes de poder aceptar viajes. Una cuenta pendiente de validación no puede operar hasta que el administrador la apruebe.</p>
        </Section>

        <Section titulo="4. Procesador de pagos — Mercado Pago">
          <p>Los pagos de los servicios de flete son procesados exclusivamente a través de <strong className="text-white">Mercado Pago</strong>. TILA no almacena datos de tarjetas ni instrumentos de pago. Al utilizar el módulo de pagos, el usuario acepta también los términos y condiciones de Mercado Pago.</p>
          <p className="mt-2">Los montos cobrados se desglosan en: tarifa al cliente (precio_cliente), pago al transportista (pago_chofer) y comisión de la plataforma. Estos valores son visibles para el administrador y aplicables según las condiciones vigentes al momento de la publicación.</p>
        </Section>

        <Section titulo="5. Comisiones, liquidaciones y billetera del chofer">
          <p>TILA cobra una comisión sobre cada viaje finalizado conforme a las tarifas publicadas en la plataforma. El saldo resultante se acredita en la billetera virtual del transportista dentro de la plataforma.</p>
          <p className="mt-2">La liquidación se realiza previa solicitud del transportista, conforme al método de cobro registrado. TILA se reserva un plazo de procesamiento de hasta 5 días hábiles. Los fondos pueden retenerse preventivamente ante reclamos, disputas o indicios de fraude, sin que ello genere derecho a indemnización.</p>
        </Section>

        <Section titulo="6. Contracargos, reclamos y retención preventiva">
          <p>Ante un contracargo iniciado por el cliente o un reclamo por servicio deficiente, TILA puede retener preventivamente los fondos del transportista involucrado hasta tanto se resuelva la disputa. El transportista será notificado y tendrá la posibilidad de presentar evidencias.</p>
          <p className="mt-2">Los reclamos deben presentarse dentro de las 48 horas de finalizado el viaje. TILA actuará como árbitro técnico pero no garantiza un resultado favorable a ninguna de las partes.</p>
        </Section>

        <Section titulo="7. Chat interno como registro auditable">
          <p>La plataforma dispone de un sistema de mensajería interno entre clientes, transportistas y el equipo de soporte. Todas las conversaciones son almacenadas y pueden ser utilizadas como evidencia en disputas. El usuario acepta que sus mensajes sean revisados por el equipo de TILA ante un reclamo.</p>
        </Section>

        <Section titulo="8. Evidencias fotográficas, documentación y comprobantes">
          <p>Los transportistas pueden y deben registrar evidencias fotográficas del estado de la carga al momento del retiro y de la entrega. Estas imágenes quedan almacenadas en la plataforma y son accesibles para el cliente y el administrador. La falta de evidencia puede perjudicar la posición del transportista ante un reclamo.</p>
        </Section>

        <Section titulo="9. GPS, tracking y limitación de responsabilidad">
          <p>TILA ofrece seguimiento GPS en tiempo real de los viajes activos. Esta funcionalidad requiere que el transportista active la ubicación en su dispositivo. TILA no garantiza la disponibilidad continua del servicio de geolocalización ni es responsable por inexactitudes de posicionamiento.</p>
          <p className="mt-2">El tracking es una herramienta de transparencia operativa, no un sistema de control laboral. TILA no garantiza la seguridad de la carga en base a los datos de ubicación.</p>
        </Section>

        <Section titulo="10. Fraude, manipulación y uso indebido">
          <p>Está expresamente prohibido:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Manipular o falsificar la ubicación GPS.</li>
            <li>Presentar documentación falsa o adulterada.</li>
            <li>Intentar eludir el sistema de cobro de TILA acordando pagos por fuera de la plataforma.</li>
            <li>Crear cuentas falsas o múltiples con fines fraudulentos.</li>
            <li>Utilizar la plataforma para actividades ilícitas.</li>
          </ul>
          <p className="mt-2">La detección de cualquiera de estas conductas derivará en la suspensión inmediata de la cuenta y la retención de los fondos disponibles, sin perjuicio de las acciones legales que TILA pueda iniciar.</p>
        </Section>

        <Section titulo="11. Documentación obligatoria del transportista">
          <p>Para operar como transportista en TILA es obligatorio mantener vigente y en regla: DNI, licencia de conducir habilitante, seguro de responsabilidad civil, VTV/RTO, cédula verde del vehículo, certificado de antecedentes penales y toda otra documentación que la normativa vigente exija para el tipo de transporte. El vencimiento o invalidez de cualquier documento puede derivar en la suspensión automática de la cuenta.</p>
        </Section>

        <Section titulo="12. Cargas prohibidas y restricciones">
          <p><strong className="text-white">Cargas prohibidas:</strong> sustancias ilegales, armas, explosivos, material biológico peligroso, y todo bien cuyo transporte esté vedado por la legislación argentina.</p>
          <p className="mt-2"><strong className="text-white">Cargas sensibles:</strong> dinero en efectivo, documentos de valor, obras de arte, medicamentos controlados y cargas que requieran permisos especiales deben declararse explícitamente y pueden requerir autorización previa de TILA.</p>
          <p className="mt-2"><strong className="text-white">Cargas de alto valor:</strong> el seguro de carga es responsabilidad del cliente o del transportista según lo acordado. TILA no cubre pérdidas ni daños a la mercadería.</p>
        </Section>

        <Section titulo="13. Suspensión y baja de cuentas">
          <p>TILA puede suspender o dar de baja una cuenta en forma temporal o definitiva ante: incumplimiento de estos términos, documentación vencida o inválida, comportamiento fraudulento, calificaciones reiteradamente bajas, reclamos graves o resolución propia de la plataforma. El usuario será notificado salvo que razones de seguridad o fraude impidan la comunicación previa.</p>
        </Section>

        <Section titulo="14. Protección de datos personales — Ley 25.326">
          <p>TILA trata los datos personales conforme a la Ley de Protección de los Datos Personales N° 25.326 de la República Argentina. El titular de los datos tiene derecho a acceder, rectificar, actualizar y suprimir su información. Para ejercer estos derechos, debe remitir una solicitud escrita a través de los canales habilitados.</p>
          <p className="mt-2">Véase la <Link href="/privacidad" className="text-yellow-400 hover:underline">Política de Privacidad</Link> para mayor detalle.</p>
        </Section>

        <Section titulo="15. Evidencia digital y conservación de registros">
          <p>TILA conserva los registros de viajes, pagos, chats, evidencias fotográficas y datos de ubicación por un período mínimo de 5 años a partir de la finalización del servicio, o el tiempo que exija la normativa aplicable. Esta información puede ser suministrada a autoridades judiciales o administrativas ante requerimiento formal.</p>
        </Section>

        <Section titulo="16. Fuerza mayor">
          <p>TILA no será responsable por incumplimientos derivados de causas fuera de su control razonable, incluyendo fallas de infraestructura de terceros, cortes de servicio de telecomunicaciones, desastres naturales, actos de autoridad pública o cualquier otro evento de fuerza mayor o caso fortuito.</p>
        </Section>

        <Section titulo="17. Reclamos, mediación y jurisdicción">
          <p>Ante cualquier controversia derivada del uso de la plataforma, las partes se comprometen a intentar una resolución amigable en primera instancia. En caso de no alcanzarse acuerdo, se someterán a mediación previa obligatoria conforme a la ley vigente y, de persistir el conflicto, a la jurisdicción de los Tribunales Ordinarios de la Ciudad Autónoma de Buenos Aires, con renuncia expresa a cualquier otro fuero que pudiera corresponder.</p>
        </Section>

        <Section titulo="18. Modificaciones">
          <p>TILA se reserva el derecho de modificar estos Términos y Condiciones en cualquier momento. Los cambios serán notificados dentro de la plataforma con al menos 10 días de anticipación. El uso continuado de la plataforma tras la vigencia de los nuevos términos implica su aceptación.</p>
        </Section>

        <div className="border-t border-zinc-800 pt-6 text-zinc-500 text-sm space-y-1">
          <p>TILA — Tecnología Inteligente Logística Argentina</p>
          <div className="flex flex-wrap gap-4 mt-3">
            <Link href="/privacidad" className="text-yellow-400 hover:underline">Política de Privacidad</Link>
            <Link href="/contrato-transportista" className="text-yellow-400 hover:underline">Contrato Transportista</Link>
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
