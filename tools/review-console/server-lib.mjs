import { isDeepStrictEqual } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { validatePetDesign, hashPetDesign, canonicalPetDesign } from '../../supabase/functions/_shared/pet-design.ts';

export const REVIEW_HOST = '127.0.0.1';
export const SIGNED_PHOTO_TTL_SECONDS = 180;
export const DEFAULT_BODY_LIMIT_BYTES = 3 * 1024 * 1024;
export const DEFAULT_PHOTO_LIMIT_BYTES = 8 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PET_NAME_PATTERN = /^[가-힣A-Za-z0-9]{1,4}$/u;
const SAFE_RPC_CONFLICTS = new Set([
  'PET_NOT_PENDING',
  'PET_PHOTO_MISSING',
  'ACCESSORY_REVIEW_REQUIRED',
  'INVALID_PET_DESIGN',
  'SIMILARITY_REVIEW_NOTE_REQUIRED',
  'INVALID_FINAL_PET_NAME',
  'REVIEW_DESIGN_CHANGED',
  'INVALID_PET_DESIGN_DOCUMENT', 'INVALID_PET_DESIGN_EDITOR', 'REVIEW_DRAFT_CHANGED',
  'REVIEW_DESIGN_REQUIRED', 'PET_NOT_MANAGEABLE', 'REVIEW_ACTOR_REQUIRED',
  'PHOTO_REVIEW_NOT_ALLOWED', 'REVIEW_PHOTOS_CHANGED', 'INVALID_REVIEW_PHOTOS',
  'PHOTO_ADDITION_ALREADY_REVIEWED', 'PHOTO_ADDITION_CAPACITY_REACHED', 'PHOTO_ADDITION_NOT_FOUND', 'INVALID_PHOTO_ADDITION_REVIEW',
]);
const ACCESSORY_KINDS = new Set(['ribbon', 'scarf', 'vest', 'ball']);
const ACCESSORY_COLORS = new Set(['pink', 'sky', 'yellow', 'mint']);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FALLBACK_TRAITS = Object.freeze({
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'cream',
  secondaryColor: 'white',
  markingPattern: 'none',
  muzzle: 'short',
  confidence: 0,
});

class PublicHttpError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'PublicHttpError';
    this.status = status;
    this.code = code;
  }
}

class UpstreamError extends Error {
  constructor(operation, cause) {
    super(operation);
    this.name = 'UpstreamError';
    this.operation = operation;
    this.cause = cause;
  }
}

export function loadReviewConfig(env = process.env) {
  const supabaseUrl = requiredEnv(env, 'REVIEW_SUPABASE_URL');
  const secretKey = optionalEnv(env, 'REVIEW_SUPABASE_SECRET_KEY')
    ?? optionalEnv(env, 'REVIEW_SUPABASE_SERVICE_ROLE_KEY');
  if (!secretKey) {
    throw new Error('REVIEW_SUPABASE_SECRET_KEY or REVIEW_SUPABASE_SERVICE_ROLE_KEY is required.');
  }
  const parsedUrl = parseHttpUrl(supabaseUrl, 'REVIEW_SUPABASE_URL');
  enforceSecureSupabaseUrl(parsedUrl);
  const port = parsePort(env.REVIEW_PORT ?? '4178');
  const operatorId = (env.REVIEW_OPERATOR_ID ?? env.REVIEW_ACTOR ?? 'local-review-console').trim();

  if (!operatorId || operatorId.length > 100) {
    throw new Error('REVIEW_OPERATOR_ID must be between 1 and 100 characters.');
  }

  return Object.freeze({
    host: REVIEW_HOST,
    operatorId,
    port,
    secretKey,
    supabaseUrl: parsedUrl.origin,
  });
}

