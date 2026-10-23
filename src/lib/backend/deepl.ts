import { validateContentBody } from './content-model.ts';
import type { Row } from './database.ts';
import { ExternalServiceError, publicJsonRequest } from './public-json.ts';
import { translationLocale } from './translation-model.ts';

export const TRANSLATION_FIELDS = ['title', 'content_md', 'meta_title', 'meta_description'] as const;
type Field = typeof TRANSLATION_FIELDS[number];
export type TranslationPiece = { field: Field; text: string };
export type TranslationBatch = TranslationPiece[];
export type TranslatedPiece = { text: string; billed_characters: number | null };
export type DeepLClient = { translate(batch: TranslationBatch, source: string, target: string): Promise<TranslatedPiece[]> };
const TARGETS: Record<string, string> = { ko: 'KO', en: 'EN-US', ja: 'JA', zh: 'ZH-HANS', es: 'ES' };

function configuration(env: Record<string, string | undefined>) {
  const key = env.DEEPL_API_KEY?.trim(), plan = env.DEEPL_API_PLAN || 'free';
  if (!key || key.length > 200 || /\s|[\p{Cc}]/u.test(key) || !['free', 'pro'].includes(plan)) throw new ExternalServiceError('자동 번역 서비스가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.', 'TRANSLATION_NOT_CONFIGURED', 503, false);
  return { key, url: `https://${plan === 'free' ? 'api-free' : 'api'}.deepl.com/v2/translate` };
}
export function deepLConfigured(env: Record<string, string | undefined> = process.env) {
  try { configuration(env); return true; } catch { return false; }
}
function body(batch: TranslationBatch, source: string, target: string) {
  return { text: batch.map(piece => piece.text), source_lang: translationLocale(source).toUpperCase(), target_lang: TARGETS[translationLocale(target)], preserve_formatting: true, show_billed_characters: true };
}

/** Split without losing Unicode characters or whitespace, preferring line boundaries. */
function split(value: string): string[] {
  const chunks: string[] = []; let buffer = '', bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (bytes + size > 24000) {
      const boundary = buffer.lastIndexOf('\n');
      const end = boundary >= buffer.length / 2 ? boundary + 1 : buffer.length;
      chunks.push(buffer.slice(0, end)); buffer = buffer.slice(end); bytes = Buffer.byteLength(JSON.stringify(buffer)) - 2;
    }
    buffer += character; bytes += size;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export function translationBatches(source: Row, sourceLocale: string, targetLocale: string): TranslationBatch[] {
  if (translationLocale(sourceLocale) === translationLocale(targetLocale)) throw new Error('원문과 다른 번역 언어를 선택해 주세요.');
  const content = validateContentBody(source), batches: TranslationBatch[] = []; let current: TranslationBatch = [];
  for (const field of TRANSLATION_FIELDS) for (const text of split(content[field])) {
    const piece = { field, text };
    // Leave room for HTTP headers within DeepL's 128 KiB request limit.
    if (current.length && (current.length >= 50 || Buffer.byteLength(JSON.stringify(body([...current, piece], sourceLocale, targetLocale))) > 120 * 1024)) { batches.push(current); current = []; }
    current.push(piece);
  }
  if (current.length) batches.push(current);
  return batches;
}

export function createDeepLClient(env: Record<string, string | undefined> = process.env, request = publicJsonRequest): DeepLClient {
  const { key, url } = configuration(env);
  return {
    async translate(batch, source, target) {
      const payload = body(batch, source, target);
      if (!batch.length || batch.length > 50 || source === target || Buffer.byteLength(JSON.stringify(payload)) > 120 * 1024) throw new ExternalServiceError('번역 요청 크기나 언어를 확인해 주세요.', 'INVALID_TRANSLATION_REQUEST', 400, false);
      let response;
      try { response = await request(url, { method: 'POST', authorization: `DeepL-Auth-Key ${key}`, body: payload }); }
      catch (cause) {
        // The transport's error does not contain remote response bodies or credentials.
        if (cause instanceof ExternalServiceError) throw cause;
        throw new ExternalServiceError('번역 요청 결과를 확인할 수 없습니다. 실행 이력을 확인해 주세요.');
      }
      if (response.status !== 200) throw new ExternalServiceError(`DeepL 번역 요청이 거절되었습니다 (HTTP ${response.status}).`, 'TRANSLATION_REJECTED', 502, !(response.status >= 400 && response.status < 500));
      const translations = (response.body as Row | null)?.translations;
      if (!Array.isArray(translations) || translations.length !== batch.length) throw new ExternalServiceError('번역 응답의 항목 수를 확인할 수 없습니다.');
      return translations.map((value: unknown, index) => {
        const row = value as Row | null;
        if (!row || typeof row.text !== 'string' || (batch[index].text.trim() && !row.text.trim()) || row.text.length > 400000 || (row.billed_characters !== undefined && (!Number.isSafeInteger(row.billed_characters) || Number(row.billed_characters) < 0))) throw new ExternalServiceError('번역 응답의 내용을 확인할 수 없습니다.');
        return { text: row.text, billed_characters: row.billed_characters === undefined ? null : Number(row.billed_characters) };
      });
    },
  };
}
