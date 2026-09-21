// Genera un PNG gris mínimo (sin dependencias) para usar como "documento ficticio" en Storage de staging.
// No contiene texto ni datos: es una imagen lisa, claramente falsa, pensada solo para que las pantallas tengan algo que mostrar.
import zlib from "node:zlib";

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (tipo, datos) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([len, cuerpo, crc]);
};

/** PNG RGB de `ancho`×`alto` con un degradado gris suave (color base `gris`). */
export function pngGris(ancho = 160, alto = 100, gris = 200) {
  const filas = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 3); // filtro 0 + píxeles
    for (let x = 0; x < ancho; x++) { const v = Math.max(0, Math.min(255, gris - Math.floor((y / alto) * 40))); fila[1 + x * 3] = v; fila[2 + x * 3] = v; fila[3 + x * 3] = v; }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(filas))), chunk("IEND", Buffer.alloc(0))]);
}
