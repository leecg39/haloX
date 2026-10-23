import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_USER_ID as ADMIN, DEFAULT_USER_ID as USER, HaloXDatabase, RlsAccessDeniedError, type Row } from './database.ts';
import { createContactRequest, readPublicSiteContent, readSiteContentAdmin, runSiteContentCommand } from './site-content-service.ts';

const page = (route = '/ko/cms-test'): Row => ({ route, locale: 'ko', title: 'CMS 테스트', excerpt: '게시 요약', body_md: '# 첫 문단\n\n본문 내용', seo_title: 'CMS SEO', taxonomy_ids: [] });

describe('공개 사이트 콘텐츠 CMS', () => {
  it('exposes the capture catalog only to the service operator and keeps private models out of REST tables', () => {
    const db = new HaloXDatabase();
    const data = readSiteContentAdmin(db, ADMIN);
    assert.ok(data.catalog_count > 100);
    assert.ok(data.contents.some(row => row.route === '/ko/contact-sales' && row.captured_fallback));
    assert.deepEqual(readPublicSiteContent(db, '/zh/about'), { found: false });
    assert.throws(() => readSiteContentAdmin(db, USER), RlsAccessDeniedError);
    for (const table of ['site_pages', 'site_posts', 'site_taxonomies', 'site_translations', 'contact_requests']) assert.throws(() => db.queryTable(table, {}, ADMIN), /does not exist/);
  });

  it('creates, publishes, revises and deletes a page while the public view uses only the published snapshot', () => {
    const db = new HaloXDatabase();
    const created = runSiteContentCommand(db, ADMIN, 'page-create', page(), 1_000);
    assert.deepEqual(readPublicSiteContent(db, '/ko/cms-test'), { found: false });
    const published = runSiteContentCommand(db, ADMIN, 'content-publish', { content_id: created.id, expected_revision: 1 }, 2_000);
    assert.equal(readPublicSiteContent(db, '/ko/cms-test').content?.title, 'CMS 테스트');
    const revised = runSiteContentCommand(db, ADMIN, 'content-update', { ...page('/ko/cms-renamed'), title: '수정 초안', content_id: created.id, expected_revision: published.revision }, 3_000);
    assert.equal(readPublicSiteContent(db, '/ko/cms-test').content?.title, 'CMS 테스트');
    assert.equal(readPublicSiteContent(db, '/ko/cms-renamed').found, false);
    assert.throws(() => runSiteContentCommand(db, ADMIN, 'content-update', { ...page(), content_id: created.id, expected_revision: 1 }), /변경/);
    const republished = runSiteContentCommand(db, ADMIN, 'content-publish', { content_id: created.id, expected_revision: revised.revision }, 4_000);
    assert.equal(readPublicSiteContent(db, '/ko/cms-test').found, false);
    assert.equal(readPublicSiteContent(db, '/ko/cms-renamed').content?.title, '수정 초안');
    runSiteContentCommand(db, ADMIN, 'content-delete', { content_id: created.id, expected_revision: republished.revision }, 5_000);
    assert.equal(readPublicSiteContent(db, '/ko/cms-renamed').deleted, true);
  });

  it('keeps a captured page public during edits, publishes managed content, and prevents route collisions', () => {
    const db = new HaloXDatabase(), original = readSiteContentAdmin(db, ADMIN).contents.find(row => row.route === '/ko/about')!;
    const draft = runSiteContentCommand(db, ADMIN, 'content-update', { ...page('/ko/about'), title: '관리 소개', content_id: original.id, expected_revision: 0 }, 10_000);
    assert.equal(readPublicSiteContent(db, '/ko/about').captured_fallback, true);
    runSiteContentCommand(db, ADMIN, 'content-publish', { content_id: original.id, expected_revision: draft.revision }, 11_000);
    assert.equal(readPublicSiteContent(db, '/ko/about').content?.title, '관리 소개');
    assert.equal(readPublicSiteContent(db, '/ko/about').captured_fallback, false);
    assert.throws(() => runSiteContentCommand(db, ADMIN, 'page-create', page('/ko/about')), /이미 사용/);
  });

  it('manages taxonomies and translated published snapshots with referential cleanup', () => {
    const db = new HaloXDatabase();
    const taxonomy = runSiteContentCommand(db, ADMIN, 'taxonomy-create', { name: '제품', slug: 'product', locale: 'ko', type: 'category' }, 20_000);
    const created = runSiteContentCommand(db, ADMIN, 'page-create', { ...page('/ko/taxonomy-page'), taxonomy_ids: [taxonomy.id] }, 21_000);
    const taxonomyUpdated = runSiteContentCommand(db, ADMIN, 'taxonomy-update', { taxonomy_id: taxonomy.id, expected_revision: 1, name: '제품 태그', slug: 'product-tag', locale: 'ko', type: 'tag' }, 21_500);
    assert.equal(taxonomyUpdated.slug, 'product-tag'); assert.equal(taxonomyUpdated.type, 'tag');
    runSiteContentCommand(db, ADMIN, 'taxonomy-delete', { taxonomy_id: taxonomy.id, expected_revision: 2 }, 22_000);
    assert.deepEqual(readSiteContentAdmin(db, ADMIN).contents.find(row => row.id === created.id)?.taxonomy_ids, []);
    const parent = readSiteContentAdmin(db, ADMIN).contents.find(row => row.route === '/ko/about')!;
    const translated = runSiteContentCommand(db, ADMIN, 'translation-create', { ...page('/en/translated-about'), locale: 'en', title: 'Translated about', parent_id: parent.id }, 23_000);
    assert.equal(readPublicSiteContent(db, '/en/translated-about').found, false);
    runSiteContentCommand(db, ADMIN, 'translation-publish', { translation_id: translated.id, expected_revision: 1 }, 24_000);
    assert.equal(readPublicSiteContent(db, '/en/translated-about').content?.title, 'Translated about');
    const parentDeleted = runSiteContentCommand(db, ADMIN, 'content-delete', { content_id: parent.id, expected_revision: 0 }, 25_000);
    assert.equal(parentDeleted.status, 'deleted'); assert.equal(readPublicSiteContent(db, '/en/translated-about').deleted, true);
  });

  it('validates consent, accepts and deduplicates contact requests, limits repeated email submissions, and supports operator workflow', () => {
    const db = new HaloXDatabase();
    const contact: Row = { consent: true, name: '문의자', email: 'Contact@Example.com', company: '예시 회사', phone: '010-1234-5678', inquiry_type: '도입', industry: 'IT', team_size: '10', message: '도입 상담을 요청합니다.', locale: 'ko', source_route: '/ko/contact-sales' };
    assert.throws(() => createContactRequest(db, { ...contact, consent: false }, { ip: '127.0.0.1' }, 100_000), /동의/);
    const created = createContactRequest(db, contact, { ip: '127.0.0.1' }, 100_000);
    const duplicate = createContactRequest(db, contact, { ip: '127.0.0.2' }, 100_001);
    assert.equal(duplicate.id, created.id); assert.equal(duplicate.duplicate, true);
    assert.equal(readSiteContentAdmin(db, ADMIN).contacts[0].email, 'contact@example.com');
    const updated = runSiteContentCommand(db, ADMIN, 'contact-update', { contact_id: created.id, expected_revision: 1, status: 'contacted', note: '전화 완료' }, 101_000);
    assert.equal(updated.status, 'contacted'); assert.equal(updated.note, '전화 완료');
    runSiteContentCommand(db, ADMIN, 'contact-delete', { contact_id: created.id, expected_revision: 2 }, 102_000);
    assert.equal(readSiteContentAdmin(db, ADMIN).contacts.length, 0);
    assert.deepEqual(createContactRequest(db, { website_url_confirm: 'bot' }, { ip: 'bot' }, 103_000), { accepted: true });
    for (let i = 0; i < 3; i++) createContactRequest(db, { ...contact, email: 'limit@example.com', message: `문의 ${i}` }, { ip: String(i) }, 200_000 + i);
    assert.throws(() => createContactRequest(db, { ...contact, email: 'limit@example.com', message: '문의 4' }, { ip: '4' }, 200_010), /잠시 후/);
  });
});
