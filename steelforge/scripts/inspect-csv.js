const fs = require('fs');
const path = require('path');
const csvPath = path.join(__dirname, '..', 'reference', 'exel program EWIWIWI(S(STEEL SELECTION)).csv');
const text = fs.readFileSync(csvPath, 'utf8');
const lines = text.split(/\r?\n/);

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

const h1 = parseLine(lines[0]);
const h3 = parseLine(lines[2]);
const d = parseLine(lines[4]);
console.log('h1 length', h1.length);
console.log('h3 length', h3.length);
console.log('data length', d.length);

const findAll = (arr, pred) =>
  arr.map((v, i) => (pred(v, i) ? i : -1)).filter((i) => i >= 0);

['Type', 'AISC_Manual_Label', 'Nominal Weight', 'Area, A', 'Depth, d'].forEach((k) => {
  console.log(k, h1.indexOf(k));
});

// Row 3 (index 2) has sub-headers - print I S r positions
h3.forEach((cell, i) => {
  if (cell && String(cell).trim() && /^(I|S|r|Z|Thickness|Width|tw|bf|tf)/i.test(String(cell).trim())) {
    console.log('h3[' + i + ']=' + JSON.stringify(cell));
  }
});

// Print full h3 with indices for columns 0-80
console.log(
  'h3 indexed:',
  h3.map((c, i) => i + ':' + JSON.stringify(c)).join(' | ')
);

console.log('W44X335 row first 45 cols:', d.slice(0, 45).map((c, i) => i + '=' + c).join(' | '));

const types = new Set();
for (let li = 4; li < lines.length; li++) {
  const r = parseLine(lines[li]);
  if (r[0] && r[0].trim()) types.add(r[0].trim());
}
console.log('types:', [...types].sort().join(', '));

const firstL = lines.slice(4).map(parseLine).find((r) => String(r[0] || '').trim() === 'L');
if (firstL) {
  console.log('First L row label:', firstL[2]);
  console.log(
    'First L row cols 0-24:',
    firstL.slice(0, 25).map((c, i) => `${i}=${c}`).join(' | ')
  );
  console.log(
    'First L row cols 25-45:',
    firstL.slice(25, 46).map((c, i) => `${i + 25}=${c}`).join(' | ')
  );
}
