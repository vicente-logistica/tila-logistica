import Link from "next/link";

export const metadata = {
  title: "Política de Privacidad — TILA",
  description: "Política de Privacidad y tratamiento de datos personales de TILA.",
};

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        <Link href="/" className="text-zinc-500 hover:text-yellow-400 text-sm">← Inicio</Link>

        <h1 className="text-3xl md:text-4xl font-black text-yellow-400 mt-4">
          Política de Privacidad — TILA
        </h1>

        <p className="text-zinc-400 text-sm">Última actualización: Junio 2025</p>

        <p className="text-zinc-300 text-sm leading-relaxed">
          TILA (Tecnología Inteligente Logística Argentina) trata los datos personales de sus usuarios con absoluto respeto a la Ley de Protección de los Datos Personales N° 25.326 de la República Argentina. Esta política describe qué datos recolectamos, con qué finalidad, cómo los protegemos y cuáles son sus derechos.
        </p>

        <Section titulo="1. Datos recolectados">
          <p>Recolectamos los siguientes tipos de datos:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong className="text-white">Datos de identificación:</strong> nombre y apellido, DNI, CUIT/CUIL, correo electrónico, número de teléfono.</li>
            <li><strong className="text-white">Datos de vehículo (transportistas):</strong> patente, tipo de vehículo, marca, modelo, año, categoría legal.</li>
            <li><strong className="text-white">Datos de pago:</strong> alias CBU/CVU, banco o billetera virtual, titular de cuenta. No almacenamos datos de tarjetas de crédito o débito.</li>
            <li><strong className="text-white">Datos operativos:</strong> origen y destino de viajes, tipo y descripción de carga, precios, estado del viaje, historial de servicios.</li>
            <li><strong className="text-white">Datos técnicos:</strong> dirección IP, tipo de dispositivo, sistema operativo, navegador, logs de acceso y actividad en la plataforma.</li>
          </ul>
        </Section>

        <Section titulo="2. Finalidades del tratamiento">
          <p>Los datos son tratados exclusivamente para:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Prestar el servicio de intermediación logística.</li>
            <li>Verificar la identidad y documentación de los transportistas.</li>
            <li>Procesar y liquidar pagos.</li>
            <li>Gestionar disputas y reclamos.</li>
            <li>Cumplir obligaciones legales y requerimientos de autoridades competentes.</li>
            <li>Mejorar la calidad y seguridad del servicio.</li>
            <li>Comunicar cambios en la plataforma o en los términos.</li>
          </ul>
          <p className="mt-2">No vendemos, cedemos ni comercializamos datos personales a terceros con fines de marketing.</p>
        </Section>

        <Section titulo="3. Datos de ubicación GPS">
          <p>Durante los viajes activos, la plataforma recolecta datos de geolocalización del dispositivo del transportista en tiempo real. Estos datos son utilizados para:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Mostrar al cliente la posición del vehículo en el mapa.</li>
            <li>Registrar el trayecto realizado como evidencia del servicio.</li>
            <li>Calcular velocidad y tiempos estimados.</li>
          </ul>
          <p className="mt-2">Los datos de ubicación se almacenan durante el viaje y quedan asociados al registro del mismo. El transportista puede desactivar la ubicación en cualquier momento, lo que afectará la visibilidad del tracking para el cliente.</p>
        </Section>

        <Section titulo="4. Documentación de transportistas">
          <p>Los transportistas suben al sistema copias de documentos identificatorios y habilitantes (DNI, licencia, VTV/RTO, seguro, cédula verde, certificado de antecedentes penales). Estos documentos son tratados con máxima confidencialidad y son accesibles únicamente por el equipo de validación de TILA y, cuando sea requerido, por autoridades competentes.</p>
          <p className="mt-2">Los documentos son conservados durante la vigencia de la cuenta y por el período adicional que exija la normativa aplicable.</p>
        </Section>

        <Section titulo="5. Evidencias fotográficas">
          <p>Las fotografías subidas como evidencia de retiro y entrega de cargas quedan almacenadas en los servidores de TILA y son accesibles por el cliente, el transportista y el administrador de la plataforma. Pueden ser utilizadas en procesos de reclamo o ante requerimiento judicial.</p>
        </Section>

        <Section titulo="6. Mensajes y chats">
          <p>El contenido de los chats internos de la plataforma (entre clientes y transportistas, y con el soporte de TILA) es almacenado y forma parte del registro auditable del viaje. Estos mensajes pueden ser revisados por el equipo de TILA ante disputas o reclamos, y suministrados a autoridades ante requerimiento formal.</p>
        </Section>

        <Section titulo="7. Datos de pagos">
          <p>Los pagos son procesados por <strong className="text-white">Mercado Pago</strong>. TILA recibe confirmación del resultado del pago y el identificador de la transacción, pero no tiene acceso a los datos de instrumentos de pago del cliente (tarjetas, cuentas bancarias). Los datos de pago son tratados conforme a la política de privacidad de Mercado Pago.</p>
        </Section>

        <Section titulo="8. Logs técnicos">
          <p>La plataforma registra automáticamente eventos técnicos como intentos de acceso, errores de sistema, llamadas a la API y actividad del usuario. Estos registros se utilizan exclusivamente para mantenimiento, seguridad y diagnóstico técnico.</p>
        </Section>

        <Section titulo="9. Conservación de datos">
          <p>Los datos personales son conservados durante la vigencia de la cuenta del usuario y por un período mínimo de <strong className="text-white">5 años</strong> tras su baja, o el tiempo que exija la normativa fiscal, laboral o judicial aplicable. Transcurrido ese plazo, los datos son anonimizados o eliminados de forma segura.</p>
        </Section>

        <Section titulo="10. Derechos ARCO — Ley 25.326">
          <p>Conforme a la Ley 25.326, el titular de los datos personales tiene derecho a:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong className="text-white">Acceso:</strong> conocer qué datos personales propios almacena TILA.</li>
            <li><strong className="text-white">Rectificación:</strong> corregir datos inexactos o desactualizados.</li>
            <li><strong className="text-white">Cancelación:</strong> solicitar la eliminación de datos cuando ya no sean necesarios.</li>
            <li><strong className="text-white">Oposición:</strong> oponerse al tratamiento de sus datos en determinadas circunstancias.</li>
          </ul>
          <p className="mt-2">Para ejercer estos derechos, enviar una solicitud escrita a: <a href="mailto:logisticatila@gmail.com" className="text-yellow-400 hover:underline font-black">logisticatila@gmail.com</a> indicando nombre completo, DNI y el derecho que desea ejercer. La solicitud será respondida dentro del plazo legal vigente.</p>
          <p className="mt-2 text-zinc-500 text-xs">La Dirección Nacional de Protección de Datos Personales (DNPDP) es el organismo de control en la materia.</p>
        </Section>

        <Section titulo="11. Seguridad de los datos">
          <p>TILA implementa medidas técnicas y organizativas para proteger los datos personales contra acceso no autorizado, pérdida, alteración o divulgación. Sin embargo, ningún sistema es 100% seguro. Ante una brecha de seguridad que afecte datos personales, TILA notificará a los usuarios afectados conforme a la normativa vigente.</p>
        </Section>

        <Section titulo="12. Modificaciones a esta política">
          <p>TILA puede modificar esta Política de Privacidad. Los cambios serán publicados en esta página con indicación de la fecha de actualización. El uso continuado de la plataforma tras la publicación de los cambios implica su aceptación.</p>
        </Section>

        <Section titulo="13. Contacto">
          <p>Para consultas sobre privacidad y protección de datos personales: <a href="mailto:logisticatila@gmail.com" className="text-yellow-400 hover:underline font-black">logisticatila@gmail.com</a></p>
          <p className="mt-2">Jurisdicción: República Argentina.</p>
        </Section>

        <div className="border-t border-zinc-800 pt-6 text-zinc-500 text-sm space-y-1">
          <p>TILA — Tecnología Inteligente Logística Argentina</p>
          <div className="flex flex-wrap gap-4 mt-3">
            <Link href="/terminos" className="text-yellow-400 hover:underline">Términos y Condiciones</Link>
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
