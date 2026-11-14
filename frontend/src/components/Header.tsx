'use client';

import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LogOut, Mail, ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';

interface HeaderProps {
  onCompose: () => void;
}

export function Header({ onCompose }: HeaderProps) {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-900/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-white font-semibold text-lg leading-none">Outbox</span>
              <span className="text-indigo-400 font-semibold text-lg leading-none"> Labs</span>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-3">
            {/* Compose Button */}
            <button
              id="compose-btn"
              onClick={onCompose}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95"
            >
              <Mail className="w-4 h-4" />
              <span className="hidden sm:inline">Compose</span>
            </button>

            {/* User Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                id="user-menu-btn"
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-white/5 transition-colors"
              >
                {/* Avatar */}
                <div className="relative w-8 h-8 rounded-full overflow-hidden ring-2 ring-indigo-500/30 flex-shrink-0">
                  {user?.avatarUrl ? (
                    <Image
                      src={user.avatarUrl}
                      alt={user.name ?? user.email}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">
                      {initials}
                    </div>
                  )}
                </div>

                {/* Name + Email */}
                <div className="hidden md:flex flex-col items-start leading-tight">
                  <span className="text-white text-sm font-medium truncate max-w-[140px]">
                    {user?.name ?? 'User'}
                  </span>
                  <span className="text-slate-400 text-xs truncate max-w-[140px]">
                    {user?.email}
                  </span>
                </div>

                <ChevronDown
                  className={`w-4 h-4 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Dropdown Menu */}
              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-white/10 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
                  {/* User info header */}
                  <div className="px-4 py-3 border-b border-white/5">
                    <p className="text-white text-sm font-medium truncate">{user?.name}</p>
                    <p className="text-slate-400 text-xs truncate">{user?.email}</p>
                  </div>

                  {/* Logout */}
                  <div className="p-1.5">
                    <button
                      id="logout-btn"
                      onClick={() => {
                        setDropdownOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-red-400 hover:bg-red-500/10 rounded-xl transition-colors text-sm font-medium"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
