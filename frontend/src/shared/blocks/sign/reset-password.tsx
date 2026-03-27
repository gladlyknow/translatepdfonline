'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { authClient } from '@/core/auth/client';
import { useRouter } from '@/core/i18n/navigation';
import { defaultLocale } from '@/config/locale';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

export function ResetPassword() {
  const t = useTranslations('common.sign');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const token = searchParams.get('token') || searchParams.get('code') || '';
  const email = searchParams.get('email') || '';

  const base = locale !== defaultLocale ? `/${locale}` : '';

  const handleSubmit = async () => {
    if (loading) return;
    if (!token) {
      toast.error(t('reset_password_missing_token'));
      return;
    }
    if (!password || !confirmPassword) {
      toast.error(t('reset_password_required_error'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('reset_password_mismatch_error'));
      return;
    }

    try {
      setLoading(true);
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });

      if (result?.error) {
        toast.error(
          result.error.message || t('reset_password_failed_message')
        );
        return;
      }

      toast.success(t('reset_password_success_message'));

      const query = new URLSearchParams();
      if (email) query.set('email', email);
      router.push(`${base}/sign-in?${query.toString()}`);
    } catch (e: any) {
      toast.error(e?.message || t('reset_password_failed_message'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto w-full md:max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">
          <h1>{t('reset_password_title')}</h1>
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          <h2>{t('reset_password_description')}</h2>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="password">{t('new_password_title')}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t('new_password_placeholder')}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">
              {t('confirm_password_title')}
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder={t('confirm_password_placeholder')}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <p>{t('reset_password_submit')}</p>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <p className="w-full text-center text-xs text-neutral-500">
          {t('reset_password_hint')}
        </p>
      </CardFooter>
    </Card>
  );
}

