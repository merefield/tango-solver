const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const helpers = html.slice(html.indexOf('function edgeKey'), html.indexOf('// DRAWING'));
const solver = html.slice(html.indexOf('// SOLVER'), html.indexOf('// UI'));

function solverContext(rows, cols, clues, equal = [], different = []) {
  const context = vm.createContext({ ROWS: rows, COLS: cols, cellClues: clues,
    eqEdges: new Set(equal), diffEdges: new Set(different) });
  vm.runInContext(`${helpers}\n${solver}
    function inspectSupports(assign, lines) {
      const supported=Array(assign.length).fill(3);
      for(const line of lines) {
        if(!lineSupport(assign,line)) return null;
        for(let i=0;i<line.positions.length;i++) {
          supported[line.positions[i]]&=((line.zeros>>i)&1)|(((line.ones>>i)&1)<<1);
          if(supported[line.positions[i]]===0) return null;
        }
      }
      return supported;
    }
  `, context);
  return context;
}

function run(rows, cols, clues, equal = [], different = [], strategy = 'backtracking') {
  const context = solverContext(rows, cols, clues, equal, different);
  context.strategy = strategy;
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
    assert.deepEqual(valid, { solution: [0, 1, 1, 0], steps: 0,
      forcedPlacements: 0, guesses: 0, backtracks: 0 });
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

test('reports distinguish forced deductions from trial placements', () => {
  const clues = [0, -1, -1, -1];
  const backtracking = run(2, 2, clues);
  assert.equal(backtracking.forcedPlacements, 0);
  assert.equal(backtracking.guesses, 3);
  assert.equal(backtracking.backtracks, 0);
  const propagation = run(2, 2, clues, [], [], 'propagation');
  assert.equal(propagation.forcedPlacements, 3);
  assert.equal(propagation.guesses, 0);
  assert.equal(propagation.backtracks, 0);
  const branching = run(2, 2, Array(4).fill(-1), [], [], 'propagation');
  assert.equal(branching.forcedPlacements, 3);
  assert.equal(branching.guesses, 1);
  assert.equal(branching.backtracks, 0);
});

function tracedRun(rows, cols, clues, equal, different, strategy) {
  const context = solverContext(rows, cols, clues, equal, different);
  context.strategy = strategy;
  return JSON.parse(vm.runInContext(`
    const events=[];
    const result=solvePuzzle(strategy,events);
    JSON.stringify({result,events});
  `, context));
}

function replayTrace(clues, events) {
  const board = clues.slice(), trail = [];
  for (const { pos, value, kind } of events) {
    assert.equal(clues[pos], -1, 'animation must never change a Build clue');
    if (kind === 'undo') {
      assert.equal(value, -1);
      assert.notEqual(board[pos], -1, 'cannot undo an empty cell');
      assert.equal(trail.pop(), pos, 'undo must reverse discovery order');
    } else {
      assert.ok(kind === 'forced' || kind === 'guess');
      assert.ok(value === 0 || value === 1);
      assert.equal(board[pos], -1, 'cannot overwrite an active placement');
      trail.push(pos);
    }
    board[pos] = value;
  }
  return board;
}

test('CP trace follows actual deductions rather than row-by-row reveal order', () => {
  const clues = [-1, -1, 0, -1];
  const { result, events } = tracedRun(2, 2, clues, [], [], 'propagation');
  assert.deepEqual(events.map(event => event.pos), [3, 0, 1]);
  assert.ok(events.every(event => event.kind === 'forced'));
  assert.deepEqual(replayTrace(clues, events), result.solution);
});

test('traces show failed branches and preserve solutions and all report counters', () => {
  const clues = Array(36).fill(-1);
  clues[2] = 0;
  const equal = ['0,0|1,0', '1,0|1,1', '1,1|0,1'];
  for (const strategy of ['backtracking', 'propagation']) {
    const { result, events } = tracedRun(6, 6, clues, equal, [], strategy);
    assert.deepEqual(result, run(6, 6, clues, equal, [], strategy));
    assert.deepEqual(replayTrace(clues, events), result.solution);
    assert.equal(events.filter(event => event.kind === 'guess').length, result.guesses);
    assert.equal(events.filter(event => event.kind === 'forced').length, result.forcedPlacements);
    assert.ok(events.some(event => event.kind === 'undo'));
    if (strategy === 'backtracking') {
      assert.equal(events.filter(event => event.kind === 'undo').length, result.backtracks);
    } else {
      assert.ok(events.filter(event => event.kind === 'undo').length > result.backtracks,
        'failed CP branches must also undo deductions made after a guess');
    }
  }
});

test('failed search traces undo every speculative placement and deduction', () => {
  const clues = Array(16).fill(-1);
  const equal = ['0,0|0,1', '0,1|1,1', '1,1|1,0'];
  const different = ['1,0|0,0'];
  for (const strategy of ['backtracking', 'propagation']) {
    const { result, events } = tracedRun(4, 4, clues, equal, different, strategy);
    assert.equal(result.solution, null);
    assert.ok(events.length > 0);
    assert.deepEqual(replayTrace(clues, events), clues);
    assert.deepEqual(result, run(4, 4, clues, equal, different, strategy));
  }
  // A contradiction can also follow forced placements before the first guess.
  const context = solverContext(6, 6, [0, ...Array(35).fill(-1)], ['0,0|1,0', '1,0|1,1', '1,1|0,1'], ['0,0|0,1']);
  const failure = JSON.parse(vm.runInContext(`
    const events=[]; const result=solvePuzzle('propagation',events);
    JSON.stringify({result,events});
  `, context));
  assert.equal(failure.result.solution, null);
  assert.equal(failure.result.guesses, 0);
  assert.ok(failure.events.some(event => event.kind === 'forced'));
  assert.deepEqual(replayTrace([0, ...Array(35).fill(-1)], failure.events), [0, ...Array(35).fill(-1)]);
});

test('complete puzzles require no trace events', () => {
  for (const strategy of ['backtracking', 'propagation']) {
    const { result, events } = tracedRun(2, 2, [0, 1, 1, 0], [], [], strategy);
    assert.deepEqual(result.solution, [0, 1, 1, 0]);
    assert.deepEqual(events, []);
  }
});

test('queued deductions cascade through intersecting lines on rectangular boards', () => {
  for (const [rows, cols] of [[4, 6], [6, 4], [6, 6], [8, 8]]) {
    const pattern = length => length === 4 ? [0, 0, 1, 1]
      : length === 6 ? [0, 0, 1, 0, 1, 1] : [0, 0, 1, 1, 0, 0, 1, 1];
    const rowPattern = pattern(rows), colPattern = pattern(cols);
    const board = Array.from({ length: rows * cols }, (_, i) =>
      rowPattern[Math.floor(i / cols)] ^ colPattern[i % cols]);
    const equal = [], different = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        if (r + dr >= rows || c + dc >= cols) continue;
        const edge = (r + c) % 2 ? `${r},${c}|${r + dr},${c + dc}`
          : `${r + dr},${c + dc}|${r},${c}`;
        (board[r * cols + c] === board[(r + dr) * cols + c + dc] ? equal : different).push(edge);
      }
    }
    const clues = Array(rows * cols).fill(-1);
    clues[0] = board[0];
    const result = run(rows, cols, clues, equal, different, 'propagation');
    assert.deepEqual(result.solution, board);
    assert.ok(legal(result.solution, rows, cols, clues, equal, different));
    assert.equal(result.forcedPlacements, rows * cols - 1);
    assert.equal(result.guesses, 0);
    assert.equal(result.backtracks, 0);
    clues[clues.length - 1] = 1 - board[board.length - 1];
    const contradictory = run(rows, cols, clues, equal, different, 'propagation');
    assert.equal(contradictory.solution, null);
    assert.equal(contradictory.guesses, 0);
  }
});

