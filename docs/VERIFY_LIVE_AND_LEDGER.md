# Live セッション再開と支出台帳を本番で確かめる

今日出荷した 2 つの仕組みは、どちらも**本番で一度も動いていない**。

- **Live セッション再開とコンテキスト圧縮**（issue #5、commit 2a66f6c、`docs/adr/0001-*.md`）。SDK がパラメータを受け取ることと型が通ることしか確認できていない。
- **支出台帳**（issue #1、commit 4775511）。Firestore の `spend/2026-10` は**存在しない**（2026-10-09 に REST で直接読んで確認）。予約も精算も `onUsage` の計上も、本番では一度も走っていない。

この文書は、**実際の電話を 1 本だけ鳴らして**、どちらが動いているかをログと Firestore から判定する手順である。1 本で何が証明でき、何は証明できないかは §1 に先に書いてある。順番に実行すれば最後に片付けまで終わる。

**前提**：`PROJECT_ID=hachicall-nao`、プロジェクト番号 `871712096742`、テスト利用者 ID `test-02102026160456`。以下はすべてこの値を埋めてある。

```bash
PROJECT=hachicall-nao
NUM=871712096742
TELEPHONY="https://hachi-telephony-${NUM}.asia-northeast1.run.app"
RESIDENT=test-02102026160456
FS="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents"
```

## 1. 1 本で何が分かるか

| 問い | 1 本の通話で | 理由 |
| --- | --- | --- |
| サーバはハンドルを 1 回でも発行したか | **分かる** | 発行のたびに数え、通話終了時に 1 行出す |
| 再接続はハンドル経由か、会話の貼り直しか | **分かる**（ただし再接続が起きた場合のみ） | 2 経路が別のログ行になった。再接続は §2.2 の強制ドロップで起こす |
| 発行されたが resumable でなかったハンドルはあったか | **分かる** | `unusableHandles` として数える |
| サーバが GoAway を送ってきたか | **分かる** | 来たら warn で 1 行 |
| コンテキスト圧縮が発動したか | **分からない。推測しかできない** | §9。プロトコルに「圧縮した」というフィールドが無い |
| 台帳が発信前に予約を取るか | **分かる** | §6 |
| 台帳が通話後に実績で精算するか | **分かる** | §6 |
| 解析のトークン数が `spentMicros` に入るか | **分かる** | §6 |
| 上限に達したときに発信が止まるか | **分からない** | $63 まで積まないと起きない。単体テストのみ |

## 2. デプロイ

**Live のログ追加だけを反映する場合は Voice Gateway のデプロイでよい。** ログ追加の変更は `services/voice-gateway/` にしかない。telephony / analyzer / api は f3ecfe5 以降のビルドが既に動いている（`hachi-telephony-00019-rtc`、`hachi-analyzer-00012-fdh`、`hachi-api-00012-27t`）。

初回利用の許可確認（issue #3）も反映する場合は、**API・telephony・Voice Gateway・web を一緒にデプロイする**。既存の利用者に許可を自動で補完することはない。以下のテスト架電でも §3 の許可確認が必要になる（詳細は `docs/CONSENT_AND_PRIVACY.md`）。

### 2.1 ログだけ入れる（強制ドロップなし）

```bash
PROJECT_ID=hachicall-nao RECORDINGS_BUCKET=oct1-hachi-recordings ./infra/deploy-voice-gateway.sh
```

この状態で 1 本かけると、§1 の表のうち「再接続はどちらの経路か」以外が埋まる。websocket は健康なら落ちないので、再接続は起きない。

### 2.2 強制ドロップを有効にする

再開は、**通話中に websocket が実際に落ちないと確かめられない**。そのための env 変数が 1 つある。

```bash
PROJECT_ID=hachicall-nao RECORDINGS_BUCKET=oct1-hachi-recordings \
  FORCE_LIVE_DROP=test-02102026160456:45 \
  ./infra/deploy-voice-gateway.sh
```

