const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the page's event handlers with controllable timers, without dependencies.
function page() {
  const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const listeners = new Map();
    const item = { value: '', textContent: '', checked: false, disabled: false,
      children: [], dataset: {}, classList: {
        contains: name => classes.has(name), add: name => classes.add(name),
        remove: name => classes.delete(name)
      },
      addEventListener: (event, callback) => listeners.set(event, callback),
      trigger: (event = 'click', data = {}) => listeners.get(event)?.(data),
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      getContext: () => new Proxy({}, { get: () => () => {} })
    };
    elements.set(id, item);
    return item;
  }
  element('colsInp').value = element('rowsInp').value = '2';
  element('strategySelect').value = 'backtracking';
  element('animationSpeed').value = '200';
  Object.defineProperty(element('strategySelect'), 'selectedOptions', {
    get: () => [{ textContent: element('strategySelect').value === 'backtracking'
      ? 'Backtracking' : 'Constraint propagation + backtracking' }]
  });
  const tabs = ['solveTab', 'buildTab'].map(id => {
    const button = element(`${id}Button`);
    button.dataset.tab = id;
    return button;
  });
  element('solveTab').classList.add('active');
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => element(Symbol()),
      querySelectorAll: selector => selector === '.tab-btn' ? tabs
        : [element('solveTab'), element('buildTab')] },
    performance: { now: () => 10 },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { element, timers,
    evaluate: code => vm.runInContext(code, context),
    nextDelay: () => timers.values().next().value?.delay,
    tick() {
      const [id, { callback }] = timers.entries().next().value;
      timers.delete(id);
      callback();
    }
  };
}

test('each strategy reports metrics, and Solve Clear preserves the Build setup', () => {
  for (const strategy of ['backtracking', 'propagation']) {
    const p = page();
    p.evaluate("cellClues=[0,-1,-1,-1]; diffEdges.add('0,0|0,1');");
    p.element('strategySelect').value = strategy;
    p.element('startBtn').trigger();
    assert.equal(p.element('startBtn').disabled, true);
    p.tick();
    assert.equal(p.element('status').textContent, '✅ Solved');
    const entry = p.element('timer').children[0];
    const metrics = entry.children.map(child => child.textContent);
    assert.match(metrics[0], /^Time: \d+\.\d{3} s$/);
    assert.match(metrics[1], /^Steps: [1-9]\d*$/);
    assert.equal(metrics[2], `Strategy: ${p.element('strategySelect').selectedOptions[0].textContent}`);
    assert.equal(metrics[3], `Forced placements: ${strategy === 'propagation' ? 3 : 0}`);
    assert.equal(metrics[4], `Guesses: ${strategy === 'propagation' ? 0 : 3}`);
    assert.equal(metrics[5], 'Backtracks: 0');
    p.element('clearSolutionBtn').trigger();
    assert.equal(p.evaluate('solution'), null);
    assert.equal(p.evaluate('JSON.stringify(cellClues)'), '[0,-1,-1,-1]');
    assert.equal(p.evaluate("diffEdges.has('0,0|0,1')"), true);
    assert.equal(p.element('timer').children.length, 1);
    assert.equal(p.element('timer').children[0], entry);
    assert.equal(p.element('status').textContent, 'Idle');
  }
});

test('repeated solves append history and keep the strategy recorded for each run', () => {
  const p = page();
  p.element('startBtn').trigger();
  p.tick();
  const firstEntry = p.element('timer').children[0];
  const firstMetrics = firstEntry.children.map(child => child.textContent);
  p.element('clearSolutionBtn').trigger();
  p.element('strategySelect').value = 'propagation';
  p.element('startBtn').trigger();
  assert.equal(p.element('timer').children.length, 1);
  p.tick();
  assert.equal(p.element('timer').children.length, 2);
  assert.equal(firstEntry.children[2].textContent, 'Strategy: Backtracking');
  assert.equal(p.element('timer').children[1].children[2].textContent,
    'Strategy: Constraint propagation + backtracking');
  p.element('startBtn').trigger();
  p.tick();
  assert.equal(p.element('timer').children.length, 3);
  assert.deepEqual(firstEntry.children.map(child => child.textContent), firstMetrics);
  assert.deepEqual(p.element('timer').children[1].children.slice(3).map(child => child.textContent),
    p.element('timer').children[2].children.slice(3).map(child => child.textContent));
});

