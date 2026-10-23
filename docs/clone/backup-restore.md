# HaloX 데이터 백업·복원

로컬 영속 저장소 전체를 무결성 검증 가능한 단일 파일로 백업하고, 하나의 SQLite 쓰기 트랜잭션으로 복원한다. 공개 테이블과 서버 전용 레코드를 함께 보존하므로 계정 해시, 암호화된 외부 연동 정보, 발송 이력 등 민감한 운영 데이터가 포함될 수 있다. 백업 파일은 Git에 추가하지 말고 접근이 제한된 저장소에 보관한다.

## 사용법

기본 데이터베이스는 `data/halox.sqlite`다. 다른 파일을 사용하면 두 명령 모두 `HALOX_DATABASE_PATH`를 지정한다.

```bash
npm run backup:data -- /safe/path/halox-2026-10-24.halox-backup.json
HALOX_DATABASE_PATH=/srv/halox.sqlite npm run backup:data -- /safe/path/halox-backup.json

npm run restore:data -- /safe/path/halox-2026-10-24.halox-backup.json
HALOX_DATABASE_PATH=/srv/halox.sqlite npm run restore:data -- /safe/path/halox-backup.json
```

백업 파일은 기본적으로 기존 파일을 덮어쓰지 않으며 권한을 `0600`으로 설정한다. JSON 봉투에는 포맷 버전, 생성 시각, 상태 payload와 SHA-256이 들어간다. 복원은 파일 크기, Base64 정규형, SHA-256, 데이터베이스 버전, 알려진 테이블과 행 구조를 먼저 확인한다. 검증이 끝난 상태만 `BEGIN IMMEDIATE` 트랜잭션에서 교체하므로 검증 오류나 SQLite 쓰기 오류가 발생하면 기존 상태가 유지된다.

## 검증 범위

`src/lib/backend/backup.test.ts`가 다음을 검증한다.

- 공개 테이블과 서버 전용 레코드의 정확한 왕복 복원
- 새 프로세스에 해당하는 별도 `PersistentHaloXStore` 인스턴스에서의 재개
- 백업 파일 `0600` 권한
- payload 변조 탐지와 실패 후 대상 데이터 불변
- 기존 백업의 우발적 덮어쓰기 방지와 명시적 덮어쓰기

백업에는 실행 중인 외부 제공자의 원격 상태까지 포함되지 않는다. WordPress 게시물, Google 계정에 저장된 권한, SMTP·SOLAPI·OpenAI 제공자의 발송·청구 상태는 각 제공자에서 별도로 관리한다.
