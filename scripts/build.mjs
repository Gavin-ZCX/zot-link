// Build script: package the plugin source into dist/zot-link-<version>.xpi.
// Uses only the Node standard library + a tiny inline ZIP writer to avoid extra deps.
// An .xpi file is just a renamed .zip archive containing manifest.json at the root.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";

const repoRoot = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
const version = manifest.version;
const xpiName = `zot-link-${version}.xpi`;

// Files / directories to ship inside the xpi.
const includeRoots = ["manifest.json", "bootstrap.js", "src", "README.md", "LICENSE", "NOTICE"];

function collectFiles(rootRel) {
  const abs = join(repoRoot, rootRel);
  const stat = statSync(abs);
  if (stat.isFile()) return [rootRel];
  if (!stat.isDirectory()) return [];
  const out = [];
  // Sorted so the archive order does not depend on the filesystem.
  for (const name of readdirSync(abs).sort()) {
    out.push(...collectFiles(join(rootRel, name)));
  }
  return out;
}

const files = includeRoots.flatMap(collectFiles);
console.log(`[build] including ${files.length} files in ${xpiName}`);

// Minimal ZIP writer (store + deflate).
function dosTime(date) {
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { t, d };
}

const centralEntries = [];
const localChunks = [];
let offset = 0;
// Fixed entry timestamp (or SOURCE_DATE_EPOCH) so the same source always yields the same .xpi bytes.
// The UTC date parts are used so the result does not depend on the build machine's time zone.
const epochSec = Number(process.env.SOURCE_DATE_EPOCH || 315532800); // 1980-01-01T00:00:00Z
const stamp = new Date(epochSec * 1000);
const fixed = new Date(stamp.getUTCFullYear(), stamp.getUTCMonth(), stamp.getUTCDate(),
  stamp.getUTCHours(), stamp.getUTCMinutes(), stamp.getUTCSeconds());
const { t: dosT, d: dosD } = dosTime(fixed);

for (const relPath of files) {
  const arcname = relPath.split(sep).join(posix.sep);
  const data = readFileSync(join(repoRoot, relPath));
  const compressed = deflateRawSync(data, { level: 9 });
  const useDeflate = compressed.length < data.length;
  const payload = useDeflate ? compressed : data;
  const method = useDeflate ? 8 : 0; // 8 = deflate, 0 = store
  const crc = crc32(data);
  const nameBuf = Buffer.from(arcname, "utf8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(dosT, 10);
  localHeader.writeUInt16LE(dosD, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  localChunks.push(localHeader, nameBuf, payload);

  centralEntries.push({
    arcname, nameBuf, method, dosT, dosD, crc,
    csize: payload.length, usize: data.length, offset
  });

  offset += localHeader.length + nameBuf.length + payload.length;
}

const centralChunks = [];
let centralSize = 0;
for (const e of centralEntries) {
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);            // version made by
  cd.writeUInt16LE(20, 6);            // version needed
  cd.writeUInt16LE(0x0800, 8);        // UTF-8
  cd.writeUInt16LE(e.method, 10);
  cd.writeUInt16LE(e.dosT, 12);
  cd.writeUInt16LE(e.dosD, 14);
  cd.writeUInt32LE(e.crc, 16);
  cd.writeUInt32LE(e.csize, 20);
  cd.writeUInt32LE(e.usize, 24);
  cd.writeUInt16LE(e.nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);
  cd.writeUInt32LE(e.offset, 42);
  centralChunks.push(cd, e.nameBuf);
  centralSize += cd.length + e.nameBuf.length;
}

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(centralEntries.length, 8);
eocd.writeUInt16LE(centralEntries.length, 10);
eocd.writeUInt32LE(centralSize, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const archive = Buffer.concat([...localChunks, ...centralChunks, eocd]);

mkdirSync(join(repoRoot, "dist"), { recursive: true });
const outPath = join(repoRoot, "dist", xpiName);
writeFileSync(outPath, archive);
const sha256 = createHash("sha256").update(archive).digest("hex");
console.log(`[build] wrote ${outPath} (${archive.length} bytes, sha256 ${sha256})`);
