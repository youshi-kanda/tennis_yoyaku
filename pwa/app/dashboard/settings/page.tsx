'use client';

import { useState, useEffect } from 'react';
import { useLogout } from '@/lib/hooks/useAuth';
import { useAuthStore } from '@/lib/stores/authStore';
import { usePushNotification } from '@/lib/hooks/usePushNotification';
import { apiClient } from '@/lib/api/client';

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
  const { isSubscribed, subscribe, unsubscribe } = usePushNotification();

  const [testNotificationStatus, setTestNotificationStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testNotificationMessage, setTestNotificationMessage] = useState('');

  const [shinagawaId, setShinagawaId] = useState('');
  const [shinagawaPassword, setShinagawaPassword] = useState('');
  const [shinagawaSessionId, setShinagawaSessionId] = useState('');
  const [shinagawaSessionUpdated, setShinagawaSessionUpdated] = useState<number | null>(null);

  const [minatoId, setMinatoId] = useState('');
  const [minatoPassword, setMinatoPassword] = useState('');
  const [minatoSessionId, setMinatoSessionId] = useState('');
  const [minatoManualSessionId, setMinatoManualSessionId] = useState(''); // 手動入力用
  const [minatoSessionUpdated, setMinatoSessionUpdated] = useState<number | null>(null);
  const [minatoSessionStatus, setMinatoSessionStatus] = useState<string>('expired');
  const [minatoSessionLastChecked, setMinatoSessionLastChecked] = useState<number>(0);

  const [showWarningModal, setShowWarningModal] = useState(false);

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
          if (response.data.minatoSessionStatus) {
            setMinatoSessionStatus(response.data.minatoSessionStatus);
            setMinatoSessionLastChecked(response.data.minatoSessionLastChecked || 0);
          }
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    loadSettings();
  }, []);

  const handleSaveShinagawa = async () => {
    if (!shinagawaId || !shinagawaPassword) {
      alert('利用者IDとパスワードを入力してください');
      return;
    }
    // 警告モーダルを表示
    setShowWarningModal(true);
  };

  const executeSaveShinagawa = async () => {
    setShowWarningModal(false);
    try {
      await apiClient.saveSettings({
        shinagawa: {
          username: shinagawaId,
          password: shinagawaPassword,
        },
      });
      alert('品川区の認証情報を保存しました\n（停止していた監視があれば自動再開されます）');
    } catch (err: any) {
      console.error('Save error:', err);
      alert(`保存に失敗しました: ${err.message}`);
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

  const handleTestNotification = async () => {
    setTestNotificationStatus('sending');
    setTestNotificationMessage('');
    try {
      await apiClient.sendTestNotification();
      setTestNotificationStatus('success');
      setTestNotificationMessage('テスト通知を送信しました。届かない場合は端末の通知設定を確認してください。');
      setTimeout(() => setTestNotificationStatus('idle'), 5000);
    } catch (err: any) {
      console.error('Failed to send test notification:', err);
      setTestNotificationStatus('error');
      setTestNotificationMessage(`送信失敗: ${err.response?.data?.error || err.message}`);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-12 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">設定</h1>
      </div>

      {/* 通知設定 */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          🔔 通知設定
        </h2>
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-medium text-gray-900">プッシュ通知</p>
                <p className="text-sm text-gray-500">空き枠検知時にお知らせします</p>
              </div>
              <button
                onClick={handleTogglePush}
                className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${isSubscribed ? 'bg-emerald-600' : 'bg-gray-200'}`}
              >
                <span className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isSubscribed ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="pt-6 border-t border-gray-100">
              <button
                onClick={handleTestNotification}
                disabled={!isSubscribed || testNotificationStatus === 'sending'}
                className="w-full sm:w-auto px-6 py-2 border border-emerald-600 text-emerald-600 rounded-lg hover:bg-emerald-50 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testNotificationStatus === 'sending' ? '送信中...' : '🔔 テスト通知を送信'}
              </button>
              {testNotificationMessage && (
                <p className={`mt-2 text-sm ${testNotificationStatus === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                  {testNotificationMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 予約サイト設定 */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          🎾 予約サイト認証
        </h2>

        {/* 品川区 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-2 h-6 bg-emerald-500 rounded-full"></span>
            品川区 (ID/パスワード)
          </h3>
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <p className="text-sm text-emerald-800">
                システムが自動でログインして空き状況を確認します。
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  利用者ID
                </label>
                <input
                  type="text"
                  value={shinagawaId}
                  onChange={(e) => setShinagawaId(e.target.value)}
                  placeholder="8400..."
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
                  placeholder="Password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {shinagawaId ? (
                <div className="text-sm text-green-600 font-medium flex items-center gap-1">
                  ✓ 設定済み
                </div>
              ) : <div></div>}
              <button
                onClick={handleSaveShinagawa}
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium"
              >
                保存する
              </button>
            </div>
          </div>
        </div>

        {/* 港区 (開発中につき非表示) */}
        {/* <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm opacity-50 pointer-events-none grayscale">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-2 h-6 bg-gray-400 rounded-full"></span>
            港区 (基本機能開発中)
          </h3>
          <div className="bg-gray-100 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600 font-medium">現在メンテナンス中 / 開発中です</p>
          </div>
        </div> */}
      </section>

      {/* アカウント・システム */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          👤 アカウント設定
        </h2>
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-8">

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">ログイン中のメールアドレス</p>
              <p className="text-base font-medium text-gray-900">{user?.email || 'guest@example.com'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">権限ロール</p>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${user?.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {user?.role === 'admin' ? '管理者' : '一般ユーザー'}
              </span>
            </div>
          </div>

          <div className="border-t pt-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">パスワード変更</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <PasswordChangeSection />
            </div>
          </div>
        </div>
      </section>

      <div className="pt-8 border-t flex justify-center">
        <button
          onClick={logout}
          className="text-red-600 hover:text-red-700 font-medium text-sm flex items-center gap-2 px-4 py-2 hover:bg-red-50 rounded-lg transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          ログアウトする
        </button>
      </div>

      {/* ⚠️ Warning Modal */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 text-amber-600">
                <svg className="w-8 h-8 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-xl font-bold">アカウント共有の警告</h3>
              </div>

              <div className="space-y-4 text-sm text-gray-600 leading-relaxed">
                <p>
                  <strong>監視実行中に別端末（スマートフォンやPC）でサイトにログインすると、</strong>
                  セッションの競合により「アカウントロック」や「強制ログアウト」のエラーが発生する可能性があります。
                </p>
                <p className="bg-amber-50 p-3 rounded-lg border border-amber-100 text-amber-800">
                  ⚠️ 監視中は可能な限り手動でのサイト利用はお控えください。
                  万が一エラーで停止した場合は、しばらく時間を置いてから「再開」を行ってください。
                </p>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setShowWarningModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition"
                >
                  キャンセル
                </button>
                <button
                  onClick={executeSaveShinagawa}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold shadow-lg shadow-emerald-200 transition"
                >
                  同意して保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
