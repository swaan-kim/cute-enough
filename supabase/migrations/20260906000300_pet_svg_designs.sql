-- Additive SVG transition. No existing dog is approved or visually rewritten.
begin;

-- JSON keys are ordered lexically and insignificant whitespace is removed, matching
-- canonicalPetDesign. Attributes use strings; numeric scene fields are bounded.
create or replace function public.canonical_pet_design_json(p_value jsonb)
returns text language plpgsql immutable strict set search_path=public as $$
declare result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.canonical_pet_design_json(value),',' order by key collate "C"),'')||'}'
      into result from jsonb_each(p_value);
    when 'array' then
      select '['||coalesce(string_agg(public.canonical_pet_design_json(value),',' order by ordinal),'')||']'
      into result from jsonb_array_elements(p_value) with ordinality item(value,ordinal);
    when 'number' then result := trim_scale((p_value#>>'{}')::numeric)::text;
    else result := p_value::text;
  end case;
  return result;
end; $$;

create or replace function public.pet_design_sha256(p_document jsonb)
returns text language sql immutable strict set search_path=public as $$
  select encode(sha256(convert_to(public.canonical_pet_design_json(p_document),'UTF8')),'hex');
$$;

create or replace function public.is_valid_pet_design_nodes(p_nodes jsonb,p_depth integer default 1)
returns boolean language plpgsql immutable set search_path=public as $$
declare node jsonb; attr record; v text; numeric_value numeric; canonical_number text; token text[];
begin
  if p_nodes is null or jsonb_typeof(p_nodes)<>'array' or p_depth>24 or jsonb_array_length(p_nodes)>1024 then return false; end if;
  for node in select value from jsonb_array_elements(p_nodes) loop
    if jsonb_typeof(node)<>'object' or exists(select 1 from jsonb_object_keys(node) k where k not in ('tag','attrs','children','motion'))
      or coalesce(node->>'tag','') not in ('g','defs','mask','clipPath','path','circle','ellipse','rect','line','polyline','polygon','linearGradient','radialGradient','stop')
      or (node ? 'motion' and (coalesce(node->>'motion','') not in ('tail','tongue') or node->>'tag'<>'g')) then return false; end if;
    if node ? 'attrs' then
      if jsonb_typeof(node->'attrs')<>'object' or (select count(*) from jsonb_object_keys(node->'attrs'))>32 then return false; end if;
      for attr in select key,value from jsonb_each(node->'attrs') loop
        if attr.key not in ('id','d','fill','stroke','strokeWidth','strokeLinecap','strokeLinejoin','strokeMiterlimit','strokeDasharray','strokeDashoffset',
          'fillRule','clipRule','opacity','fillOpacity','strokeOpacity','transform','cx','cy','r','rx','ry','x','y','width','height','x1','x2','y1','y2',
          'points','mask','clipPath','maskUnits','maskContentUnits','clipPathUnits','pointerEvents','aria-hidden',
          'gradientUnits','gradientTransform','spreadMethod','stopColor','stopOpacity','offset','fx','fy') and attr.key !~ '^data-[a-z][a-z0-9-]{0,63}$'
          or (jsonb_typeof(attr.value)<>'string' and not (attr.key='aria-hidden' and attr.value='true'::jsonb)) then return false; end if;
        v:=attr.value#>>'{}';
        if length(v)>8192 or v ~ '[<>";\\]' or v ~ '[[:cntrl:]]' or v ~* '(javascript:|data:|https?:|@import|expression\s*\()' then return false; end if;
        if attr.key='id' and v !~ '^d[0-9]+$' then return false; end if;
        if attr.key in ('mask','clipPath') and v !~ '^(none|url\(#d[0-9]+\))$' then return false; end if;
        if attr.key in ('fill','stroke','stopColor') and v !~* '^(none|transparent|white|black|#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|url\(#d[0-9]+\))$' then return false; end if;
        if v ~* 'url\s*\(' and attr.key not in ('mask','clipPath','fill','stroke') then return false; end if;
        if attr.key like 'data-%' and length(v)>256 then return false; end if;
        if attr.key in ('x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','strokeWidth','strokeMiterlimit',
          'opacity','fillOpacity','strokeOpacity','stopOpacity','offset','fx','fy','strokeDashoffset') then
          if v !~* '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)(e[+-]?[0-9]+)?$' then return false; end if;
          numeric_value:=v::numeric;
          if abs(numeric_value)>100000 then return false; end if;
          canonical_number:=case when numeric_value=0 or abs(numeric_value)>=0.000001
            then trim_scale((numeric_value::double precision)::text::numeric)::text
            else regexp_replace((numeric_value::double precision)::text,'e(-?)0+([0-9]+)$','e\1\2') end;
          if v<>canonical_number then return false; end if;
          if attr.key in ('opacity','fillOpacity','strokeOpacity','stopOpacity','offset') and numeric_value not between 0 and 1 then return false; end if;
          if attr.key in ('r','rx','ry','width','height','strokeWidth') and numeric_value<0 then return false; end if;
        end if;
        if attr.key='d' and v !~ '^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,[:space:]-]*$' then return false; end if;
        if attr.key in ('points','strokeDasharray') and v !~ '^[0-9eE+.,[:space:]-]+$' then return false; end if;
        if attr.key in ('transform','gradientTransform') and v !~ '^([[:space:]]*(matrix|translate|scale|rotate|skewX|skewY)\([[:space:]0-9eE+.,-]+\)[[:space:]]*)+$' then return false; end if;
        if attr.key in ('d','points','strokeDasharray','transform','gradientTransform') then
          for token in select regexp_matches(v,'[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?','g') loop
            if abs((token[1]||coalesce(token[2],''))::numeric)>100000 then return false; end if;
          end loop;
        end if;
        if attr.key='strokeLinecap' and v not in ('round','butt','square') then return false; end if;
        if attr.key='strokeLinejoin' and v not in ('round','miter','bevel') then return false; end if;
        if attr.key in ('fillRule','clipRule') and v not in ('evenodd','nonzero') then return false; end if;
        if attr.key='pointerEvents' and v<>'none' then return false; end if;
        if attr.key='aria-hidden' and attr.value<>'true'::jsonb then return false; end if;
        if attr.key in ('maskUnits','maskContentUnits','clipPathUnits','gradientUnits') and v not in ('userSpaceOnUse','objectBoundingBox') then return false; end if;
        if attr.key='spreadMethod' and v not in ('pad','reflect','repeat') then return false; end if;
      end loop;
    end if;
    if node ? 'children' and (node->>'tag' not in ('g','defs','clipPath','mask','linearGradient','radialGradient') or not public.is_valid_pet_design_nodes(node->'children',p_depth+1)) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;

create or replace function public.is_valid_pet_design_v1(p_document jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare n jsonb; total integer; duplicate_count integer; invalid_refs integer; invalid_order integer;
begin
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(public.canonical_pet_design_json(p_document))>200000
    or exists(select 1 from jsonb_object_keys(p_document) k where k not in ('schemaVersion','motionVersion','viewBox','nodes'))
    or p_document->'schemaVersion' is distinct from '1'::jsonb or p_document->'motionVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_document->'viewBox') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_document->'viewBox')<>4 then return false; end if;
  for n in select value from jsonb_array_elements(p_document->'viewBox') loop
    if jsonb_typeof(n)<>'number' or abs((n#>>'{}')::numeric)>100000 or trunc((n#>>'{}')::numeric)<>(n#>>'{}')::numeric then return false; end if;
  end loop;
  if (p_document->'viewBox'->>2)::numeric<=0 or (p_document->'viewBox'->>3)::numeric<=0 or (p_document->'viewBox'->>2)::numeric>4096 or (p_document->'viewBox'->>3)::numeric>4096
    or not public.is_valid_pet_design_nodes(p_document->'nodes') then return false; end if;
  with recursive all_nodes(node) as (
    select value from jsonb_array_elements(p_document->'nodes')
    union all select child.value from all_nodes parent cross join lateral jsonb_array_elements(coalesce(parent.node->'children','[]')) child
  ) select count(*), count(node->'attrs'->>'id')-count(distinct node->'attrs'->>'id') into total,duplicate_count from all_nodes;
  with recursive all_nodes(node,ord) as (
    select value,array[ordinal] from jsonb_array_elements(p_document->'nodes') with ordinality item(value,ordinal)
    union all select child.value,parent.ord||child.ordinal from all_nodes parent
      cross join lateral jsonb_array_elements(coalesce(parent.node->'children','[]')) with ordinality child(value,ordinal)
  ), definitions as (
    select node->'attrs'->>'id' id,row_number() over(order by ord)-1 expected from all_nodes where node->'attrs' ? 'id'
  ), refs as (
    select substring(a.value#>>'{}' from '^url\(#(d[0-9]+)\)$') ref
    from all_nodes cross join lateral jsonb_each(coalesce(node->'attrs','{}')) a
    where a.key in ('mask','clipPath','fill','stroke') and a.value#>>'{}' like 'url(%'
  ) select (select count(*) from refs where not exists(select 1 from definitions d where d.id=refs.ref)),
    (select count(*) from definitions where id<>'d'||expected::text) into invalid_refs,invalid_order;
  return total between 1 and 1024 and duplicate_count=0 and invalid_refs=0 and invalid_order=0;
exception when others then return false;
end; $$;

create table if not exists public.pet_design_drafts (
  pet_id uuid primary key references public.pets(id),
  revision integer not null check(revision>0),
  expected_design_version integer not null check(expected_design_version>0),
  document jsonb not null check(public.is_valid_pet_design_v1(document)),
  sha256 text not null check(sha256=public.pet_design_sha256(document)),
  editor_state jsonb not null check(jsonb_typeof(editor_state)='object' and octet_length(editor_state::text)<=1048576),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create table if not exists public.pet_design_versions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id),
  design_version integer not null check(design_version>0),
  draft_revision integer not null check(draft_revision>0),
  document jsonb not null check(public.is_valid_pet_design_v1(document)),
  sha256 text not null check(sha256=public.pet_design_sha256(document)),
  editor_state jsonb not null check(jsonb_typeof(editor_state)='object' and octet_length(editor_state::text)<=1048576),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique(pet_id,design_version), unique(pet_id,id)
);
alter table public.pet_design_drafts enable row level security;
alter table public.pet_design_versions enable row level security;
revoke all on public.pet_design_drafts,public.pet_design_versions from public,anon,authenticated,service_role;
grant select on public.pet_design_drafts,public.pet_design_versions to service_role;
alter table public.pets add column if not exists published_design_id uuid;
alter table public.pets add constraint pets_published_design_identity foreign key(id,published_design_id)
  references public.pet_design_versions(pet_id,id) deferrable initially deferred;

create or replace function public.prevent_pet_design_version_mutation()
returns trigger language plpgsql set search_path=public as $$
begin raise exception 'PET_DESIGN_VERSION_IMMUTABLE'; end; $$;
create trigger pet_design_versions_immutable before update or delete on public.pet_design_versions
  for each row execute function public.prevent_pet_design_version_mutation();

-- Submitted owner intent stays immutable; only the reviewed output may differ.
create or replace function public.enforce_owner_accessory_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.accessory_selection_mode is distinct from old.accessory_selection_mode
    or new.requested_accessory is distinct from old.requested_accessory then raise exception 'OWNER_REQUEST_IMMUTABLE'; end if;
  return new;
end; $$;

create or replace function public.save_pet_design_draft(
  p_pet_id uuid,p_actor text,p_document jsonb,p_editor_state jsonb,
  p_expected_draft_revision integer,p_expected_design_version integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare pet public.pets%rowtype; draft public.pet_design_drafts%rowtype; next_revision integer; fingerprint text;
begin
  if nullif(trim(p_actor),'') is null then raise exception 'REVIEW_ACTOR_REQUIRED'; end if;
  select * into pet from public.pets where id=p_pet_id and status in ('pending','approved','paused') for update;
  if not found then raise exception 'PET_NOT_MANAGEABLE'; end if;
  if p_expected_design_version is null or pet.design_version<>p_expected_design_version then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  select * into draft from public.pet_design_drafts where pet_id=p_pet_id for update;
  if p_expected_draft_revision is null or coalesce(draft.revision,0)<>p_expected_draft_revision then raise exception 'REVIEW_DRAFT_CHANGED'; end if;
  if not public.is_valid_pet_design_v1(p_document) then raise exception 'INVALID_PET_DESIGN_DOCUMENT'; end if;
  if p_editor_state is null or jsonb_typeof(p_editor_state)<>'object' or octet_length(p_editor_state::text)>1048576
    or not coalesce(public.is_valid_pet_traits_v1(p_editor_state->'finalTraits'),false)
    or not coalesce(public.is_valid_pet_style_v1(p_editor_state->'finalStyle',p_editor_state->'finalTraits'),false)
    or (p_editor_state->'publishedAccessory' is not null and p_editor_state->'publishedAccessory'<>'null'::jsonb
      and not coalesce(public.is_valid_pet_accessory(p_editor_state->'publishedAccessory'),false))
    or p_editor_state->'editor'->'schemaVersion' is distinct from '1'::jsonb
    or p_editor_state->'editor'->'document' is distinct from p_document
    or not public.is_valid_pet_design_v1(p_editor_state->'editor'->'baseDocument')
    or jsonb_typeof(p_editor_state->'editor'->'input') is distinct from 'object'
    or p_editor_state->'editor'->'input'->'traits' is distinct from p_editor_state->'finalTraits'
    or p_editor_state->'editor'->'input'->'style' is distinct from p_editor_state->'finalStyle'
    or coalesce(p_editor_state->'editor'->'input'->'accessory','null'::jsonb) is distinct from coalesce(p_editor_state->'publishedAccessory','null'::jsonb)
    then raise exception 'INVALID_PET_DESIGN_EDITOR'; end if;
  if p_editor_state->'editor'->'input' ? 'expression' and (
    jsonb_typeof(p_editor_state->'editor'->'input'->'expression') is distinct from 'object'
    or coalesce(p_editor_state->'editor'->'input'->'expression'->>'browStyle','') not in ('none','soft','caterpillar','angled')
    or coalesce(p_editor_state->'editor'->'input'->'expression'->>'tongueShape','') not in ('drop','round','wide','side'))
    then raise exception 'INVALID_PET_DESIGN_EDITOR'; end if;
  if p_editor_state->'editor'->'input' ? 'earVariant'
    and coalesce(p_editor_state->'editor'->'input'->>'earVariant','') not in ('high-floppy','soft-upright')
    then raise exception 'INVALID_PET_DESIGN_EDITOR'; end if;
  -- New creator-side signature labels need no database enum or app release;
  -- their actual geometry is carried by document, not interpreted by the app.
  if p_editor_state->'editor'->'input' ? 'signature'
    and (jsonb_typeof(p_editor_state->'editor'->'input'->'signature')<>'string'
      or p_editor_state->'editor'->'input'->>'signature' !~ '^[a-z][a-z0-9-]{0,79}$')
    then raise exception 'INVALID_PET_DESIGN_EDITOR'; end if;
  next_revision:=coalesce(draft.revision,0)+1;
  fingerprint:=public.pet_design_sha256(p_document);
  insert into public.pet_design_drafts(pet_id,revision,expected_design_version,document,sha256,editor_state,updated_by)
    values(p_pet_id,next_revision,pet.design_version,p_document,fingerprint,p_editor_state,trim(p_actor))
    on conflict(pet_id) do update set revision=excluded.revision,expected_design_version=excluded.expected_design_version,
      document=excluded.document,sha256=excluded.sha256,editor_state=excluded.editor_state,updated_at=now(),updated_by=excluded.updated_by;
  insert into public.admin_audit_logs(pet_id,actor,action,detail) values(p_pet_id,trim(p_actor),'design_draft_saved',
    jsonb_build_object('draftRevision',next_revision,'expectedDesignVersion',pet.design_version,'sha256',fingerprint));
  return jsonb_build_object('petId',p_pet_id,'draftRevision',next_revision,'expectedDesignVersion',pet.design_version,
    'document',p_document,'sha256',fingerprint,'editorState',p_editor_state);
end; $$;

create or replace function public.publish_pet_design_draft(
  p_pet_id uuid,p_actor text,p_expected_draft_revision integer,p_expected_design_version integer
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare pet public.pets%rowtype; draft public.pet_design_drafts%rowtype; saved public.pet_design_versions%rowtype;
begin
  select * into pet from public.pets where id=p_pet_id for update;
  if not found then raise exception 'PET_NOT_FOUND'; end if;
  if p_expected_design_version is null or pet.design_version<>p_expected_design_version then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  select * into draft from public.pet_design_drafts where pet_id=p_pet_id for update;
  if not found then raise exception 'REVIEW_DESIGN_REQUIRED'; end if;
  if p_expected_draft_revision is null or draft.revision<>p_expected_draft_revision then raise exception 'REVIEW_DRAFT_CHANGED'; end if;
  if draft.expected_design_version<>pet.design_version then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  if not exists(select 1 from public.pet_photos photo join storage.objects object
    on object.bucket_id='pet-photos' and object.name=photo.storage_path where photo.pet_id=p_pet_id and photo.is_active)
    then raise exception 'PET_PHOTO_MISSING'; end if;
  insert into public.pet_design_versions(pet_id,design_version,draft_revision,document,sha256,editor_state,created_by)
    values(p_pet_id,pet.design_version+1,draft.revision,draft.document,draft.sha256,draft.editor_state,trim(p_actor)) returning * into saved;
  update public.pets set published_design_id=saved.id,design_version=saved.design_version,
    traits=draft.editor_state->'finalTraits',published_style=draft.editor_state->'finalStyle',
    published_accessory=nullif(draft.editor_state->'publishedAccessory','null'::jsonb) where id=p_pet_id;
  return jsonb_build_object('id',saved.id,'designVersion',saved.design_version,'sha256',saved.sha256,'document',saved.document);
end; $$;

create or replace function public.review_pet_submission_with_design(
  p_pet_id uuid,p_decision text,p_actor text,p_reason text default null,p_final_name text default null,
  p_review_note text default null,p_expected_draft_revision integer default null,p_expected_design_version integer default null
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare pet public.pets%rowtype; draft public.pet_design_drafts%rowtype; published jsonb; similarity integer; unchanged boolean;
begin
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'INVALID_REVIEW_DECISION'; end if;
  if nullif(trim(p_actor),'') is null then raise exception 'REVIEW_ACTOR_REQUIRED'; end if;
  if char_length(coalesce(p_review_note,''))>500 then raise exception 'REVIEW_NOTE_TOO_LONG'; end if;
  select * into pet from public.pets where id=p_pet_id and status='pending' for update;
  if not found then raise exception 'PET_NOT_PENDING'; end if;
  if (p_decision='approved' and p_expected_design_version is null)
    or (p_expected_design_version is not null and pet.design_version<>p_expected_design_version) then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  if p_decision='approved' then
    if coalesce(trim(p_final_name),'') !~ '^[가-힣A-Za-z0-9]{1,4}$' then raise exception 'INVALID_FINAL_PET_NAME'; end if;
    select * into draft from public.pet_design_drafts where pet_id=p_pet_id;
    if not found then raise exception 'REVIEW_DESIGN_REQUIRED'; end if;
    select coalesce(max(public.pet_design_similarity_score(draft.editor_state->'finalTraits',draft.editor_state->'finalStyle',other.traits,other.published_style)),0)
      into similarity from public.pets other where other.status='approved' and other.id<>p_pet_id;
    unchanged:=draft.editor_state->'finalTraits'=pet.submitted_traits and draft.editor_state->'finalStyle'=pet.submitted_style
      and coalesce(draft.editor_state->'publishedAccessory','null'::jsonb)=coalesce(pet.requested_accessory,'null'::jsonb);
    if similarity>=80 and unchanged and nullif(trim(coalesce(p_review_note,'')),'') is null then raise exception 'SIMILARITY_REVIEW_NOTE_REQUIRED'; end if;
    published:=public.publish_pet_design_draft(p_pet_id,p_actor,p_expected_draft_revision,p_expected_design_version);
    update public.pets set status='approved',name=trim(p_final_name),reviewed_at=now(),rejection_reason=null,
      owner_pinned_pending=false,review_note=nullif(trim(coalesce(p_review_note,'')),'') where id=p_pet_id;
    if pet.name is distinct from trim(p_final_name) then
      insert into public.admin_audit_logs(pet_id,actor,action,detail) values(p_pet_id,trim(p_actor),'review_name_corrected',jsonb_build_object('before',pet.name,'after',trim(p_final_name)));
    end if;
  else
    if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'REJECTION_REASON_REQUIRED'; end if;
    update public.pets set status='rejected',reviewed_at=now(),rejection_reason=trim(p_reason),owner_pinned_pending=false,
      review_note=nullif(trim(coalesce(p_review_note,'')),'') where id=p_pet_id;
  end if;
  insert into public.admin_audit_logs(pet_id,actor,action,detail) values(p_pet_id,trim(p_actor),'review_'||p_decision,
    jsonb_build_object('reason',p_reason,'reviewNote',p_review_note,'beforeDesignId',pet.published_design_id,
      'publishedDesignId',published->>'id','sha256',published->>'sha256','designVersion',coalesce((published->>'designVersion')::integer,pet.design_version),'similarityScore',similarity));
  return jsonb_build_object('petId',p_pet_id,'status',p_decision,'designVersion',coalesce((published->>'designVersion')::integer,pet.design_version),
    'publishedDesign',published,'draftRevision',p_expected_draft_revision);
end; $$;

create or replace function public.manage_pet_publication_with_design(
  p_pet_id uuid,p_action text,p_actor text,p_review_note text default null,
  p_expected_draft_revision integer default null,p_expected_design_version integer default null
) returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare pet public.pets%rowtype; published jsonb; next_status public.pet_status;
begin
  if p_action is null or p_action not in ('revise','pause','republish') then raise exception 'INVALID_PUBLICATION_ACTION'; end if;
  if nullif(trim(p_actor),'') is null or nullif(trim(coalesce(p_review_note,'')),'') is null then raise exception 'REVIEW_NOTE_REQUIRED'; end if;
  if char_length(p_review_note)>500 then raise exception 'REVIEW_NOTE_TOO_LONG'; end if;
  select * into pet from public.pets where id=p_pet_id and status in ('approved','paused') for update;
  if not found then raise exception 'PET_NOT_MANAGEABLE'; end if;
  if p_expected_design_version is null or pet.design_version<>p_expected_design_version then raise exception 'REVIEW_DESIGN_CHANGED'; end if;
  next_status:=case when p_action='pause' then 'paused'::public.pet_status else 'approved'::public.pet_status end;
  if p_action<>'pause' then published:=public.publish_pet_design_draft(p_pet_id,p_actor,p_expected_draft_revision,p_expected_design_version); end if;
  update public.pets set status=next_status,review_note=trim(p_review_note) where id=p_pet_id;
  insert into public.admin_audit_logs(pet_id,actor,action,detail) values(p_pet_id,trim(p_actor),'publication_'||p_action,
    jsonb_build_object('reviewNote',p_review_note,'beforeDesignId',pet.published_design_id,'publishedDesignId',coalesce(published->>'id',pet.published_design_id::text),
      'sha256',published->>'sha256','designVersion',coalesce((published->>'designVersion')::integer,pet.design_version)));
  return jsonb_build_object('petId',p_pet_id,'status',next_status,'designVersion',coalesce((published->>'designVersion')::integer,pet.design_version),
    'publishedDesign',published,'draftRevision',p_expected_draft_revision);
end; $$;

-- Future publication requires SVG. Existing untouched approvals remain unchanged
-- until the creator confirms each conversion; no PNG deletion happens here.
drop trigger if exists require_reviewed_artwork_for_publication on public.pets;
create or replace function public.require_svg_design_for_publication()
returns trigger language plpgsql security definer set search_path=public as $$
declare current_pet public.pets%rowtype; needs_design boolean;
begin
  if new.status<>'approved' then return null; end if;
  needs_design:=tg_op='INSERT';
  if tg_op='UPDATE' then needs_design:=old.status is distinct from new.status or old.design_version is distinct from new.design_version
    or old.traits is distinct from new.traits or old.published_style is distinct from new.published_style
    or old.published_accessory is distinct from new.published_accessory or old.published_design_id is distinct from new.published_design_id; end if;
  if not needs_design then return null; end if;
  select * into current_pet from public.pets where id=new.id;
  if current_pet.status<>'approved' then return null; end if;
  if current_pet.published_design_id is null or not exists(select 1 from public.pet_design_versions d
    where d.id=current_pet.published_design_id and d.pet_id=current_pet.id and d.design_version=current_pet.design_version
      and d.editor_state->'finalTraits'=current_pet.traits and d.editor_state->'finalStyle'=current_pet.published_style
      and nullif(d.editor_state->'publishedAccessory','null'::jsonb) is not distinct from current_pet.published_accessory)
    then raise exception 'REVIEW_DESIGN_REQUIRED'; end if;
  return null;
end; $$;
create constraint trigger require_svg_design_for_publication after insert or update on public.pets
  deferrable initially deferred for each row execute function public.require_svg_design_for_publication();

create or replace view public.pet_review_catalog with (security_barrier=true) as
select pet.id pet_id,pet.name,pet.status,pet.submitted_traits,pet.submitted_style,pet.traits,
  pet.published_style,pet.published_accessory,pet.design_version,pet.reviewed_at,pet.review_note,pet.reviewed_artwork,
  pet.published_design_id
from public.pets pet where pet.status in ('approved','paused');
revoke all on public.pet_review_catalog from public,anon,authenticated;
grant select on public.pet_review_catalog to service_role;

do $$ declare routine record; begin
  for routine in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname ~ '^review_pet_submission(_v[0-9]+|_with_artwork)?$'
      or p.proname ~ '^manage_pet_publication(_v[0-9]+|_with_artwork)?$'
      or p.proname in ('publish_pet_design_draft','save_pet_design_draft','review_pet_submission_with_design','manage_pet_publication_with_design',
        'require_svg_design_for_publication','prevent_pet_design_version_mutation','canonical_pet_design_json','pet_design_sha256','is_valid_pet_design_nodes','is_valid_pet_design_v1'))
  loop execute format('revoke execute on function %s from public,anon,authenticated,service_role',routine.signature); end loop;
end; $$;
grant execute on function public.save_pet_design_draft(uuid,text,jsonb,jsonb,integer,integer) to service_role;
grant execute on function public.review_pet_submission_with_design(uuid,text,text,text,text,text,integer,integer) to service_role;
grant execute on function public.manage_pet_publication_with_design(uuid,text,text,text,integer,integer) to service_role;
comment on column public.pets.requested_accessory is 'Immutable original owner request; creator-reviewed final output is stored separately.';
comment on column public.pets.published_design_id is 'Current immutable SVG scene; null only for unconverted historical approvals or pending submissions.';
commit;

