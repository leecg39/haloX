import { expect, test } from '@playwright/test';

test('workspaces create, edit, reload, select, and delete use one server record', async ({ page, request }) => {
  const name = `CRUD 프로젝트 ${Date.now()}`;
  const renamed = name + ' 수정';
  await page.goto('/app/workspaces');
  await page.getByRole('button', { name: '+ 새 워크스페이스 만들기', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('워크스페이스 이름').fill(name);
  await dialog.getByLabel('대표 도메인 (선택)').fill('crud.example.com');
  await dialog.getByLabel('설명 (선택)').fill('서버에 저장한 설명');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const response = await request.get(`/api/v1/rest/workspaces?name=eq.${encodeURIComponent(name)}`);
  const rows = await response.json();
  expect(rows).toHaveLength(1);
  const id = rows[0].id;
  const keyword = await request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: id, keywords: ['삭제 연쇄 테스트'] } });
  expect(keyword.status()).toBe(200);
  await page.getByRole('region', { name, exact: true }).getByRole('button', { name: '수정', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('워크스페이스 이름').fill(renamed);
  await dialog.getByLabel('설명 (선택)').fill('수정한 설명');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await page.reload();
  let card = page.getByRole('region', { name: renamed, exact: true });
  await expect(card).toContainText('수정한 설명');
  await card.getByRole('button', { name: '이 워크스페이스 선택', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/workspaces');
  card = page.getByRole('region', { name: renamed, exact: true });
  await expect(card).toContainText('현재 선택됨');
  await card.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toHaveCount(0);
  for (const table of ['workspaces', 'workspace_members', 'workspace_plans', 'keywords']) {
    const column = table === 'workspaces' ? 'id' : 'workspace_id';
    const result = await request.get(`/api/v1/rest/${table}?${column}=eq.${id}`);
    expect(await result.json()).toEqual([]);
  }
});

test('workspace save failure preserves the form without a fake success record', async ({ page }) => {
  await page.goto('/app/workspaces');
  await page.getByRole('button', { name: '+ 새 워크스페이스 만들기', exact: true }).click();
  await page.route('**/api/v1/rest/workspaces', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { error: '저장소 연결 실패' } });
    else await route.continue();
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('워크스페이스 이름').fill('저장 실패 항목');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('저장소 연결 실패');
  await expect(dialog.getByLabel('워크스페이스 이름')).toHaveValue('저장 실패 항목');
  await expect(page.getByRole('heading', { name: '저장 실패 항목', exact: true })).toHaveCount(0);
});
