import { generateJWT, verifyJWT, hashPassword, verifyPassword, authenticate } from './auth';
import {
  checkShinagawaAvailability,
  checkMinatoAvailability,
  makeShinagawaReservation,
  makeMinatoReservation,
  type AvailabilityResult,
} from './scraper';

export interface Env {
  USERS: KVNamespace;
  SESSIONS: KVNamespace;
  MONITORING: KVNamespace;
  RESERVATIONS: KVNamespace;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  ADMIN_KEY: string;
}

export interface User {
  id: string;
  email: string;
  password: string;
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
  lastCheck?: number;
  lastStatus?: string; // '×' or '○'
  createdAt: number;
}

export interface ReservationHistory {
  id: string;
  userId: string;
  targetId: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed' | 'cancelled';
  message?: string;
  createdAt: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/auth/register') {
        return handleRegister(request, env);
      }

      if (path === '/api/auth/login') {
        return handleLogin(request, env);
      }

      if (path === '/api/monitoring/list') {
        return handleMonitoringList(request, env);
      }

      if (path === '/api/monitoring/create') {
        return handleMonitoringCreate(request, env);
      }

      if (path === '/api/reservations/history') {
        return handleReservationHistory(request, env);
      }

      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', timestamp: Date.now() });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error: any) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message || 'Internal server error' }, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('[Cron] Started:', new Date().toISOString());
    
    try {
      const targets = await getAllActiveTargets(env);
      console.log(`[Cron] Found ${targets.length} active monitoring targets`);
      
      for (const target of targets) {
        try {
          await checkAndNotify(target, env);
        } catch (error) {
          console.error(`[Cron] Error checking target ${target.id}:`, error);
        }
      }
    } catch (error) {
      console.error('[Cron] Error:', error);
    }
  },
};

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string; adminKey?: string };
    const { email, password, adminKey } = body;

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400);
    }

    const existingUser = await env.USERS.get(`user:${email}`);
    if (existingUser) {
      return jsonResponse({ error: 'User already exists' }, 409);
    }

    const role = (adminKey === env.ADMIN_KEY) ? 'admin' : 'user';

    const user: User = {
      id: crypto.randomUUID(),
      email,
      password: await hashPassword(password),
      role,
      createdAt: Date.now(),
    };

    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    await env.USERS.put(`user:id:${user.id}`, email);

    const token = await generateJWT(
      { userId: user.id, email: user.email, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      env.JWT_SECRET
    );

    return jsonResponse({
      success: true,
      data: {
        user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
        token,
      },
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Registration failed: ' + error.message }, 500);
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string };
    const { email, password } = body;

    const userJson = await env.USERS.get(`user:${email}`);
    if (!userJson) {
      return jsonResponse({ error: 'Invalid credentials' }, 401);
    }

    const user: User = JSON.parse(userJson);

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return jsonResponse({ error: 'Invalid credentials' }, 401);
    }

    const token = await generateJWT(
      { userId: user.id, email: user.email, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      env.JWT_SECRET
    );

    return jsonResponse({
      success: true,
      data: {
        user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
        token,
      },
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Login failed: ' + error.message }, 500);
  }
}

async function handleMonitoringList(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const list = await env.MONITORING.list({ prefix: `target:${userId}:` });
    const targets = await Promise.all(
      list.keys.map(async (key) => {
        const data = await env.MONITORING.get(key.name);
        return data ? JSON.parse(data) : null;
      })
    );

    return jsonResponse({
      success: true,
      data: targets.filter(t => t !== null),
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function handleMonitoringCreate(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const body = await request.json() as {
      site: 'shinagawa' | 'minato';
      facilityId: string;
      facilityName: string;
      date: string;
      timeSlot: string;
      autoReserve: boolean;
    };

    const target: MonitoringTarget = {
      id: crypto.randomUUID(),
      userId,
      site: body.site,
      facilityId: body.facilityId,
      facilityName: body.facilityName,
      date: body.date,
      timeSlot: body.timeSlot,
      status: 'active',
      autoReserve: body.autoReserve,
      createdAt: Date.now(),
    };

    await env.MONITORING.put(`target:${userId}:${target.id}`, JSON.stringify(target));

    return jsonResponse({
      success: true,
      data: target,
    });
  } catch (error: any) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleReservationHistory(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const list = await env.RESERVATIONS.list({ prefix: `history:${userId}:` });
    const history = await Promise.all(
      list.keys.map(async (key) => {
        const data = await env.RESERVATIONS.get(key.name);
        return data ? JSON.parse(data) : null;
      })
    );

    return jsonResponse({
      success: true,
      data: history.filter(h => h !== null).sort((a, b) => b.createdAt - a.createdAt),
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function getAllActiveTargets(env: Env): Promise<MonitoringTarget[]> {
  const list = await env.MONITORING.list({ prefix: 'target:' });
  const targets = await Promise.all(
    list.keys.map(async (key) => {
      const data = await env.MONITORING.get(key.name);
      return data ? JSON.parse(data) as MonitoringTarget : null;
    })
  );
  return targets.filter(t => t !== null && t.status === 'active');
}

async function checkAndNotify(target: MonitoringTarget, env: Env): Promise<void> {
  console.log(`[Check] Target ${target.id}: ${target.site} - ${target.facilityName}`);

  try {
    let result: AvailabilityResult;

    if (target.site === 'shinagawa') {
      result = await checkShinagawaAvailability(
        target.facilityId,
        target.date,
        target.timeSlot
      );
    } else {
      result = await checkMinatoAvailability(
        target.facilityId,
        target.date,
        target.timeSlot
      );
    }

    // 前回の状態と比較
    const previousStatus = target.lastStatus || '×';
    const changedToAvailable = previousStatus === '×' && result.currentStatus === '○';

    // 監視ターゲットを更新
    target.lastCheck = Date.now();
    target.lastStatus = result.currentStatus;
    await env.MONITORING.put(`target:${target.userId}:${target.id}`, JSON.stringify(target));

    console.log(`[Check] Status: ${previousStatus} → ${result.currentStatus}, Changed: ${changedToAvailable}`);

    // ×→○になった場合
    if (changedToAvailable) {
      console.log(`[Alert] Availability changed for target ${target.id}!`);

      // 自動予約が有効な場合は予約を試みる
      if (target.autoReserve) {
        await attemptReservation(target, env);
      }

      // TODO: プッシュ通知を送信
    }
  } catch (error) {
    console.error(`[Check] Error for target ${target.id}:`, error);
  }
}

async function attemptReservation(target: MonitoringTarget, env: Env): Promise<void> {
  console.log(`[Reserve] Attempting reservation for target ${target.id}`);

  try {
    // TODO: ユーザーの認証情報を取得
    const credentials = { username: 'user', password: 'pass' }; // 仮

    let result;
    if (target.site === 'shinagawa') {
      result = await makeShinagawaReservation(
        target.facilityId,
        target.date,
        target.timeSlot,
        credentials
      );
    } else {
      result = await makeMinatoReservation(
        target.facilityId,
        target.date,
        target.timeSlot,
        credentials
      );
    }

    // 履歴に保存
    const history: ReservationHistory = {
      id: crypto.randomUUID(),
      userId: target.userId,
      targetId: target.id,
      site: target.site,
      facilityName: target.facilityName,
      date: target.date,
      timeSlot: target.timeSlot,
      status: result.success ? 'success' : 'failed',
      message: result.message,
      createdAt: Date.now(),
    };

    await env.RESERVATIONS.put(`history:${target.userId}:${history.id}`, JSON.stringify(history));

    // 成功した場合は監視を完了状態に
    if (result.success) {
      target.status = 'completed';
      await env.MONITORING.put(`target:${target.userId}:${target.id}`, JSON.stringify(target));
    }

    console.log(`[Reserve] Result: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.message}`);
  } catch (error) {
    console.error(`[Reserve] Error:`, error);
  }
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
