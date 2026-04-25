import { EmailManager, ResendProvider } from '@/extensions/email';
import { Configs, getAllConfigs } from '@/shared/models/config';

/**
 * get email service with configs
 */
export function getEmailServiceWithConfigs(configs: Configs) {
  const emailManager = new EmailManager();
  const defaultFrom = (
    configs.resend_sender_email ||
    (configs as Record<string, string>).resend_from ||
    process.env.RESEND_SENDER_EMAIL ||
    process.env.RESEND_FROM ||
    ''
  ).trim();

  if (configs.resend_api_key) {
    emailManager.addProvider(
      new ResendProvider({
        apiKey: configs.resend_api_key,
        defaultFrom,
      })
    );
  }

  return emailManager;
}

/**
 * global email service
 */
let emailService: EmailManager | null = null;

/**
 * get email service instance
 */
export async function getEmailService(
  configs?: Configs
): Promise<EmailManager> {
  if (!configs) {
    configs = await getAllConfigs();
  }
  emailService = getEmailServiceWithConfigs(configs);

  return emailService;
}
