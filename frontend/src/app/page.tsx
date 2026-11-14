import { redirect } from 'next/navigation';

/**
 * Root page — redirects to /login.
 * The login page itself redirects to /dashboard if already authenticated.
 */
export default function RootPage() {
  redirect('/login');
}
