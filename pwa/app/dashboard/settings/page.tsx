'use client';

import { useState, useEffect } from 'react';
import { useLogout } from '@/lib/hooks/useAuth';
import { useAuthStore } from '@/lib/stores/authStore';
import { usePushNotification } from '@/lib/hooks/usePushNotification';
import { apiClient } from '@/lib/api/client';

export default function SettingsPage() {
  const { logout } = useLogout();
  const { user } = useAuthStore();
  const { isSupported, isSubscribed, isLoading, error, subscribe, unsubscribe } = usePushNotification();
  
  const [shinagawaId, setShinagawaId] = useState('');
  const [shinagawaPassword, setShinagawaPassword] = useState('');
  const [minatoId, setMinatoId] = useState('');
  const [minatoPassword, setMinatoPassword] = useState('');

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
          if (response.data.minato?.username) {
            setMinatoId(response.data.minato.username);
            setMinatoPassword('••••••••');
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

        {/* 品川区認証情報設定 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            品川区予約サイト 認証情報
          </h2>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-800">
              ℹ️ 自動ログイン方式を使用します。1回保存すれば自動で監視・予約を行います。
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

        {/* 港区認証情報設定 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            港区予約サイト 認証情報
          </h2>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-800">
              ℹ️ 自動ログイン方式を使用します。1回保存すれば自動で監視・予約を行います。
            </p>
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
        </div>

        {/* 予約上限設定 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">予約上限設定</h2>
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
        </div>

        {/* 通知設定 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">通知設定</h2>
          
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
                  className={`px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSubscribed
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
