/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_RUNTIME?: 'preview' | 'private' | 'production';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ADS_ENABLED?: 'true' | 'false';
  readonly VITE_ADS_TEST_MODE?: 'true' | 'false';
  readonly VITE_AD_DIAGNOSTICS?: 'true' | 'false';
  readonly VITE_REWARDED_AD_GROUP_ID?: string;
  readonly VITE_SHARE_OG_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
