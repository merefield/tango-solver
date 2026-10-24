# tango-solver
 
## Tango Puzzle Builder and Solver

As an experiment I built a solver for the fun Tango puzzles on LinkedIn, e.g.:

https://www.linkedin.com/games/tango/

Tango puzzles, require suns and moons to be placed on a grid under simple adjacency and balance rules.

99% written by AI

## Rules of Tango

1. Fill every cell with either a sun (☀) or a moon (☾).
2. No more than two suns or moons may be adjacent vertically or horizontally.
3. Each row and each column must contain the same number of suns and moons.
4. Cells separated by an “=” sign must contain the same symbol.
5. Cells separated by an “×” sign must contain opposite symbols.
6. Each puzzle has a unique solution and can be solved by deduction (no guessing required).

## Using the solver

Set up cell clues and `=` / `×` edges in **Build**, then switch to **Solve**.
Choose a strategy before pressing **Start**:

* **Backtracking** tries cells in row order and rejects choices that break a rule.
* **Constraint propagation + backtracking** repeatedly fills cells with only one
  legal symbol. It checks complete balanced row and column patterns with no three
  consecutive matching symbols, including `=` / `×` edges. This captures deductions
  such as a matching pair at one end forcing the opposite end of a six-cell line.
  Each line uses its own length, including on rectangular boards. If deductions
  stall, it branches on a cell with the fewest remaining choices.

The result reports `Time`, `Steps`, the strategy used, `Forced placements`,
`Guesses`, and `Backtracks`. A step is one candidate
symbol checked against the rules, including failed choices and propagation checks.
Filtering line patterns is additional work that is not counted as extra steps.
Time measures solving only, excluding the optional solution animation. Both
strategies stop at the first solution; they do not check uniqueness.

Forced placements count cells filled by propagation when only one candidate
remains. Guesses count trial placements made by search; backtracks count those
trial branches abandoned after failing to find a solution. Immediately rejected
candidates count only as steps. Plain backtracking makes trial placements without
a deduction phase, so its forced-placement count is zero. All counts include work
in unsuccessful branches and exclude the initial Build clues. Each run starts
with fresh counters.

Each solve appends a row to the results history. **Clear** on the Solve tab removes
the solution and cancels any pending animation, preserving the history and all
Build clues. The history resets when you switch to **Build** or refresh the page.
**Clear** on the Build tab clears the entire puzzle. Both grid dimensions must be
even to allow equal numbers of suns and moons in every row and column.

Run the automated checks with `node --test *.test.cjs` (Node.js 18 or later).
Run `node benchmark.cjs` for repeated solve timings on five synthetic puzzles.
To compare with a saved version, run `node benchmark.cjs /path/to/old/index.html`;
the comparison also checks that solutions and all report counters match.
The benchmark includes rule preparation and excludes drawing and animation.
It measures warmed Node.js performance; browser timings can differ.

## How I built the tool

Built with [Codex](https://github.com/openai/codex) and `o4-mini`.  I worked for about 1 hour based on code from the prior project ["Zip Solver"](https://github.com/merefield/zip-solver) which shares a lot of features.

## Issues I encountered (at time of writing):

* `o4-mini` undoing work that I had already completed successfully

Definitely an interesting experience.  I know these tools can struggle with bigger codebases but single page javascript widgets like this appear conquered.

## About me

I'm a freelance full-stack developer, specialising in Discourse, Rails, EmberJS & AI that can work on your project.  Find me @ https://merefield.tech