test('queued propagation detects a contradiction in each guessed branch', () => {
  const equal = ['0,0|0,1', '0,1|1,1', '1,1|1,0'];
  const different = ['1,0|0,0'];
  const result = run(4, 4, Array(16).fill(-1), equal, different, 'propagation');
  assert.equal(result.solution, null);
  assert.equal(result.guesses, 2);
  assert.equal(result.backtracks, 2);
  assert.ok(result.forcedPlacements > 0);
});

test('reports count failed branches and reset counters for each solve', () => {
  const clues = Array(36).fill(-1);
  clues[2] = 0;
  const equal = ['0,0|1,0', '1,0|1,1', '1,1|0,1'];
  for (const strategy of ['backtracking', 'propagation']) {
    const context = solverContext(6, 6, clues, equal);
    context.strategy = strategy;
    const first = JSON.parse(vm.runInContext('JSON.stringify(solvePuzzle(strategy))', context));
    assert.ok(legal(first.solution, 6, 6, clues, equal));
    assert.ok(first.guesses > 0);
    assert.ok(first.backtracks > 0);
    assert.ok(first.guesses >= first.backtracks);
    if (strategy === 'backtracking') assert.equal(first.guesses - first.backtracks, 35);
    const second = JSON.parse(vm.runInContext('JSON.stringify(solvePuzzle(strategy))', context));
    assert.deepEqual(second, first);
  }
  const failed = run(2, 2, Array(4).fill(-1), ['0,0|0,1']);
  assert.equal(failed.solution, null);
  assert.ok(failed.guesses > 0);
  assert.equal(failed.backtracks, failed.guesses);
});

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