- 書式は `residentId:秒数`。秒数は 5〜120。**書式が違えばサービスは起動しない**（黙って無効にはならない。黙って無効になると「サーバが落とさなかった」と区別がつかず、テストの意味が消える）。
- **利用者 ID が一致した通話にしか効かない。** 外し忘れても、届くのはここに書いた 1 つの ID だけで、それは人ではない。
- **1 通話に 1 回だけ。** 毎セッション落とせば 1 通話に許された 3 セッションを使い切って `gateway_error` で終わる。
- **緊急対応中は発動しない。** その瞬間モデルは「これから何が起きるか」を読み上げている。再接続の知見のためにそれを切る取引はしない。
- `infra/deploy-*.sh` は `--set-env-vars`（全置換）なので、**変数を付けずに再デプロイすれば自動的に消える**。手で入れた変数は次のデプロイで消えるし、ここで入れた変数も次のデプロイで消える。消し忘れる状態が存在しない。

デプロイ出力に `!!  FORCE_LIVE_DROP=...` の 3 行が出る。出ていなければ有効になっていない。

45 秒にしてあるのは、挨拶と 1〜2 往復が終わり、サーバがハンドルを出す余裕ができたあたりを狙うため。§5 で `handles: 0` だったら、ハンドルが来る前に落としたということなので `:90` でやり直す。

## 3. 初回利用の許可を確認し、テスト利用者を一時的に有効にする

**現在 `active: false` である**（2026-10-09 に確認）。この状態では `placeCall` が `skipped / inactive` を返して通話記録すら作らないので、予約も走らない。台帳が現れない原因の第一候補はこれ。

**`active: true` だけでは架電できない。** 電話を受けるテスト担当者にも `/privacy` の説明を提示し、AI 通話・録音・解析・共有について初回の明示的な許可を得る。スタッフ画面の Residents でその許可を記録する。既に記録済みなら、テストのたびに取り直す必要はない。テスト用 ID であることを許可の代わりにせず、Firestore に架空の `callConsent` を書いて通過させない。

許可が未記録の場合は `skipped / consent_required` となり、通話記録も予約も作られない。許可を得てから、次の手順で一時的に有効にする。

```bash
curl -s -X PATCH \
  "${FS}/residents/${RESIDENT}?updateMask.fieldPaths=active" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"active":{"booleanValue":true}}}' | grep -o '"booleanValue": [a-z]*'
```

`hachi-dispatch` は PAUSED なので、有効にしても勝手に架電は始まらない。**§7 で必ず `false` に戻すこと。**

## 4. 1 本だけ架電する

`POST /tasks/place-call` は OIDC で保護されていて、`TASK_CALLER_EMAILS` は `hachi-tasks@hachicall-nao.iam.gserviceaccount.com` **だけ**を許している（デプロイ済みの env を読んで確認）。つまり自分のアカウントからは直接叩けない。

経路は 2 つあり、**片方は追加の権限が要らない**。

| 経路 | 必要な権限 | 現状 |
| --- | --- | --- |
| Cloud Tasks に 1 件積む | `iam.serviceAccounts.actAs` on `hachi-tasks` | **持っている**（確認済み） |
| 自分で ID トークンを発行して curl | `iam.serviceAccounts.getOpenIdToken` on `hachi-tasks` | **持っていない**。Owner でも付かない（確認済み） |

したがって Cloud Tasks を使う。これは**日次発信が通る経路そのもの**で、検証用の抜け道ではない。

```bash
LOCAL_DATE=$(TZ=Asia/Tokyo date +%F)

gcloud tasks create-http-task "call-${RESIDENT}-${LOCAL_DATE}-0" \
  --queue=outbound-calls --location=asia-northeast1 \
  --url="${TELEPHONY}/tasks/place-call" --method=POST \
  --header="Content-Type: application/json" \
  --body-content="{\"residentId\":\"${RESIDENT}\",\"localDate\":\"${LOCAL_DATE}\",\"attempt\":0}" \
  --oidc-service-account-email="hachi-tasks@${PROJECT}.iam.gserviceaccount.com" \
  --oidc-token-audience="${TELEPHONY}"
```

