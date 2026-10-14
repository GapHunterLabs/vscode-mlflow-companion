import * as vscode from 'vscode';

/**
 * Asks the user to rate the extension on the Marketplace, once, after a
 * real amount of use -- never on install, never on a timer. This
 * extension is a tree view, not a linter, so "use" is measured as the
 * number of distinct MLflow runs it has actually loaded and shown (dedup'd
 * by run ID), not findings. Re-scanning the same runs on every
 * file-watcher refresh doesn't inflate the count towards the prompt.
 *
 * Persisted via `ExtensionContext.globalState` (not workspaceState) -- how
 * much this extension has been used isn't tied to any one workspace, and
 * neither is whether the user already answered.
 *
 * Standard mechanism used catalog-wide since 2026-08-24.
 */

const HITS_BEFORE_PROMPT = 10;
const MAX_TRACKED_KEYS = 200;

const KEY_SEEN = 'mlflowCompanion.review.seenRuns';
const KEY_ANSWERED = 'mlflowCompanion.review.answered';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/publishers/GapHunterLabs';

/**
 * Call once per distinct run loaded (e.g. the run ID). Safe to call
 * repeatedly with the same key or after the user has already answered --
 * both are no-ops.
 */
export function recordHit(context: vscode.ExtensionContext, key: string): void {
  if (context.globalState.get<boolean>(KEY_ANSWERED, false)) {
    return;
  }

  const seen = context.globalState.get<string[]>(KEY_SEEN, []);
  if (seen.includes(key)) {
    return;
  }

  const updated = [...seen, key].slice(-MAX_TRACKED_KEYS);
  void context.globalState.update(KEY_SEEN, updated);

  if (updated.length === HITS_BEFORE_PROMPT) {
    showPrompt(context);
  }
}

function showPrompt(context: vscode.ExtensionContext): void {
  const rateAction = 'Rate on Marketplace';
  const dismissAction = "Don't ask again";

  void vscode.window
    .showInformationMessage(
      `MLflow Companion: this has loaded ${HITS_BEFORE_PROMPT} of your MLflow runs -- if it's been useful, a rating on the Marketplace helps other developers find it.`,
      rateAction,
      dismissAction,
    )
    .then((selection) => {
      if (selection === rateAction) {
        void context.globalState.update(KEY_ANSWERED, true);
        void vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL));
      } else if (selection === dismissAction) {
        void context.globalState.update(KEY_ANSWERED, true);
      }
      // No selection (dismissed by clicking away): leave unanswered so it
      // can prompt again after the next real use.
    });
}
