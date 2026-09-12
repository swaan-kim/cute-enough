import { ApiError } from '../_shared/api-error.ts';
import { MAX_SUBMISSION_PHOTOS } from '../_shared/submission-photos.ts';
import { createPhotoReceipt, PHOTO_RECEIPT_TTL_MS, photoReceiptPathPrefix, type PhotoReceiptScope } from '../_shared/submission-photo-receipts.ts';

type DatabaseError = { message?: string; code?: string };
type Registration = { pet_id: string; reward_granted: boolean };
type Photo = { bytes: Uint8Array; mime: 'image/jpeg' };
type SubmissionArguments = Record<string, unknown> & {
  p_owner_hash: string; p_submission_id: string; p_pet_id: string;
};
export interface SubmissionClient {
  from(table: string): { select(columns: string): {
    in(column: string, values: string[]): PromiseLike<{ data: Array<{ storage_path: string }> | null; error: unknown }>;
  } };
  rpc(name: string, args: Record<string, unknown>): {
    single(): PromiseLike<{ data: unknown; error: DatabaseError | null }>;
  };
  storage: { from(bucket: string): {
    upload(path: string, bytes: Uint8Array, options: { contentType: string; cacheControl: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
    remove(paths: string[]): PromiseLike<{ error: unknown }>;
  } };
}

/** Call only before RPC dispatch, after a confirmed rollback, or for a losing retry. */
async function cleanUnreferencedAttempt(client: Pick<SubmissionClient, 'from' | 'storage'>, paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const checks = await Promise.all([
      client.from('pets').select('storage_path').in('storage_path', paths),
      client.from('pet_photos').select('storage_path').in('storage_path', paths),
    ]);
    if (checks.some((check) => check.error || !check.data)) return;
    const referenced = new Set(checks.flatMap((check) => check.data!.map((row) => row.storage_path)));
    const unused = paths.filter((path) => !referenced.has(path));
    if (unused.length) await client.storage.from('pet-photos').remove(unused);
  } catch {
    // Failed reference checks or cleanup retain private objects for later recovery.
  }
}

export async function uploadSubmissionPhoto(
  client: Pick<SubmissionClient, 'from' | 'storage'>,
  input: { ownerHash: string; submissionId: string; photoIndex: number } & PhotoReceiptScope,
  photo: Photo,
  secret: string,
): Promise<{ photoReceipt: string }> {
  const path = `${photoReceiptPathPrefix(input)}${input.photoIndex}-${crypto.randomUUID()}.jpg`;
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(photo.bytes).buffer)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const photoReceipt = await createPhotoReceipt({
    version: 1, purpose: 'registration', ...input, storagePath: path, sha256, expiresAt: Date.now() + PHOTO_RECEIPT_TTL_MS,
  }, secret);
  try {
    const { error } = await client.storage.from('pet-photos').upload(path, photo.bytes, {
      contentType: photo.mime, cacheControl: '3600', upsert: false,
    });
    if (error) throw error;
  } catch (error) {
    // No receipt has left the server and no registration was sent for this
    // uniquely generated path. Still confirm that no database row references it.
    // Addition staging retains uncertain uploads; its private batch references
    // live outside the legacy registration cleanup boundary.
    if (input.purpose !== 'photo-addition') await cleanUnreferencedAttempt(client, [path]);
    throw error;
  }
  return { photoReceipt };
}

function submissionError(error: DatabaseError): unknown {
  const known: Array<[string, number, string]> = [
    ['DAILY_UPLOAD_LIMIT_REACHED', 429, '강아지는 하루에 한 마리만 소개할 수 있어요.'],
    ['PENDING_UPLOAD_LIMIT_REACHED', 409, '검수 중인 강아지가 있어요. 검수가 끝난 뒤 다시 소개해 주세요.'],
    ['UPLOAD_CAPACITY_REACHED', 503, '오늘 받을 수 있는 강아지가 모두 모였어요. 내일 다시 소개해 주세요.'],
    ['INVALID_PHOTO_COUNT', 400, '사진은 1장부터 5장까지 골라 주세요.'],
    ['INVALID_PHOTO_PATH', 400, '등록할 사진을 다시 확인해 주세요.'],
    ['PET_PHOTO_MISSING', 503, '사진 저장을 확인하지 못했어요. 다시 시도해 주세요.'],
  ];
  for (const [code, status, message] of known) {
    if (error.message?.includes(code)) return new ApiError(code, status, message);
  }
  return error;
}

