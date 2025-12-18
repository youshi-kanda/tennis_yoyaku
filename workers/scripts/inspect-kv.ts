export default {
    async fetch(request, env) {
        // List all keys in MONITORING namespace
        const list = await env.MONITORING.list();
        const results = [];

        for (const key of list.keys) {
            const value = await env.MONITORING.get(key.name);
            if (value) {
                try {
                    const parsed = JSON.parse(value);
                    // Extract only essential info
                    const targets = parsed.targets.map(t => ({
                        facility: t.facilityName,
                        date: t.date,
                        time: t.timeSlot,
                        status: t.status
                    }));
                    results.push({ user: key.name, targets });
                } catch (e) {
                    results.push({ key: key.name, error: 'Parse Error' });
                }
            }
        }
        return Response.json(results, { headers: { 'Content-Type': 'application/json' } });
    }
};
