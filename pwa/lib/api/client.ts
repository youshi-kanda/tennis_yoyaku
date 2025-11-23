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
          if (typeof window !== 'undefined') {
            window.location.href = '/';
          }
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
    if (response.data.success && response.data.data?.token) {
      this.setToken(response.data.data.token);
    }
    return response.data;
  }

  async register(email: string, password: string, adminKey?: string) {
    const response = await this.client.post('/api/auth/register', {
      email,
      password,
      adminKey,
    });
    if (response.data.success && response.data.data?.token) {
      this.setToken(response.data.data.token);
    }
    return response.data;
  }

  async adminRegister(email: string, password: string, adminKey: string) {
    const response = await this.client.post('/api/auth/admin-register', {
      email,
      password,
      adminKey,
    });
    if (response.data.success && response.data.data?.token) {
      this.setToken(response.data.data.token);
    }
    return response.data;
  }

  async logout() {
    this.clearToken();
  }

  // 監視API
  async getMonitoringList() {
    const response = await this.client.get('/api/monitoring/list');
    return response.data;
  }

  async createMonitoring(data: {
    site: 'shinagawa' | 'minato';
    facilityId: string;
    facilityName: string;
    date?: string; // 単一日付（後方互換性）
    startDate?: string; // 期間指定開始日
    endDate?: string; // 期間指定終了日
    timeSlots: string[]; // 複数時間枠対応
    selectedWeekdays?: number[]; // 監視する曜日（0=日, 1=月, ..., 6=土）
    priority?: number; // 優先度（1-5）
    autoReserve: boolean;
    reservationStrategy?: 'all' | 'priority';
    maxReservationsPerDay?: number;
  }) {
    const response = await this.client.post('/api/monitoring/create', data);
    return response.data;
  }

  async deleteMonitoring(id: string) {
    const response = await this.client.delete(`/api/monitoring/${id}`);
    return response.data;
  }

  // 履歴API
  async getReservationHistory(limit = 50) {
    const response = await this.client.get('/api/reservations/history', {
      params: { limit },
    });
    return response.data;
  }

  // 設定API
  async getSiteCredentials() {
    const response = await this.client.get('/api/settings/credentials');
    return response.data;
  }

  async updateSiteCredentials(site: 'shinagawa' | 'minato', credentials: {
    username: string;
    password: string;
  }) {
    const response = await this.client.put(`/api/settings/credentials/${site}`, credentials);
    return response.data;
  }

  // 設定API
  async saveSettings(settings: {
    shinagawaUserId?: string;
    shinagawaPassword?: string;
    minatoUserId?: string;
    minatoPassword?: string;
    reservationLimits?: {
      perWeek?: number;
      perMonth?: number;
    };
  }) {
    // バックエンドの期待する形式に変換
    const payload: {
      shinagawa?: { username: string; password: string };
      minato?: { username: string; password: string };
      reservationLimits?: {
        perWeek?: number;
        perMonth?: number;
      };
    } = {};
    if (settings.shinagawaUserId && settings.shinagawaPassword) {
      payload.shinagawa = {
        username: settings.shinagawaUserId,
        password: settings.shinagawaPassword,
      };
    }
    if (settings.minatoUserId && settings.minatoPassword) {
      payload.minato = {
        username: settings.minatoUserId,
        password: settings.minatoPassword,
      };
    }
    if (settings.reservationLimits) {
      payload.reservationLimits = settings.reservationLimits;
    }
    const response = await this.client.post('/api/settings', payload);
    return response.data;
  }

  async getSettings() {
    const response = await this.client.get('/api/settings');
    return response.data;
  }

  // 施設一覧API
  async getShinagawaFacilities() {
    const response = await this.client.get('/api/facilities/shinagawa');
    return response.data;
  }

  async getMinatoFacilities() {
    const response = await this.client.get('/api/facilities/minato');
    return response.data;
  }

  // 予約可能期間API
  async getReservationPeriod(site: 'shinagawa' | 'minato') {
    const response = await this.client.get(`/api/reservation-period?site=${site}`);
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
