'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { authApi } from '@/lib/api';

export default function AuthCallbackClient() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      router.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!token) {
      router.replace('/login?error=missing_token');
      return;
    }

    // Store token and fetch user info
    localStorage.setItem('auth_token', token);

    authApi
      .me()
      .then((user) => {
        login(token, user);
        router.replace('/dashboard');
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        router.replace('/login?error=auth_failed');
      });
  }, [searchParams, login, router]);

  return (
    <div className="min-h-screen gradient-bg flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm">Completing sign in...</p>
      </div>
    </div>
  );
}
