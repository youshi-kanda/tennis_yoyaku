'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';

export default function DebugPage() {
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const res = await apiClient.getMonitoringList();
                setData(res);
            } catch (e: any) {
                setError(e.message);
            }
        }
        load();
    }, []);

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold mb-4">Debug Monitoring Data</h1>
            {error && <div className="text-red-500 mb-4">{error}</div>}
            <pre className="bg-gray-100 p-4 rounded overflow-auto max-w-full text-xs font-mono">
                {data ? JSON.stringify(data, null, 2) : 'Loading...'}
            </pre>
        </div>
    );
}
