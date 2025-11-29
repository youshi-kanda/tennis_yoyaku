'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';

export default function AdminMaintenancePage() {
  const { isAdmin } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">🔧 保守点検</h1>
      <div className="bg-white rounded-xl shadow-md p-6 border">
        <p className="text-gray-600">Phase 4で実装予定</p>
      </div>
    </div>
  );
}
