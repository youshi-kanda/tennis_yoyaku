
import { Env, User } from '../types';
import { generateJWT, hashPassword, verifyPassword, authenticate } from '../auth';
import { jsonResponse } from '../utils/response';

export async function handleRegister(request: Request, env: Env): Promise<Response> {
    try {
        const body = await request.json() as any;
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

export async function handleLogin(request: Request, env: Env): Promise<Response> {
    try {
        const body = await request.json() as any;
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

export async function handleChangePassword(request: Request, env: Env): Promise<Response> {
    try {
        const payload = await authenticate(request, env.JWT_SECRET);
        const email = payload.email;

        const body = await request.json() as any;
        const { currentPassword, newPassword } = body;

        // バリデーション
        if (!currentPassword || !newPassword) {
            return jsonResponse({ error: 'Current password and new password are required' }, 400);
        }

        if (newPassword.length < 8) {
            return jsonResponse({ error: 'New password must be at least 8 characters long' }, 400);
        }

        if (currentPassword === newPassword) {
            return jsonResponse({ error: 'New password must be different from current password' }, 400);
        }

        // 現在のユーザー情報を取得
        const userJson = await env.USERS.get(`user:${email}`);
        if (!userJson) {
            return jsonResponse({ error: 'User not found' }, 404);
        }

        const user: User = JSON.parse(userJson);

        // 現在のパスワードを検証
        const isValid = await verifyPassword(currentPassword, user.password);
        if (!isValid) {
            return jsonResponse({ error: 'Current password is incorrect' }, 401);
        }

        // 新しいパスワードをハッシュ化
        const hashedPassword = await hashPassword(newPassword);

        // ユーザー情報を更新
        user.password = hashedPassword;
        user.updatedAt = Date.now();

        await env.USERS.put(`user:${email}`, JSON.stringify(user));

        console.log(`[ChangePassword] User ${email} changed password successfully`);

        return jsonResponse({
            success: true,
            message: 'Password changed successfully',
        });
    } catch (error: any) {
        console.error('[ChangePassword] Error:', error);
        if (error.message === 'Unauthorized') {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        return jsonResponse({ error: error.message }, 500);
    }
}
