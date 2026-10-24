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
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { element, timers,
    evaluate: code => vm.runInContext(code, context),
    tick() {
      const [id, callback] = timers.entries().next().value;
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
