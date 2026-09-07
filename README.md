# MLflow Companion (VS Code)

Browses local [MLflow](https://mlflow.org) tracking-store runs
(params, metrics, tags) in a sidebar tree, reading `mlruns/` directly
from disk — no tracking server, no MLflow UI, no network call.

**v0.1, new niche.** Not a port from the Gap Hunter Labs IntelliJ-
family catalog. Evidence: MLflow's own web UI requires running
`mlflow ui` (a local server) or `mlflow server` — there's no
lightweight, always-there editor view of `mlruns/` for a data
scientist who just wants to glance at recent runs without leaving VS
Code or starting another process.

## Real format, not a guess

The `mlruns/` directory layout and file formats this extension reads
were verified against **real, captured example directories** found on
GitHub (not a paraphrased description) — a run's `meta.yaml`, an
experiment's `meta.yaml`, a `params/<name>` file, and a real 3-point
`metrics/<name>` file — plus MLflow's own `service.proto` source for
the numeric run-status codes (`RUNNING=1` … `KILLED=5`). See the
comment at the top of `src/mlrunsParser.ts` for exact citations.

## What it does

An **MLflow Runs** view in the Explorer sidebar, populated by reading
a top-level `mlruns/` directory in your workspace (MLflow's default
local "file store" backend — the layout you get without configuring a
remote tracking server). Each experiment expands to its runs; each run
shows its status (`RUNNING`/`FINISHED`/`FAILED`/etc.) and expands to
its logged params, metrics (latest value + point count), and tags.

## v0.1 scope, honestly noted

- **Local file store only.** MLflow also supports a SQLite/Postgres/
  MySQL-backed tracking store and a remote tracking server — this
  extension reads only the plain-directory `mlruns/` layout used when
  no tracking URI is configured; neither the database backends nor a
  remote server's HTTP API are read.
- **Browsing, not comparison.** Lists what's there; doesn't yet chart
  metrics over steps or diff params across runs.
- **Read-only.** Never writes to `mlruns/`.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test
```

To build an installable package without publishing:

```bash
npx @vscode/vsce package
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
