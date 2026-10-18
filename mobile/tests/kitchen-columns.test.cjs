const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Load the production pure function without requiring native UI modules.
const source = fs.readFileSync(path.join(__dirname, '../src/screens/kitchen/KitchenBoardScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('KitchenBoardScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'balanceKitchenColumns');
assert.ok(fn, 'Production balanced-column algorithm exists');
const compiled = ts.transpileModule(source.slice(fn.getStart(ast), fn.end), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const balance = (...args) => JSON.parse(JSON.stringify(sandbox.exports.balanceKitchenColumns(...args)));

test('empty list and fewer orders than available columns', () => {
  assert.deepEqual(balance([], 4, 16), { placements: [], height: 0 });
  assert.deepEqual(balance([50, 90], 4, 16), {
    placements: [{ column: 0, top: 0 }, { column: 1, top: 0 }], height: 90,
  });
});

test('portrait keeps the original order, measured fractional heights and gaps', () => {
  assert.deepEqual(balance([45.5, 70, 18], 1, 16), {
    placements: [{ column: 0, top: 0 }, { column: 0, top: 61.5 }, { column: 0, top: 147.5 }], height: 165.5,
  });
});

test('landscape forms consecutive balanced groups rather than alternating columns', () => {
  assert.deepEqual(balance([80, 120, 90, 110], 2, 16), {
    placements: [{ column: 0, top: 0 }, { column: 0, top: 96 }, { column: 1, top: 0 }, { column: 1, top: 106 }], height: 216,
  });
  assert.deepEqual(balance([240, 30, 30, 30], 2, 16).placements.map(placement => placement.column), [0, 1, 1, 1]);
});

// Independent exhaustive search enumerates every legal partition.
function minimumHeight(heights, columns, gap, start = 0) {
  if (columns === 1) return heights.slice(start).reduce((sum, height) => sum + height, 0) + gap * (heights.length - start - 1);
  let best = Infinity;
  let own = 0;
  for (let end = start + 1; end <= heights.length - columns + 1; end++) {
    own += heights[end - 1] + (end > start + 1 ? gap : 0);
    best = Math.min(best, Math.max(own, minimumHeight(heights, columns - 1, gap, end)));
  }
  return best;
}

test('400 varying-height layouts match exhaustive partitions without overlap or reordering', () => {
  let seed = 4242;
  for (let size = 1; size <= 8; size++) {
    for (let requested = 1; requested <= 5; requested++) {
      for (let trial = 0; trial < 10; trial++) {
        const heights = Array.from({ length: size }, () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return 5 + seed % 350 + (seed % 4) / 4;
        });
        const gap = trial % 2 ? 16 : 0;
        const actual = balance(heights, requested, gap);
        const columns = Math.min(size, requested);
        assert.equal(actual.placements.length, heights.length);
        assert.equal(actual.height, minimumHeight(heights, columns, gap));
        const used = new Set();
        actual.placements.forEach((placement, index) => {
          used.add(placement.column);
          assert.ok(placement.top >= 0);
          assert.ok(placement.top + heights[index] <= actual.height);
          if (index && placement.column === actual.placements[index - 1].column) {
            assert.equal(placement.top, actual.placements[index - 1].top + heights[index - 1] + gap);
          } else {
            assert.equal(placement.top, 0);
            if (index) assert.equal(placement.column, actual.placements[index - 1].column + 1);
          }
        });
        assert.equal(used.size, columns, 'Every column contains a consecutive nonempty group');
      }
    }
  }
});

test('remeasured expanded cards and inserted orders produce a new valid layout', () => {
  const compact = [80, 120, 90, 110];
  const expanded = [80, 320, 90, 110];
  const inserted = [70, ...expanded];
  for (const heights of [compact, expanded, inserted]) {
    const layout = balance(heights, 2, 16);
    assert.equal(layout.height, minimumHeight(heights, 2, 16));
    assert.equal(layout.placements.length, heights.length);
  }
  assert.notDeepEqual(balance(compact, 2, 16), balance(expanded, 2, 16));
});
