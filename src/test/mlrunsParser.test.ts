import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetaYaml, parseMetricFile, buildRun, latestMetricValue } from '../mlrunsParser';

// Real fixture, fetched via `gh api` from
// PacktPublishing/Hyperparameter-Tuning-with-Python
// mlruns/6/a3112407148b4966b929bc9f8784a3d3/meta.yaml on 2026-09-07.
const REAL_RUN_META_YAML = `artifact_uri: file:///mnt/c/Users/Louis%20Owen/Desktop/Packt/Hyperparameter-Tuning-with-Python/mlruns/6/a3112407148b4966b929bc9f8784a3d3/artifacts
end_time: 1656994882161
entry_point_name: ''
experiment_id: '6'
lifecycle_stage: active
name: ''
run_id: a3112407148b4966b929bc9f8784a3d3
run_uuid: a3112407148b4966b929bc9f8784a3d3
source_name: ''
source_type: 4
source_version: ''
start_time: 1656994881395
status: 3
tags: []
user_id: louisowen6
`;

// Real fixture: same repo, mlruns/6/meta.yaml.
const REAL_EXPERIMENT_META_YAML = `artifact_location: file:///mnt/c/Users/Louis%20Owen/Desktop/Packt/Hyperparameter-Tuning-with-Python/mlruns/6
experiment_id: '6'
lifecycle_stage: active
name: example1
`;

// Real fixture: mlruns/.../metrics/foo, 3 real logged points.
const REAL_METRIC_FILE = `1656994881659 0.5957562753945062 1
1656994881689 1.373249995906063 2
1656994881718 2.2922696453675444 3
`;

test('parseMetaYaml reads the real run meta.yaml, unquoting string ids and skipping tags: []', () => {
  const meta = parseMetaYaml(REAL_RUN_META_YAML);
  assert.equal(meta.experiment_id, '6'); // was "'6'" (quoted) in the source
  assert.equal(meta.run_id, 'a3112407148b4966b929bc9f8784a3d3');
  assert.equal(meta.status, '3');
  assert.equal(meta.start_time, '1656994881395');
  assert.equal(meta.end_time, '1656994882161');
  assert.equal('tags' in meta, false);
});

test('parseMetaYaml reads the real experiment meta.yaml', () => {
  const meta = parseMetaYaml(REAL_EXPERIMENT_META_YAML);
  assert.equal(meta.name, 'example1');
  assert.equal(meta.experiment_id, '6');
  assert.equal(meta.lifecycle_stage, 'active');
});

test('parseMetricFile reads the real 3-point metric file in order', () => {
  const points = parseMetricFile(REAL_METRIC_FILE);
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], { timestampMs: 1656994881659, value: 0.5957562753945062, step: 1 });
  assert.deepEqual(points[2], { timestampMs: 1656994881718, value: 2.2922696453675444, step: 3 });
});

test('parseMetricFile ignores blank trailing lines', () => {
  assert.equal(parseMetricFile('100 1.0 0\n\n200 2.0 1\n').length, 2);
});

test('buildRun maps numeric status codes to real MLflow RunStatus names (verified against mlflow/mlflow service.proto)', () => {
  const meta = parseMetaYaml(REAL_RUN_META_YAML);
  const run = buildRun(meta, {}, {}, {});
  assert.equal(run.status, 'FINISHED'); // status: 3
  assert.equal(run.runId, 'a3112407148b4966b929bc9f8784a3d3');
  assert.equal(run.experimentId, '6');
  assert.equal(run.startTime, 1656994881395);
  assert.equal(run.endTime, 1656994882161);
});

test('buildRun maps every real RunStatus code (1-5)', () => {
  const statusFor = (code: string) => buildRun({ status: code }, {}, {}, {}).status;
  assert.equal(statusFor('1'), 'RUNNING');
  assert.equal(statusFor('2'), 'SCHEDULED');
  assert.equal(statusFor('3'), 'FINISHED');
  assert.equal(statusFor('4'), 'FAILED');
  assert.equal(statusFor('5'), 'KILLED');
  assert.equal(statusFor('99'), 'UNKNOWN');
});

test('latestMetricValue picks the point with the highest step, not the last line', () => {
  const points = parseMetricFile('100 1.0 0\n300 3.0 2\n200 2.0 1\n'); // out-of-order lines
  assert.equal(latestMetricValue(points), 3.0); // step 2, not the textually-last line (step 1)
});

test('latestMetricValue returns null for an empty metric', () => {
  assert.equal(latestMetricValue([]), null);
});
