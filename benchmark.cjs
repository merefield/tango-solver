const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

function load(file) {
  const html = fs.readFileSync(file, 'utf8');
  const helpers = html.slice(html.indexOf('function edgeKey'), html.indexOf('// DRAWING'));
  const solver = html.slice(html.indexOf('// SOLVER'), html.indexOf('// UI'));
  return new Function(`let ROWS,COLS,cellClues,eqEdges,diffEdges; ${helpers}\n${solver}
    return {
      setup(fixture) {
        ROWS=fixture.rows; COLS=fixture.cols; cellClues=fixture.clues.slice();
        eqEdges=new Set(fixture.equal); diffEdges=new Set(fixture.different);
      },
      solve:solvePuzzle
    };`)();
}

const currentFile = `${__dirname}/index.html`;
const current = load(currentFile);
function fixture(rows, cols, density = 4) {
  current.setup({ rows, cols, clues: Array(rows * cols).fill(-1), equal: [], different: [] });
  const board = current.solve('backtracking').solution;
  const clues = board.map((v, i) => i % 9 === 2 ? v : -1);
  const equal = [], different = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      if (r + dr >= rows || c + dc >= cols || (r * 7 + c * 3 + dr) % density !== 0) continue;
      (board[r * cols + c] === board[(r + dr) * cols + c + dc] ? equal : different)
        .push(`${r},${c}|${r + dr},${c + dc}`);
    }
  }
  return { name: `${rows}x${cols} clues and edges`, rows, cols, clues, equal, different };
}

const corner = { name: '6x6 corner chain', rows: 6, cols: 6, clues: Array(36).fill(-1),
  equal: ['0,0|1,0', '1,0|1,1', '1,1|0,1'], different: [] };
corner.clues[2] = 0;
const deduction = { ...fixture(6, 6, 2), name: '6x6 deduction only' };
const fixtures = [deduction, fixture(6, 6), fixture(8, 8), fixture(4, 6), corner,
  { name: '6x6 empty', rows: 6, cols: 6, clues: Array(36).fill(-1), equal: [], different: [] }];
const options = process.argv.slice(2), cold = options.includes('--cold');
const baseline = options.find(arg => arg !== '--cold');
const versions = baseline
  ? [{ name: 'Baseline', file: baseline, runtime: load(baseline) }, { name: 'Current', file: currentFile, runtime: current }]
  : [{ name: 'Current', file: currentFile, runtime: current }];
const rounds = 7, batchSize = 500, results = [];
for (const f of fixtures) for (const strategy of ['backtracking', 'propagation']) {
  const samples = versions.map(() => []), counters = [];
  let expected;
  for (const { runtime } of versions) {
    runtime.setup(f);
    const result = runtime.solve(strategy);
    assert.ok(result.solution, `No solution for ${f.name}`);
    if (expected) {
      assert.deepEqual(result.solution, expected.solution, 'Solution changed');
      if (strategy === 'backtracking') assert.deepEqual(result, expected, 'Backtracking counters changed');
    }
    counters.push(result);
    expected = result;
    if (!cold) for (let i = 0; i < 100; i++) runtime.solve(strategy);
  }
  for (let round = 0; round < (cold ? 31 : rounds); round++) {
    // Alternate order to reduce bias from sustained CPU load.
    for (let i = 0; i < versions.length; i++) {
      const index = (round + i) % versions.length;
      const runtime = cold ? load(versions[index].file) : versions[index].runtime;
      if (cold) runtime.setup(f);
      const repeats = cold ? 1 : batchSize;
      const start = performance.now();
      for (let repeat = 0; repeat < repeats; repeat++) runtime.solve(strategy);
      samples[index].push((performance.now() - start) / repeats);
    }
  }
  const medians = samples.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  const row = { Puzzle: f.name, Strategy: strategy, Guesses: expected.guesses };
  versions.forEach((version, i) => { row[`${version.name} steps`] = counters[i].steps; row[`${version.name} ms`] = medians[i].toFixed(4); });
  if (versions.length === 2) row.Speedup = `${(medians[0] / medians[1]).toFixed(1)}x`;
  results.push(row);
}
console.log(`${process.version}: median milliseconds per solve; ${cold ? '31 runs with fresh solver state' : `${rounds} batches of ${batchSize}, after 100 warmup solves`}.`);
console.table(results);
