import React from 'react';
import ReactDOM from 'react-dom/client';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import App from './App';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
function renderScreen(screen: React.ReactNode) { root.render(
  <React.StrictMode>
    <TDSMobileAITProvider brandPrimaryColor="#FF6B8A" fontScaleAvailable>
      {screen}
    </TDSMobileAITProvider>
  </React.StrictMode>,
); }

// Compile-time only: no query parameter or account setting can enable this in
// an ordinary app. The production build strips the entire diagnostic import.
if (import.meta.env.VITE_AD_DIAGNOSTICS === 'true'
  && import.meta.env.VITE_APP_RUNTIME === 'private'
  && import.meta.env.VITE_ADS_ENABLED === 'true'
  && import.meta.env.VITE_ADS_TEST_MODE === 'true'
  && import.meta.env.VITE_REWARDED_AD_GROUP_ID === 'ait-ad-test-rewarded-id') {
  renderScreen(<main className="screen-loading" role="status">광고 테스트 화면을 준비하고 있어요</main>);
  void import('./diagnostics/PrivateAdCheck').then(({ PrivateAdCheck }) => renderScreen(<PrivateAdCheck />))
    .catch(() => renderScreen(<main className="screen-loading" role="alert">테스트 화면을 열지 못했어요. 앱을 다시 열어 주세요.</main>));
} else renderScreen(<App />);
