# tango-solver
 
## Tango Puzzle Builder and Solver

As an experiment I built a solver for the logical Tango puzzles, which place suns and moons on a grid under simple adjacency and balance rules.
100% with AI; I did not write a single line of code.

## Rules of Tango

1. Fill every cell with either a sun (☀) or a moon (☾).
2. No more than two suns or moons may be adjacent vertically or horizontally.
3. Each row and each column must contain the same number of suns and moons.
4. Cells separated by an “=” sign must contain the same symbol.
5. Cells separated by an “×” sign must contain opposite symbols.
6. Each puzzle has a unique solution and can be solved by deduction (no guessing required).

## How I built the tool

Built with [Codex](https://github.com/openai/codex) and `o4-mini`.  I worked for about 1 hour based on code from the prior project "Zip Solver" which shares a lot of features.

## Issues I encountered (at time of writing):

* `o4-mini` undoing work that I had already completed successfully

Definitely an interesting experience.  I know these tools can struggle with bigger codebases but single page javascript widgets like this appear conquered.
