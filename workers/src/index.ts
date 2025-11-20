export interface Env {
  // KV Namespaces
  USERS: KVNamespace;
  SESSIONS: KVNamespace;
  MONITORING: KVNamespace;
  RESERVATIONS: KVNamespace;

  // Environment variables
  ENVIRONMENT: string;
  JWT_SECRET: string;
  ADMIN_KEY: string;
}

export interface User {
  id: string;
  email: string;
  password: string; // hashed
  role: 'user' | 'admin';
  createdAt: number;
}

export interface MonitoringTarget {
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'active' | 'pending' | 'completed' | 'failed';
  autoReserve: boolean;
  createdAt: number;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API routes
      if (path === '/api/auth/register') {
        return handleRegister(request, env, corsHeaders);
      }

      if (path === '/api/auth/login') {
        return handleLogin(request, env, corsHeaders);
      }

      if (path === '/api/monitoring/list') {
        return handleMonitoringList(request, env, corsHeaders);
      }

      if (path === '/api/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },

  // Cron handler (通常監視: 60秒間隔)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Cron job started:', new Date().toISOString());
    
    // TODO: 実装
    // 1. アクティブな監視対象を取得
    // 2. 各サイトにアクセスして空き状況をチェック
    // 3. ×→○検知時に通知を送信
    // 4. 自動予約が有効な場合は予約を実行
  },
};

// ユーザー登録
async function handleRegister(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string; adminKey?: string };
    const { email, password, adminKey } = body;

    // バリデーション
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ユーザー存在チェック
    const existingUser = await env.USERS.get(`user:${email}`);
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'User already exists' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ロール決定
    const role = (adminKey === env.ADMIN_KEY) ? 'admin' : 'user';

    // ユーザー作成
    const user: User = {
      id: crypto.randomUUID(),
      email,
      password: await hashPassword(password), // TODO: 実装
      role,
      createdAt: Date.now(),
    };

    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    await env.USERS.put(`user:id:${user.id}`, email);

    // JWT生成 (TODO: 実装)
    const token = 'dummy-token';

    return new Response(JSON.stringify({
      success: true,
      data: {
        user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
        token,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Registration failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ログイン
async function handleLogin(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string };
    const { email, password } = body;

    const userJson = await env.USERS.get(`user:${email}`);
    if (!userJson) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const user: User = JSON.parse(userJson);

    // パスワード検証 (TODO: 実装)
    // const isValid = await verifyPassword(password, user.password);

    const token = 'dummy-token';

    return new Response(JSON.stringify({
      success: true,
      data: {
        user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
        token,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Login failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// 監視リスト取得
async function handleMonitoringList(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  // TODO: JWT認証実装
  // const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  
  return new Response(JSON.stringify({
    success: true,
    data: [],
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// パスワードハッシュ化 (TODO: 実装)
async function hashPassword(password: string): Promise<string> {
  return password; // 仮実装
}
