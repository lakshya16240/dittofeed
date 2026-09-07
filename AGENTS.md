# Agents

## Commands

The following are useful commands for the agents:

```bash
# Lint a specific file in the backend-lib package. A similar command can be used for other packages.
yarn workspace backend-lib eslint src/resources.test.ts --fix

# Run tests for a specific file. A similar command can be used for other packages.
yarn jest packages/backend-lib/src/resources.test.ts

# Run tests and pipe output to a timestamped file in .tmp for debugging.
# Prefer this for large tests to avoid inflating context. The output file can be
# searched and explored more efficiently using Read, Grep, etc.
yarn test:file packages/backend-lib/src/resources.test.ts

# Run tests with jest flags (e.g., -t to filter by test name).
yarn test:file packages/backend-lib/src/resources.test.ts -t "specific test name"

# Reduces the log levels before running tests, providing more verbose log output.
LOG_LEVEL=debug yarn jest packages/backend-lib/src/resources.test.ts

# Run type checking for the backend-lib package. A similar command can be used for other packages.
yarn workspace backend-lib check
```

## Resource Constraints

This development machine has 14 GB of RAM, and the editor and all agent sessions
share a single cgroup that systemd-oomd will kill as a unit when memory pressure
spikes. An oversized build therefore takes down the whole editor, not just the
command. Keep every build and test command bounded:

```bash
# Cap the heap and the worker count on tests. jest.config.js defines five ts-jest
# projects, each of which type checks in every worker, so the default worker count
# is far too high for this machine.
NODE_OPTIONS=--max-old-space-size=3072 yarn jest packages/backend-lib/src/resources.test.ts --maxWorkers=1

# Type check one package at a time. Never run `tsc --build` from the repository root.
yarn workspace backend-lib check

# For anything heavier than a single test file, run it in its own cgroup so that only
# the command can be killed.
systemd-run --user --scope -p MemoryHigh=4G -p MemoryMax=6G \
  env NODE_OPTIONS=--max-old-space-size=3072 yarn workspace backend-lib check
```

- Do not run `yarn jest` or `yarn test` without a path filter, and do not run a
  workspace-wide `tsc --build`.
- Ask before running `yarn workspace dashboard build`, which is multi-gigabyte on its own.
- Run one heavy command at a time; do not issue build or test commands in parallel.

## Key Files and Directories

- packages/backend-lib/src/config.ts: Where the majority of our applications' environment variables and configuration values are resolved.
- .tmp/: this directory can be used output disposable files for debugging purposes
