import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { validatePetDesign, hashPetDesign } from '../../supabase/functions/_shared/pet-design.ts';
import { PhotoTokenStore, applySecurityHeaders, createReviewApiHandler, createSupabaseReviewGateway,
  loadReviewConfig, validatePublicationInput, validateReviewInput, validateDraftInput, validatePhotoReviewInput } from './server-lib.mjs';

const PET_ID = '11111111-1111-4111-8111-111111111111';
const DESIGN_ID = '22222222-2222-4222-8222-222222222222';
const TRAITS = { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'cream', secondaryColor: 'caramel', markingPattern: 'none', muzzle: 'short', confidence: 1 };
const STYLE = { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' };
const DOCUMENT = validatePetDesign({ schemaVersion: 1, motionVersion: 1, viewBox: [0,0,180,156], nodes: [
  { tag: 'g', motion: 'tail', children: [{ tag: 'path', attrs: { d: 'M1 2Q3 4 5 6', fill: '#fff', 'data-cookie-custom-head': 'pom' } }] },
] });
const SHA = await hashPetDesign(DOCUMENT);
const EDITOR = { finalTraits: TRAITS, finalStyle: STYLE, publishedAccessory: null, editor: { schemaVersion: 1, document: DOCUMENT, baseDocument: DOCUMENT, input: { traits: TRAITS, style: STYLE } } };
const VERSIONS = { expectedDraftRevision: 1, expectedDesignVersion: 1 };
const DRAFT_INPUT = { petId: PET_ID, document: DOCUMENT, editorState: EDITOR, expectedDraftRevision: 0, expectedDesignVersion: 1 };
const DRAFT_ROW = { pet_id: PET_ID, revision: 1, expected_design_version: 1, document: DOCUMENT, sha256: SHA, editor_state: EDITOR };
const VERSION_ROW = { id: DESIGN_ID, pet_id: PET_ID, design_version: 2, document: DOCUMENT, sha256: SHA, editor_state: EDITOR };
const PUBLISHED = { id: DESIGN_ID, designVersion: 2, document: DOCUMENT, sha256: SHA };
const PENDING_ROW = { pet_id: PET_ID, name: '부용', traits: TRAITS, submitted_traits: TRAITS, submitted_style: STYLE,
  published_style: STYLE, created_at: '2026-08-29T00:00:00Z', storage_paths: ['private/photo.webp'], photo_present: true,
  accessory_selection_mode: 'reviewer', accessory_required: true, requested_accessory: null, published_accessory: null,
  design_version: 1, similar_pets: [] };

function fakeClient({ pending = [PENDING_ROW], drafts = [], catalog = [], versions = [], rpcResult, rpcError, sign } = {}) {
  const trace = [];
  const client = {
    from(table) {
      trace.push(['from',table]);
      const rows = { pending_pet_review_queue: pending, pet_design_drafts: drafts, pet_review_catalog: catalog, pet_design_versions: versions }[table];
      assert.ok(rows, `unexpected table ${table}`);
      const result = { data: rows, error: null };
      return { select(columns) { trace.push(['select',table,columns]); return this; },
        order() { return this; }, limit() { return this; }, eq() { return this; }, ilike() { return this; },
        in(column, ids) { trace.push(['in',table,column,ids]); return Promise.resolve(result); },
        then(resolve,reject) { return Promise.resolve(result).then(resolve,reject); },
      };
    },
    storage: { from(bucket) {
      assert.equal(bucket,'pet-photos');
      return { createSignedUrl: async (path,ttl) => {
        trace.push(['sign',path,ttl]);
        return sign ? sign(path,ttl) : { data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/pet-photos/${path}?token=secret` } };
      } };
    } },
    async rpc(name,args) { trace.push(['rpc',name,args]); return { data: rpcResult, error: rpcError }; },
  };
  return { client,trace,gateway:createSupabaseReviewGateway({ client,actor:'reviewer',supabaseUrl:'https://example.supabase.co' }) };
}

test('queue exposes safe metadata and opaque same-origin photo URLs',async(t)=>{
  const signedUrl='https://example.supabase.co/storage/v1/object/sign/pet-photos/owners/sensitive-hash/original.webp?token=secret';
  const fixture=await startFixture({gateway:{ listPending:async()=>[{
    petId:PET_ID,name:'부용',traits:TRAITS,submittedTraits:TRAITS,submittedStyle:STYLE,publishedStyle:STYLE,
    createdAt:'2026-08-29',photoPresent:true,signedPhotoUrls:[signedUrl],accessorySelectionMode:'reviewer',accessoryRequired:true,
    requestedAccessory:null,publishedAccessory:null,designVersion:1,similarPets:[],draftDesign:null,
    ownerHash:'sensitive-hash',storagePaths:['original.webp'],serviceRoleKey:'never-return-this',
  }] },fetchFn:async(url)=>{assert.equal(url,signedUrl);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/webp'}});} });
  t.after(fixture.close);
  const response=await fetch(`${fixture.origin}/api/review-queue`);
  assert.equal(response.status,200); assert.equal(response.headers.get('x-frame-options'),'DENY');
  const body=await response.text(); assert.doesNotMatch(body,/sensitive-hash|original.webp|secret|never-return-this/);
  const item=JSON.parse(body).items[0]; assert.equal(item.draftDesign,null);
  assert.match(item.photoUrls[0],/^\/api\/review-photo\/[A-Za-z0-9_-]+$/);
  const photo=await fetch(`${fixture.origin}${item.photoUrls[0]}`);
  assert.equal(photo.headers.get('content-type'),'image/webp'); assert.deepEqual([...new Uint8Array(await photo.arrayBuffer())],[1,2,3]);
});

test('additional photo queue hides storage paths; mutations require same origin and a valid decision',async(t)=>{
  const calls=[];
  const fixture=await startFixture({gateway:{
    listPhotoAdditions:async()=>[{ batchId:PET_ID,petId:PET_ID,name:'구르미',petStatus:'approved',expectedRevision:SHA,
      photos:[{photoId:DESIGN_ID,signedUrl:'https://example.supabase.co/storage/v1/object/sign/pet-photos/private/source.jpg?token=secret'}] }],
    reviewPhotoAddition:async(value)=>{calls.push(value);return {batchId:value.batchId,petId:PET_ID,status:value.decision};},
  }});
  t.after(fixture.close);
  const queue=await fetch(`${fixture.origin}/api/review-photo-additions`);
  const body=await queue.text(); assert.equal(queue.status,200); assert.doesNotMatch(body,/secret|source.jpg|signedUrl/);
  assert.match(JSON.parse(body).items[0].photos[0].url,/^\/api\/review-photo\//);
  const input={batchId:PET_ID,expectedRevision:SHA,decision:'approved',note:''};
  const forbidden=await fetch(`${fixture.origin}/api/review-photo-additions`,{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify(input)});
  assert.equal(forbidden.status,403);
  assert.equal((await post(fixture,'/api/review-photo-additions',{...input,decision:'rejected'})).status,400);
  assert.equal((await post(fixture,'/api/review-photo-additions',{...input,storagePath:'injected'})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await post(fixture,'/api/review-photo-additions',input)).status,200); assert.equal(calls.length,1);
});

test('review/draft mutations require exact origin and JSON before gateway calls',async(t)=>{
  const calls=[];
  const fixture=await startFixture({gateway:{review:async(input)=>{calls.push(input);return {petId:PET_ID,status:input.decision};},saveDraft:async()=>{throw Error('not called');}}});
  t.after(fixture.close);
  for(const route of ['/api/review','/api/review-design-draft']) {
    const denied=await fetch(`${fixture.origin}${route}`,{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});
    assert.equal(denied.status,403);
    const wrongType=await fetch(`${fixture.origin}${route}`,{method:'POST',headers:{origin:fixture.origin,'content-type':'text/plain'},body:'{}'});
    assert.equal(wrongType.status,415);
  }
  const accepted=await post(fixture,'/api/review',{petId:PET_ID.toUpperCase(),decision:'rejected',reason:'  사진이 흐려요.  '});
  assert.equal(accepted.status,200); assert.deepEqual(await accepted.json(),{petId:PET_ID,status:'rejected'});
  assert.deepEqual(calls,[{petId:PET_ID,decision:'rejected',reason:'사진이 흐려요.',finalName:null,reviewNote:null}]);
});

test('oversized, malformed, old PNG and malicious SVG requests never reach gateway',async(t)=>{
  let calls=0;
  const fixture=await startFixture({bodyLimitBytes:1200,gateway:{review:async()=>{calls++;},saveDraft:async()=>{calls++;}}}); t.after(fixture.close);
  assert.equal((await post(fixture,'/api/review',{petId:PET_ID,decision:'rejected',reason:'x'.repeat(2000)})).status,413);
  assert.equal((await post(fixture,'/api/review',{petId:'bad',decision:'approved'})).status,400);
  assert.equal((await post(fixture,'/api/review',{petId:PET_ID,decision:'approved',...VERSIONS,artwork:{pngDataUrl:'data:image/png'}})).status,400);
  assert.equal((await post(fixture,'/api/review-design-draft',{...DRAFT_INPUT,document:{...DOCUMENT,nodes:[{tag:'script'}]}})).status,400);
  assert.equal(calls,0);
});

test('photo tokens expire without revealing their upstream URL',()=>{
  let now=10000;const store=new PhotoTokenStore({now:()=>now,randomToken:()=>'opaque_token_1234567890'});
  const token=store.issue('https://example.invalid/private/path',180);assert.equal(store.consume(token),'https://example.invalid/private/path');
  now+=180000;assert.equal(store.consume(token),null);
});

test('gateway signs only photos for 180 seconds and returns creator draft',async()=>{
  const {gateway,trace}=fakeClient({drafts:[DRAFT_ROW]});
  const [row]=await gateway.listPending();
  assert.equal(row.signedPhotoUrls.length,1); assert.equal(row.draftDesign.sha256,SHA);assert.deepEqual(row.draftDesign.document,DOCUMENT);
  assert.ok(trace.some((item)=>item[0]==='sign'&&item[2]===180));
  assert.ok(trace.filter((item)=>item[0]==='select').every((item)=>!item[2].includes('owner_hash')));
});

test('queue keeps all five photos in order and reports the full submitted count',async()=>{
  const paths=Array.from({length:5},(_,index)=>`private/photo-${index}.jpg`);
  const {gateway}=fakeClient({pending:[{...PENDING_ROW,storage_paths:paths}]});
  const [row]=await gateway.listPending();
  assert.equal(row.photoCount,5);
  assert.equal(row.signedPhotoUrls.length,5);
  paths.forEach((path,index)=>assert.ok(row.signedPhotoUrls[index].includes(path)));
});

test('draft save re-reads and checks canonical SHA/revision',async()=>{
  const {gateway,trace}=fakeClient({drafts:[DRAFT_ROW],rpcResult:{draftRevision:1}});
  const saved=await gateway.saveDraft(DRAFT_INPUT);assert.equal(saved.sha256,SHA);assert.equal(saved.draftRevision,1);
  assert.deepEqual(trace.find((item)=>item[0]==='rpc'),['rpc','save_pet_design_draft',{
    p_pet_id:PET_ID,p_actor:'reviewer',p_document:DOCUMENT,p_editor_state:EDITOR,p_expected_draft_revision:0,p_expected_design_version:1,
  }]);
  const changed=fakeClient({drafts:[{...DRAFT_ROW,revision:2}],rpcResult:{draftRevision:1}});
  await assert.rejects(()=>changed.gateway.saveDraft(DRAFT_INPUT),/REVIEW_DRAFT_CHANGED/);
  const corrupt=fakeClient({drafts:[{...DRAFT_ROW,sha256:'0'.repeat(64)}],rpcResult:{draftRevision:1}});
  await assert.rejects(()=>corrupt.gateway.saveDraft(DRAFT_INPUT),/DESIGN_HASH_MISMATCH/);
});

test('review publishes saved draft only and returns the database envelope',async()=>{
  const result={petId:PET_ID,status:'approved',designVersion:2,publishedDesign:PUBLISHED,draftRevision:1};
  const {gateway,trace}=fakeClient({rpcResult:result});
  assert.deepEqual(await gateway.review({petId:PET_ID,decision:'approved',finalName:'치즈',reviewNote:'확정',...VERSIONS}),result);
  assert.deepEqual(trace.find((item)=>item[0]==='rpc'),['rpc','review_pet_submission_with_design',{
    p_pet_id:PET_ID,p_decision:'approved',p_actor:'reviewer',p_reason:null,p_final_name:'치즈',p_review_note:'확정',p_expected_draft_revision:1,p_expected_design_version:1,
  }]);assert.ok(trace.every((item)=>item[0]!=='sign'));
});

test('publication references optimistic versions and pause needs no draft',async()=>{
  const {gateway,trace}=fakeClient({rpcResult:{petId:PET_ID,status:'paused',designVersion:1}});
  await gateway.manage({petId:PET_ID,action:'pause',reviewNote:'확인',expectedDesignVersion:1});
  assert.deepEqual(trace.at(-1),['rpc','manage_pet_publication_with_design',{
    p_pet_id:PET_ID,p_action:'pause',p_actor:'reviewer',p_review_note:'확인',p_expected_draft_revision:null,p_expected_design_version:1,
  }]);
});

test('missing SVG RPC and domain conflicts never fall back to legacy approval',async()=>{
  for(const [error,expected] of [[{code:'PGRST202',message:'missing rpc'},/DESIGN_RPC_FAILED/],[{code:'P0001',message:'REVIEW_DRAFT_CHANGED'},/REVIEW_DRAFT_CHANGED/]]) {
    const {gateway,trace}=fakeClient({rpcError:error});
    await assert.rejects(()=>gateway.review({petId:PET_ID,decision:'approved',...VERSIONS}),expected);
    assert.deepEqual(trace.filter((item)=>item[0]==='rpc').map((item)=>item[1]),['review_pet_submission_with_design']);
  }
});

test('one failed photo does not hide remaining photos',async()=>{
  const {gateway}=fakeClient({pending:[{...PENDING_ROW,name:null,storage_paths:['missing.webp','present.webp']}],sign:async(path)=>
    path==='missing.webp'?{error:'not found'}:{data:{signedUrl:`https://example.supabase.co/storage/v1/object/sign/pet-photos/${path}?token=x`}}});
  const [row]=await gateway.listPending();assert.equal(row.name,'이름 없음');assert.equal(row.photoPresent,true);assert.equal(row.photoCount,2);assert.equal(row.signedPhotoUrls.length,1);assert.match(row.signedPhotoUrls[0],/present.webp/);
});

test('fully identical decoration comparison excludes partial similarities',async()=>{
  const exact={id:DESIGN_ID,name:'완전같음',traits:{...TRAITS,confidence:0.2},publishedStyle:STYLE,publishedAccessory:null,designVersion:1};
  const partial={...exact,id:'33333333-3333-4333-8333-333333333333',traits:{...TRAITS,secondaryColor:'white'}};
  const {gateway}=fakeClient({pending:[{...PENDING_ROW,similar_pets:[partial,exact]}]});
  assert.deepEqual((await gateway.listPending())[0].similarPets.map((pet)=>pet.name),['완전같음']);
});

test('catalog distinguishes missing/current/corrupt/stale SVG without PNG signing',async(t)=>{
  const ids=[PET_ID,'33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
  const catalog=ids.map((id,index)=>({pet_id:id,name:`친구${index}`,status:'approved',traits:TRAITS,published_style:STYLE,design_version:2,published_design_id:index===0?null:`design${index}`}));
  const versions=[{...VERSION_ROW,id:'design1',pet_id:ids[1]},{...VERSION_ROW,id:'design2',pet_id:ids[2],sha256:'0'.repeat(64)},{...VERSION_ROW,id:'design3',pet_id:ids[3],design_version:1}];
  const {gateway,trace}=fakeClient({catalog,versions});const items=await gateway.listCatalog();
  assert.deepEqual(items.map((item)=>item.designStatus),['missing','ready','unavailable','unavailable']);
  assert.deepEqual(items[1].publishedDesign.document,DOCUMENT);assert.equal(items[2].publishedDesign,null);assert.ok(trace.every((item)=>item[0]!=='sign'));
  const fixture=await startFixture({gateway:{listCatalog:async()=>items}});t.after(fixture.close);
  const response=await fetch(`${fixture.origin}/api/review-catalog`);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/illustrationUrl|pet-artwork|signedArtwork/);
});

test('draft route returns exact data without approving automatically',async(t)=>{
  let saves=0;const draft={petId:PET_ID,draftRevision:1,expectedDesignVersion:1,sha256:SHA,document:DOCUMENT,editorState:EDITOR};
  const fixture=await startFixture({gateway:{saveDraft:async(input)=>{saves++;assert.deepEqual(input,DRAFT_INPUT);return draft;},review:async()=>{throw Error('unauthorized approval');}}});t.after(fixture.close);
  const response=await post(fixture,'/api/review-design-draft',DRAFT_INPUT);assert.equal(response.status,200);assert.deepEqual(await response.json(),draft);assert.equal(saves,1);
});

test('validators enforce editable scene identity, versions, notes and final name',()=>{
  assert.deepEqual(validateDraftInput(DRAFT_INPUT),DRAFT_INPUT);
  assert.throws(()=>validateDraftInput({...DRAFT_INPUT,expectedDraftRevision:-1}),/REVIEW_DRAFT_VERSION_REQUIRED/);
  assert.throws(()=>validateDraftInput({...DRAFT_INPUT,editorState:{...EDITOR,editor:{...EDITOR.editor,document:{...DOCUMENT,viewBox:[0,0,200,156]}}}}),/INVALID_PET_DESIGN_EDITOR/);
  assert.throws(()=>validateReviewInput({petId:PET_ID,decision:'approved',...VERSIONS,finalName:'치즈',finalTraits:TRAITS}),/INVALID_REVIEW_REQUEST/);
  assert.throws(()=>validateReviewInput({petId:PET_ID,decision:'approved',finalName:'치즈',expectedDesignVersion:1}),/REVIEW_DRAFT_VERSION_REQUIRED/);
  assert.throws(()=>validateReviewInput({petId:PET_ID,decision:'rejected',reason:' '}),/REJECTION_REASON_REQUIRED/);
  assert.throws(()=>validateReviewInput({petId:PET_ID,decision:'approved',...VERSIONS,finalName:'치즈',reason:'불필요'}),/APPROVAL_REASON_NOT_ALLOWED/);
  assert.deepEqual(validateReviewInput({petId:PET_ID,decision:'approved',...VERSIONS,finalName:' 치즈 ',reviewNote:'확정'}),{petId:PET_ID,decision:'approved',...VERSIONS,finalName:'치즈',reviewNote:'확정',reason:null});
  assert.throws(()=>validateReviewInput({petId:PET_ID,decision:'approved',...VERSIONS,finalName:'다섯글자이름'}),/INVALID_FINAL_PET_NAME/);
  assert.throws(()=>validatePublicationInput({petId:PET_ID,action:'pause',reviewNote:' '}),/REVIEW_NOTE_REQUIRED/);
  assert.deepEqual(validatePublicationInput({petId:PET_ID,action:'pause',reviewNote:'원본 재확인',expectedDesignVersion:1}),{petId:PET_ID,action:'pause',reviewNote:'원본 재확인',expectedDesignVersion:1});
  assert.throws(()=>validatePublicationInput({petId:PET_ID,action:'revise',reviewNote:'수정',expectedDesignVersion:1}),/REVIEW_DRAFT_VERSION_REQUIRED/);
});

test('configuration keeps loopback host and server-only credentials',()=>{
  assert.throws(()=>loadReviewConfig({}),/REVIEW_SUPABASE_URL/);
  const config=loadReviewConfig({REVIEW_PORT:'4317',REVIEW_OPERATOR_ID:'reviewer',REVIEW_SUPABASE_SECRET_KEY:'server-secret',REVIEW_SUPABASE_URL:'https://example.supabase.co/path-is-discarded'});
  assert.equal(config.host,'127.0.0.1');assert.equal(config.port,4317);assert.equal(config.supabaseUrl,'https://example.supabase.co');assert.equal(config.operatorId,'reviewer');
  const legacy=loadReviewConfig({REVIEW_SUPABASE_SERVICE_ROLE_KEY:'legacy-secret',REVIEW_SUPABASE_URL:'https://example.supabase.co'});assert.equal(legacy.port,4178);
  assert.throws(()=>loadReviewConfig({REVIEW_SUPABASE_SECRET_KEY:'secret',REVIEW_SUPABASE_URL:'http://remote.example'}),/must use HTTPS/);
});

async function post(fixture,path,body){return fetch(`${fixture.origin}${path}`,{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json'},body:JSON.stringify(body)});}

const PHOTO_ID = '66666666-6666-4666-8666-666666666666';
const PHOTO_REVISION = 'a'.repeat(64);
const PHOTO_SNAPSHOT = { petId: PET_ID, revision: PHOTO_REVISION, photos: [
  { photoId: PHOTO_ID, storagePath: 'owners/private-hash/photo.jpg', caption: '산책 중', sortOrder: 0, isActive: true, available: true },
] };
test('photo review uses stable IDs, opaque URLs and exact-origin writes', async (t) => {
  let writes = 0;
  const signedUrl = 'https://example.supabase.co/storage/v1/object/sign/pet-photos/owners/private-hash/photo.jpg?token=secret';
  const snapshot = { ...PHOTO_SNAPSHOT, photos: PHOTO_SNAPSHOT.photos.map((photo) => ({ ...photo, signedUrl })) };
  const fixture = await startFixture({ gateway: {
    getPhotos: async (petId) => { assert.equal(petId, PET_ID); return snapshot; },
    savePhotos: async (input) => { writes++; assert.equal(input.photos[0].photoId, PHOTO_ID); return snapshot; },
  } });
  t.after(fixture.close);
  const response = await fetch(`${fixture.origin}/api/review-photos?petId=${PET_ID}`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /owners|private-hash|token=|storagePath|signedUrl/);
  const photo = JSON.parse(text).photos[0];
  assert.equal(photo.photoId, PHOTO_ID); assert.equal(photo.caption, '산책 중');
  assert.match(photo.url, /^\/api\/review-photo\/[A-Za-z0-9_-]+$/);
  const input = { petId: PET_ID, expectedRevision: PHOTO_REVISION, photos: [{ photoId: PHOTO_ID, caption: '산책 중' }] };
  assert.equal((await fetch(`${fixture.origin}/api/review-photos`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify(input) })).status, 403);
  assert.equal(writes, 0);
  assert.equal((await post(fixture, '/api/review-photos', input)).status, 200); assert.equal(writes, 1);
});
test('photo edit input rejects empty sets, duplicate IDs, forged fields and unsafe captions', () => {
  const input = { petId: PET_ID, expectedRevision: PHOTO_REVISION, photos: [{ photoId: PHOTO_ID, caption: null }] };
  for (const photos of [[], [...input.photos, ...input.photos], [{ photoId: PHOTO_ID, caption: null, storagePath: 'forged.jpg' }],
    ...['가'.repeat(31), '<script>', 'hello\nworld', '안\u200b녕'].map((caption) => [{ photoId: PHOTO_ID, caption }])]) {
    assert.throws(() => validatePhotoReviewInput({ ...input, photos }), /INVALID_REVIEW_PHOTOS/);
  }
  assert.throws(() => validatePhotoReviewInput({ ...input, expectedRevision: '' }), /INVALID_REVIEW_PHOTOS/);
  assert.equal(validatePhotoReviewInput({ ...input, photos: [{ photoId: PHOTO_ID, caption: '🐶'.repeat(30) }] }).photos[0].caption, '🐶'.repeat(30));
});
test('photo gateway preserves unavailable entries and only signs server-owned paths', async () => {
  const { gateway, trace } = fakeClient({ rpcResult: { ...PHOTO_SNAPSHOT, photos: [
    ...PHOTO_SNAPSHOT.photos, { photoId: DESIGN_ID, storagePath: 'withdrawn.jpg', caption: null, sortOrder: null, isActive: false, available: false },
  ] } });
  const result = await gateway.getPhotos(PET_ID);
  assert.equal(result.photos.length, 2); assert.equal(result.photos[1].signedUrl, null);
  assert.equal(trace.filter((entry) => entry[0] === 'sign').length, 1);
  assert.deepEqual(trace.find((entry) => entry[0] === 'rpc'), ['rpc', 'get_pet_photo_review', { p_pet_id: PET_ID }]);
});
test('photo save re-reads authoritative order and caption, detects mismatch without approval', async () => {
  const { gateway, trace } = fakeClient({ rpcResult: PHOTO_SNAPSHOT });
  const input = { petId: PET_ID, expectedRevision: 'b'.repeat(64), photos: [{ photoId: PHOTO_ID, caption: '산책 중' }] };
  assert.equal((await gateway.savePhotos(input)).revision, PHOTO_REVISION);
  assert.deepEqual(trace.filter((entry) => entry[0] === 'rpc').map((entry) => entry[1]), ['save_pet_photo_review', 'get_pet_photo_review']);
  await assert.rejects(() => gateway.savePhotos({ ...input, photos: [{ photoId: PHOTO_ID, caption: '다른 문구' }] }), /REVIEW_PHOTOS_CHANGED/);
});
test('missing photo migration fails clearly, with no fallback mutations', async () => {
  const { gateway, trace } = fakeClient({ rpcError: { code: 'PGRST202', message: 'function missing' } });
  await assert.rejects(() => gateway.getPhotos(PET_ID), /REVIEW_PHOTOS_SETUP_REQUIRED/);
  assert.equal(trace.length, 1);
});
async function startFixture({gateway,fetchFn=fetch,bodyLimitBytes}={}) {
  let handler;const server=http.createServer(async(request,response)=>{
    const expectedOrigin=`http://127.0.0.1:${server.address().port}`;applySecurityHeaders(response,expectedOrigin);
    handler??=createReviewApiHandler({bodyLimitBytes,expectedOrigin,fetchFn,gateway,logger:{error(){}}});
    if(!(await handler(request,response))){response.statusCode=404;response.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve)=>server.close(resolve))};
}
