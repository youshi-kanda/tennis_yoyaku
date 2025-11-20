'use client';

import { useState } from 'react';
import { useLogout } from '@/lib/hooks/useAuth';
import { useAuthStore } from '@/lib/stores/authStore';

export default function SettingsPage() {
  const { logout } = useLogout();
  const { user } = useAuthStore();
  
  const [shinagawaCredentials, setShinagawaCredentials] = useState({
    username: '',
    password: '',
  });
  
  const [minatoCredentials, setMinatoCredentials] = useState({
    username: '',
    password: '',
  });

  const [pushEnabled, setPushEnabled] = useState(false);

  const handleSaveShinagawa = () => {
    // TODO: API呼び出し
    alert('品川区のログイン情報を保存しました');
  };

  const handleSaveMinato = () => {
    // TODO: API呼び出し
    alert('港区のログイン情報を保存しました');
  };

  const handleEnablePush = async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: 'YOUR_VAPID_PUBLIC_KEY', // TODO: 実際のキーに置き換え
        });
        setPushEnabled(true);
        alert('プッシュ通知を有効にしました');
      } catch (err) {
        console.error('Failed to enable push:', err);
        alert('プッシュ通知の有効化に失敗しました');
      }
    } else {
      alert('このブラウザはプッシュ通知に対応していません');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">設定</h1>

      <div className="space-y-6">
        {/* アカウント情報 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">アカウント情報</h2>
          <div className="space-y-3">
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
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                user?.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {user?.role === 'admin' ? '管理者' : '一般ユーザー'}
              </span>
            </div>
          </div>
        </div>

        {/* 品川区ログイン情報 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            品川区予約サイト ログイン情報
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ユーザー名/メールアドレス
              </label>
              <input
                type="text"
                value={shinagawaCredentials.username}
                onChange={(e) => setShinagawaCredentials({ ...shinagawaCredentials, username: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="品川区予約サイトのログインID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                type="password"
                value={shinagawaCredentials.password}
                onChange={(e) => setShinagawaCredentials({ ...shinagawaCredentials, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="パスワード"
              />
            </div>
            <button
              onClick={handleSaveShinagawa}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
            >
              保存
            </button>
            <p className="text-xs text-gray-500 mt-2">
              ※ 自動予約を有効にするには、品川区予約サイトのログイン情報が必要です
            </p>
          </div>
        </div>

        {/* 港区ログイン情報 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            港区予約サイト ログイン情報
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ユーザー名/メールアドレス
              </label>
              <input
                type="text"
                value={minatoCredentials.username}
                onChange={(e) => setMinatoCredentials({ ...minatoCredentials, username: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="港区予約サイトのログインID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                type="password"
                value={minatoCredentials.password}
                onChange={(e) => setMinatoCredentials({ ...minatoCredentials, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="パスワード"
              />
            </div>
            <button
              onClick={handleSaveMinato}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
            >
              保存
            </button>
            <p className="text-xs text-gray-500 mt-2">
              ※ 自動予約を有効にするには、港区予約サイトのログイン情報が必要です
            </p>
          </div>
        </div>

        {/* 通知設定 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">通知設定</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">プッシュ通知</h3>
                <p className="text-sm text-gray-600">空きが見つかった際に通知を受け取る</p>
              </div>
              <button
                onClick={handleEnablePush}
                disabled={pushEnabled}
                className={`px-4 py-2 rounded-lg transition ${
                  pushEnabled
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {pushEnabled ? '有効' : '有効にする'}
              </button>
            </div>
          </div>
        </div>

        {/* ログアウト */}
        <div className="bg-white rounded-lg shadow p-6">
          <button
            onClick={logout}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}