test('entering Build clears history and pending callbacks; a refreshed page starts empty', () => {
  for (const animate of [false, true]) {
    const p = page();
    p.element('animateChk').checked = animate;
    p.element('startBtn').trigger();
    p.tick();
    assert.equal(p.element('timer').children.length, 1);
    p.element('buildTabButton').trigger();
    assert.equal(p.element('timer').children.length, 0);
    assert.equal(p.timers.size, 0);
    p.element('solveTabButton').trigger();
    assert.equal(p.element('timer').children.length, 0);
    p.element('startBtn').trigger();
    p.tick();
    assert.equal(p.element('timer').children.length, 1);
  }
  const p = page();
  p.element('startBtn').trigger();
  p.element('buildTabButton').trigger();
  assert.equal(p.timers.size, 0);
  assert.equal(page().element('timer').children.length, 0);
});

test('Clear cancels queued solving and animation, and permits a fresh solve', () => {
  const p = page();
  p.element('startBtn').trigger();
  p.element('clearSolutionBtn').trigger();
  assert.equal(p.timers.size, 0);
  p.element('animateChk').checked = true;
  p.element('startBtn').trigger();
  p.tick();
  assert.equal(p.element('status').textContent, 'Animating...');
  p.tick();
  p.element('clearSolutionBtn').trigger();
  assert.equal(p.timers.size, 0);
  assert.equal(p.evaluate('solution'), null);
  assert.equal(p.element('startBtn').disabled, false);
  p.element('animateChk').checked = false;
  p.element('startBtn').trigger();
  p.tick();
  assert.equal(p.element('status').textContent, '✅ Solved');
});

test('CP animation begins with the first discovered cell, not the first empty cell', () => {
  const p = page();
  p.evaluate('cellClues=[-1,-1,0,-1]');
  p.element('strategySelect').value = 'propagation';
  p.element('animateChk').checked = true;
  p.element('startBtn').trigger();
  p.tick();
  p.tick();
  assert.equal(p.evaluate('JSON.stringify(solution)'), '[-1,-1,-1,1]');
  assert.equal(p.evaluate('animationMove.pos'), 3);
  assert.match(p.element('status').textContent, /^Forced placement: row 2, column 2/);
  assert.equal(p.evaluate('cellClues[2]'), 0);
  while (p.timers.size) p.tick();
  assert.equal(p.element('status').textContent, '✅ Solved');
  assert.equal(p.evaluate('JSON.stringify(solution)'), '[1,0,0,1]');
  assert.equal(p.evaluate('animationMove'), null);
});

test('each animation speed applies its requested delay without changing solve reports', () => {
  for (const strategy of ['backtracking', 'propagation']) {
    let expectedMetrics;
    for (const speed of [200, 500, 1000]) {
      const p = page();
      p.element('strategySelect').value = strategy;
      p.element('animateChk').checked = true;
      p.element('animationSpeed').value = String(speed);
      p.element('startBtn').trigger();
      p.tick();
      assert.equal(p.nextDelay(), 0, 'the first move should start immediately');
      p.tick();
      while (p.timers.size) {
        assert.equal(p.timers.size, 1);
        assert.equal(p.nextDelay(), speed);
        p.tick();
      }
      assert.equal(p.element('status').textContent, '✅ Solved');
      const metrics = p.element('timer').children[0].children.map(item => item.textContent);
      if (expectedMetrics) assert.deepEqual(metrics, expectedMetrics);
      expectedMetrics = metrics;
    }
  }
});

test('animation defaults to Fast and allows speed changes during playback', () => {
  const p = page();
  p.element('animateChk').checked = true;
  p.element('startBtn').trigger();
  p.tick();
  p.tick();
  assert.equal(p.nextDelay(), 200);
  p.element('animationSpeed').value = '1000';
  p.tick();
  assert.equal(p.nextDelay(), 1000);
  p.element('animationSpeed').value = '500';
  p.tick();
  assert.equal(p.nextDelay(), 500);
  p.element('clearSolutionBtn').trigger();
  assert.equal(p.timers.size, 0);
  assert.equal(p.element('status').textContent, 'Idle');
});