- タスク ID は `callTaskId()` が作る名前と同じ形にしてある。仮に `hachi-dispatch` が動いていても同名で重複排除され、二重に鳴らない。
- **同じ日に 2 回試すときは `attempt` を 1 に上げる**（ID も `-1` に）。Cloud Tasks は完了済みのタスク名をしばらく再利用させないし、`attempt` が違えば通話 ID も予約 ID も別になる。`attempt` は 0〜2 のみ（`MAX_CALL_ATTEMPTS=3`）。
- **`hachi-dispatch` を resume して架電するのは禁止。** 全利用者に一斉に鳴る。`hachi-notify-sweep` は緊急通知の配達経路なので、こちらも止めないこと。

タスクが実際に処理されたかは、通話記録の有無で分かる。

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "${FS}/residents/${RESIDENT}/calls/${LOCAL_DATE}-0"
```

- ドキュメントが無い → `skipped / inactive` または `skipped / consent_required`（§3 の有効化・許可確認が未完了）か、タスクがまだ届いていない。
- `failure.code = gateway_unavailable` → ブレーカーが止めた。§8。
- `failure.code = budget_exhausted` → 台帳が拒否した。§8。
- `status: scheduled` → 発信済み。電話が鳴る。

## 5. ログを読む

Voice Gateway の pino ログは `jsonPayload` に入る（`msg` がメッセージ、`residentId` / `callId` が同階層）。

```bash
G='resource.type="cloud_run_revision" AND resource.labels.service_name="hachi-voice-gateway"'
```

### 5.1 1 通話の答えを 1 行で

```bash
gcloud logging read "$G AND jsonPayload.msg=\"Gemini Live session summary\"" \
  --freshness=2h --limit=3 --format='json(timestamp, jsonPayload)'
```

健全な、ハンドルで再接続できた通話はこう見える。

```json
{
  "msg": "Gemini Live session summary",
  "residentId": "test-02102026160456",
  "callId": "2026-10-09-0",
  "sessions": 2,
  "handles": 9,
  "unusableHandles": 3,
  "resumedFromHandle": 1,
  "replayedTranscript": 0,
  "goAways": 0,
  "peakPromptTokens": 6100,
  "contextShrinks": 0
}
```

読み方：

| フィールド | 意味 | 期待 |
| --- | --- | --- |
| `sessions` | この通話で使った Gemini セッション数（最初 + 再接続） | ドロップさせたなら 2 |
| `handles` | **resumable な**ハンドルを受け取った回数 | 1 以上。0 なら再開は検証できていない |
| `unusableHandles` | 生成中に出されて使えなかった更新の回数 | 0 でも 0 以外でもよい。ADR 0001 が「来る」と書いた現象の実測値 |
| `resumedFromHandle` | ハンドルでサーバに会話を復元させた回数 | **1 なら再開は本番で動いた** |
| `replayedTranscript` | ハンドルが無い/拒否されてプロンプトに会話を貼り直した回数 | 1 ならフォールバックが動いた（再開は未検証のまま） |
| `goAways` | サーバが「もうすぐ切る」と言ってきた回数 | 8 分の通話では 0 のことが多い |
| `peakPromptTokens` | 1 ターンあたり入力トークン数の最大値。Live は毎ターン全文脈を送るので、**これが文脈の大きさ** | §9 |
| `contextShrinks` | その数が前のターンより**減った**回数 | §9。圧縮の証拠ではなく、圧縮の痕跡 |

### 5.2 ハンドルが 1 回でも来たか（通話が落ちても残る行）

最初のハンドルだけは、届いた時点で独立した 1 行になる。通話が途中で死んで §5.1 に到達しなかった場合でもこれは残る。

```bash
gcloud logging read "$G AND jsonPayload.msg=\"Gemini Live offered a resumption handle\"" \
  --freshness=2h --limit=5 --format='value(timestamp, jsonPayload.callId, jsonPayload.handleChars)'
```

`handleChars` は**ハンドルの文字数だけ**。ハンドル自体はログに出ない。不透明な値でも、1 人の会話の状態であることは変わらない。

### 5.3 再接続はどちらの経路を通ったか

```bash
gcloud logging read "$G AND (jsonPayload.msg=\"reconnected from a Gemini Live resumption handle\" OR jsonPayload.msg=\"reconnected by replaying the conversation, not from a handle\")" \
  --freshness=2h --limit=10 --format='value(timestamp, jsonPayload.msg, jsonPayload.session, jsonPayload.offered)'
