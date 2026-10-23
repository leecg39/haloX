import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInterfaceLanguage, translateUiText } from '../ui-language.ts';

describe('administrator interface language dictionary', () => {
  it('translates known navigation, controls and explanatory copy while preserving whitespace', () => {
    assert.equal(translateUiText('  키워드 현황  ', 'en'), '  Keywords  ');
    assert.equal(translateUiText('변경 사항을 저장했습니다.', 'en'), 'Changes saved.');
    assert.equal(translateUiText('수정·실행·다운로드는 제한됩니다.', 'en'), 'Editing, running, and downloading are restricted.');
    assert.equal(translateUiText('· 검색 성과와 키워드 자산을 관리합니다.', 'en'), '· Manage search performance and keyword assets.');
    assert.equal(translateUiText('등록한 감시 규칙이 없습니다.', 'en'), 'There are no monitoring rules registered.');
    assert.equal(translateUiText('12개', 'en'), '12 items');
  });
  it('does not translate user-authored Korean data and defaults unknown locale values to Korean', () => {
    assert.equal(translateUiText('우리 회사 캠페인', 'en'), '우리 회사 캠페인');
    assert.equal(translateUiText('키워드 현황', 'ko'), '키워드 현황');
    assert.equal(normalizeInterfaceLanguage('en'), 'en');
    assert.equal(normalizeInterfaceLanguage('fr'), 'ko');
  });
});
