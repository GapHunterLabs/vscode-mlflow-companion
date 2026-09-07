/**
 * Pure logic -- no `vscode` dependency. New niche, not a port.
 *
 * Layout and file formats verified against REAL local `mlruns/`
 * directories captured on GitHub (not a paraphrased guess), plus
 * MLflow's own protobuf source for the numeric status enum:
 *  - Run meta.yaml: PacktPublishing/Hyperparameter-Tuning-with-Python
 *    mlruns/6/a3112407148b4966b929bc9f8784a3d3/meta.yaml
 *  - Experiment meta.yaml: same repo, mlruns/6/meta.yaml
 *  - params/<name> file: plain value, no key, no trailing structure
 *    (e.g. mlruns/.../params/param1 contains just "12")
 *  - metrics/<name> file: one line per logged point,
 *    "<timestamp_ms> <value> <step>" (verified against
 *    mlruns/.../metrics/foo, 3 real logged points)
 *  - RunStatus enum (RUNNING=1, SCHEDULED=2, FINISHED=3, FAILED=4,
 *    KILLED=5): mlflow/mlflow mlflow/protos/service.proto, fetched via
 *    `gh api` 2026-09-07.
 *
 * A minimal hand-rolled YAML-subset reader is used for meta.yaml
 * instead of a full YAML parser dependency -- MLflow always writes
 * these as flat `key: value` files (confirmed in the real fixture
 * above: no nesting, no lists except the always-empty `tags: []`), so
 * a full YAML grammar isn't needed.
 */

export type RunStatus = 'RUNNING' | 'SCHEDULED' | 'FINISHED' | 'FAILED' | 'KILLED' | 'UNKNOWN';

const STATUS_BY_CODE: Record<string, RunStatus> = {
  '1': 'RUNNING',
  '2': 'SCHEDULED',
  '3': 'FINISHED',
  '4': 'FAILED',
  '5': 'KILLED',
};

/** Parses a flat MLflow meta.yaml (run or experiment) into a plain
 * string-keyed map. Strips MLflow's `'...'` quoting around numeric-
 * looking ids (e.g. `experiment_id: '6'`) and skips the always-empty
 * `tags: []` line, which this flat reader can't represent. */
export function parseMetaYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (value === '[]') continue; // e.g. "tags: []" -- not representable by this flat map, and MLflow's real per-run tags live in tags/<name> files anyway
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export interface MetricPoint {
  timestampMs: number;
  value: number;
  step: number;
}

/** Parses a metrics/<name> file: one "<timestamp_ms> <value> <step>"
 * per line, in the order MLflow appended them (chronological). */
export function parseMetricFile(text: string): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const [timestampMs, value, step] = parts.map(Number);
    if (Number.isNaN(timestampMs) || Number.isNaN(value) || Number.isNaN(step)) continue;
    points.push({ timestampMs, value, step });
  }
  return points;
}

export interface MlflowRun {
  runId: string;
  experimentId: string;
  status: RunStatus;
  startTime: number | null;
  endTime: number | null;
  params: Record<string, string>;
  metrics: Record<string, MetricPoint[]>;
  tags: Record<string, string>;
}

export function buildRun(
  meta: Record<string, string>,
  params: Record<string, string>,
  metrics: Record<string, MetricPoint[]>,
  tags: Record<string, string>
): MlflowRun {
  return {
    runId: meta.run_id ?? meta.run_uuid ?? '(unknown run)',
    experimentId: meta.experiment_id ?? '(unknown experiment)',
    status: STATUS_BY_CODE[meta.status ?? ''] ?? 'UNKNOWN',
    startTime: meta.start_time ? Number(meta.start_time) : null,
    endTime: meta.end_time ? Number(meta.end_time) : null,
    params,
    metrics,
    tags,
  };
}

/** For a metric with more than one recorded point, the "latest" value
 * is the one with the highest step (not the last line, in case a
 * report was regenerated out of order) -- ties broken by timestamp. */
export function latestMetricValue(points: MetricPoint[]): number | null {
  if (points.length === 0) return null;
  const latest = points.reduce((best, p) => (p.step > best.step || (p.step === best.step && p.timestampMs > best.timestampMs) ? p : best));
  return latest.value;
}