```

- `reconnected from a Gemini Live resumption handle`（info）→ **ADR 0001 の「未検証」が 1 行埋まる。**
- `reconnected by replaying the conversation, not from a handle`（warn）→ 旧経路に落ちた。`offered` がその時点までに受け取ったハンドル数。`offered: 0` ならハンドルがまだ来ていなかっただけなので §2.2 の秒数を上げる。`offered` が 1 以上なのに貼り直しに落ちたなら、**サーバがハンドルを拒否した**ということで、それ自体が有益な実測値。

### 5.4 サーバが切断を予告したか

```bash
gcloud logging read "$G AND jsonPayload.msg=\"Gemini Live says it is about to close the session\"" \
  --freshness=2h --limit=10 --format='value(timestamp, jsonPayload.callId, jsonPayload.timeLeft)'
```

### 5.5 強制ドロップが実際に発動したか

```bash
gcloud logging read "$G AND (jsonPayload.msg:\"FORCE_LIVE_DROP\" OR jsonPayload.msg=\"closing the Gemini Live socket to test resumption\")" \
  --freshness=2h --limit=10 --format='value(timestamp, jsonPayload.msg, jsonPayload.afterSec)'
```

`FORCE_LIVE_DROP is set: ...` だけ出て `closing ...` が無い場合、タイマーは発火したが条件で見送られた（通話が既に終了方向に入っていた、または緊急対応中だった）。

### 5.6 セッションが落ちた理由そのもの

```bash
gcloud logging read "$G AND jsonPayload.msg=\"Gemini Live session closed unexpectedly\"" \
  --freshness=2h --limit=10 --format='value(timestamp, jsonPayload.callId, jsonPayload.reason)'
```

`reason` が `closed: 1008 Spend cap breached ...` なら、それは強制ドロップではなく請求側の遮断である（`docs/COST_CONTROL.md` §6）。この場合 `sessions` は増えない——系統的障害と分類されて再接続しない。

## 6. 台帳を読む

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" "${FS}/spend/2026-10"
```

月は **UTC** で決まる（`spendMonth()`）。UTC の月末付近では `spend/2026-11` を見ること。

### 6.1 発信直前 — 予約が入っている

`MAX_CONVERSATION_SEC` は未設定なので既定の **480 秒**。`callReservationMicros(480)` の内訳は：

- 通話：`ceil(480 / 60 × 150,000)` = **1,200,000** マイクロドル
- 解析（入力 20,000 / 出力 10,000 と見積もる）：`ceil(0.02 × 1,500,000 + 0.01 × 7,500,000)` = 30,000 + 75,000 = **105,000**
- 合計 **1,305,000** マイクロドル（= $1.31）

```json
{
  "fields": {
    "month":       { "stringValue": "2026-10" },
    "spentMicros": { "integerValue": "0" },
    "leases": { "arrayValue": { "values": [
      { "mapValue": { "fields": {
        "id":     { "stringValue": "call:test-02102026160456/2026-10-09-0" },
        "micros": { "integerValue": "1305000" },
        "at":     { "stringValue": "2026-10-09T07:12:03.411Z" }
      }}}
    ]}},
    "updatedAt": { "stringValue": "2026-10-09T07:12:03.411Z" }
  }
}
```

**`micros` が 1,305,000 でないなら単価か `MAX_CONVERSATION_SEC` がずれている。** リース ID の形（`call:{residentId}/{callId}`）は再配達されたタスクが二重に予約しないための鍵なので、ここも見ておく。

### 6.2 通話終了後 — 予約が消えて実績が入っている

Twilio の `completed` コールバックで精算される。185 秒の通話なら `ceil(185 / 60 × 150,000)` = **462,500**。

```json
{
  "spentMicros": { "integerValue": "462500" },
  "leases":      { "arrayValue": {} }
}
```

