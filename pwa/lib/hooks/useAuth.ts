import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';

interface LoginForm {
  email: string;
  password: string;
}

interface RegisterForm {
  email: string;
  password: string;
  passwordConfirm: string;
  adminKey?: string;
}

export function useLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { setUser } = useAuthStore();

  const login = async (form: LoginForm) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.login(form.email, form.password);
      
      if (response.success && response.data) {
        setUser(response.data.user);
        router.push('/dashboard');
      } else {
        setError(response.error || 'ログインに失敗しました');
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'ネットワークエラーが発生しました';
      setError(errorMessage);
      console.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return { login, isLoading, error };
}

export function useRegister() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { setUser } = useAuthStore();

  const register = async (form: RegisterForm) => {
    setIsLoading(true);
    setError(null);

    // バリデーション
    if (form.password !== form.passwordConfirm) {
      setError('パスワードが一致しません');
      setIsLoading(false);
      return;
    }

    if (form.password.length < 8) {
      setError('パスワードは8文字以上で設定してください');
      setIsLoading(false);
      return;
    }

    if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setError('パスワードは英字と数字を含む必要があります');
      setIsLoading(false);
      return;
    }

    try {
      const response = await apiClient.register(form.email, form.password, form.adminKey);
      
      if (response.success && response.data) {
        setUser(response.data.user);
        router.push('/dashboard');
      } else {
        setError(response.error || 'アカウント作成に失敗しました');
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'ネットワークエラーが発生しました';
      setError(errorMessage);
      console.error('Register error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return { register, isLoading, error };
}

export function useLogout() {
  const router = useRouter();
  const { setUser } = useAuthStore();

  const logout = () => {
    apiClient.logout();
    
    // 状態をクリア
    setUser(null);
    
    // ログインページにリダイレクト
    router.push('/');
  };

  return { logout };
}