export function createSupabaseReviewGateway({ client, supabaseUrl, actor }) {
  if (!client) throw new TypeError('A Supabase client is required.');
  const expectedStorageOrigin = parseHttpUrl(supabaseUrl, 'supabaseUrl').origin;

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (['get_pet_photo_review', 'save_pet_photo_review'].includes(name) && error.code === 'PGRST202') {
        throw new PublicHttpError(503, 'REVIEW_PHOTOS_SETUP_REQUIRED');
      }
      const conflict = findSafeRpcConflict(error);
      if (conflict) throw new PublicHttpError(409, conflict);
      throw new UpstreamError('DESIGN_RPC_FAILED', error);
    }
    if (!isPlainRecord(data)) throw new UpstreamError('INVALID_DESIGN_RPC_RESPONSE');
    return data;
  }
  async function readDrafts(ids) {
    if (!ids.length) return new Map();
    const { data, error } = await client.from('pet_design_drafts')
      .select('pet_id,revision,expected_design_version,sha256,document,editor_state').in('pet_id', ids);
    if (error) throw new UpstreamError('DRAFT_QUERY_FAILED', error);
    return new Map(await Promise.all((data ?? []).map(async (row) => {
      const document = validatePetDesign(row.document);
      if (await hashPetDesign(document) !== row.sha256) throw new UpstreamError('DESIGN_HASH_MISMATCH');
      return [row.pet_id, { petId: row.pet_id, draftRevision: row.revision, expectedDesignVersion: row.expected_design_version,
        sha256: row.sha256, document, editorState: row.editor_state }];
    })));
  }
  async function readPhotoSet(petId) {
    const snapshot = await rpc('get_pet_photo_review', { p_pet_id: petId });
    if (snapshot.petId !== petId || !/^[a-f0-9]{64}$/.test(snapshot.revision) || !Array.isArray(snapshot.photos)) {
      throw new UpstreamError('INVALID_PHOTO_REVIEW_RESPONSE');
    }
    const ids = new Set();
    for (const photo of snapshot.photos) {
      if (!isPlainRecord(photo) || !UUID_PATTERN.test(photo.photoId) || ids.has(photo.photoId)
        || typeof photo.storagePath !== 'string' || typeof photo.isActive !== 'boolean'
        || typeof photo.available !== 'boolean' || !(photo.caption === null || typeof photo.caption === 'string')
        || !(photo.sortOrder === null || (Number.isInteger(photo.sortOrder) && photo.sortOrder >= 0 && photo.sortOrder < 16))) {
        throw new UpstreamError('INVALID_PHOTO_REVIEW_RESPONSE');
      }
      ids.add(photo.photoId);
    }
    return snapshot;
  }
  async function signPhotoSet(snapshot) {
    const photos = await Promise.all(snapshot.photos.map(async (photo) => {
      let signedUrl = null;
      if (photo.available) {
        const { data, error } = await client.storage.from('pet-photos').createSignedUrl(photo.storagePath, SIGNED_PHOTO_TTL_SECONDS);
        if (!error && typeof data?.signedUrl === 'string') signedUrl = validateSignedPhotoUrl(data.signedUrl, expectedStorageOrigin);
      }
      return { photoId: photo.photoId, caption: photo.caption, sortOrder: photo.sortOrder,
        isActive: photo.isActive, available: photo.available, signedUrl };
    }));
    return { petId: snapshot.petId, revision: snapshot.revision, photos };
  }
  return Object.freeze({
    async listPhotoAdditions() {
      const snapshot = await rpc('get_pet_photo_addition_review_queue', {});
      if (!Array.isArray(snapshot.items)) throw new UpstreamError('INVALID_PHOTO_ADDITION_RESPONSE');
      return Promise.all(snapshot.items.map(async (batch) => {
        if (!UUID_PATTERN.test(batch.batchId) || !UUID_PATTERN.test(batch.petId)
          || !/^[a-f0-9]{64}$/.test(batch.expectedRevision) || !Array.isArray(batch.photos)
          || batch.photos.length < 1 || batch.photos.length > 5) throw new UpstreamError('INVALID_PHOTO_ADDITION_RESPONSE');
        const photos = await Promise.all(batch.photos.map(async (photo) => {
          if (!UUID_PATTERN.test(photo.photoId) || typeof photo.storagePath !== 'string') throw new UpstreamError('INVALID_PHOTO_ADDITION_RESPONSE');
          let signedUrl = null;
          if (photo.available) {
            const { data, error } = await client.storage.from('pet-photos').createSignedUrl(photo.storagePath, SIGNED_PHOTO_TTL_SECONDS);
            if (!error && data?.signedUrl) signedUrl = validateSignedPhotoUrl(data.signedUrl, expectedStorageOrigin);
          }
          return { photoId: photo.photoId, signedUrl };
        }));
        return { batchId: batch.batchId, petId: batch.petId, name: batch.name, petStatus: batch.petStatus,
          createdAt: batch.createdAt, expectedRevision: batch.expectedRevision, photos };
      }));
    },
    async reviewPhotoAddition({ batchId, expectedRevision, decision, note }) {
      return rpc('review_pet_photo_addition', { p_batch_id: batchId, p_expected_revision: expectedRevision,
        p_decision: decision, p_note: note, p_actor: actor });
    },
    async getPhotos(petId) { return signPhotoSet(await readPhotoSet(petId)); },
    async savePhotos({ petId, expectedRevision, photos }) {
      const saved = await rpc('save_pet_photo_review', {
        p_pet_id: petId, p_expected_revision: expectedRevision, p_photos: photos, p_actor: actor,
      });
      const reread = await readPhotoSet(petId);
      const retained = reread.photos.filter((photo) => photo.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ photoId, caption }) => ({ photoId, caption }));
      if (reread.revision !== saved.revision || !isDeepStrictEqual(retained, photos)) {
        throw new PublicHttpError(409, 'REVIEW_PHOTOS_CHANGED');
      }
      return signPhotoSet(reread);
    },
    async listPending() {
      const { data, error } = await client
        .from('pending_pet_review_queue')
        .select('pet_id,name,submitted_traits,submitted_style,traits,published_style,created_at,storage_paths,photo_present,accessory_selection_mode,accessory_required,requested_accessory,published_accessory,design_version,similar_pets')
        .order('created_at', { ascending: false });

      if (error) throw new UpstreamError('QUEUE_QUERY_FAILED', error);

      const drafts = await readDrafts((data ?? []).map((row) => row.pet_id));
      return Promise.all((Array.isArray(data) ? data : []).map(async (row) => {
        const storagePaths = Array.isArray(row.storage_paths)
          ? row.storage_paths.filter((path) => typeof path === 'string' && path.length > 0)
          : [];

        const signedResults = await Promise.allSettled(storagePaths.map(async (storagePath) => {
          const { data: signed, error: signError } = await client.storage
            .from('pet-photos')
            .createSignedUrl(storagePath, SIGNED_PHOTO_TTL_SECONDS);

          if (signError || typeof signed?.signedUrl !== 'string') {
            throw new UpstreamError('PHOTO_SIGNING_FAILED', signError);
          }

          return validateSignedPhotoUrl(signed.signedUrl, expectedStorageOrigin);
        }));
        const signedPhotoUrls = signedResults
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value);

        const submittedTraits = isPlainRecord(row.submitted_traits)
          ? row.submitted_traits
          : (isPlainRecord(row.traits) ? row.traits : FALLBACK_TRAITS);
        const submittedStyle = isValidStyle(row.submitted_style, submittedTraits)
          ? row.submitted_style
          : inferStyle(submittedTraits);
        const accessorySelectionMode = row.accessory_selection_mode === 'owner' ? 'owner' : 'reviewer';
        const requestedAccessory = isValidAccessory(row.requested_accessory) ? row.requested_accessory : null;
        const publishedAccessory = isValidAccessory(row.published_accessory) ? row.published_accessory : null;
        const submittedAccessory = accessorySelectionMode === 'owner' ? requestedAccessory : publishedAccessory;
        const exactMatches = Array.isArray(row.similar_pets)
          ? row.similar_pets
            .filter(isReviewPetSummary)
            .filter((candidate) => isExactDecorationMatch(
              submittedTraits,
              submittedStyle,
              submittedAccessory,
              candidate,
            ))
            .slice(0, 3)
          : [];

        return {
          petId: row.pet_id,
          name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '이름 없음',
          traits: isPlainRecord(row.traits) ? row.traits : FALLBACK_TRAITS,
          submittedTraits,
          submittedStyle,
          publishedStyle: isValidStyle(row.published_style, row.traits)
            ? row.published_style
            : inferStyle(row.traits),
          createdAt: row.created_at,
          photoPresent: row.photo_present === true && signedPhotoUrls.length > 0,
          photoCount: storagePaths.length,
          signedPhotoUrls,
          accessorySelectionMode,
          accessoryRequired: row.accessory_required === true,
          requestedAccessory,
          publishedAccessory,
          designVersion: Number.isInteger(row.design_version) ? row.design_version : 1,
          similarPets: exactMatches,
          draftDesign: drafts.get(row.pet_id) ?? null,
        };
      }));
    },

    async saveDraft({ petId, document, editorState, expectedDraftRevision, expectedDesignVersion }) {
      const saved = await rpc('save_pet_design_draft', {
        p_pet_id: petId, p_actor: actor, p_document: document, p_editor_state: editorState,
        p_expected_draft_revision: expectedDraftRevision, p_expected_design_version: expectedDesignVersion,
      });
      const reread = (await readDrafts([petId])).get(petId);
      if (!reread || reread.draftRevision !== saved.draftRevision || reread.sha256 !== await hashPetDesign(document)) {
        throw new PublicHttpError(409, 'REVIEW_DRAFT_CHANGED');
      }
      return reread;
    },
    async review({ petId, decision, reason, finalName, reviewNote, expectedDraftRevision, expectedDesignVersion }) {
      return rpc('review_pet_submission_with_design', {
        p_pet_id: petId, p_decision: decision, p_actor: actor, p_reason: reason ?? null,
        p_final_name: finalName ?? null, p_review_note: reviewNote ?? null,
        p_expected_draft_revision: expectedDraftRevision ?? null, p_expected_design_version: expectedDesignVersion ?? null,
      });
    },

    async listCatalog(search = '') {
      let query = client.from('pet_review_catalog')
        .select('pet_id,name,status,traits,published_style,published_accessory,design_version,reviewed_at,review_note,published_design_id')
        .order('reviewed_at', { ascending: false })
        .limit(30);
      const normalized = typeof search === 'string' ? search.trim() : '';
      if (normalized) {
        query = UUID_PATTERN.test(normalized)
          ? query.eq('pet_id', normalized.toLowerCase())
          : query.ilike('name', `%${normalized.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
      }
      const { data, error } = await query;
      if (error) throw new UpstreamError('CATALOG_QUERY_FAILED', error);
      const rows = Array.isArray(data) ? data : [];
      const drafts = await readDrafts(rows.map((row) => row.pet_id));
      const ids = rows.map((row) => row.published_design_id).filter(Boolean);
      const versions = ids.length ? await client.from('pet_design_versions')
        .select('id,pet_id,design_version,sha256,document,editor_state').in('id', ids) : { data: [] };
      if (versions.error) throw new UpstreamError('DESIGN_QUERY_FAILED', versions.error);
      const byId = new Map((versions.data ?? []).map((row) => [row.id, row]));
      return Promise.all(rows.map(async (row) => {
        const designVersion = Number.isInteger(row.design_version) ? row.design_version : 1;
        const saved = byId.get(row.published_design_id);
        let publishedDesign = null;
        let designStatus = row.published_design_id ? 'unavailable' : 'missing';
        if (saved && saved.pet_id === row.pet_id && saved.design_version === designVersion) {
          try {
            const document = validatePetDesign(saved.document);
            if (await hashPetDesign(document) === saved.sha256) {
              publishedDesign = { id: saved.id, designVersion, sha256: saved.sha256, document };
              designStatus = 'ready';
            }
          } catch { /* Keep corrupt/unsupported data visible as a retry state. */ }
        }
        return {
        petId: row.pet_id,
        name: typeof row.name === 'string' ? row.name : null,
        status: row.status === 'paused' ? 'paused' : 'approved',
        traits: isValidTraits(row.traits) ? row.traits : FALLBACK_TRAITS,
        publishedStyle: isValidStyle(row.published_style, row.traits) ? row.published_style : inferStyle(row.traits),
        publishedAccessory: isValidAccessory(row.published_accessory) ? row.published_accessory : null,
        designVersion,
        reviewedAt: typeof row.reviewed_at === 'string' ? row.reviewed_at : null,
        reviewNote: typeof row.review_note === 'string' ? row.review_note : null,
        publishedDesign, designStatus,
        draftDesign: drafts.get(row.pet_id) ?? null,
        publishedEditorState: publishedDesign ? saved.editor_state : null,
      }; }));
    },

    async manage({ petId, action, reviewNote, expectedDraftRevision, expectedDesignVersion }) {
      return rpc('manage_pet_publication_with_design', {
        p_pet_id: petId, p_action: action, p_actor: actor, p_review_note: reviewNote,
        p_expected_draft_revision: expectedDraftRevision ?? null, p_expected_design_version: expectedDesignVersion,
      });
    },
  });
}

export class PhotoTokenStore {
  constructor({ now = Date.now, randomToken = () => randomBytes(32).toString('base64url'), maxEntries = 4096 } = {}) {
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.now = now;
    this.randomToken = randomToken;
  }

  issue(signedUrl, ttlSeconds = SIGNED_PHOTO_TTL_SECONDS) {
    this.purgeExpired();
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }

    let token;
    do token = this.randomToken(); while (this.entries.has(token));
    this.entries.set(token, {
      expiresAt: this.now() + ttlSeconds * 1000,
      signedUrl,
    });
    return token;
  }

  consume(token) {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry.signedUrl;
  }

  purgeExpired() {
    const currentTime = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= currentTime) this.entries.delete(token);
    }
  }
}

export function applySecurityHeaders(response, expectedOrigin) {
  const connectSource = expectedOrigin.replace(/^http:/, 'ws:');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; base-uri 'none'; connect-src 'self' ${connectSource}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`,
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

export function createReviewApiHandler({
  expectedOrigin,
  gateway,
  tokenStore = new PhotoTokenStore(),
  fetchFn = globalThis.fetch,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
  photoLimitBytes = DEFAULT_PHOTO_LIMIT_BYTES,
  logger = console,
}) {
  if (typeof fetchFn !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!gateway) throw new TypeError('A review gateway is required.');
  const allowedOrigin = parseHttpUrl(expectedOrigin, 'expectedOrigin').origin;
  const allowedHost = new URL(allowedOrigin).host;

  return async function handleReviewApi(request, response) {
    const url = new URL(request.url ?? '/', allowedOrigin);
    const isQueueRoute = url.pathname === '/api/review-queue';
    const isReviewRoute = url.pathname === '/api/review';
    const isCatalogRoute = url.pathname === '/api/review-catalog';
    const isPublicationRoute = url.pathname === '/api/review-publication';
    const isDraftRoute = url.pathname === '/api/review-design-draft';
    const isPhotosRoute = url.pathname === '/api/review-photos';
    const isAdditionsRoute = url.pathname === '/api/review-photo-additions';
    const photoToken = parsePhotoToken(url.pathname);

    if (!isQueueRoute && !isReviewRoute && !isCatalogRoute && !isPublicationRoute && !isDraftRoute && !isPhotosRoute && !isAdditionsRoute && !photoToken) return false;

    const requestId = randomUUID();
    try {
      enforceSameOrigin(request, allowedOrigin, allowedHost, isReviewRoute || isPublicationRoute || isDraftRoute || ((isPhotosRoute || isAdditionsRoute) && request.method !== 'GET'));

      if (isAdditionsRoute) {
        if (request.method === 'GET') {
          const items = await gateway.listPhotoAdditions();
          writeJson(response, 200, { items: items.map((batch) => ({ ...batch, photos: batch.photos.map((photo) => ({
            photoId: photo.photoId, url: photo.signedUrl ? `/api/review-photo/${tokenStore.issue(photo.signedUrl, SIGNED_PHOTO_TTL_SECONDS)}` : null,
          })) })) });
        } else if (request.method === 'POST') {
          enforceJsonContentType(request);
          writeJson(response, 200, await gateway.reviewPhotoAddition(validatePhotoAdditionReviewInput(await readJsonBody(request, bodyLimitBytes))));
        } else throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        return true;
      }

      if (isPhotosRoute) {
        let snapshot;
        if (request.method === 'GET') {
          const petId = requestRecord({ petId: url.searchParams.get('petId') }, ['petId'], 'INVALID_REVIEW_PHOTOS');
          snapshot = await gateway.getPhotos(petId);
        } else if (request.method === 'POST') {
          enforceJsonContentType(request);
          snapshot = await gateway.savePhotos(validatePhotoReviewInput(await readJsonBody(request, bodyLimitBytes)));
        } else throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        writeJson(response, 200, { petId: snapshot.petId, revision: snapshot.revision, photos: snapshot.photos.map((photo) => ({
          photoId: photo.photoId, caption: photo.caption, sortOrder: photo.sortOrder, isActive: photo.isActive,
          available: photo.available, url: photo.signedUrl ? `/api/review-photo/${tokenStore.issue(photo.signedUrl, SIGNED_PHOTO_TTL_SECONDS)}` : null,
        })) });
        return true;
      }

      if (isQueueRoute) {
        if (request.method !== 'GET') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        const rows = await gateway.listPending();
        const items = rows.map((row) => ({
          petId: row.petId,
          name: row.name,
          traits: row.traits,
          submittedTraits: row.submittedTraits,
          submittedStyle: row.submittedStyle,
          publishedStyle: row.publishedStyle,
          createdAt: row.createdAt,
          photoPresent: row.photoPresent,
          photoCount: row.photoCount ?? row.signedPhotoUrls.length,
          photoUrls: row.signedPhotoUrls.map((signedUrl) => {
            const token = tokenStore.issue(signedUrl, SIGNED_PHOTO_TTL_SECONDS);
            return `/api/review-photo/${token}`;
          }),
          accessorySelectionMode: row.accessorySelectionMode,
          accessoryRequired: row.accessoryRequired,
          requestedAccessory: row.requestedAccessory,
          publishedAccessory: row.publishedAccessory,
          designVersion: row.designVersion,
          similarPets: row.similarPets,
          draftDesign: row.draftDesign ?? null,
        }));
        writeJson(response, 200, { items });
        return true;
      }

      if (isDraftRoute) {
        if (request.method !== 'POST') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        enforceJsonContentType(request);
        const input = validateDraftInput(await readJsonBody(request, bodyLimitBytes));
        writeJson(response, 200, await gateway.saveDraft(input));
        return true;
      }
      if (isReviewRoute) {
        if (request.method !== 'POST') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        enforceJsonContentType(request);
        const body = await readJsonBody(request, bodyLimitBytes);
        const input = validateReviewInput(body);
        writeJson(response, 200, await gateway.review(input));
        return true;
      }

      if (isCatalogRoute) {
        if (request.method !== 'GET') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        const search = (url.searchParams.get('q') ?? '').trim();
        if (search.length > 50) throw new PublicHttpError(400, 'INVALID_CATALOG_QUERY');
        const rows = await gateway.listCatalog(search);
        writeJson(response, 200, { items: rows });
        return true;
      }

      if (isPublicationRoute) {
        if (request.method !== 'POST') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        enforceJsonContentType(request);
        const input = validatePublicationInput(await readJsonBody(request, bodyLimitBytes));
        writeJson(response, 200, await gateway.manage(input));
        return true;
      }

      if (request.method !== 'GET') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
      const signedUrl = tokenStore.consume(photoToken);
      if (!signedUrl) throw new PublicHttpError(404, 'PHOTO_LINK_EXPIRED');
      await proxyPhoto(response, signedUrl, fetchFn, photoLimitBytes);
      return true;
    } catch (error) {
      const status = error instanceof PublicHttpError
        ? error.status
        : error instanceof UpstreamError
          ? 502
          : 500;
      const code = error instanceof PublicHttpError
        ? error.code
        : error instanceof UpstreamError
          ? 'UPSTREAM_ERROR'
          : 'INTERNAL_ERROR';

      logSafeError(logger, { requestId, route: url.pathname, status, error });
      if (!response.headersSent) writeJson(response, status, { error: code, requestId });
      else response.destroy();
      return true;
    }
  };
}

function requestRecord(value, keys, code) {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new PublicHttpError(400, code);
  const petId = typeof value.petId === 'string' ? value.petId.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(petId)) throw new PublicHttpError(400, 'INVALID_PET_ID');
  return petId;
}
export function validatePhotoAdditionReviewInput(value) {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !['batchId','expectedRevision','decision','note'].includes(key))
    || typeof value.batchId !== 'string' || !UUID_PATTERN.test(value.batchId)
    || typeof value.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedRevision)
    || !['approved','rejected'].includes(value.decision) || typeof value.note !== 'string'
    || [...value.note].length > 500 || /[<>\u0000-\u001f]/u.test(value.note)
    || (value.decision === 'rejected' && !value.note.trim())) throw new PublicHttpError(400, 'INVALID_PHOTO_ADDITION_REVIEW');
  return { batchId: value.batchId, expectedRevision: value.expectedRevision, decision: value.decision, note: value.note.trim() };
}

