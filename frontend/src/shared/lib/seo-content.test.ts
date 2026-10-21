import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { locales } from '@/config/locale';

const ROOT = process.cwd();
const MESSAGES_ROOT = path.join(ROOT, 'src/config/locale/messages');
const CONTENT_ROOT = path.join(ROOT, 'content');

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function collectFiles(directory: string, extensions: Set<string>): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath, extensions);
    return extensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

test('every locale has dedicated home and OCR metadata plus a visible OCR H1', () => {
  for (const locale of locales) {
    const home = readJson(
      `src/config/locale/messages/${locale}/pages/index.json`
    );
    const ocr = readJson(
      `src/config/locale/messages/${locale}/pages/ocr-translator.json`
    );

    assert.ok(home.metadata?.title?.trim(), `${locale} home title`);
    assert.ok(home.metadata?.description?.trim(), `${locale} home description`);
    assert.ok(ocr.metadata?.title?.trim(), `${locale} OCR title`);
    assert.ok(ocr.metadata?.description?.trim(), `${locale} OCR description`);
    assert.ok(ocr.h1?.trim(), `${locale} OCR H1`);
    assert.ok(ocr.intro?.trim(), `${locale} OCR intro`);
  }
});

test('public content does not reintroduce unsupported Norwegian claims, no-signup claims, or www links', () => {
  const files = [
    ...collectFiles(MESSAGES_ROOT, new Set(['.json'])),
    ...collectFiles(CONTENT_ROOT, new Set(['.md', '.mdx'])),
  ];
  const forbidden = [
    /https:\/\/www\.translatepdfonline\.com/i,
    /Norwegian|Norweg|Norvég|Noruego|Norvegese|Νορβηγ|挪威|ノルウェ|노르웨|норвеж/i,
    /no\s+(?:account|sign[ -]?up)\s+(?:is\s+)?required/i,
    /无需(?:注册|账号|登录)|不用注册/i,
    /ohne Anmeldung|keine Anmeldung|kein Konto (?:nötig|erforderlich)/i,
    /sans (?:inscription|compte)|aucun compte requis/i,
    /sin (?:necesidad de )?(?:registro|cuenta)/i,
    /senza registrazione|nessun account richiesto/i,
    /χωρίς (?:εγγραφή|λογαριασμό)/i,
    /登録不要|アカウント登録なし|アカウント不要/i,
    /회원가입 없이|회원가입 불필요|가입 없이|계정 없이/i,
    /без регистрации|регистрация не требуется/i,
    /every new user (?:receives|gets)|new users receive/i,
    /每(?:个|位)新用户.{0,30}(?:获得|获赠|赠送)|新用户.{0,20}(?:获得|获赠|赠送)/i,
    /jeder neue Nutzer erhält|Neue (?:Nutzer|Benutzer) erhalten/i,
    /chaque nouvel utilisateur reçoit|les nouveaux utilisateurs reçoivent/i,
    /cada (?:nuevo usuario|usuario nuevo) recibe|los nuevos usuarios reciben/i,
    /ogni nuovo utente riceve|i nuovi utenti ricevono/i,
    /κάθε νέος χρήστης (?:λαμβάνει|παίρνει)|οι νέοι χρήστες λαμβάνουν/i,
    /すべての新規ユーザー.{0,20}(?:付与|獲得)|新規ユーザー.{0,20}(?:付与|獲得)/i,
    /모든 신규 사용자.{0,20}(?:받|제공)|신규 사용자.{0,20}(?:받|제공)/i,
    /каждый новый пользователь получает|новые пользователи получают/i,
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        content,
        pattern,
        `${path.relative(ROOT, file)}: ${pattern}`
      );
    }
  }
});

test('runtime offers are conditional and current credit rates are injected at render time', () => {
  for (const locale of locales) {
    const landing = readJson(
      `src/config/locale/messages/${locale}/landing.json`
    );
    const pricing = readJson(
      `src/config/locale/messages/${locale}/pages/pricing.json`
    );
    const promoCredits = landing.header?.topbanner?.promoCredits;
    const pricingText = JSON.stringify(pricing);

    assert.match(
      promoCredits,
      /\{credits\}/,
      `${locale} dynamic signup credit`
    );
    assert.match(
      pricingText,
      /\{creditsPerPage\}/,
      `${locale} dynamic per-page rate`
    );
    assert.doesNotMatch(
      pricingText,
      /10\s*(?:credits|积分|crédits|créditos|crediti|πιστώσεις|クレジット|크레딧|кредит)/i,
      `${locale} hard-coded per-page rate`
    );
  }

  const landingLayout = fs.readFileSync(
    path.join(ROOT, 'src/app/[locale]/(landing)/layout.tsx'),
    'utf8'
  );
  const pricingPage = fs.readFileSync(
    path.join(ROOT, 'src/app/[locale]/(landing)/pricing/page.tsx'),
    'utf8'
  );
  assert.match(landingLayout, /initial_credits_enabled/);
  assert.match(landingLayout, /initial_credits_amount/);
  assert.match(pricingPage, /getTranslateCreditsPerPage/);
  assert.match(pricingPage, /applyCurrentCreditRate/);
});

test('contract comparison publishes factual scope and omits retired promotional blocks', () => {
  const retiredKeys = [
    'section1Title',
    'decisionMatrixTitle',
    'seoFaq',
    'relatedSearchesHeading',
    'geoFooterHeading',
  ];
  const english = readJson(
    'src/config/locale/messages/en/pages/contract-comparison.json'
  );

  for (const locale of locales) {
    const contract = readJson(
      `src/config/locale/messages/${locale}/pages/contract-comparison.json`
    );
    for (const key of [
      'metaTitle',
      'metaDescription',
      'heroTitle',
      'heroText',
      'scopeTitle',
      'scopeBody',
      'reviewTitle',
      'reviewBody',
      'howStep1Desc',
      'howStep2Desc',
      'howStep3Desc',
      'trustText',
    ]) {
      assert.ok(contract[key]?.trim(), `${locale} contract ${key}`);
    }
    for (const key of retiredKeys) {
      assert.equal(key in contract, false, `${locale} retired key ${key}`);
    }
    if (locale !== 'en') {
      for (const key of [
        'explorePdfToTextDesc',
        'exploreImageToTextDesc',
        'explorePdfTranslateDesc',
      ]) {
        assert.notEqual(
          contract[key],
          english[key],
          `${locale} localized ${key}`
        );
      }
    }
  }
});

test('priority PDF-to-text docs have non-empty frontmatter descriptions', () => {
  for (const locale of ['es', 'fr', 'it', 'zh']) {
    const content = fs.readFileSync(
      path.join(CONTENT_ROOT, `docs/pdf-to-text.${locale}.mdx`),
      'utf8'
    );
    assert.match(content, /description:\s*>-\s*\n\s+\S/);
  }
});

test('local blog sources do not duplicate the page template H1', () => {
  const blogFiles = collectFiles(
    path.join(CONTENT_ROOT, 'blog'),
    new Set(['.md'])
  );
  for (const file of blogFiles) {
    const body = fs
      .readFileSync(file, 'utf8')
      .replace(/^---[\s\S]*?---\s*/, '');
    assert.doesNotMatch(body, /^#\s+/m, path.relative(ROOT, file));
  }
});
