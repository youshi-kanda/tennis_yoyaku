import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // リクエストインターセプター
    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // レスポンスインターセプター
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // 認証エラー: トークンクリア、ログインページへ
          this.clearToken();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  private getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('auth_token');
    }
    return null;
  }

  private setToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }

  private clearToken(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
  }

  // 認証API
  async login(email: string, password: string) {
    const response = await this.client.post('/api/auth/login', {
      email,
      password,
    });
    this.setToken(response.data.token);
    return response.data;
  }

  async register(email: string, password: string) {
    const response = await this.client.post('/api/auth/register', {
      email,
      password,
    });
    this.setToken(response.data.token);
    return response.data;
  }

  async logout() {
    this.clearToken();
  }

  // 監視API
  async getMonitoringStatus() {
    const response = await this.client.get('/api/monitoring/status');
    return response.data;
  }

  async startMonitoring(targets: any[]) {
    const response = await this.client.post('/api/monitoring/start', {
      targets,
    });
    return response.data;
  }

  async stopMonitoring() {
    const response = await this.client.post('/api/monitoring/stop');
    return response.data;
  }

  // 設定API
  async getSettings() {
    const response = await this.client.get('/api/settings');
    return response.data;
  }

  async updateSettings(settings: any) {
    const response = await this.client.put('/api/settings', settings);
    return response.data;
  }

  // 履歴API
  async getReservationHistory(limit = 50) {
    const response = await this.client.get('/api/reservations/history', {
      params: { limit },
    });
    return response.data;
  }

  // プッシュ通知API
  async subscribePush(subscription: PushSubscription) {
    const response = await this.client.post('/api/push/subscribe', subscription);
    return response.data;
  }

  async unsubscribePush() {
    const response = await this.client.post('/api/push/unsubscribe');
    return response.data;
  }
}

export const apiClient = new ApiClient();
