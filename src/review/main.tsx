import React from 'react';
import ReactDOM from 'react-dom/client';
import ReviewApp from './ReviewApp';
import './styles.css';

const root = document.getElementById('review-root');

if (!root) {
  throw new Error('검수 화면을 표시할 review-root 요소가 없습니다.');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ReviewApp />
  </React.StrictMode>,
);
