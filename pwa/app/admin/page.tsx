'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';

export default function AdminRegister() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // バリデーション
    if (password !== passwordConfirm) {
      setError('パスワードが一致しません');
      return;
    }

    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }

    if (!adminKey) {
      setError('管理者キーを入力してください');
      return;
    }

    try {
      setIsLoading(true);
      await apiClient.adminRegister(email, password, adminKey);

      alert('管理者アカウントが作成されました！ログインページに移動します。');
      router.push('/');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || '管理者登録に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-purple-50 to-indigo-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* ロゴ・ヘッダー */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 text-white rounded-full mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">
            管理者アカウント登録
          </h1>
          <p className="text-gray-600 mt-2">
            システム管理者用の登録画面
          </p>
        </div>

        {/* 登録カード */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* メールアドレス */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                placeholder="メールアドレスを入力"
                required
                disabled={isLoading}
              />
            </div>

            {/* パスワード */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                placeholder="8文字以上"
                required
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                8文字以上の英数字を含むパスワード
              </p>
            </div>

            {/* パスワード確認 */}
            <div>
              <label htmlFor="password-confirm" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード（確認）
              </label>
              <input
                type="password"
                id="password-confirm"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                placeholder="パスワードを再入力"
                required
                disabled={isLoading}
              />
            </div>

            {/* 管理者キー */}
            <div>
              <label htmlFor="admin-key" className="block text-sm font-medium text-gray-700 mb-1">
                管理者キー
              </label>
              <input
                type="password"
                id="admin-key"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                placeholder="管理者キーを入力"
                required
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                システム管理者のみが知る秘密キー
              </p>
            </div>

            {/* 登録ボタン */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-purple-600 text-white py-3 rounded-lg font-semibold hover:bg-purple-700 transition duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '処理中...' : '管理者アカウントを作成'}
            </button>
          </form>

          {/* ログインリンク */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              すでにアカウントをお持ちの方は{' '}
              <Link href="/" className="text-purple-600 font-semibold hover:text-purple-700">
                ログイン
              </Link>
            </p>
            <p className="text-sm text-gray-600 mt-2">
              一般ユーザーの方は{' '}
              <Link href="/register" className="text-emerald-600 font-semibold hover:text-emerald-700">
                こちらから登録
              </Link>
            </p>
          </div>
        </div>

        {/* 警告 */}
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-yellow-800">
              <p className="font-semibold mb-1">⚠️ 管理者専用</p>
              <p className="text-yellow-700">
                この画面はシステム管理者専用です。管理者キーは厳重に管理してください。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
