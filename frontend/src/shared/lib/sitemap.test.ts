import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultLocale, locales } from '@/config/locale';
import {
  currentPricingLocales,
  indexableLandingRoutes,
  isCanonicalSiteHost,
} from '@/config/seo-routes';

import { buildSitemapUrlEntry, pathForLocale, wrapSitemap } from './sitemap';

const BASE = 'https://translatepdfonline.com';

test('pathForLocale adds exactly one locale prefix', () => {
  assert.equal(pathForLocale('/', defaultLocale, defaultLocale), '/');
  assert.equal(pathForLocale('/', 'zh', defaultLocale), '/zh');
  assert.equal(
    pathForLocale('/pdf-to-text', defaultLocale, defaultLocale),
    '/pdf-to-text'
  );
  assert.equal(
    pathForLocale('/pdf-to-text', 'zh', defaultLocale),
    '/zh/pdf-to-text'
  );
});

test('localized sitemap entries build alternates from the base path', () => {
  const entry = buildSitemapUrlEntry({
    base: BASE,
    pathname: '/pdf-to-text',
    locale: 'zh',
    alternateLocales: locales,
    defaultLocale,
  });

  assert.match(
    entry,
    /<loc>https:\/\/translatepdfonline\.com\/zh\/pdf-to-text<\/loc>/
  );
  assert.match(
    entry,
    /hreflang="en" href="https:\/\/translatepdfonline\.com\/pdf-to-text"/
  );
  assert.match(
    entry,
    /hreflang="es" href="https:\/\/translatepdfonline\.com\/es\/pdf-to-text"/
  );
  assert.match(
    entry,
    /hreflang="x-default" href="https:\/\/translatepdfonline\.com\/pdf-to-text"/
  );
  assert.doesNotMatch(entry, /\/zh\/zh\/|\/es\/zh\//);
  assert.equal(
    (entry.match(/rel="alternate"/g) || []).length,
    locales.length + 1
  );
});

test('default-only routes expose only the default locale and x-default', () => {
  const entry = buildSitemapUrlEntry({
    base: BASE,
    pathname: '/blog',
    locale: defaultLocale,
    alternateLocales: [defaultLocale],
    defaultLocale,
  });

  assert.equal((entry.match(/rel="alternate"/g) || []).length, 2);
  assert.doesNotMatch(entry, /hreflang="zh"/);
});

test('indexable route registry excludes legal pages and limits duplicate shells', () => {
  const routes = new Map(
    indexableLandingRoutes.map((route) => [route.path, route.localePolicy])
  );
  assert.equal(routes.has('/privacy-policy'), false);
  assert.equal(routes.has('/terms-of-service'), false);
  assert.equal(routes.get('/blog'), 'default-only');
  assert.equal(routes.get('/docs/api'), 'default-only');
  const pricing = indexableLandingRoutes.find(
    (route) => route.path === '/pricing'
  );
  assert.deepEqual(pricing?.locales, currentPricingLocales);
  const pricingLocales = new Set<string>(pricing?.locales);
  assert.equal(pricingLocales.has('de'), false);
  assert.equal(pricingLocales.has('es'), false);
  assert.equal(pricingLocales.has('ru'), false);
});

test('sitemap output omits ignored priority and changefreq hints', () => {
  const xml = wrapSitemap([
    buildSitemapUrlEntry({
      base: BASE,
      pathname: '/',
      locale: defaultLocale,
      alternateLocales: locales,
      defaultLocale,
    }),
  ]);
  assert.doesNotMatch(xml, /<priority>|<changefreq>/);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
});

test('only canonical production hosts are indexable', () => {
  assert.equal(isCanonicalSiteHost('translatepdfonline.com'), true);
  assert.equal(isCanonicalSiteHost('www.translatepdfonline.com'), true);
  assert.equal(
    isCanonicalSiteHost('translatepdfonline-dev.gladlyknow.workers.dev'),
    false
  );
  assert.equal(isCanonicalSiteHost('localhost'), false);
});
