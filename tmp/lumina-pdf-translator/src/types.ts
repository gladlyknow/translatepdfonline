export interface User {
  id: number;
  email: string;
  avatar_url?: string;
  provider?: 'email' | 'google';
}

export interface TranslationJob {
  id: number;
  filename: string;
  source_lang: string;
  target_lang: string;
  status: string;
  created_at: string;
}

export type Language = 'Chinese' | 'English' | 'Spanish';
