// 서비스워커 등록·새 버전 안내·설치 안내·저장소 유지 요청.
// 화면에 무엇을 보일지는 app.js가 정하고, 여기서는 알맞은 때에 콜백만 부른다.

const PERSIST_ASKED = 'goals.persistAsked';
const IOS_HINT_DISMISSED = 'goals.iosHintDismissed';

function flag(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) === '1';
    localStorage.setItem(key, '1');
  } catch { /* 저장소를 못 써도 안내만 반복될 뿐 */ }
  return false;
}

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPWA({ onUpdate, onInstallable, onIOSHint }) {
  // 처음 실행할 때 한 번, 브라우저가 데이터를 함부로 지우지 않도록 요청
  if (!flag(PERSIST_ASKED) && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
    flag(PERSIST_ASKED, true);
  }

  if ('serviceWorker' in navigator) {
    // 사용자가 [새로고침]을 눌렀을 때만 새로고침 (첫 설치 때 서비스워커가 제어를 시작해도 그대로 둔다)
    let updating = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updating) return;
      updating = false;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(reg => {
      const offer = worker => onUpdate(() => {
        updating = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          // 이미 다른 버전이 화면을 맡고 있을 때만 '새 버전' 안내 (첫 설치는 조용히)
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    }).catch(() => { /* file:// 등 서비스워커를 못 쓰는 환경 */ });
  }

  // 안드로이드 크롬: 설치 버튼
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    onInstallable(async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      onInstallable(null);
    });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    onInstallable(null);
  });

  // 아이폰·아이패드 Safari 탭에서 열렸을 때: 홈 화면 추가 안내를 한 번
  if (isIOS() && !isStandalone() && !flag(IOS_HINT_DISMISSED)) {
    onIOSHint(() => flag(IOS_HINT_DISMISSED, true));
  }
}
