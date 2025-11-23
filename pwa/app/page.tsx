'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLogin } from '@/lib/hooks/useAuth';

// 動的レンダリングを強制
export const dynamic = 'force-dynamic';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error } = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login({ email, password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* ロゴ・ヘッダー */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600 text-white rounded-full mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            テニスコート自動予約
          </h1>
          <p className="text-gray-600 mt-2">
            品川区・港区の予約を自動監視
          </p>
        </div>

        {/* ログインカード */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            ログイン
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition"
                placeholder="email@example.com"
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition"
                placeholder="パスワードを入力"
                required
                disabled={isLoading}
              />
            </div>

            {/* パスワード忘れ */}
            <div className="text-right">
              <Link href="/forgot-password" className="text-sm text-emerald-600 hover:text-emerald-700">
                パスワードをお忘れですか？
              </Link>
            </div>

            {/* ログインボタン */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-600 text-white py-3 rounded-lg font-semibold hover:bg-emerald-700 transition duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          {/* 新規登録リンク */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              アカウントをお持ちでない方は{' '}
              <Link href="/register" className="text-emerald-600 font-semibold hover:text-emerald-700">
                新規登録
              </Link>
            </p>
          </div>

          {/* 管理者登録リンク */}
          <div className="mt-3 text-center">
            <Link href="/admin" className="text-xs text-purple-600 hover:text-purple-700">
              管理者アカウント登録
            </Link>
          </div>
        </div>

        {/* 機能紹介 */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg p-3 text-center shadow">
            <div className="text-2xl mb-1">🎾</div>
            <p className="text-xs text-gray-600">自動監視</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center shadow">
            <div className="text-2xl mb-1">⚡</div>
            <p className="text-xs text-gray-600">即時通知</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center shadow">
            <div className="text-2xl mb-1">🔔</div>
            <p className="text-xs text-gray-600">自動予約</p>
          </div>
        </div>
      </div>
    </div>
  );
}
