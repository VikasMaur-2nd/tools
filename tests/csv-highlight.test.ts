import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_START, csvLine, csvScan } from '../lib/convert/highlight';

/** Highlights a CSV document line by line, as the code view does. */
const lines = (csv: string) => {
  let st = CSV_START;
  return csv.split('\n').map((l) => {
    const h = csvLine(l, st);
    st = csvScan('\n', 0, 1, csvScan(l, 0, l.length, st));
    return h;
  });
};

test('each field takes its column colour; the header is bold', () => {
  const [head, row] = lines('id,name\r\n1,Ada\r\n');
  assert.equal(head, '<span class="cc0 ch">id</span><span class="tp">,</span><span class="cc1 ch">name</span>\r');
  assert.equal(row, '<span class="cc0">1</span><span class="tp">,</span><span class="cc1">Ada</span>\r');
});

test('commas inside quotes and doubled quotes stay in their field', () => {
  const [, row] = lines('a,b,c\n"x, ""y""",2,3');
  assert.equal(row, '<span class="cc0">&quot;x, &quot;&quot;y&quot;&quot;&quot;</span><span class="tp">,</span><span class="cc1">2</span><span class="tp">,</span><span class="cc2">3</span>');
});

test('a quoted line break continues the same column on the next line', () => {
  const out = lines('a,b,c\n1,"two\nlines",3\n4,5,6');
  assert.match(out[2], /^<span class="cc1">lines&quot;<\/span><span class="tp">,<\/span><span class="cc2">3<\/span>$/);
  assert.match(out[3], /^<span class="cc0">4<\/span>/);
});

test('a row can start mid-line with the scanned state (wrapped rows)', () => {
  const line = 'a,b,c,d';
  const st = csvScan(line, 0, 4, 0);
  assert.equal(csvLine(line.slice(4), st), '<span class="cc2">c</span><span class="tp">,</span><span class="cc3">d</span>');
});
