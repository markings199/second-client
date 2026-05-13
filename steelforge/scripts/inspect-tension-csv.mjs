import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '..', 'reference', 'exel program EWIWIWI(TENSION).csv');
const txt = fs.readFileSync(p, 'utf8');
const lines = txt.split(/\r?\n/);

function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const showLines = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 25, 26, 27, 33];
for (const idx of showLines) {
  const row = parseLine(lines[idx] || '');
  const picks = row.map((v, i) => [i, v]).filter(([, v]) => v && String(v).trim());
  console.log('\n=== CSV row', idx + 1, 'nonempty', picks.length, '===');
  for (let k = 0; k < Math.min(picks.length, 50); k++) {
    const [i, v] = picks[k];
    console.log(String(i).padStart(4), String(v).slice(0, 80));
  }
}
