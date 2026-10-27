import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { locales } from '@/config/locale';
import { resolveImageAlt } from '@/shared/lib/image-alt';
import { isOcrWorkbenchMode } from '@/shared/lib/ocr-workbench-mode';

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

test('home pages expose one factual, highlight-safe content contract', () => {
  for (const locale of locales) {
    const home = readJson(
      `src/config/locale/messages/${locale}/pages/index.json`
    );
    const sections = home.page?.sections;
    const hero = sections?.hero;
    const faqItems = sections?.faq?.items ?? [];

    assert.ok(hero?.title?.trim(), `${locale} home H1`);
    assert.ok(hero?.highlight_text?.trim(), `${locale} home H1 highlight`);
    assert.ok(
      hero.title.includes(hero.highlight_text),
      `${locale} home highlight must be part of the H1`
    );
    assert.equal(faqItems.length, 6, `${locale} concise home FAQ`);
    assert.equal(
      sections?.stats?.items?.[0]?.title,
      '10',
      `${locale} supported-language count`
    );
  }

  const featuresStep = fs.readFileSync(
    path.join(ROOT, 'src/themes/default/blocks/features-step.tsx'),
    'utf8'
  );
  assert.match(featuresStep, /!useCarousel \? \(/);
});

test('home pages do not publish high-risk free, browser-only, or absolute layout claims', () => {
  const homeFiles = locales.map((locale) =>
    path.join(MESSAGES_ROOT, locale, 'pages/index.json')
  );
  const forbidden = [
    /free AI PDF translator|free AI-powered|online for free|for free online/i,
    /everything (?:to translate PDF online )?happens in the browser/i,
    /at any scale/i,
    /mirrors? the original structure/i,
    /keeps? the original (?:fonts|layout|structure)/i,
    /and more\. We add pairs|and more\. New language pairs/i,
    /kostenlos(?:e[nrms]?|\s+online)|alles läuft im Browser|in jedem Maßstab/i,
    /δωρεάν|όλα γίνονται στον περιηγητή|οποιαδήποτε κλίμακα/i,
    /gratis(?: en línea| online)|todo (?:ocurre|se hace) en el navegador|cualquier escala/i,
    /gratuitement|tout se passe dans le navigateur|toute échelle/i,
    /gratis online|tutto avviene nel browser|qualsiasi scala/i,
    /無料|すべてブラウザ内で(?:安全に)?処理|あらゆる規模/i,
    /무료|모든 과정이 브라우저|어떤 규모/i,
    /бесплатн|всё происходит в браузере|любом масштабе/i,
    /免费|全程在浏览器|任意规模/i,
    /Konto- oder Gast|Λογαριασμός ή επισκέπτης|Cuenta o invitado/i,
    /Compte ou invité|Account o sessione ospite|アカウントまたはゲスト/i,
    /계정 또는 게스트|Аккаунт или гость|账号或访客/i,
  ];

  for (const file of homeFiles) {
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

test('home image alt text and organization data stay descriptive and factual', () => {
  assert.equal(
    resolveImageAlt('benefits', 'OCR review preview'),
    'OCR review preview'
  );
  assert.equal(
    resolveImageAlt('  Detailed preview  ', 'Fallback'),
    'Detailed preview'
  );

  const organizationSchema = fs.readFileSync(
    path.join(ROOT, 'src/shared/blocks/seo/organization-json-ld.tsx'),
    'utf8'
  );

  assert.doesNotMatch(organizationSchema, /free online PDF translator/i);
  assert.doesNotMatch(
    organizationSchema,
    /preserv(?:e|es|ing) the original layout/i
  );
  assert.match(organizationSchema, /https:\/\/x\.com\/translatep73025/);
  assert.match(organizationSchema, /https:\/\/github\.com\/translatepdfonline/);
});

test('OCR content cluster includes localized workflow, review, output, privacy, FAQ, and detailed docs', () => {
  const english = readJson(
    'src/config/locale/messages/en/pages/ocr-translator.json'
  );

  for (const locale of locales) {
    const ocr = readJson(
      `src/config/locale/messages/${locale}/pages/ocr-translator.json`
    );
    for (const key of ['title', 'intro']) {
      assert.ok(ocr.workflow?.[key]?.trim(), `${locale} OCR workflow ${key}`);
    }
    for (const step of [1, 2, 3, 4]) {
      assert.ok(
        ocr.workflow?.[`step${step}Title`]?.trim(),
        `${locale} OCR workflow step ${step} title`
      );
      assert.ok(
        ocr.workflow?.[`step${step}Description`]?.trim(),
        `${locale} OCR workflow step ${step} description`
      );
    }
    for (const section of ['review', 'outputs', 'privacy']) {
      assert.ok(ocr[section]?.title?.trim(), `${locale} OCR ${section} title`);
      assert.ok(
        ocr[section]?.description?.trim(),
        `${locale} OCR ${section} description`
      );
    }
    assert.ok(ocr.faq?.title?.trim(), `${locale} OCR FAQ title`);
    for (const item of [1, 2, 3, 4]) {
      assert.ok(ocr.faq?.[`q${item}`]?.trim(), `${locale} OCR FAQ q${item}`);
      assert.ok(ocr.faq?.[`a${item}`]?.trim(), `${locale} OCR FAQ a${item}`);
    }
    assert.ok(ocr.reviewedLabel?.trim(), `${locale} OCR reviewed label`);
    assert.ok(ocr.guideLink?.trim(), `${locale} OCR guide link`);

    if (locale !== 'en') {
      assert.notEqual(
        ocr.workflow.intro,
        english.workflow.intro,
        `${locale} localized OCR workflow`
      );
      assert.notEqual(
        ocr.faq.q1,
        english.faq.q1,
        `${locale} localized OCR FAQ`
      );
    }

    const docName =
      locale === 'en' ? 'ocr-workbench.mdx' : `ocr-workbench.${locale}.mdx`;
    const doc = fs.readFileSync(
      path.join(CONTENT_ROOT, 'docs', docName),
      'utf8'
    );
    assert.ok(doc.length >= 1000, `${locale} detailed OCR guide length`);
    assert.match(doc, /description:\s*\S/, `${locale} OCR guide description`);
    assert.match(doc, /PDF/, `${locale} OCR guide PDF output`);
    assert.match(doc, /Markdown/, `${locale} OCR guide Markdown output`);
    assert.match(doc, /HTML/, `${locale} OCR guide HTML output`);
  }
});

test('OCR SEO content is omitted only when a task or document opens the workbench', () => {
  assert.equal(isOcrWorkbenchMode({}), false);
  assert.equal(isOcrWorkbenchMode({ target_lang: 'zh' }), false);
  assert.equal(isOcrWorkbenchMode({ task: '' }), false);
  assert.equal(isOcrWorkbenchMode({ task: 'task-123' }), true);
  assert.equal(isOcrWorkbenchMode({ document: 'document-123' }), true);
  assert.equal(isOcrWorkbenchMode({ task: [' ', 'task-456'] }), true);

  const ocrPage = fs.readFileSync(
    path.join(ROOT, 'src/app/[locale]/(translate)/ocrtranslator/page.tsx'),
    'utf8'
  );
  assert.match(ocrPage, /showLandingContent = !isOcrWorkbenchMode\(query\)/);
  assert.match(ocrPage, /\{showLandingContent \? \(/);
  assert.match(ocrPage, /if \(!isOcrWorkbenchMode\(query\)\) return metadata/);
  assert.match(ocrPage, /index: false/);
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

test('localized docs landing pages provide factual task navigation', () => {
  const staleOrSpeculative = [
    /\/translate\/upload/i,
    /www\.translatepdfonline\.com/i,
    /more language pairs|weitere Sprachpaare|más pares de idiomas/i,
    /d’autres paires de langues|altre coppie linguistiche/i,
    /περισσότερα ζεύγη γλωσσών|言語ペアは今後も拡張/i,
    /언어 쌍은 계속 확장|других языковых парах|持续扩展语言对/i,
    /FastAPI|Celery|DeepSeek|DocLayout-YOLO|react-pdf-selection|PyMuPDF|\bECS\b/,
  ];

  for (const locale of locales) {
    const fileName = locale === 'en' ? 'index.mdx' : `index.${locale}.mdx`;
    const content = fs.readFileSync(
      path.join(CONTENT_ROOT, 'docs', fileName),
      'utf8'
    );
    const prefix = locale === 'en' ? '' : `/${locale}`;
    const requiredLinks = [
      `${prefix}/ocrtranslator`,
      `${prefix}/docs/upload`,
      `${prefix}/docs/ocr-workbench`,
      `${prefix}/docs/pdf-to-text`,
      `${prefix}/docs/image-to-text`,
      `${prefix}/docs/contract-comparison`,
      `${prefix}/privacy-policy`,
      `${prefix}/terms-of-service`,
    ];

    assert.match(content, /^---\n[\s\S]*?title:\s*\S/m, `${locale} docs title`);
    assert.match(
      content,
      /^---\n[\s\S]*?description:\s*\S/m,
      `${locale} docs description`
    );
    assert.ok(content.length > 1300, `${locale} substantive docs landing page`);
    assert.match(content, /2026-10-27/, `${locale} product-fact review date`);
    assert.doesNotMatch(
      content.replace(/^---[\s\S]*?---\s*/, ''),
      /^#\s+/m,
      `${locale} docs body must not duplicate the template H1`
    );

    for (const link of requiredLinks) {
      assert.ok(content.includes(`](${link})`), `${locale} docs link ${link}`);
    }
    for (const pattern of staleOrSpeculative) {
      assert.doesNotMatch(content, pattern, `${locale} docs: ${pattern}`);
    }
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
