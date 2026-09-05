import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { notificationConfiguration } from '../_shared/notification-settings.ts';
import { sendRechargeNotification } from '../_shared/notification-sender.ts';
import { matchesCronSecret, processRechargeNotifications } from './worker.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!await matchesCronSecret(request.headers.get('x-recharge-cron-secret'), Deno.env.get('RECHARGE_NOTIFICATION_CRON_SECRET') ?? '')) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  const configuration = notificationConfiguration();
  if (!configuration.available) return json({ enabled: false });
  const denoWithHttpClient = Deno as typeof Deno & {
    createHttpClient?: (options: { cert: string; key: string }) => { close(): void };
  };
  if (!denoWithHttpClient.createHttpClient) return json({ error: 'MTLS_UNAVAILABLE' }, 503);
  const client = denoWithHttpClient.createHttpClient({
    cert: Deno.env.get('AIT_MTLS_CERT_PEM')!.replaceAll('\\n', '\n'),
    key: Deno.env.get('AIT_MTLS_PRIVATE_KEY_PEM')!.replaceAll('\\n', '\n'),
  });
  try {
    const database = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    return json(await processRechargeNotifications({
      database, encryptionKey: configuration.encryptionKey, templateCode: configuration.templateCode,
      send: (anonymousKey, templateCode) => sendRechargeNotification(anonymousKey, templateCode, client),
    }));
  } catch {
    // Do not serialize provider responses, credentials, keys, or job payloads.
    return json({ error: 'NOTIFICATION_WORKER_FAILED' }, 503);
  } finally {
    client.close();
  }
});
