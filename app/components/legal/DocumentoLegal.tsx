import Link from "next/link";
import type { ReactNode } from "react";
import type { DocumentoLegalFuente } from "../../lib/legal/tipos";

// Renderizador interno de markdown legal — sin dependencias externas.
// Cubre exactamente la sintaxis presente en los documentos v2026-07:
// ## / ### (headings), **bold**, [texto](url), listas "- " y "1. ".
// El contenido es siempre texto propio (no input de usuario), por lo que
// se construyen nodos React directamente — nunca dangerouslySetInnerHTML.

function renderizarInline(texto: string, keyPrefix: string): ReactNode[] {
  const nodos: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let ultimoIndice = 0;
  let contador = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(texto)) !== null) {
    if (match.index > ultimoIndice) {
      nodos.push(texto.slice(ultimoIndice, match.index));
    }
    if (match[1] !== undefined) {
      nodos.push(
        <strong key={`${keyPrefix}-${contador++}`} className="text-white">
          {match[1]}
        </strong>
      );
    } else {
      nodos.push(
        <a
          key={`${keyPrefix}-${contador++}`}
          href={match[3]}
          className="text-yellow-400 hover:underline"
        >
          {match[2]}
        </a>
      );
    }
    ultimoIndice = regex.lastIndex;
  }
  if (ultimoIndice < texto.length) {
    nodos.push(texto.slice(ultimoIndice));
  }
  return nodos;
}

function renderizarBloques(contenido: string): ReactNode[] {
  const lineas = contenido.split("\n");
  const bloques: string[][] = [];
  let actual: string[] = [];

  for (const linea of lineas) {
    if (linea.trim() === "") {
      if (actual.length) {
        bloques.push(actual);
        actual = [];
      }
    } else {
      actual.push(linea);
    }
  }
  if (actual.length) bloques.push(actual);

  return bloques.map((bloque, i) => {
    const primera = bloque[0];

    if (primera.startsWith("### ")) {
      return (
        <h3 key={i} className="text-base font-black text-yellow-400 mt-4 mb-1">
          {renderizarInline(primera.slice(4), `h3-${i}`)}
        </h3>
      );
    }

    if (primera.startsWith("## ")) {
      return (
        <h2 key={i} className="text-lg font-black text-yellow-400 mb-2 mt-6">
          {renderizarInline(primera.slice(3), `h2-${i}`)}
        </h2>
      );
    }

    if (bloque.every((l) => l.startsWith("- "))) {
      return (
        <ul key={i} className="list-disc pl-5 mt-2 space-y-1 text-zinc-300 text-sm leading-relaxed">
          {bloque.map((l, j) => (
            <li key={j}>{renderizarInline(l.slice(2), `ul-${i}-${j}`)}</li>
          ))}
        </ul>
      );
    }

    if (bloque.every((l) => /^\d+\.\s/.test(l))) {
      return (
        <ol key={i} className="list-decimal pl-5 mt-2 space-y-1 text-zinc-300 text-sm leading-relaxed">
          {bloque.map((l, j) => (
            <li key={j}>{renderizarInline(l.replace(/^\d+\.\s/, ""), `ol-${i}-${j}`)}</li>
          ))}
        </ol>
      );
    }

    return (
      <div key={i} className="text-zinc-300 text-sm leading-relaxed space-y-2 mt-2">
        {bloque.map((l, j) => (
          <p key={j}>{renderizarInline(l, `p-${i}-${j}`)}</p>
        ))}
      </div>
    );
  });
}

export function DocumentoLegal({ documento }: { documento: DocumentoLegalFuente }) {
  return (
    <main className="min-h-screen bg-black text-white px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        <Link href="/" className="text-zinc-500 hover:text-yellow-400 text-sm">← Inicio</Link>

        <h1 className="text-3xl md:text-4xl font-black text-yellow-400 mt-4">
          {documento.titulo}
        </h1>

        <div>{renderizarBloques(documento.contenido)}</div>

        <div className="border-t border-zinc-800 pt-6 text-zinc-500 text-sm space-y-1">
          <p>TILA — Tecnología Inteligente Logística Argentina</p>
          <div className="flex flex-wrap gap-4 mt-3">
            <Link href="/terminos" className="text-yellow-400 hover:underline">Términos y Condiciones</Link>
            <Link href="/privacidad" className="text-yellow-400 hover:underline">Política de Privacidad</Link>
            <Link href="/contrato-transportista" className="text-yellow-400 hover:underline">Contrato Transportista</Link>
            <Link href="/" className="hover:text-white">Inicio</Link>
          </div>
        </div>

      </div>
    </main>
  );
}
