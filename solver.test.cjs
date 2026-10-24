const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const helpers = html.slice(html.indexOf('function edgeKey'), html.indexOf('// DRAWING'));
const solver = html.slice(html.indexOf('const dirs ='), html.indexOf('// UI'));

function run(rows, cols, clues, equal = [], different = [], strategy = 'backtracking') {
  const context = vm.createContext({ ROWS: rows, COLS: cols, cellClues: clues,
    eqEdges: new Set(equal), diffEdges: new Set(different), strategy });
  vm.runInContext(`${helpers}\n${solver}`, context);
  return JSON.parse(vm.runInContext('JSON.stringify(solvePuzzle(strategy))', context));
}

// Independent oracle: inspect complete boards, rather than solver decisions.
function legal(board, rows, cols, clues, equal = [], different = []) {
  if (board.length !== rows * cols || board.some(v => v !== 0 && v !== 1)) return false;
  if (clues.some((v, i) => v !== -1 && v !== board[i])) return false;
  for (let r = 0; r < rows; r++) {
    const line = board.slice(r * cols, (r + 1) * cols);
    if (line.reduce((sum, v) => sum + v, 0) !== cols / 2) return false;
  }
  for (let c = 0; c < cols; c++) {
    const line = Array.from({ length: rows }, (_, r) => board[r * cols + c]);
    if (line.reduce((sum, v) => sum + v, 0) !== rows / 2) return false;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = board[r * cols + c];
    if (c + 2 < cols && board[r * cols + c + 1] === v && board[r * cols + c + 2] === v) return false;
    if (r + 2 < rows && board[(r + 1) * cols + c] === v && board[(r + 2) * cols + c] === v) return false;
  }
  const endpoints = edge => edge.split('|').map(cell => {
    const [r, c] = cell.split(',').map(Number);
    return board[r * cols + c];
  });
  return equal.every(edge => { const [a, b] = endpoints(edge); return a === b; }) &&
    different.every(edge => { const [a, b] = endpoints(edge); return a !== b; });
}

for (const strategy of ['backtracking', 'propagation']) {
  test(`${strategy}: validates complete clues and odd board sizes`, () => {
    const valid = run(2, 2, [0, 1, 1, 0], [], [], strategy);
    assert.deepEqual(valid, { solution: [0, 1, 1, 0], steps: 0 });
    assert.equal(run(2, 2, [1, 1, 1, 1], [], [], strategy).solution, null);
    assert.equal(run(2, 3, Array(6).fill(-1), [], [], strategy).solution, null);
    assert.equal(run(2, 2, [0, 1, 1, 0], ['0,0|0,1'], [], strategy).solution, null);
    assert.equal(run(2, 2, [0, -1, -1, -1], ['0,0|0,1'], [], strategy).solution, null);
    assert.equal(run(2, 6, [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0], [], [], strategy).solution, null);
  });

  test(`${strategy}: solves without modifying Build clues`, () => {
    const clues = [0, -1, -1, -1];
    const result = run(2, 2, clues, [], ['0,0|0,1'], strategy);
    assert.deepEqual(result.solution, [0, 1, 1, 0]);
    assert.ok(result.steps > 0);
    assert.deepEqual(clues, [0, -1, -1, -1]);
  });

  test(`${strategy}: solves a standard 6x6 and a rectangular board`, () => {
    for (const [rows, cols] of [[6, 6], [4, 6]]) {
      const clues = Array(rows * cols).fill(-1);
      const result = run(rows, cols, clues, [], [], strategy);
      assert.ok(result.solution);
      assert.ok(legal(result.solution, rows, cols, clues));
    }
  });
}

test('both strategies agree with exhaustive 4x4 solutions on varied setups', () => {
  const empty = Array(16).fill(-1);
  const boards = [];
  for (let mask = 0; mask < 2 ** 16; mask++) {
    const board = Array.from({ length: 16 }, (_, i) => (mask >> i) & 1);
    if (legal(board, 4, 4, empty)) boards.push(board);
  }
  assert.ok(boards.length > 0);
  let seed = 29;
  function random(n) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; }
  for (let fixture = 0; fixture < 80; fixture++) {
    const source = boards[random(boards.length)];
    const clues = source.map(v => random(3) === 0 ? v : -1);
    const equal = [], different = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        if (r + dr >= 4 || c + dc >= 4 || random(4) !== 0) continue;
        const matches = source[r * 4 + c] === source[(r + dr) * 4 + c + dc];
        const useEqual = fixture % 2 === 0 ? matches : random(2) === 0;
        (useEqual ? equal : different).push(`${r},${c}|${r + dr},${c + dc}`);
      }
    }
    const possible = boards.some(board => legal(board, 4, 4, clues, equal, different));
    for (const strategy of ['backtracking', 'propagation']) {
      const result = run(4, 4, clues, equal, different, strategy);
      assert.equal(result.solution !== null, possible, `fixture ${fixture}, ${strategy}`);
      if (result.solution) assert.ok(legal(result.solution, 4, 4, clues, equal, different));
    }
  }
});

test('candidate checks preserve existing assignments, including rejected values', () => {
  const context = vm.createContext({ ROWS: 2, COLS: 2, cellClues: [0, 1, 1, 0],
    eqEdges: new Set(), diffEdges: new Set() });
  vm.runInContext(`${helpers}\n${solver}`, context);
  assert.equal(vm.runInContext('valid(cellClues, 0, 1)', context), false);
  assert.deepEqual(context.cellClues, [0, 1, 1, 0]);
});
