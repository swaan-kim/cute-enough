import React from 'react';
import ReactDOM from 'react-dom/client';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TDSMobileAITProvider brandPrimaryColor="#FF6B8A" fontScaleAvailable>
      <App />
    </TDSMobileAITProvider>
  </React.StrictMode>,
);
