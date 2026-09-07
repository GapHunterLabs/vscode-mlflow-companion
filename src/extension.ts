import * as vscode from 'vscode';
import { parseMetaYaml, parseMetricFile, buildRun, latestMetricValue, type MlflowRun, type MetricPoint } from './mlrunsParser';

async function readTextFile(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

async function listDirNames(uri: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => name);
  } catch {
    return [];
  }
}

async function readFlatFileDir(uri: vscode.Uri): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      result[name] = (await readTextFile(vscode.Uri.joinPath(uri, name))).trim();
    }
  } catch {
    // params/tags/metrics directory absent for this run -- treat as empty
  }
  return result;
}

async function readMetricsDir(uri: vscode.Uri): Promise<Record<string, MetricPoint[]>> {
  const result: Record<string, MetricPoint[]> = {};
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      result[name] = parseMetricFile(await readTextFile(vscode.Uri.joinPath(uri, name)));
    }
  } catch {
    // metrics directory absent -- no metrics logged for this run
  }
  return result;
}

interface ExperimentNode {
  experimentId: string;
  name: string;
  uri: vscode.Uri;
  runs: MlflowRun[];
}

async function loadExperiments(mlrunsUri: vscode.Uri): Promise<ExperimentNode[]> {
  const experiments: ExperimentNode[] = [];
  for (const experimentId of await listDirNames(mlrunsUri)) {
    if (experimentId === '.trash' || experimentId === 'models') continue; // MLflow's own reserved directories, not real experiments
    const experimentUri = vscode.Uri.joinPath(mlrunsUri, experimentId);
    let experimentMeta: Record<string, string> = {};
    try {
      experimentMeta = parseMetaYaml(await readTextFile(vscode.Uri.joinPath(experimentUri, 'meta.yaml')));
    } catch {
      continue; // not a real experiment directory (no meta.yaml) -- skip
    }
    const runs: MlflowRun[] = [];
    for (const runId of await listDirNames(experimentUri)) {
      const runUri = vscode.Uri.joinPath(experimentUri, runId);
      let runMeta: Record<string, string> = {};
      try {
        runMeta = parseMetaYaml(await readTextFile(vscode.Uri.joinPath(runUri, 'meta.yaml')));
      } catch {
        continue; // e.g. an "artifacts" leftover dir with no meta.yaml -- skip
      }
      const [params, tags, metrics] = await Promise.all([
        readFlatFileDir(vscode.Uri.joinPath(runUri, 'params')),
        readFlatFileDir(vscode.Uri.joinPath(runUri, 'tags')),
        readMetricsDir(vscode.Uri.joinPath(runUri, 'metrics')),
      ]);
      runs.push(buildRun(runMeta, params, metrics, tags));
    }
    experiments.push({ experimentId, name: experimentMeta.name || `(experiment ${experimentId})`, uri: experimentUri, runs });
  }
  return experiments;
}

type Node = ExperimentNode | { parent: ExperimentNode; run: MlflowRun } | { parent: MlflowRun; label: string };

class MlflowTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private experiments: ExperimentNode[] = [];

  constructor(private readonly mlrunsUri: vscode.Uri | undefined) {}

  async refresh(): Promise<void> {
    this.experiments = this.mlrunsUri ? await loadExperiments(this.mlrunsUri) : [];
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if ('run' in element) {
      const item = new vscode.TreeItem(
        `Run ${element.run.runId.slice(0, 8)} — ${element.run.status}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${Object.keys(element.run.params).length} param(s), ${Object.keys(element.run.metrics).length} metric(s)`;
      return item;
    }
    if ('label' in element) {
      return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    }
    const item = new vscode.TreeItem(`${element.name} (${element.runs.length} run(s))`, vscode.TreeItemCollapsibleState.Collapsed);
    item.resourceUri = element.uri;
    return item;
  }

  getChildren(element?: Node): Node[] {
    if (!element) return this.experiments;
    if ('run' in element) {
      const run = element.run;
      const paramLines = Object.entries(run.params).map(([k, v]) => ({ parent: run, label: `param: ${k} = ${v}` }));
      const metricLines = Object.entries(run.metrics).map(([k, points]) => ({
        parent: run,
        label: `metric: ${k} = ${latestMetricValue(points) ?? '(no points)'} (${points.length} point(s))`,
      }));
      const tagLines = Object.entries(run.tags).map(([k, v]) => ({ parent: run, label: `tag: ${k} = ${v}` }));
      return [...paramLines, ...metricLines, ...tagLines];
    }
    if ('label' in element) return [];
    return element.runs.map((run) => ({ parent: element, run }));
  }
}

async function findMlrunsUri(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return undefined;
  for (const folder of folders) {
    const candidate = vscode.Uri.joinPath(folder.uri, 'mlruns');
    try {
      const stat = await vscode.workspace.fs.stat(candidate);
      if (stat.type === vscode.FileType.Directory) return candidate;
    } catch {
      // no mlruns/ in this workspace folder -- try the next one
    }
  }
  return undefined;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const mlrunsUri = await findMlrunsUri();
  const provider = new MlflowTreeProvider(mlrunsUri);
  const treeView = vscode.window.createTreeView('mlflowCompanion.runs', { treeDataProvider: provider });
  context.subscriptions.push(treeView);
  await provider.refresh();

  if (mlrunsUri) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(mlrunsUri, '**/*'));
    context.subscriptions.push(watcher);
    const refresh = () => void provider.refresh();
    watcher.onDidCreate(refresh);
    watcher.onDidChange(refresh);
    watcher.onDidDelete(refresh);
  }

  context.subscriptions.push(vscode.commands.registerCommand('mlflowCompanion.refresh', () => void provider.refresh()));
}

export function deactivate(): void {
  // no-op: no timers, connections, or watchers outside context.subscriptions to tear down
}
