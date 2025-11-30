'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';

interface AdminUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: number;
  monitoringCount: number;
  reservationCount: number;
  successCount: number;
}

export default function AdminUsersPage() {
  const { isAdmin } = useAuthStore();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdUser, setCreatedUser] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getAdminUsers();
      setUsers(response.users);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      alert('メールアドレスとパスワードを入力してください');
      return;
    }

    try {
      setCreating(true);
      await apiClient.createUserByAdmin(newEmail, newPassword);
      setCreatedUser({ email: newEmail, password: newPassword });
      await loadUsers();
    } catch (error: any) {
      console.error('Failed to create user:', error);
      alert(error.response?.data?.error || 'ユーザーの作成に失敗しました');
    } finally {
      setCreating(false);
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setCreatedUser(null);
    setNewEmail('');
    setNewPassword('');
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`ユーザー「${email}」を削除しますか?\n\n削除すると以下のデータも削除されます:\n• 監視設定\n• 予約履歴\n\nこの操作は取り消せません。`)) {
      return;
    }

    try {
      await apiClient.deleteUserByAdmin(userId);
      alert('ユーザーを削除しました');
      await loadUsers();
    } catch (error: any) {
      console.error('Failed to delete user:', error);
      alert(error.response?.data?.error || 'ユーザーの削除に失敗しました');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('コピーしました');
  };

  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isAdmin) return null;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">👥 ユーザー管理</h1>
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">👥 ユーザー管理</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
          >
            ➕ 新規ユーザー追加
          </button>
          <button
            onClick={loadUsers}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            🔄 更新
          </button>
        </div>
      </div>

      {/* 検索バー */}
      <div className="bg-white rounded-xl shadow-md p-4 border">
        <input
          type="text"
          placeholder="メールアドレスで検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* 統計サマリー */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-md p-4 border">
          <div className="text-sm text-gray-600">総ユーザー数</div>
          <div className="text-2xl font-bold text-gray-900">{users.length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border">
          <div className="text-sm text-gray-600">管理者</div>
          <div className="text-2xl font-bold text-purple-600">
            {users.filter(u => u.role === 'admin').length}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border">
          <div className="text-sm text-gray-600">一般ユーザー</div>
          <div className="text-2xl font-bold text-blue-600">
            {users.filter(u => u.role === 'user').length}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border">
          <div className="text-sm text-gray-600">総監視設定</div>
          <div className="text-2xl font-bold text-green-600">
            {users.reduce((sum, u) => sum + u.monitoringCount, 0)}
          </div>
        </div>
      </div>

      {/* ユーザーテーブル */}
      <div className="bg-white rounded-xl shadow-md border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ユーザー
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ロール
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  登録日
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  監視設定
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  予約履歴
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  成功率
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-blue-600 font-semibold">
                          {user.email.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {user.email}
                        </div>
                        <div className="text-xs text-gray-500">
                          ID: {user.id.substring(0, 8)}...
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {user.role === 'admin' ? '🛡️ 管理者' : '👤 ユーザー'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{user.monitoringCount} 件</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {user.reservationCount} 件
                    </div>
                    <div className="text-xs text-green-600">
                      成功: {user.successCount} 件
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-900">
                      {user.reservationCount > 0
                        ? ((user.successCount / user.reservationCount) * 100).toFixed(1)
                        : '0'}
                      %
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {user.role !== 'admin' && (
                      <button
                        onClick={() => handleDeleteUser(user.id, user.email)}
                        className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
                      >
                        🗑️ 削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">ユーザーが見つかりません</p>
          </div>
        )}
      </div>

      {/* 新規ユーザー作成モーダル */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-900">
                ➕ 新規ユーザー追加
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                クライアント用のアカウントを作成します
              </p>
            </div>

            {!createdUser ? (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="client@example.com"
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    初期パスワード
                  </label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="8文字以上の安全なパスワード"
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    💡 クライアントにこのパスワードを共有してください
                  </p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    <strong>注意:</strong> 作成後、認証情報をコピーしてクライアントに渡してください。
                    ログイン後、クライアント自身でパスワード変更が可能です。
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCreateUser}
                    disabled={creating || !newEmail || !newPassword}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creating ? '作成中...' : '✅ ユーザーを作成'}
                  </button>
                  <button
                    onClick={handleCloseModal}
                    disabled={creating}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">✅</span>
                    <h3 className="font-semibold text-green-900">ユーザー作成完了!</h3>
                  </div>
                  <p className="text-sm text-green-800">
                    以下の認証情報をクライアントに共有してください
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      メールアドレス
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={createdUser.email}
                        readOnly
                        className="flex-1 px-4 py-2 border rounded-lg bg-gray-50 text-gray-900 font-mono"
                      />
                      <button
                        onClick={() => copyToClipboard(createdUser.email)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                      >
                        📋 コピー
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      パスワード
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={createdUser.password}
                        readOnly
                        className="flex-1 px-4 py-2 border rounded-lg bg-gray-50 text-gray-900 font-mono"
                      />
                      <button
                        onClick={() => copyToClipboard(createdUser.password)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                      >
                        📋 コピー
                      </button>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm text-yellow-800">
                      <strong>⚠️ 重要:</strong> このパスワードは二度と表示されません。
                      必ずコピーしてクライアントに安全に共有してください。
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleCloseModal}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
                >
                  完了
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
