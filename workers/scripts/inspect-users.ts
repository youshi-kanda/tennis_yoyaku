
import { Env } from '../src/index';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const list = await env.USERS.list({ prefix: 'user:' });
        const users: any[] = [];
        const logs: string[] = [];

        logs.push('--- User Inspection ---');

        for (const key of list.keys) {
            // Skip user:id: index
            if (key.name.includes(':id:')) continue;

            const email = key.name.replace('user:', '');
            const userData = await env.USERS.get(key.name, 'json') as any;

            if (!userData) continue;

            const userId = userData.id;
            logs.push(`User: ${email} (ID: ${userId})`);

            // Check Settings
            const settings = await env.USERS.get(`settings:${userId}`, 'json') as any;
            if (settings) {
                logs.push(`  Settings found.`);
                if (settings.shinagawa) {
                    logs.push(`  Shinagawa: Username=${settings.shinagawa.username}, Password=${settings.shinagawa.password ? '(Present)' : '(Missing)'}`);
                } else {
                    logs.push(`  Shinagawa: NOT CONFIG`);
                }
                if (settings.minato) {
                    logs.push(`  Minato: Username=${settings.minato.username}, Password=${settings.minato.password ? '(Present)' : '(Missing)'}`);
                } else {
                    logs.push(`  Minato: NOT CONFIG`);
                }
            } else {
                logs.push(`  Settings: NOT FOUND`);
            }
            logs.push('');
        }

        return new Response(logs.join('\n'));
    }
};
