import { auditDoc } from '../model/docAudit';
import { pushToast } from './toastStore';
import type { MapDoc } from '../model/types';

/**
 * The doc audit at an export door — anywhere bytes LEAVE the app: the JSON
 * download, Save version, Save a copy, and the auto-save a document switch
 * writes. App writers keep the doc coherent by construction, so a violation
 * here means some transform corrupted the live doc. The caller still writes
 * the bytes — the user's work is never held hostage to a bug — but the
 * failure surfaces as a persistent toast NOW, instead of being discovered as
 * a mangled file on some future load (the load path would repair or refuse
 * it, silently burying the writer bug). Returns the violations for tests.
 */
export function auditExportDoc(snap: MapDoc): string[] {
  const violations = auditDoc(snap);
  if (violations.length > 0) {
    const n = violations.length;
    pushToast(
      'error',
      `This map failed ${n} internal consistency check${n === 1 ? '' : 's'} ` +
        `(${violations[0]}). The file was still written, but this is a bug — please report it.`,
    );
  }
  return violations;
}