- **`leases` が空であること**が精算の証拠。空でないまま残っていたら、Twilio のステータスコールバックが届いていない（6 時間で没収され `spentMicros` に移る）。
- **`spentMicros` が 1,305,000 のままなら**、精算が実績を取れず予約額をそのまま計上した。`durationSec` が通話記録に入っているか確認する（`status: completed` なのに `durationSec` が無い場合）。

### 6.3 解析完了後 — トークン実績が足されている

解析は**予約しない**。通話はもう起きているので、その解析を予算が拒否することはできない。`charge()` が `spentMicros` に直接足す。Gemini は 1 通話につき **2 回**呼ばれる（レビューと `GeminiListener` の録音聴取）ので、増分は 2 回分。

```json
{ "spentMicros": { "integerValue": "497000" }, "leases": { "arrayValue": {} } }
```

内訳の例（**トークン数は例示。実測ではない**）：レビュー 3,100 in / 1,600 out = 16,650、聴取 7,400 in / 900 out = 17,850。合計 34,500 増えて 497,000。

**462,500 から 1 マイクロドルも動かなければ `onUsage` が通っていない。** analyzer のリビジョンが 00012 であること（00:17 以前は 6 リビジョン遅れていた）と、通話記録に `analysis` が入っていることを確認する。解析は通話終了の 1 分後にキューされるので、**2〜3 分待つ**。

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "${FS}/residents/${RESIDENT}/calls/${LOCAL_DATE}-0" | grep -o '"analysisPending".*'
```

## 7. 後片付け

**この 3 つは必ず戻す。**

```bash
# 1. テスト利用者を無効に戻す
curl -s -X PATCH "${FS}/residents/${RESIDENT}?updateMask.fieldPaths=active" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"active":{"booleanValue":false}}}' > /dev/null

# 2. 強制ドロップを消す（変数を付けずに再デプロイするだけ）
PROJECT_ID=hachicall-nao RECORDINGS_BUCKET=oct1-hachi-recordings ./infra/deploy-voice-gateway.sh

