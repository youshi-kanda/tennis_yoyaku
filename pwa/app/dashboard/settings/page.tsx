'use client';

import { useState, useEffect } from 'react';
import { useLogout } from '@/lib/hooks/useAuth';
import { useAuthStore } from '@/lib/stores/authStore';
import { usePushNotification } from '@/lib/hooks/usePushNotification';
import { apiClient } from '@/lib/api/client';

interface CollapsibleCardProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleCard({ title, defaultOpen = false, children }: CollapsibleCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-lg shadow">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition rounded-lg"
      >
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-6 pb-6">
          {children}
        </div>
      )}
    </div>
  );
}

function PasswordChangeSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChangePassword = async () => {
    setError('');
    setSuccess(false);

    // バリデーション
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('すべての項目を入力してください');
      return;
    }

    if (newPassword.length < 8) {
      setError('新しいパスワードは8文字以上で入力してください');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('新しいパスワードと確認用パスワードが一致しません');
      return;
    }

    if (currentPassword === newPassword) {
      setError('現在のパスワードと異なるパスワードを設定してください');
      return;
    }

    setIsChanging(true);

    try {
      const response = await apiClient.changePassword(currentPassword, newPassword);
      if (response.success) {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        alert('パスワードを変更しました。セキュリティのため、再度ログインしてください。');
        // 3秒後にログアウト
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      }
    } catch (err: any) {
      console.error('Password change error:', err);
      const errorMessage = err.response?.data?.error || 'パスワード変更に失敗しました';
      if (errorMessage.includes('Current password is incorrect')) {
        setError('現在のパスワードが正しくありません');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          現在のパスワード
        </label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="現在のパスワードを入力"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
          disabled={isChanging}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          新しいパスワード
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="新しいパスワード（8文字以上）"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
          disabled={isChanging}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          新しいパスワード（確認）
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="新しいパスワードを再入力"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
          disabled={isChanging}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 font-medium">
            ✓ パスワードを変更しました。ログイン画面に移動します...
          </p>
        </div>
      )}

      <button
        onClick={handleChangePassword}
        disabled={isChanging || success}
        className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isChanging ? '変更中...' : 'パスワードを変更'}
      </button>

      <div className="text-xs text-gray-500 space-y-1">
        <p>• パスワードは8文字以上で設定してください</p>
        <p>• 変更後は自動的にログアウトされます</p>
        <p>• 新しいパスワードで再度ログインしてください</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { logout } = useLogout();
  const { user } = useAuthStore();
  const { isSupported, isSubscribed, isLoading, error, subscribe, unsubscribe } = usePushNotification();

  const [shinagawaId, setShinagawaId] = useState('');
  const [shinagawaPassword, setShinagawaPassword] = useState('');
  const [shinagawaSessionId, setShinagawaSessionId] = useState('');
  const [shinagawaManualSessionId, setShinagawaManualSessionId] = useState(''); // 手動入力用
  const [shinagawaSessionUpdated, setShinagawaSessionUpdated] = useState<number | null>(null);

  const [minatoId, setMinatoId] = useState('');
  const [minatoPassword, setMinatoPassword] = useState('');
  const [minatoSessionId, setMinatoSessionId] = useState('');
  const [minatoManualSessionId, setMinatoManualSessionId] = useState(''); // 手動入力用
  const [minatoSessionUpdated, setMinatoSessionUpdated] = useState<number | null>(null);

  const [reservationLimits, setReservationLimits] = useState({
    perWeek: 0,  // 0 = 制限なし
    perMonth: 0, // 0 = 制限なし
  });

  // 保存済みの設定を読み込む
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await apiClient.getSettings();
        if (response.success && response.data) {
          if (response.data.shinagawa?.username) {
            setShinagawaId(response.data.shinagawa.username);
            // パスワードは暗号化されているので表示用に●●●表示
            setShinagawaPassword('••••••••');
          }
          if (response.data.shinagawa?.sessionId) {
            setShinagawaSessionId(response.data.shinagawa.sessionId);
            setShinagawaSessionUpdated(response.data.shinagawa.lastUpdated || null);
          }
          if (response.data.minato?.username) {
            setMinatoId(response.data.minato.username);
            setMinatoPassword('••••••••');
          }
          if (response.data.minato?.sessionId) {
            setMinatoSessionId(response.data.minato.sessionId);
            setMinatoSessionUpdated(response.data.minato.lastUpdated || null);
          }
          if (response.data.reservationLimits) {
            setReservationLimits({
              perWeek: response.data.reservationLimits.perWeek || 0,
              perMonth: response.data.reservationLimits.perMonth || 0,
            });
          }
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    loadSettings();
  }, []);

  const handleGetShinagawaSession = async () => {
    try {
      // Cookie Store APIでJSESSIONIDを取得
      if (!('cookieStore' in window)) {
        alert('このブラウザはCookie Store APIに対応していません。Chrome/Edge の最新版をお使いください。');
        return;
      }

      const cookies = await (window as any).cookieStore.getAll();
      const jsessionCookie = cookies.find(
        (c: any) => c.name === 'JSESSIONID' && c.domain?.includes('cm9.eprs.jp')
      );

      if (!jsessionCookie) {
        alert('品川区サイトのセッションが見つかりません。先に品川区サイトでログインしてください。');
        window.open('https://www.cm9.eprs.jp/shinagawa/web/rsvWTransUserLoginAction.do', '_blank');
        return;
      }

      await apiClient.saveSettings({
        shinagawaSessionId: jsessionCookie.value,
      });

      setShinagawaSessionId(jsessionCookie.value);
      setShinagawaSessionUpdated(Date.now());
      alert('品川区のセッションIDを保存しました');
    } catch (err: any) {
      console.error('Session fetch error:', err);
      alert(`セッション取得に失敗しました: ${err.message}`);
    }
  };

  const handleSaveShinagawaManualSession = async () => {
    if (!shinagawaManualSessionId) {
      alert('セッションIDを入力してください');
      return;
    }

    try {
      await apiClient.saveSettings({
        shinagawaSessionId: shinagawaManualSessionId,
      });
      setShinagawaSessionId(shinagawaManualSessionId);
      setShinagawaSessionUpdated(Date.now());
      setShinagawaManualSessionId('');
      alert('品川区のセッションIDを保存しました');
    } catch (err: any) {
      console.error('Save error:', err);
      alert(`保存に失敗しました: ${err.message}`);
    }
  };

  const handleSaveShinagawa = async () => {
    if (!shinagawaId || !shinagawaPassword) {
      alert('利用者IDとパスワードを入力してください');
      return;
    }

    try {
      await apiClient.saveSettings({
        shinagawa: {
          username: shinagawaId,
          password: shinagawaPassword,
        },
      });
      alert('品川区の認証情報を保存しました');
    } catch (err: any) {
      console.error('Save error:', err);
      alert(`保存に失敗しました: ${err.message}`);
    }
  };

  const handleGetMinatoSession = async () => {
    try {
      // Cookie Store APIでJSESSIONIDを取得
      if (!('cookieStore' in window)) {
        alert('このブラウザはCookie Store APIに対応していません。Chrome/Edge の最新版をお使いください。');
        return;
      }

      const cookies = await (window as any).cookieStore.getAll();
      const jsessionCookie = cookies.find(
        (c: any) => c.name === 'JSESSIONID' && c.domain?.includes('rsv.ws-scs.jp')
      );

      if (!jsessionCookie) {
        alert('港区サイトのセッションが見つかりません。先に港区サイトでログインしてください。');
        window.open('https://web101.rsv.ws-scs.jp/web/', '_blank');
        return;
      }

      await apiClient.saveSettings({
        minatoSessionId: jsessionCookie.value,
      });

      setMinatoSessionId(jsessionCookie.value);
      setMinatoSessionUpdated(Date.now());
      alert('港区のセッションIDを保存しました');
    } catch (err: any) {
      console.error('Session fetch error:', err);
      alert(`セッション取得に失敗しました: ${err.message}`);
    }
  };

  const handleSaveMinatoManualSession = async () => {
    if (!minatoManualSessionId) {
      alert('セッションIDを入力してください');
      return;
    }

    try {
      await apiClient.saveSettings({
        minatoSessionId: minatoManualSessionId,
      });
      setMinatoSessionId(minatoManualSessionId);
      setMinatoSessionUpdated(Date.now());
      setMinatoManualSessionId('');
      alert('港区のセッションIDを保存しました');
    } catch (err: any) {
      console.error('Save error:', err);
      alert(`保存に失敗しました: ${err.message}`);
    }
  };

  const handleSaveMinato = async () => {
    if (!minatoId || !minatoPassword) {
      alert('利用者IDとパスワードを入力してください');
      return;
    }

    try {
      await apiClient.saveSettings({
        minato: {
          username: minatoId,
          password: minatoPassword,
        },
      });
      alert('港区の認証情報を保存しました');
    } catch (err: any) {
      console.error('Save error:', err);
      alert(`保存に失敗しました: ${err.message}`);
    }
  };

  const handleSaveReservationLimits = async () => {
    try {
      await apiClient.saveSettings({
        reservationLimits: {
          perWeek: reservationLimits.perWeek > 0 ? reservationLimits.perWeek : undefined,
          perMonth: reservationLimits.perMonth > 0 ? reservationLimits.perMonth : undefined,
        },
      });
      alert('予約上限設定を保存しました');
    } catch (err) {
      console.error('Save error:', err);
      alert('保存に失敗しました');
    }
  };

  const handleTogglePush = async () => {
    if (isSubscribed) {
      const success = await unsubscribe();
      if (success) {
        alert('プッシュ通知を無効にしました');
      }
    } else {
      const success = await subscribe();
      if (success) {
        alert('プッシュ通知を有効にしました');
      }
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">設定</h1>

      <div className="space-y-4">
        {/* アカウント情報 */}
        <CollapsibleCard title="アカウント情報" defaultOpen={true}>
          <div className="space-y-3 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <p className="text-gray-900">{user?.email || 'guest@example.com'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ロール
              </label>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${user?.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                {user?.role === 'admin' ? '管理者' : '一般ユーザー'}
              </span>
            </div>
          </div>
        </CollapsibleCard>

        {/* パスワード変更 */}
        <CollapsibleCard title="パスワード変更">
          <div className="mt-4">
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                💡 初回ログイン後は、セキュリティのため必ずパスワードを変更してください
              </p>
            </div>
            <PasswordChangeSection />
          </div>
        </CollapsibleCard>

        {/* 品川区認証情報設定 */}
        <CollapsibleCard title="品川区予約サイト セッション設定（推奨）">

          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-emerald-800 font-medium mb-2">
              ✨ セッション方式（推奨）
            </p>
            <p className="text-xs text-gray-700">
              将来的なreCAPTCHA導入にも対応できる方式です。手動ログイン後にセッションを取得するだけで監視・予約が可能になります。
            </p>
          </div>

          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-900 mb-2">セットアップ手順</p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                <li>
                  <a
                    href="https://www.cm9.eprs.jp/shinagawa/web/rsvWTransUserLoginAction.do"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 underline hover:text-emerald-700"
                  >
                    品川区予約サイト
                  </a>
                  を新しいタブで開く
                </li>
                <li>利用者IDとパスワードを入力してログイン</li>
                <li>ログイン成功後、下の「セッション取得」ボタンをクリック</li>
              </ol>
            </div>

            <button
              onClick={handleGetShinagawaSession}
              className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              自動取得（PC Chrome/Edge推奨）
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-2 bg-white text-sm text-gray-500">または手動入力（iPhone/Safari等）</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                セッションID (JSESSIONID)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shinagawaManualSessionId}
                  onChange={(e) => setShinagawaManualSessionId(e.target.value)}
                  placeholder="ここにJSESSIONIDを貼り付け"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
                <button
                  onClick={handleSaveShinagawaManualSession}
                  disabled={!shinagawaManualSessionId}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  保存
                </button>
              </div>
              <p className="text-xs text-gray-500">
                ※ 開発者ツール等で `JSESSIONID` クッキーの値を確認して入力してください
              </p>
            </div>

            {shinagawaSessionId && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800 font-medium">
                  ✓ セッションID設定済み
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  セッションID: {shinagawaSessionId.substring(0, 20)}...
                </p>
                {shinagawaSessionUpdated && (
                  <p className="text-xs text-gray-500 mt-1">
                    最終更新: {new Date(shinagawaSessionUpdated).toLocaleString('ja-JP')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              ID/パスワード方式（非推奨・後方互換性のみ）
            </h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-yellow-800">
                ⚠️ この方式は将来のreCAPTCHA導入時に動作しなくなる可能性があります。上記のセッション方式を推奨します。
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  利用者ID
                </label>
                <input
                  type="text"
                  value={shinagawaId}
                  onChange={(e) => setShinagawaId(e.target.value)}
                  placeholder="84005349"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  パスワード
                </label>
                <input
                  type="password"
                  value={shinagawaPassword}
                  onChange={(e) => setShinagawaPassword(e.target.value)}
                  placeholder="パスワードを入力"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
                <p className="text-xs text-gray-500 mt-1">
                  パスワードは暗号化して安全に保存されます
                </p>
              </div>

              <button
                onClick={handleSaveShinagawa}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
              >
                保存
              </button>

              {shinagawaId && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-800 font-medium">
                    ✓ 認証情報設定済み
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    ログインに失敗する場合はプッシュ通知でお知らせします
                  </p>
                </div>
              )}
            </div>
          </div>
        </CollapsibleCard>

        {/* 港区認証情報設定 */}
        <CollapsibleCard title="港区予約サイト セッション設定">

          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-800 font-medium mb-2">
              ⚠️ reCAPTCHA対応のためセッション方式必須
            </p>
            <p className="text-xs text-gray-700">
              港区サイトはreCAPTCHA（「私はロボットではありません」チェック）を実装しているため、自動ログインができません。
              セッション方式のみ対応しています。
            </p>
          </div>

          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-900 mb-2">セットアップ手順</p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                <li>
                  <a
                    href="https://web101.rsv.ws-scs.jp/web/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 underline hover:text-emerald-700"
                  >
                    港区予約サイト
                  </a>
                  を新しいタブで開く
                </li>
                <li>利用者IDとパスワードを入力</li>
                <li className="font-medium text-red-700">reCAPTCHA（「私はロボットではありません」）をチェック</li>
                <li>ログイン成功後、下の「セッション取得」ボタンをクリック</li>
              </ol>
            </div>

            <button
              onClick={handleGetMinatoSession}
              className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              自動取得（PC Chrome/Edge推奨）
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-2 bg-white text-sm text-gray-500">または手動入力（iPhone/Safari等）</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                セッションID (JSESSIONID)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={minatoManualSessionId}
                  onChange={(e) => setMinatoManualSessionId(e.target.value)}
                  placeholder="ここにJSESSIONIDを貼り付け"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
                <button
                  onClick={handleSaveMinatoManualSession}
                  disabled={!minatoManualSessionId}
                  className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  保存
                </button>
              </div>
              <p className="text-xs text-gray-500">
                ※ 開発者ツール等で `JSESSIONID` クッキーの値を確認して入力してください
              </p>
            </div>

            {minatoSessionId && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800 font-medium">
                  ✓ セッションID設定済み
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  セッションID: {minatoSessionId.substring(0, 20)}...
                </p>
                {minatoSessionUpdated && (
                  <p className="text-xs text-gray-500 mt-1">
                    最終更新: {new Date(minatoSessionUpdated).toLocaleString('ja-JP')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              ID/パスワード方式（非対応）
            </h3>
            <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-600">
                ⚠️ 港区サイトはreCAPTCHAのため、ID/パスワードによる自動ログインは利用できません。
                上記のセッション方式をご利用ください。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                利用者ID
              </label>
              <input
                type="text"
                value={minatoId}
                onChange={(e) => setMinatoId(e.target.value)}
                placeholder="利用者IDを入力"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                type="password"
                value={minatoPassword}
                onChange={(e) => setMinatoPassword(e.target.value)}
                placeholder="パスワードを入力"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
              />
              <p className="text-xs text-gray-500 mt-1">
                パスワードは暗号化して安全に保存されます
              </p>
            </div>

            <button
              onClick={handleSaveMinato}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
            >
              保存
            </button>

            {minatoId && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800 font-medium">
                  ✓ 認証情報設定済み
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  ログインに失敗する場合はプッシュ通知でお知らせします
                </p>
              </div>
            )}
          </div>
        </CollapsibleCard>

        {/* 予約上限設定 */}
        <CollapsibleCard title="予約上限設定">
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
              <p className="text-sm text-blue-800">
                💡 予約しすぎを防ぐために、週・月の予約回数に上限を設定できます。
                上限に達した場合、監視は継続しますが自動予約は停止します。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                週あたりの予約上限
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  value={reservationLimits.perWeek}
                  onChange={(e) => setReservationLimits({ ...reservationLimits, perWeek: parseInt(e.target.value) || 0 })}
                  className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
                <span className="text-sm text-gray-600">
                  回 / 週 {reservationLimits.perWeek === 0 && '（制限なし）'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                0に設定すると制限なし。例: 週2回までなら「2」と入力
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                月あたりの予約上限
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  value={reservationLimits.perMonth}
                  onChange={(e) => setReservationLimits({ ...reservationLimits, perMonth: parseInt(e.target.value) || 0 })}
                  className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
                <span className="text-sm text-gray-600">
                  回 / 月 {reservationLimits.perMonth === 0 && '（制限なし）'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                0に設定すると制限なし。例: 月8回までなら「8」と入力
              </p>
            </div>

            <button
              onClick={handleSaveReservationLimits}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
            >
              予約上限を保存
            </button>

            {(reservationLimits.perWeek > 0 || reservationLimits.perMonth > 0) && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm text-emerald-800 font-medium">
                  ✓ 設定中:
                  {reservationLimits.perWeek > 0 && ` 週${reservationLimits.perWeek}回まで`}
                  {reservationLimits.perWeek > 0 && reservationLimits.perMonth > 0 && ' / '}
                  {reservationLimits.perMonth > 0 && ` 月${reservationLimits.perMonth}回まで`}
                </p>
              </div>
            )}
          </div>
        </CollapsibleCard>

        {/* 通知設定 */}
        <CollapsibleCard title="通知設定">

          {!isSupported ? (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                このブラウザはプッシュ通知に対応していません
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 flex items-center gap-2">
                    プッシュ通知
                    {isSubscribed && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                        有効
                      </span>
                    )}
                  </h3>
                  <p className="text-sm text-gray-600">空きが見つかった際に通知を受け取る</p>
                </div>
                <button
                  onClick={handleTogglePush}
                  disabled={isLoading}
                  className={`px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${isSubscribed
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                >
                  {isLoading ? '処理中...' : isSubscribed ? '無効にする' : '有効にする'}
                </button>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {isSubscribed && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <p className="text-sm text-emerald-800 font-medium mb-2">
                    ✓ プッシュ通知が有効です
                  </p>
                  <p className="text-xs text-emerald-700">
                    テニスコートに空きが見つかった際、リアルタイムで通知されます
                  </p>
                </div>
              )}
            </div>
          )}
        </CollapsibleCard>

        {/* ログアウト */}
        <CollapsibleCard title="ログアウト">
          <button
            onClick={logout}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            ログアウト
          </button>
        </CollapsibleCard>
      </div>
    </div>
  );
}
