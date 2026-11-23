import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Lock, ShieldCheck } from 'lucide-react';
import { setAuthToken } from '../hooks/lib/authToken';

interface PasswordProtectPageProps {
  onSuccess: () => void;
}

const PasswordProtectPage: React.FC<PasswordProtectPageProps> = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/auth/status');
        if (res.ok && active) {
          const data = await res.json();
          setSetupRequired(Boolean(data.setupRequired));
        }
      } catch {
        if (active) {
          setError('Unable to reach server. Please refresh and try again.');
        }
      } finally {
        if (active) setCheckingStatus(false);
      }
    };
    checkStatus();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (setupRequired) {
      if (password.length < 6) {
        setError('Please choose a password of at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = setupRequired ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setError(data.error || 'Authentication failed. Please try again.');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      setAuthToken(data.token);
      onSuccess();
    } catch {
      setError('Network error while verifying password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-sm animate-scale-in">
        <CardHeader className="text-center">
          <div className="mx-auto bg-blue-100 dark:bg-blue-900/50 p-3 rounded-full w-fit mb-4">
            {setupRequired ? (
              <ShieldCheck className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            ) : (
              <Lock className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {setupRequired ? 'Set Admin Password' : 'Access Required'}
          </CardTitle>
          <CardDescription>
            {checkingStatus
              ? 'Checking security status...'
              : setupRequired
                ? 'First-time setup: create an admin password to protect your BIOTECHCENTRE workspace.'
                : 'This workspace is password protected. Enter your password to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={setupRequired ? 'Create password (min 6 chars)' : 'Enter password'}
                className="mt-1"
                disabled={loading || checkingStatus}
                required
              />
            </div>
            {setupRequired && (
              <div>
                <label htmlFor="confirmPassword" className="sr-only">
                  Confirm Password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="mt-1"
                  disabled={loading || checkingStatus}
                  required
                />
              </div>
            )}
            {error && <p className="mt-2 text-sm text-red-500 text-center">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || checkingStatus}>
              {loading
                ? setupRequired
                  ? 'Saving...'
                  : 'Verifying...'
                : setupRequired
                  ? 'Set Password & Unlock'
                  : 'Unlock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default PasswordProtectPage;