export async function registerSubmissionPhotos<T extends { pet: { id: string } }>(
  client: SubmissionClient,
  args: SubmissionArguments,
  photos: Photo[],
  recover: () => Promise<T | null | undefined>,
): Promise<{ registration: Registration; recovered?: never } | { recovered: T; registration?: never }> {
  if (photos.length < 1 || photos.length > MAX_SUBMISSION_PHOTOS) {
    throw new ApiError('INVALID_PHOTO_COUNT', 400, '사진은 1장부터 5장까지 골라 주세요.');
  }
  // A distinct pet UUID isolates every attempt, including concurrent retries.
  const paths = photos.map((_, index) => `${args.p_owner_hash}/${args.p_submission_id}/${args.p_pet_id}/${index}.jpg`);
  const attemptedPaths: string[] = [];
  try {
    for (const [index, photo] of photos.entries()) {
      attemptedPaths.push(paths[index]);
      const { error } = await client.storage.from('pet-photos').upload(paths[index], photo.bytes, {
        contentType: photo.mime, cacheControl: '3600', upsert: false,
      });
      if (error) throw error;
    }
  } catch (error) {
    // No registration has been sent, including when an upload response is lost.
    await cleanUnreferencedAttempt(client, attemptedPaths);
    throw error;
  }

  return registerSubmissionPhotoPaths(client, args, paths, recover, paths);
}

/**
 * The caller must verify all signed receipts before passing staged paths.
 * Staged receipts may be reused by concurrent finalizations. A read finding no
 * references cannot rule out their later commit, so these objects are retained.
 * Only unique legacy attempt paths can be supplied as exclusivelyOwnedPaths.
 */
export async function registerSubmissionPhotoPaths<T extends { pet: { id: string } }>(
  client: SubmissionClient,
  args: SubmissionArguments,
  paths: string[],
  recover: () => Promise<T | null | undefined>,
  exclusivelyOwnedPaths: string[] = [],
): Promise<{ registration: Registration; recovered?: never } | { recovered: T; registration?: never }> {
  let registration: Registration | undefined;
  let failure: DatabaseError;
  try {
    const { data, error } = await client.rpc('register_pet_submission_v4', {
      ...args, p_storage_paths: paths,
    }).single();
    if (!error && data && typeof data === 'object'
      && typeof (data as Registration).pet_id === 'string'
      && typeof (data as Registration).reward_granted === 'boolean') {
      registration = data as Registration;
    }
    failure = error ?? new Error('Pet registration result unavailable');
  } catch (error) {
    failure = error as DatabaseError;
  }
  if (registration?.pet_id === args.p_pet_id) return { registration };

  let committed: T | null = null;
  try { committed = await recover() ?? null; } catch { /* Preserve uncertain attempts when recovery also fails. */ }
  if (committed) {
    if (committed.pet.id !== args.p_pet_id) await cleanUnreferencedAttempt(client, exclusivelyOwnedPaths);
    return { recovered: committed };
  }
  if (registration) {
    // The RPC returned the first immutable submission; this attempt lost the race.
    await cleanUnreferencedAttempt(client, exclusivelyOwnedPaths);
    throw new Error('SUBMISSION_RESULT_UNAVAILABLE');
  }
  // SQL RAISE EXCEPTION confirms rollback. A timeout/transport error does not:
  // the RPC may still commit after a reference read, so keep every object then.
  if (failure?.code === 'P0001') await cleanUnreferencedAttempt(client, exclusivelyOwnedPaths);
  throw submissionError(failure ?? new Error('Pet registration failed'));
}