test('each animated move matches the search trace, including backtracking', () => {
  for (const strategy of ['backtracking', 'propagation']) {
    const p = page();
    p.evaluate(`ROWS=COLS=6; cellClues=Array(36).fill(-1); cellClues[2]=0;
      eqEdges=new Set(['0,0|1,0','1,0|1,1','1,1|0,1']);`);
    const expected = JSON.parse(p.evaluate(`(()=>{
      const events=[]; const result=solvePuzzle('${strategy}',events);
      return JSON.stringify({events,result});
    })()`));
    p.element('strategySelect').value = strategy;
    p.element('animateChk').checked = true;
    p.element('startBtn').trigger();
    p.tick();
    const partial = Array(36).fill(-1);
    assert.ok(expected.events.some(event => event.kind === 'undo'));
    for (const event of expected.events) {
      assert.equal(p.timers.size, 1, 'long traces should use only one pending timer');
      p.tick();
      partial[event.pos] = event.value;
      assert.equal(p.evaluate('JSON.stringify(solution)'), JSON.stringify(partial));
      assert.deepEqual(JSON.parse(p.evaluate('JSON.stringify(animationMove)')), event);
      if (event.kind === 'undo') assert.match(p.element('status').textContent, /^Backtrack:/);
      assert.equal(p.evaluate('cellClues[2]'), 0);
    }
    p.tick();
    assert.equal(p.timers.size, 0);
    assert.equal(p.element('status').textContent, '✅ Solved');
    assert.equal(p.evaluate('JSON.stringify(solution)'), JSON.stringify(expected.result.solution));
    assert.equal(p.element('startBtn').disabled, false);
    assert.equal(p.element('strategySelect').disabled, false);
  }
});

test('unsolvable searches animate failed guesses and undo them before reporting failure', () => {
  const p = page();
  p.evaluate("eqEdges.add('0,0|0,1')");
  p.element('animateChk').checked = true;
  p.element('startBtn').trigger();
  p.tick();
  assert.equal(p.element('status').textContent, 'Animating...');
  p.tick();
  assert.equal(p.evaluate('solution[0]'), 0);
  assert.match(p.element('status').textContent, /^Guess:/);
  p.tick();
  assert.equal(p.evaluate('solution[0]'), -1);
  assert.match(p.element('status').textContent, /^Backtrack:/);
  while (p.timers.size) p.tick();
  assert.equal(p.element('status').textContent, 'No solution');
  assert.equal(p.evaluate('solution'), null);
  assert.equal(p.evaluate('animationMove'), null);
  assert.equal(p.element('startBtn').disabled, false);
  assert.equal(p.element('timer').children.length, 1);
});

test('complete puzzles finish with animation enabled; invalid setups report no solution', () => {
  const p = page();
  p.element('animateChk').checked = true;
  p.evaluate('cellClues=[0,1,1,0]');
  p.element('startBtn').trigger();
  p.tick();
  assert.equal(p.element('status').textContent, '✅ Solved');
  assert.equal(p.element('startBtn').disabled, false);
  assert.equal(p.timers.size, 0);
  p.evaluate('cellClues=[1,1,1,1]');
  p.element('startBtn').trigger();
  p.tick();
  assert.equal(p.element('status').textContent, 'No solution');
  assert.equal(p.element('startBtn').disabled, false);
  assert.equal(p.evaluate('solution'), null);
});

test('Build Clear and resizing discard old results and pending animations', () => {
  const p = page();
  p.evaluate("cellClues=[0,-1,-1,-1]; diffEdges.add('0,0|0,1');");
  p.element('startBtn').trigger();
  p.element('clearBtn').trigger();
  assert.equal(p.timers.size, 0);
  assert.equal(p.evaluate('JSON.stringify(cellClues)'), '[-1,-1,-1,-1]');
  assert.equal(p.evaluate('diffEdges.size'), 0);
  p.element('startBtn').trigger();
  p.element('colsInp').value = '4';
  p.element('colsInp').trigger('change');
  assert.equal(p.timers.size, 0);
  assert.equal(p.evaluate('cellClues.length'), 8);
  assert.equal(p.element('status').textContent, 'Idle');
});