test('end-pair deductions respect line length, direction, symbol, and rectangular boards', () => {
  for (const [rows, cols] of [[6, 6], [4, 6], [6, 4], [8, 8]]) {
    const directions = [
      Array.from({ length: cols }, (_, c) => c),
      Array.from({ length: rows }, (_, r) => r * cols)
    ];
    for (const positions of directions) for (const reverse of [false, true]) {
      const line = reverse ? positions.slice().reverse() : positions;
      for (const value of [0, 1]) {
        const clues = Array(rows * cols).fill(-1);
        clues[line[0]] = clues[line[1]] = value;
        const context = solverContext(rows, cols, clues);
        const supported = JSON.parse(vm.runInContext(
          'JSON.stringify(inspectSupports(cellClues,puzzleLines()))', context));
        assert.ok(supported);
        assert.equal(supported[line[2]], 1 << (1 - value));
        // The far endpoint is forced for lengths 4 and 6, but not for length 8.
        assert.equal(supported[line.at(-1)], line.length === 8 ? 3 : 1 << (1 - value));
        if (line.length === 6) {
          context.endpoint = line.at(-1);
          context.value = value;
          // The old local test alone could not reject this endpoint value.
          assert.equal(vm.runInContext('valid(cellClues,endpoint,value)', context), true);
        }
      }
    }
  }
});

test('whole-line deductions combine edge clues with balance and adjacency', () => {
  const clues = Array(36).fill(-1);
  clues[0] = 0;
  const context = solverContext(6, 6, clues, ['0,1|0,2']);
  const supported = JSON.parse(vm.runInContext(
    'JSON.stringify(inspectSupports(cellClues,puzzleLines()))', context));
  assert.equal(supported[1], 2);
  assert.equal(supported[2], 2);
  assert.equal(supported[3], 1);
  const impossible = solverContext(6, 6, Array(36).fill(-1), ['0,0|0,1', '0,1|0,2']);
  assert.equal(vm.runInContext('inspectSupports(cellClues,puzzleLines())', impossible), null);
});

