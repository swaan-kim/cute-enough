import { ApiError } from './api-error.ts';
import { encryptNotificationKey } from './notification-crypto.ts';

export interface NotificationDatabase {
  rpc(name: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export type RechargeNotificationSettings = { enabled: boolean; available: boolean; templateCode?: string };
export type NotificationEnvironment = (name: string) => string | undefined;
const serverEnvironment: NotificationEnvironment = (name) => Deno.env.get(name);

export function notificationConfiguration(env: NotificationEnvironment = serverEnvironment) {
  const encryptionKey = env('NOTIFICATION_KEY_ENCRYPTION_KEY') ?? '';
  const templateCode = env('RECHARGE_NOTIFICATION_TEMPLATE_CODE') ?? '';
  const enabled = env('RECHARGE_NOTIFICATIONS_ENABLED') === 'true';
  let validKey = false;
  try { validKey = atob(encryptionKey).length === 32; } catch { /* Not deployable yet. */ }
  const available = enabled && validKey && Boolean(templateCode
    && env('RECHARGE_NOTIFICATION_CRON_SECRET')
    && env('AIT_MTLS_CERT_PEM') && env('AIT_MTLS_PRIVATE_KEY_PEM'));
  return { available, encryptionKey, templateCode };
}

export async function getRechargeNotificationSettings(
  database: NotificationDatabase,
  ownerHash: string,
  env: NotificationEnvironment = serverEnvironment,
): Promise<RechargeNotificationSettings> {
  const configuration = notificationConfiguration(env);
  const { data, error } = await database.rpc('get_recharge_notification_settings', { p_owner_hash: ownerHash });
  if (error) {
    // An app bundle may arrive before the optional notification migration.
    if (['PGRST202', '42883', '42P01'].includes(error.code ?? '')) return { enabled: false, available: false };
    throw new ApiError('NOTIFICATION_SETTINGS_UNAVAILABLE', 503, '알림 설정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
  const settings = data as { enabled?: unknown; templateCode?: unknown } | null;
  // A kill switch stops new subscriptions and sending, but users must still be
  // able to see and remove an existing subscription and its encrypted key.
  if (!configuration.available) return { enabled: settings?.enabled === true, available: false };
  return { enabled: settings?.enabled === true && settings.templateCode === configuration.templateCode,
    available: true, templateCode: configuration.templateCode };
}

/** Call only after verifying anonymousKey and deriving ownerHash with the existing identity salt. */
export async function setRechargeNotificationSettings(
  database: NotificationDatabase,
  input: { ownerHash: string; anonymousKey: string; enabled: boolean; tossAgreementGranted?: boolean },
  env: NotificationEnvironment = serverEnvironment,
): Promise<RechargeNotificationSettings> {
  const configuration = notificationConfiguration(env);
  if (input.enabled && (!configuration.available || input.tossAgreementGranted !== true)) {
    throw new ApiError('NOTIFICATION_AGREEMENT_REQUIRED', 409, '토스 알림 수신에 동의한 뒤 이용권 알림을 켤 수 있어요.');
  }
  const ciphertext = input.enabled
    ? await encryptNotificationKey(input.anonymousKey, input.ownerHash, configuration.encryptionKey)
    : null;
  const { error } = await database.rpc('set_recharge_notification_settings', {
    p_owner_hash: input.ownerHash,
    p_enabled: input.enabled,
    p_encrypted_anon_key: ciphertext,
    p_template_code: input.enabled ? configuration.templateCode : null,
  });
  if (error) throw new ApiError('NOTIFICATION_SETTINGS_UNAVAILABLE', 503, '알림 설정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  return { enabled: input.enabled, available: configuration.available,
    ...(configuration.available ? { templateCode: configuration.templateCode } : {}) };
}

/** Notification bookkeeping must never turn a successful house/shared request into an error. */
export async function noteRechargeNotificationVisit(database: NotificationDatabase, ownerHash: string): Promise<void> {
  try {
    await database.rpc('note_recharge_notification_visit', { p_owner_hash: ownerHash });
  } catch { /* Optional subsystem; never log the raw identifier or encryption envelope. */ }
}