export function validatePhotoReviewInput(value) {
  const petId = requestRecord(value, ['petId', 'expectedRevision', 'photos'], 'INVALID_REVIEW_PHOTOS');
  if (typeof value.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedRevision)
    || !Array.isArray(value.photos) || value.photos.length < 1 || value.photos.length > 16) {
    throw new PublicHttpError(400, 'INVALID_REVIEW_PHOTOS');
  }
  const ids = new Set();
  const photos = value.photos.map((photo) => {
    if (!isPlainRecord(photo) || Object.keys(photo).length !== 2 || !Object.hasOwn(photo, 'photoId') || !Object.hasOwn(photo, 'caption')
      || typeof photo.photoId !== 'string' || !UUID_PATTERN.test(photo.photoId)
      || !(photo.caption === null || typeof photo.caption === 'string')
      || (typeof photo.caption === 'string' && ([...photo.caption].length > 30 || /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(photo.caption)))) {
      throw new PublicHttpError(400, 'INVALID_REVIEW_PHOTOS');
    }
    const photoId = photo.photoId.toLowerCase();
    if (ids.has(photoId)) throw new PublicHttpError(400, 'INVALID_REVIEW_PHOTOS');
    ids.add(photoId);
    return { photoId, caption: photo.caption?.trim() || null };
  });
  return { petId, expectedRevision: value.expectedRevision, photos };
}
function validateVersions(value, needsDraft = true, allowZero = false) {
  if (!Number.isSafeInteger(value.expectedDesignVersion) || value.expectedDesignVersion < 1) throw new PublicHttpError(400, 'REVIEW_DESIGN_VERSION_REQUIRED');
  if (needsDraft && (!Number.isSafeInteger(value.expectedDraftRevision) || value.expectedDraftRevision < (allowZero ? 0 : 1))) throw new PublicHttpError(400, 'REVIEW_DRAFT_VERSION_REQUIRED');
}
export function validateDraftInput(value) {
  const petId = requestRecord(value, ['petId','document','editorState','expectedDraftRevision','expectedDesignVersion'], 'INVALID_DRAFT_REQUEST');
  validateVersions(value, true, true);
  let document;
  try { document = validatePetDesign(value.document); } catch { throw new PublicHttpError(400, 'INVALID_PET_DESIGN_DOCUMENT'); }
  const state = value.editorState;
  if (!isPlainRecord(state) || Object.keys(state).some((key) => !['finalTraits','finalStyle','publishedAccessory','editor'].includes(key))
    || !isValidTraits(state.finalTraits) || !isValidStyle(state.finalStyle, state.finalTraits)
    || (state.publishedAccessory !== null && !isValidAccessory(state.publishedAccessory))
    || !isPlainRecord(state.editor) || state.editor.schemaVersion !== 1
    || !isPlainRecord(state.editor.input)
    || !isDeepStrictEqual(state.editor.input.traits, state.finalTraits)
    || !isDeepStrictEqual(state.editor.input.style, state.finalStyle)
    || !isDeepStrictEqual(state.editor.input.accessory ?? null, state.publishedAccessory)
    || Object.keys(state.editor.input).some((key) => !['traits','style','accessory','expression','signature','earVariant'].includes(key))
    || Object.keys(state.editor).some((key) => !['schemaVersion','input','baseDocument','document'].includes(key))
    || (state.editor.input.earVariant !== undefined && !['high-floppy','soft-upright'].includes(state.editor.input.earVariant))
    || (state.editor.input.signature !== undefined && !['sky-bandana','peach-hairpin','mint-collar','lemon-star','milk-carton','gray-backpack','birthday-star','chocolate-cookie','black-sunglasses','strawberry-milk','chive-bundle','chew-bone','cheese-wedge','cloud-cotton-candy'].includes(state.editor.input.signature))
    || (state.editor.input.expression !== undefined && !isValidStyle({ ...state.finalStyle, expression: state.editor.input.expression }, state.finalTraits))
    || JSON.stringify(state).length > 700000) {
    throw new PublicHttpError(400, 'INVALID_PET_DESIGN_EDITOR');
  }
  try {
    if (canonicalPetDesign(state.editor.document) !== canonicalPetDesign(document)) throw new Error('mismatch');
    validatePetDesign(state.editor.baseDocument);
  } catch { throw new PublicHttpError(400, 'INVALID_PET_DESIGN_EDITOR'); }
  return { petId, document, editorState: state, expectedDraftRevision: value.expectedDraftRevision, expectedDesignVersion: value.expectedDesignVersion };
}
export function validatePublicationInput(value) {
  const petId = requestRecord(value, ['petId','action','reviewNote','expectedDesignVersion','expectedDraftRevision'], 'INVALID_PUBLICATION_REQUEST');
  if (!['revise','pause','republish'].includes(value.action)) throw new PublicHttpError(400, 'INVALID_PUBLICATION_ACTION');
  const reviewNote = typeof value.reviewNote === 'string' ? value.reviewNote.trim() : '';
  if (!reviewNote || reviewNote.length > 500) throw new PublicHttpError(400, 'REVIEW_NOTE_REQUIRED');
  validateVersions(value, value.action !== 'pause');
  return { petId, action: value.action, reviewNote, expectedDesignVersion: value.expectedDesignVersion,
    ...(value.action !== 'pause' ? { expectedDraftRevision: value.expectedDraftRevision } : {}) };
}
export function validateReviewInput(value) {
  const petId = requestRecord(value, ['petId','decision','reason','finalName','reviewNote','expectedDraftRevision','expectedDesignVersion'], 'INVALID_REVIEW_REQUEST');
  if (!['approved','rejected'].includes(value.decision)) throw new PublicHttpError(400, 'INVALID_REVIEW_DECISION');
  const approved = value.decision === 'approved';
  if (approved) validateVersions(value);
  if (value.reason != null && typeof value.reason !== 'string') throw new PublicHttpError(400, 'INVALID_REVIEW_REASON');
  const reason = value.reason?.trim() ?? '';
  if (reason.length > 500) throw new PublicHttpError(400, 'INVALID_REVIEW_REASON');
  if (!approved && !reason) throw new PublicHttpError(400, 'REJECTION_REASON_REQUIRED');
  if (approved && reason) throw new PublicHttpError(400, 'APPROVAL_REASON_NOT_ALLOWED');
  if (value.reviewNote != null && typeof value.reviewNote !== 'string') throw new PublicHttpError(400, 'INVALID_REVIEW_NOTE');
  const reviewNote = value.reviewNote?.trim() ?? '';
  if (reviewNote.length > 500) throw new PublicHttpError(400, 'INVALID_REVIEW_NOTE');
  const finalName = approved && typeof value.finalName === 'string' ? value.finalName.normalize('NFKC').trim() : null;
  if (approved && !PET_NAME_PATTERN.test(finalName ?? '')) throw new PublicHttpError(400, 'INVALID_FINAL_PET_NAME');
  return { petId, decision: value.decision, reason: approved ? null : reason, finalName, reviewNote: reviewNote || null,
    ...(approved ? { expectedDraftRevision: value.expectedDraftRevision, expectedDesignVersion: value.expectedDesignVersion } : {}) };
}