# 3. 消えたことを確認する（何も出力されなければ消えている）
gcloud run services describe hachi-voice-gateway --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep FORCE_LIVE_DROP
```

`hachi-dispatch` は PAUSED のまま。設計が確定するまで戻さない。

## 8. 台帳が現れないとき

`spend/2026-10` が 404 のままなら、次の 4 つを確認する。

1. **テスト利用者が `active: false` のまま。** `placeCall` は利用者を見た直後に `skipped / inactive` を返す。予約はその手前には無い。通話記録も作られないので、§4 の最後の REST 読みが 404 になるのが目印。→ §3。
2. **初回利用の許可が未記録。** `callConsent` が無い、または有効な許可記録でなければ `skipped / consent_required` を返す。通話記録も予約も作らない。→ §3 のスタッフ画面で、実際に得た許可を記録する。
3. **ブレーカーが先に止めた。** `claimGatewayForCall()` は予約の**前**にある。`service/gateway` が存在して `fault: systemic` なら、発信そのものが行われず予約も走らない。通話記録に `failure.code = gateway_unavailable` が入る。
   ```bash
   curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" "${FS}/service/gateway"
   ```
   2026-10-09 時点ではこのドキュメントも存在しない（=「健全」扱い）。存在して止まっているなら、理由（`reason`）を読んで直すか、15 分の cooldown を待つ。
4. **Firestore トランザクションが失敗している。** `mutateSpendLedger` が投げると `/tasks/place-call` は 500 を返し、Cloud Tasks が再試行する。telephony のエラーログに出る。
   ```bash
   gcloud logging read 'resource.labels.service_name="hachi-telephony" AND severity>=ERROR' \
     --freshness=2h --limit=10 --format='value(timestamp, jsonPayload.msg, jsonPayload.err)'
   ```
   `hachi-telephony@` に `roles/datastore.user` が付いているかも見る（`infra/deploy-telephony.sh` が付けている）。

それ以外に、**UTC の月境界**で `spend/2026-11` を見ていることがある（§6 冒頭）。

## 9. 圧縮は現実的に検証できるのか

**できない。そう書いておくべきである。**

### サーバは圧縮を報告しない

`@google/genai` 2.26.0 の `LiveServerMessage` を全フィールド確認した。`setupComplete` / `serverContent` / `toolCall` / `toolCallCancellation` / `usageMetadata` / `goAway` / `sessionResumptionUpdate` / `voiceActivityDetectionSignal` / `voiceActivity` の 9 つで、**「コンテキストウィンドウを圧縮した」に相当するフィールドは無い**。`contextWindowCompression` は接続時の設定（`LiveConnectConfig`）にしか現れない。

一方 `usageMetadata` は Live のメッセージに**来る**（`promptTokenCount` / `totalTokenCount` / モダリティ別の内訳）。Live は毎ターン全セッションコンテキストを再送するので、`promptTokenCount` は**その時点の文脈の大きさ**である。したがって得られる信号は 2 つだけ：

- `peakPromptTokens` — 文脈が 16,000 トークンのトリガーにどこまで近づいたか。**これは事実**。
- `contextShrinks` — その数が前のターンより減った回数。**これは推測**。圧縮以外の理由で減ることもありうるし、減らなかったことは圧縮が起きなかったことの証明にはならない。

### 数字が合わない

Live の音声は**片方向 1 秒あたり 25 トークン**（料金ページの換算値、`docs/COST_CONTROL.md` §1）。文脈に積まれるのは実際に発話された音声なので、

| 仮定 | 16,000 に達する発話時間 |
| --- | --- |
| 片側だけ常に話している（25 tok/s） | 640 秒 = **10 分 40 秒** |
| ADR 0001 の見積もり（両方向で 50 tok/s） | 320 秒 = **5 分 20 秒** |

`MAX_CONVERSATION_SEC` の既定は **480 秒（8 分）**で、`loadConfig()` が許す上限は 900 秒。1200 秒は `MAX_CALL_SEC`——緊急時の三者通話を含む電話全体の上限であって、会話の上限ではない。

つまり：

- 25 tok/s の側が正しければ、**既定の 480 秒では構造的に到達しない**。上限の 900 秒に上げても 640 秒ぶんの**切れ目のない**発話が必要で、85 歳の利用者との見守り通話はそういう形をしていない。
- 50 tok/s の側が正しければ 5 分 20 秒で越えるので、8 分の通話なら到達しうる。だがこの 50 tok/s は 10 月の Live トークン比から逆算した推定で（`docs/adr/0003-*.md`）、実測ではない。
- `MAX_CONVERSATION_SEC` は Voice Gateway（強制する側）と telephony（予約額を計算する側）の**両方**が読む。片方だけ上げると台帳の予約額が実際の上限と合わなくなる。

### 提出に向けての結論

**2026-10-18 までに圧縮の発動を観測するのは現実的でない。** 1 本の通話が示せるのは `peakPromptTokens` の実測値だけで、それはおそらく 4,000〜8,000 のあたりに出る。トリガーの半分以下である。

したがって提出物では「圧縮が動く」ではなく「**圧縮を設定してある。通常の通話では到達しない水準に意図的に置いてあり、本番で発動したことはない**」と書くべきである。これは ADR 0001 が既に言っていることでもあり、嘘をつかずに済む唯一の言い方である。`peakPromptTokens` が入ったので、**次からは「どれくらい遠かったか」を数字で言える**。

## 10. やってはいけないこと

- **`hachi-dispatch` を resume して 1 本鳴らそうとしない。** 全利用者に鳴る。
- **`hachi-notify-sweep` を止めない。** 緊急通知の配達経路で、意図的に有効のままにしてある。`hachi-analysis-sweep` も同様。
- **`--update-env-vars` で `FORCE_LIVE_DROP` を入れない。** `infra/deploy-*.sh` は `--set-env-vars`（全置換）なので次のデプロイで消え、消えたことに気づかないまま「ドロップしなかった」と読むことになる。入れるならデプロイスクリプト経由（§2.2）。
- **利用者 ID を伏せずに `FORCE_LIVE_DROP` を設定しない。** 書式がそれを許さないので、実際には設定できない。
- **電話番号をログ・コミット・課題に書かない。**
