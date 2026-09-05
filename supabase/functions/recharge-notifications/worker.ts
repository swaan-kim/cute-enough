import { decryptNotificationKey } from '../_shared/notification-crypto.ts';
import type { NotificationDatabase } from '../_shared/notification-settings.ts';
import type { NotificationSendOutcome } from '../_shared/notification-sender.ts';

type ClaimedJob = { job_id: string; claim_token: string };
type PreparedJob = { ownerHash: string; encryptedAnonymousKey: string; templateCode: string };

export async function processRechargeNotifications(input: {
  database: NotificationDatabase;
  encryptionKey: string;
  templateCode: string;
  send: (anonymousKey: string, templateCode: string) => Promise<NotificationSendOutcome>;
  limit?: number;
}): Promise<{ claimed: number; sent: number; skipped: number; failed: number; unknown: number }> {
  const result = { claimed: 0, sent: 0, skipped: 0, failed: 0, unknown: 0 };
  const { data, error } = await input.database.rpc('claim_recharge_notification_jobs', { p_limit: input.limit ?? 5 });
  if (error || !Array.isArray(data)) throw new Error('NOTIFICATION_CLAIM_FAILED');
  for (const job of data as ClaimedJob[]) {
    result.claimed++;
    const prepared = await input.database.rpc('prepare_recharge_notification_send', {
      p_job_id: job.job_id, p_claim_token: job.claim_token,
    });
    if (prepared.error) throw new Error('NOTIFICATION_PREPARE_FAILED');
    if (!prepared.data) { result.skipped++; continue; }
    const candidate = prepared.data as PreparedJob;
    let outcome: NotificationSendOutcome;
    try {
      if (candidate.templateCode !== input.templateCode) {
        outcome = { outcome: 'failed', reason: 'template_changed_requires_agreement' };
      } else {
        const anonymousKey = await decryptNotificationKey(candidate.encryptedAnonymousKey, candidate.ownerHash, input.encryptionKey);
        outcome = await input.send(anonymousKey, candidate.templateCode);
      }
    } catch {
      // Includes an unexpected sender exception. An already started request must
      // remain terminal even if the response or function execution was lost.
      outcome = { outcome: 'unknown', reason: 'worker_outcome_unknown' };
    }
    result[outcome.outcome]++;
    const finished = await input.database.rpc('finish_recharge_notification_send', {
      p_job_id: job.job_id, p_claim_token: job.claim_token,
      p_outcome: outcome.outcome, p_reason: outcome.reason,
    });
    if (finished.error) throw new Error('NOTIFICATION_FINISH_FAILED');
  }
  return result;
}

export async function matchesCronSecret(actual: string | null, expected: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([actual, expected].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
