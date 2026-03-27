'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { authClient } from '@/core/auth/client';
import { Link, useRouter } from '@/core/i18n/navigation';
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

export function ForgotPassword() {
  const t = useTranslations('common.sign');
  const locale = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const base = locale !== defaultLocale ? `/${locale}` : '';

  const handleSubmit = async () => {
    if (loading) return;
    if (!email) {
      toast.error(t('email_required_error'));
      return;
    }

    try {
      setLoading(true);
      // Better Auth: POST /request-password-reset, redirectTo = full URL of reset page
      const origin =
        typeof window !== 'undefined' ? window.location.origin : '';
      const redirectTo = `${origin}${base}/reset-password`;
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo,
      });

      if (result?.error) {
        toast.error(
          result.error.message || t('reset_password_send_failed_message')
        );
        return;
      }

      toast.success(t('reset_password_email_sent_message'));
      // 返回登录页，并预填邮箱，方便用户之后登录
      router.push(`/sign-in?email=${encodeURIComponent(email)}`);
    } catch (e: any) {
      toast.error(e?.message || t('reset_password_send_failed_message'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto w-full md:max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">
          <h1>{t('forgot_password_title')}</h1>
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          <h2>{t('forgot_password_description')}</h2>
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
            <Label htmlFor="email">{t('email_title')}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t('email_placeholder')}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <p>{t('forgot_password_submit')}</p>
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center border-t py-4 text-xs text-neutral-500">
          {t('remember_password')}
          <Link href="/sign-in" className="ml-1 underline">
            {t('back_to_sign_in')}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}