function inferStyle(traits) {
  const source = isPlainRecord(traits) ? traits : FALLBACK_TRAITS;
  return {
    schemaVersion: 1,
    coatMode: source.baseColor === source.secondaryColor && source.markingPattern === 'none' ? 'solid' : 'point',
    furStyle: 'neat',
  };
}

function isValidTraits(value) {
  if (!isPlainRecord(value)) return false;
  const allowedKeys = new Set(['schemaVersion','earShape','headShape','baseColor','secondaryColor','markingPattern','muzzle','confidence']);
  return !Object.keys(value).some((key) => !allowedKeys.has(key)) && value.schemaVersion === 1
    && ['floppy','upright','semi','rounded'].includes(value.earShape)
    && ['round','oval','long'].includes(value.headShape)
    && ['cream','caramel','chocolate','black','gray','white'].includes(value.baseColor)
    && ['cream','caramel','chocolate','black','gray','white'].includes(value.secondaryColor)
    && ['none','brow','mask','blaze','spots'].includes(value.markingPattern)
    && ['short','medium','long'].includes(value.muzzle)
    && typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1;
}

function isValidStyle(value, traits) {
  if (!isPlainRecord(value) || !isValidTraits(traits)) return false;
  if (Object.keys(value).some((key) => !['schemaVersion','coatMode','furStyle','expression'].includes(key))) return false;
  const expression = value.expression;
  const expressionValid = expression === undefined || (isPlainRecord(expression)
    && !Object.keys(expression).some((key) => !['browStyle','tongueShape'].includes(key))
    && ['none','soft','caterpillar','angled'].includes(expression.browStyle)
    && ['drop','round','wide','side'].includes(expression.tongueShape));
  if (value.schemaVersion !== 1 || !['solid','point'].includes(value.coatMode)
    || !['neat','fluffy','cloud'].includes(value.furStyle) || !expressionValid) return false;
  return value.coatMode === 'solid'
    ? traits.baseColor === traits.secondaryColor && traits.markingPattern === 'none'
    : traits.baseColor !== traits.secondaryColor;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optionalEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error('REVIEW_PORT must be an integer between 1 and 65535.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('REVIEW_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  return parsed;
}

function enforceSecureSupabaseUrl(parsed) {
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (parsed.protocol !== 'https:' && !localHosts.has(parsed.hostname)) {
    throw new Error('REVIEW_SUPABASE_URL must use HTTPS (HTTP is allowed only for local Supabase).');
  }
}

function validateSignedPhotoUrl(value, expectedOrigin, bucket = 'pet-photos') {
  const parsed = parseHttpUrl(value, 'signed photo URL');
  const expectedPrefix = `/storage/v1/object/sign/${bucket}/`;
  if (parsed.origin !== expectedOrigin || !parsed.pathname.startsWith(expectedPrefix)) {
    throw new UpstreamError('INVALID_SIGNED_PHOTO_URL');
  }
  return parsed.href;
}

function findSafeRpcConflict(error) {
  const source = [error?.message, error?.details, error?.hint]
    .filter((part) => typeof part === 'string')
    .join(' ');
  for (const code of SAFE_RPC_CONFLICTS) {
    if (source.includes(code)) return code;
  }
  return null;
}

function isMissingReviewV5Rpc(error) {
  if (!isPlainRecord(error)) return false;
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';
  if (code !== 'PGRST202' && code !== '42883') return false;
  const source = [error.message, error.details, error.hint]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return source.includes('review_pet_submission_v5')
    && (source.includes('not find') || source.includes('does not exist') || source.includes('schema cache'));
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidAccessory(value) {
  if (!isPlainRecord(value)) return false;
  if (Object.keys(value).some((key) => !['kind', 'color', 'assetKey'].includes(key))) return false;
  if (!ACCESSORY_KINDS.has(value.kind) || !ACCESSORY_COLORS.has(value.color)) return false;
  return value.assetKey === `builtin:${value.kind}`;
}

function isReviewPetSummary(value) {
  return isPlainRecord(value)
    && typeof value.id === 'string'
    && (typeof value.name === 'string' || value.name === null)
    && isPlainRecord(value.traits)
    && (value.publishedAccessory === null || value.publishedAccessory === undefined || isValidAccessory(value.publishedAccessory));
}

function isExactDecorationMatch(traits, style, accessory, candidate) {
  const otherTraits = candidate.traits;
  const otherStyle = candidate.publishedStyle;
  if (!isPlainRecord(traits) || !isPlainRecord(style) || !isPlainRecord(otherTraits) || !isPlainRecord(otherStyle)) {
    return false;
  }

  const traitKeys = ['schemaVersion', 'earShape', 'headShape', 'baseColor', 'secondaryColor', 'markingPattern', 'muzzle'];
  return traitKeys.every((key) => traits[key] === otherTraits[key])
    && JSON.stringify(style) === JSON.stringify(otherStyle)
    && JSON.stringify(accessory ?? null) === JSON.stringify(candidate.publishedAccessory ?? null);
}

function parsePhotoToken(pathname) {
  const match = /^\/api\/review-photo\/([A-Za-z0-9_-]{20,128})$/.exec(pathname);
  return match?.[1] ?? null;
}

function enforceSameOrigin(request, expectedOrigin, expectedHost, requireOrigin) {
  if (request.headers.host !== expectedHost) throw new PublicHttpError(403, 'FORBIDDEN_ORIGIN');
  const origin = request.headers.origin;
  if ((requireOrigin && origin !== expectedOrigin) || (origin && origin !== expectedOrigin)) {
    throw new PublicHttpError(403, 'FORBIDDEN_ORIGIN');
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new PublicHttpError(403, 'FORBIDDEN_ORIGIN');
  }
}

function enforceJsonContentType(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new PublicHttpError(415, 'JSON_CONTENT_TYPE_REQUIRED');
  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new PublicHttpError(415, 'CONTENT_ENCODING_NOT_SUPPORTED');
  }
}

async function readJsonBody(request, limitBytes) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    request.resume();
    throw new PublicHttpError(413, 'REQUEST_BODY_TOO_LARGE');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limitBytes) throw new PublicHttpError(413, 'REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }

  if (total === 0) throw new PublicHttpError(400, 'INVALID_JSON');
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    throw new PublicHttpError(400, 'INVALID_JSON');
  }
}

async function proxyPhoto(response, signedUrl, fetchFn, limitBytes) {
  let upstream;
  try {
    upstream = await fetchFn(signedUrl, {
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new UpstreamError('PHOTO_FETCH_FAILED', error);
  }
  if (!upstream.ok) throw new UpstreamError('PHOTO_FETCH_FAILED');

  const contentType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new UpstreamError('UNEXPECTED_PHOTO_TYPE');
  }

  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new UpstreamError('PHOTO_TOO_LARGE');
  }

  const body = await readResponseBody(upstream, limitBytes);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', body.length);
  response.end(body);
}

async function readResponseBody(response, limitBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        throw new UpstreamError('PHOTO_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function logSafeError(logger, { requestId, route, status, error }) {
  if (!logger || typeof logger.error !== 'function') return;
  const operation = error instanceof UpstreamError ? error.operation : undefined;
  logger.error('[review-console] request failed', { operation, requestId, route, status });
}
