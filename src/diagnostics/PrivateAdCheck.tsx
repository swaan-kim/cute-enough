import { useEffect, useRef, useState } from 'react';
import { Button, Top } from '@toss/tds-mobile';
import { closeMiniApp, subscribeNativeNavigation } from '../lib/nativeNavigation';
import { subscribeSafeArea } from '../lib/safeArea';
import { confirmRewardedAdReturn, disposeRewardedAd, getRewardedAdStatus, preloadRewardedAd,
  showRewardedAd, subscribeRewardedAdStatus, type RewardedAdStatus } from '../lib/rewardedAd';
import './PrivateAdCheck.css';

const STATUS_COPY: Record<RewardedAdStatus, string> = {
  disabled: '테스트 광고가 꺼져 있어요', unsupported: '현재 토스 앱에서 광고 지원을 확인하지 못했어요',
  idle: '광고를 준비할 수 있어요', loading: '광고를 준비하고 있어요. 최대 65초 걸릴 수 있어요',
  loaded: '광고 준비 완료', showing: '광고 화면을 여는 중이에요',
  'awaiting-confirmation': '광고가 열리지 않았다면 아래에서 다시 확인해 주세요',
  'reward-earned': '시청 완료 신호를 받았어요', error: '광고 준비 또는 표시에 실패했어요',
};

// Deliberately no user hash, pet API, reward API, storage or collected-photo
// dependency. Only the real SDK's official test-ad bridge is exercised here.
export function PrivateAdCheck() {
  const allowed = import.meta.env.VITE_AD_DIAGNOSTICS === 'true'
    && import.meta.env.VITE_APP_RUNTIME === 'private'
    && import.meta.env.VITE_ADS_ENABLED === 'true'
    && import.meta.env.VITE_ADS_TEST_MODE === 'true'
    && import.meta.env.VITE_REWARDED_AD_GROUP_ID === 'ait-ad-test-rewarded-id';
  const [status, setStatus] = useState<RewardedAdStatus>(getRewardedAdStatus);
  const [busy, setBusy] = useState(false);
  const [earned, setEarned] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController>();
  const mounted = useRef(false);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    mounted.current = true;
    const stopStatus = subscribeRewardedAdStatus(setStatus);
    const stopInsets = subscribeSafeArea();
    const leave = () => {
      if (abortRef.current) { abortRef.current.abort(); return; }
      void closeMiniApp().catch(() => setError('토스 상단 닫기 버튼으로 나갈 수 있어요.'));
    };
    const stopNavigation = subscribeNativeNavigation({ onBack: leave, onHome: leave });
    void preloadRewardedAd().catch(() => { if (active) setError('광고를 준비하지 못했어요. 아래 버튼으로 다시 확인해 주세요.'); });
    return () => {
      active = false;
      mounted.current = false;
      abortRef.current?.abort();
      stopStatus(); stopInsets(); stopNavigation(); disposeRewardedAd();
    };
  }, [allowed]);

  async function prepare() {
    if (!allowed || abortRef.current) return;
    setError('');
    try { await preloadRewardedAd(); }
    catch { if (mounted.current) setError('광고 준비에 실패했어요. 토스 버전과 연결 상태를 확인한 뒤 다시 눌러 주세요.'); }
  }

  async function show() {
    if (!allowed || abortRef.current || status !== 'loaded') return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true); setEarned(false); setOutcome(''); setError('');
    let earnedThisAttempt = false;
    try {
      await showRewardedAd(abort.signal, () => {
        earnedThisAttempt = true;
        if (mounted.current) setEarned(true);
      });
      if (mounted.current) setOutcome(earnedThisAttempt ? '광고 연결과 시청 완료 신호를 확인했어요.' : '시청 완료 신호는 아직 없어요.');
    } catch (failure) {
      if (!mounted.current) return;
      if (earnedThisAttempt) setOutcome('시청 완료 신호는 확인됐어요. 실제 티켓은 변경하지 않았어요.');
      else if (failure instanceof DOMException && failure.name === 'AbortError') setError('광고 테스트를 취소했어요.');
      else setError('광고가 끝나기 전에 닫혔거나 표시하지 못했어요. 다시 준비해 주세요.');
    } finally {
      if (abortRef.current === abort) abortRef.current = undefined;
      if (mounted.current) setBusy(false);
    }
  }

  if (!allowed) return <main className="screen-loading" role="alert">이 화면은 별도 테스트 파일에서만 열 수 있어요.</main>;
  const manual = status === 'awaiting-confirmation' || status === 'reward-earned';
  return <main className="private-ad-check" data-testid="private-ad-diagnostics">
    <span className="private-ad-check-badge">비공개 · 테스트 전용</span>
    <Top title={<Top.TitleParagraph size={28}>광고 연결을 확인해요</Top.TitleParagraph>}
      subtitleBottom={<Top.SubtitleParagraph>이미 본 강아지와 상관없이 테스트할 수 있어요</Top.SubtitleParagraph>} />
    <section className="private-ad-check-ticket" aria-label="테스트 티켓 0장">
      <strong>테스트 티켓 0장</strong>
      <p>실제 티켓·앨범·등록 기록은 그대로예요.</p>
    </section>
    <section className="private-ad-check-state">
      <p role="status">{STATUS_COPY[status]}</p>
      <p>시청 완료 신호: <strong>{earned ? '확인됐어요 ✓' : '아직 없어요'}</strong></p>
      {outcome && <p role="status">{outcome}</p>}
      {error && <p className="private-ad-check-error" role="alert">{error}</p>}
    </section>
    <div className="private-ad-check-actions">
      {manual ? <Button display="full" size="large" onClick={() => confirmRewardedAdReturn()}>
        {status === 'reward-earned' ? '광고를 닫고 돌아왔어요' : '광고 없이 돌아왔어요 · 다시 확인'}
      </Button> : status === 'loaded' ? <Button display="full" size="large" disabled={busy} onClick={() => void show()}>
        테스트 광고 보기
      </Button> : <Button display="full" size="large" disabled={busy || status === 'loading'} onClick={() => void prepare()}>
        {status === 'loading' ? '광고 준비 중…' : busy ? '광고 확인 중…' : '광고 준비 다시 확인'}
      </Button>}
    </div>
    <p className="private-ad-check-note">공식 테스트 광고만 사용해요. 실제 보상은 지급하지 않아요.<br />운영 광고의 송출 여부와 서버 보상 처리는 별도 확인이 필요해요.</p>
  </main>;
}