test('cached line patterns match exhaustive balanced, triple-free lines', () => {
  const context = solverContext(8, 8, Array(64).fill(-1));
  for (const length of [2, 4, 6, 8]) {
    const expected = [];
    for (let mask = 0; mask < 2 ** length; mask++) {
      const values = Array.from({ length }, (_, i) => (mask >> i) & 1);
      if (values.reduce((a, b) => a + b, 0) !== length / 2) continue;
      if (values.some((v, i) => i >= 2 && values[i - 1] === v && values[i - 2] === v)) continue;
      expected.push(values.join(''));
    }
    context.length = length;
    const actual = JSON.parse(vm.runInContext('JSON.stringify(linePatternMasks(length).map(mask=>Array.from({length},(_,i)=>(mask>>i)&1)))', context));
    assert.deepEqual(actual.map(values => values.join('')).sort(), expected.sort());
  }
});

test('line-support cache handles replaced symbols, contradictions, and rollback', () => {
  const context = solverContext(6, 6, Array(36).fill(-1));
  vm.runInContext('const lines=puzzleLines();', context);
  function supports() {
    return JSON.parse(vm.runInContext('JSON.stringify(inspectSupports(cellClues,lines))', context));
  }
  const empty = supports();
  vm.runInContext('cellClues[0]=cellClues[1]=0;', context);
  assert.equal(supports()[5], 2);
  // Same known positions, different values must invalidate the cached supports.
  vm.runInContext('cellClues[0]=cellClues[1]=1;', context);
  assert.equal(supports()[5], 1);
  vm.runInContext('cellClues[2]=1;', context);
  assert.equal(supports(), null);
  vm.runInContext('cellClues.fill(-1);', context);
  assert.deepEqual(supports(), empty);
});

test('rule tables follow edge edits and board dimensions between solves', () => {
  const context = solverContext(4, 6, Array(24).fill(-1));
  assert.ok(vm.runInContext("solvePuzzle('backtracking').solution!==null", context));
  vm.runInContext("cellClues=[0,1,0,1,0,1,1,0,1,0,1,0,0,1,0,1,0,1,1,0,1,0,1,0]; eqEdges.add('0,0|0,1');", context);
  assert.equal(vm.runInContext("solvePuzzle('backtracking').solution", context), null);
  vm.runInContext("eqEdges.clear(); diffEdges.add('0,1|0,0');", context);
  assert.ok(vm.runInContext("solvePuzzle('propagation').solution!==null", context));
  // Keep the same cell count while swapping dimensions to catch stale topology.
  vm.runInContext('ROWS=6; COLS=4; cellClues=Array(24).fill(-1);', context);
  const solution = JSON.parse(vm.runInContext("JSON.stringify(solvePuzzle('backtracking').solution)", context));
  assert.ok(legal(solution, 6, 4, Array(24).fill(-1), [], ['0,1|0,0']));
});

test('incremental counts stay correct through placements, replacements, and undo', () => {
  const context = solverContext(4, 6, Array(24).fill(-1));
  vm.runInContext('const rules=createRules(cellClues);', context);
  for (const [pos, value] of [[0, 0], [1, 1], [7, 1], [0, 1], [1, -1], [7, -1], [0, -1]]) {
    context.pos = pos;
    context.value = value;
    vm.runInContext('setValue(cellClues,pos,value,rules)', context);
    const state = JSON.parse(vm.runInContext('JSON.stringify({clues:cellClues,rows:rules.rowCounts,cols:rules.colCounts})', context));
    const expectedRows = Array(8).fill(0), expectedCols = Array(12).fill(0);
    state.clues.forEach((v, i) => {
      if (v === -1) return;
      expectedRows[2 * Math.floor(i / 6) + v]++;
      expectedCols[2 * (i % 6) + v]++;
    });
    assert.deepEqual(state.rows, expectedRows);
    assert.deepEqual(state.cols, expectedCols);
  }
});
