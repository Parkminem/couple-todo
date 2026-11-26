# 설정 및 배포

데모를 보려면 [README의 로컬 데모](../README.md#로컬-데모)를 참고하세요. 실제 두 계정의 데이터를 동기화하려면 아래 설정을 사용합니다.

## Supabase와 실제 계정

1. Supabase 프로젝트를 만들고 Supabase CLI 3으로 대상 프로젝트를 확인한 뒤 저장소의 [모든 마이그레이션](../supabase/migrations)을 적용합니다.

   ```sh
   SUPABASE_PROJECT_REF="your-project-ref"
   supabase db push --remote="$SUPABASE_PROJECT_REF" --skip-vault
   ```

2. Supabase Auth의 신규 가입과 익명 로그인을 끕니다. 이메일 로그인은 활성화하고, 관리자 API에서 `createUser({ email, email_confirm: true })`로 사용할 두 계정을 등록합니다. 관리자 키는 계정을 등록하는 서버 환경에 보관합니다. [Supabase 계정 등록 API](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
3. Auth의 Magic Link 템플릿을 [인증번호 템플릿](../supabase/templates/otp.html)으로 바꿉니다. 인증번호는 6자리, 유효 시간은 600초, 재요청 간격은 60초로 맞추고 운영 이메일 발송을 위해 커스텀 SMTP를 연결합니다. [Supabase SMTP 설정](https://supabase.com/docs/guides/auth/auth-smtp)
4. Realtime에서 **Allow public access**를 끕니다. [Supabase Realtime 권한](https://supabase.com/docs/guides/realtime/authorization)
5. [`.env.example`](../.env.example)을 `.env.local`로 복사하고 아래 값을 설정한 뒤 `pnpm dev`를 실행합니다.

| 변수 | 값 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 같은 프로젝트의 Publishable Key |
| `NEXT_PUBLIC_WEB_PUSH_KEY` | Web Push용 VAPID 공개키. 푸시를 사용하지 않을 때는 생략합니다. |

두 사람 모두 이메일의 인증번호로 로그인하고 표시 이름을 저장합니다. 한 사람이 **우리 → 공유 공간 만들기 → 초대 코드 발급**을 누르고, 상대가 **우리** 화면에 받은 코드를 입력하면 공유 목록이 연결됩니다.

## 로컬 Supabase 통합 테스트

Docker와 Supabase CLI를 설치한 뒤 데이터가 없는 전용 로컬 프로젝트에서 실행합니다.

```sh
supabase start
pnpm test:db
pnpm test:e2e:live
```

`pnpm test:e2e:live`를 실행하는 셸에서 `NEXT_PUBLIC_SUPABASE_URL`에 `http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`에 로컬 공개 키, `COUPLE_TEST_SUPABASE_SECRET_KEY`에 로컬 관리자 키를 지정합니다. 테스트가 전용 로컬 프로젝트에 계정을 만들고 Mailpit으로 인증번호를 받습니다.

## Vercel 배포

1. Vercel 프로젝트에 저장소를 연결하고 Next.js 프리셋과 Node.js 24를 선택합니다. 함수 리전은 [`vercel.json`](../vercel.json)의 `icn1`(서울)을 사용합니다.
2. Preview와 Production에 별도의 Supabase 프로젝트를 연결합니다. 각 Vercel 환경의 공개 URL과 키를 설정하고, Supabase Auth의 Site URL을 해당 HTTPS 주소로 맞춥니다.
3. Preview에서 마이그레이션, OTP 수신, 두 계정 연결과 동기화, iPhone 홈 화면 설치를 확인합니다. 운영 DB에 마이그레이션을 적용하고 앱을 배포한 뒤 같은 흐름을 확인합니다.

인증과 동기화 문제는 Vercel 함수 로그와 Supabase Auth·Realtime 로그에서 확인합니다. 앱 배포에 문제가 있으면 Vercel의 이전 정상 배포로 되돌릴 수 있습니다. DB 변경은 데이터 보존을 전제로 따로 검토합니다.

### Web Push

1. 환경마다 VAPID 키 쌍과 디스패치 키를 생성합니다. 공개키는 Vercel의 `NEXT_PUBLIC_WEB_PUSH_KEY`에 설정합니다. Supabase Edge Functions Secrets에 아래 값을 설정합니다.

   | 비밀값 이름 | 값 |
   | --- | --- |
   | `NOTIFICATION_VAPID_PUBLIC_KEY` | VAPID 공개키 |
   | `NOTIFICATION_VAPID_PRIVATE_KEY` | VAPID 비밀키 |
   | `NOTIFICATION_VAPID_SUBJECT` | 앱의 공개 HTTPS 주소 |
   | `NOTIFICATION_DISPATCH_KEY` | 디스패치 요청 서명에 쓰는 비밀값 |

2. 위에서 설정한 `SUPABASE_PROJECT_REF`로 전송 함수를 배포합니다.

   ```sh
   supabase functions deploy dispatch-notifications --remote="$SUPABASE_PROJECT_REF" --use-api
   ```

3. Supabase Vault에 `couple_todo_notification_dispatch_url` 값으로 해당 프로젝트의 `https://<project-ref>.supabase.co/functions/v1/dispatch-notifications`를, `couple_todo_notification_dispatch_key` 값으로 위의 디스패치 키를 저장합니다. 관련 SQL 마이그레이션이 DB 트리거와 분 단위 재시도를 등록합니다.
4. iOS 16.4 이상에서는 Safari에서 **홈 화면에 추가**한 앱을 열고 **우리 → 알림함 → 알림 설정 → 이 기기에서 켜기**를 누릅니다. 공유 할 일 알림은 상대에게 전달되며, 방해 금지 시간에는 알림함에만 남습니다. [iOS 홈 화면 앱의 Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
