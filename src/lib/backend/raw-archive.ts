import type { Row } from './database.ts';
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
export function rawCsv(rows: Row[]) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();
  if (!columns.length) return '\uFEFFid\r\n';
  const cell = (value: unknown) => { let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n') + '\r\n';
}
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
/** Small, bounded ZIP (STORE method). Filenames are fixed by the server. */
export function rawZip(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, value]) => ({ name: Buffer.from(name), data: Buffer.from(value) }));
  if (entries.length > 100 || entries.some(({ name }) => !/^[a-z0-9_.-]+$/i.test(name.toString())) || entries.reduce((sum, row) => sum + row.data.length + row.name.length * 2 + 76, 22) > MAX_ARCHIVE_BYTES) throw new Error('다운로드 파일이 20 MiB 한도를 초과했습니다. 필터를 좁혀 주세요.');
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const { name, data } of entries) {
    const crc = crc32(data), header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const center = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, center, end]);
}
