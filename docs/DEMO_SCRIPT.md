# デモ動画の台本（3 分以内）

Google Cloud AI Builder Cup 2026 提出用。本番環境 <https://hachicall-nao.web.app> をそのまま画面収録する。

ナレーションは英語（製品も README も英語、利用者も英語話者）。合計 **405 語 / 約 2 分 54 秒**（3 分まで 6 秒の余裕）。読み上げ速度は 1 分あたり 150 語を想定。語数は引用（`>`）のナレーションだけを空白区切りで数えた値で、「long-term」のようなハイフン語は 1 語、「—」は数えない。

収録前の準備は「[収録前のチェックリスト](#収録前のチェックリスト)」を参照。

---

## 1. 問題提起（0:00–0:22 / 55 語）

**画面**：日本の団地や住宅街の静かな映像、またはタイトルカード「Hachi — a daily AI check-in call」。

> More and more older people in Japan live alone, including long-term residents from abroad who are
> most comfortable in English. Their families are often overseas, local services speak Japanese,
> and staff cannot phone everyone daily.
>
> An app never reaches them; the device by the chair is a landline. So Hachi needs nothing but a
> telephone.

## 2. 電話の様子（0:22–0:55 / 52 語 + 音声 12 秒）

**画面**：Edith Carter のケース画面。最初の画面に、上部の見出し（「Review soon」の札、名前、最後につながった日の札、9 つの指標のバー）と「What was said」が並ぶ。引用の下の音声プレイヤーで、つまみを先頭（0:00）に戻して再生する。プレイヤーは引用の位置から始まるが、音源は通話全体の録音なので、Hachi の自己紹介から聞かせられる。音声が主役なので、ナレーションは音声の前後に分けて入れる。文字起こしは引用の下の「Whole conversation」（横に発言数）に畳まれている。再生前に開いておくと、再生中に会話の文字起こしも映る。

**字幕で補う（推奨、1 回だけ）**：All residents shown are fictional. ケース画面が初めて映るところで出す（チェックリスト参照）。

> Hachi phones each resident once a day. It says who it is, that it is an AI, and that the call is
> recorded.

（ここで通話音声を 10〜12 秒流す。「Good morning Edith, this is Hachi calling for our daily chat.」から、
本人が体調と睡眠について答えるところまで）

> Health and meals come up in the small talk, with two standard screening questions a day. It
> listens for two things: **what** they say, and **how** they say it.

**字幕で補う**：Calls begin only after the resident agrees, and staff record that agreement.

## 3. 緊急（R1）と沈黙（0:55–1:16 / 52 語）

**画面**：緊急ケースのケース画面。上部の「Immediate action」の札（赤、「!!」）とその横の意味の一文
「Possible immediate danger to life or health. Act now.」→「What was said」の該当発言と音声 →
「Who was told」で職員と家族への通知が届いた記録（各行に配信状態の札が付く）。

> **保留中**：どのケースを映すかは未決定。「[あとで決めること](#あとで決めること)」を参照。

> When someone says something dangerous — chest pain, a fall they cannot get up from — a rule and
> Gemini both catch it during the call. Hachi asks them to call an ambulance and phones staff and
> family to bridge them in. Silence counts too: picking up but never answering is flagged at once.

**字幕で補う**：Hedged wording counts. Past events, other people and denials do not.

最後の一文は、出たのに 3 回の問いかけに一度も答えなかった通話のこと。この場合も Immediate action の
ケースになり、通常の R1 と同じく職員と家族に通知が行く（三者通話はつながない）。

## 4. 話し方の変化（R3）（1:16–1:40 / 62 語）

**画面**：Edith Carter のケース画面。まず「What was said」の中にある言い直しの証拠（1:15 付近の
「from the from the bakery」。引用の下に「In their own words · … · 1:15 in」と出る）を再生し、言い直しを
耳で聞かせる。続いて「Speech over time」をゆっくり見せる。見出しの横の札（「Clear change」など）→
「Changed in the latest call: …」の一文 → 指標ごとの札（Time to answer / Stops and restarts / Word variety /
Staying on topic。例「Stops and restarts: clear change」）。グラフは最初に変化した指標で開いている。
「Usual for Edith」と書かれた帯から最新の点（ひし形）が外れているところと、下の凡例（Usual for Edith /
Within usual / Outside usual）を見せる。最新の点にカーソルを置く（携帯ならタップ）と、日付と値、
「(usual … to …)」の吹き出しが出る。どの指標が変化しているかは、収録前に画面で確かめる。

Edith のケース画面では「Who was told」が「No notifications were sent for this case.」になる。これは
正しい動作で、「Review soon」は職員が待ち行列で見るだけ、誰にも通知しない段階という設計のとおり。

> The third signal is the quiet one: how the resident speaks — how long they take to answer, how
> often they correct themselves, how varied their words are. Each measure is compared only with
> **their own** twenty-eight-day baseline. Here, Edith repeats herself mid-sentence, and her answers
> have moved outside her usual range. No diagnosis — a sign of change, with the recording as
> evidence.

## 5. 職員の待ち行列（1:40–2:01 / 51 語）

**画面**：待ち行列（Needs attention）。件数の枠（Immediate action / Review today / Review soon / Monitor の
未対応件数と Residents registered。0 件は灰色）→「Cases」の緊急度別のレーンを上から見せる。各レーンの
見出しには札と件数、求める対応（「Review soon」なら「within a few days」）が並ぶ →「Review soon」のレーンで
Edith Carter のカードの札、1 行の理由、9 つの指標のバーを見せる。絞り込みは使わなくてよい（「Filter cases」
に畳まれている）。「Nobody has been reached」や「Not fully checked」の枠が出ていれば、2 文目に合わせて
そこで止めて見せる。「Nobody has been reached」の各行には、名前と「No call for 2 days」のような札が付く。
広い画面（ページ幅 1200px 以上）では左にレーン、右に件数と枠が並ぶので、1 画面に収まる。最後にテスト
利用者（実際の電話で試した利用者。名前はチェックリストの改名で確かめる）のケース画面で「Call now」を
押して確認文を出し、「Cancel」で閉じる（電話番号はぼかす。チェックリスト参照）。

> Staff work from one queue, most urgent first, each case with a one-line reason. Hachi also lists
> what it could not do — a resident nobody reached, a call not fully checked — so a quiet day is
> never mistaken for a good one. To hear from someone now, staff press Call now.

## 6. 家族の画面（2:01–2:19 / 45 語）

**画面**：家族ダッシュボード（見出し「Daily calls with Edith Carter」）。上部の状態の枠（1 つの色と記号、
「Mostly well」のような一言とその下の一文、横に「Talked today, …」の札）→「Today's call, …」の
6 領域のタイル →「The last two weeks at a glance」の 14 日グリッド（右端の今日の列が枠で囲まれ、
「Today」の札が付く）→「What keeps coming up」。状態の一言（Worth a call / Mostly well / All seemed well）は
最新の通話で決まるので、収録前に確かめる。

> Family see a different view: the latest call, area by area, fourteen days at a glance so a change
> shows up as a shape, and what keeps coming up.
>
> They never see recordings, transcripts, or anything about how she speaks. The API enforces that
> boundary.

## 7. 仕組み（2:19–2:35 / 40 語）

**画面**：`architecture.png`。サービス名を順に軽くハイライト。最後の一文で待ち行列の最下部にある
「… of AI spend this month, …% of the … cap.」の 1 行に切り替える。

> Twilio streams the call through Cloud Run to the Gemini Live API. Afterwards, Gemini reviews the
> transcript with structured output, and speech measures come from the recording itself. A monthly
> AI budget can stop new calls — never an emergency alert.

## 8. 評価と限界（2:35–2:54 / 48 語）

**画面**：`docs/eval/r3-synthetic.md` の結果表、または結果を書いたカード。最後にタイトルカードと URL。

> On synthetic recordings, all ten people with a scripted change were detected, and none of the ten
> stable people were flagged. Real phone audio is much harder, so treat that as an upper bound.
> Hachi does not diagnose. It tells staff who to look at first, and why.

---

## 収録前のチェックリスト

### 決めたこと

- **古いテストケースは残す**。待ち行列にはテスト利用者のケース（台本作成時は R1 が 3 件、R2 が 2 件）が
  残っている。これは実際の電話で検知できた記録なので、あえて映す。待ち行列のカードに出るのは名前と
  1 行の理由、指標のバー、誰に知らせたか（「✓ Staff」など）だけで、電話番号は出ない。件数は収録前に
  数え直す。
- **画面には架空の名前だけを出す**。名前は `services/analyzer/eval/demo-names.json` から付く。デモ利用者は
  Edith Carter、Walter Hughes、Margaret Ellis など、担当職員は Aiko Tanaka。テスト利用者（実際の電話で
  試した利用者）には、作った順に `testResidents` の名前（Kenji Mori、Hana Takeda、…）が付く。本番に残って
  いる古い名前は、収録前に改名する（下の 2）。デモ利用者は内部では `synthetic: true` のままで、連絡先が
  なく、電話もかけない。
- **架空の人物だと字幕で 1 回伝える（推奨）**。画面から合成デモのラベルがなくなったので、画面には人物が
  架空だと示すものがない。第 8 節の語りは録音が合成だと言うが、映っている人物のことは言わない。第 2 節で
  ケース画面が初めて映るところに「All residents shown are fictional」の字幕を 1 回入れる。

### 必ず対応するもの

1. **本番に最新の画面が出ているか確かめる**。台本は `feat/glanceable-ux` の画面（cddf17a まで）に
   合わせてある。待ち行列が緊急度別のレーンに分かれ、カードに色付きの札と 9 つの指標のバーが出て
   いなければ、本番が古い。
2. **本番の名前を架空の名前に揃える**。`node infra/rename-demo-residents.mjs <project-id>` をまず
   そのまま実行する（dry run。変更を表示するだけ）。内容を確かめてから `--apply` を付けて実行する。
   デモ利用者（`demo-`）とテスト利用者（`test-`）の名前、担当職員の名前、家族の名前が変わる。ケースと
   通話は利用者 ID でつながっているので、ほかは変わらない。テスト利用者の新しい名前は出力の
   `test-…: <旧名> -> <新名>` で確かめる。第 5 節で探すのはこの名前で、ID が `test-` で始まる最新の
   利用者。デモ利用者をこの変更より前に投入していたなら、同じスクリプトで改名するか、
   `npm run seed:demo -w @hachi/analyzer -- --reset` で入れ直す。入れ直すと最後の通話が当日になるので、
   家族画面の札が「Talked today」になり、今日の列も埋まる。入れ直すと家族ログインの設定も消えるので、
   `--family-login-of <residentId>` も付ける（組織対応の入った版では `--org <組織 ID>` も必要）。
3. **テスト利用者の画面には実際の電話番号が出る**。ケース画面では右上の「Phone」、「About this person」の
   Assigned staff（職員の番号とメール）、「Who was told」の各行の通知先。「Call now」を押したときの確認文
   「Ring … on … now?」にも番号が出る。利用者一覧（Residents）のカードと、利用者の詳細画面の名前の下の
   1 行にも番号が出る。映すならすべてぼかす。待ち行列のカードと「Nobody has been reached」の枠には番号は
   出ない。デモ利用者は連絡先が空なので、どれも出ない。
4. **「Call now」はテスト利用者でしか出ない**。デモ利用者は電話をかけない設計なので、ボタン自体が
   出ない。テスト利用者でも、初回承認（first-use approval）が記録されていなければ出ない。Residents で
   「Approval needed」になっていないか確かめる。確認文は呼び名を使うので、テスト利用者では
   「Ring there on … now?」になる。収録では確認文を出して「Cancel」で閉じる。押し切ると本当に電話が
   かかる（スタッフ通話は 10 分に 1 回まで）。
5. **Edith の家族画面の Mood を確かめる**。家族への気分・孤独感の共有は初回承認に含まれる。承認のない
   利用者では、最新の通話のタイルは 6 枚のまま Mood が「Not shared」になり、14 日グリッドからは Mood の
   行が消える（下に「Mood is shared only if Edith Carter agrees, so it is not shown.」と出る）。上部の状態の
   一文も Gemini の要約ではなく、領域から作った汎用の文（例「A little concern about food.」）になり、
   通話ごとの要約も出ない。デモ利用者は承認の仕組みより前に作ったので、このままだとこの状態のはず。
   ナレーションは領域の数も一言まとめの中身も言わないので、どちらでも成り立つ。Mood も見せたいなら
   「[あとで決めること](#あとで決めること)」を参照。
6. **音量**。通話音声を流す区間はナレーションを止める。音声は左右で話者が分かれているステレオなので、
   収録時はモノラルにまとめる。

### あとで決めること

- **緊急（R1）の場面をどう撮るか（保留中）**。選択肢は 3 つ。
  - 合成の緊急デモ利用者を 1 人追加する。R1/R2 の評価シナリオ（`eval/r12-scenario.ts`）に胸の痛みや
    転倒の台本が揃っているので、音声合成に流せば、聞ける証拠付きの緊急ケースが作れる。個人情報は
    入らず、「Who was told」に通知の記録も出る。作業は 1〜2 時間程度。
  - テスト利用者の実際の通話を使い、上記の電話番号をすべてぼかす。
  - 画面を映さず、語りと図だけで済ませる。ただし「Who was told」で通知が届いた証跡を見せられない。
- **沈黙の場面を画面で見せるか**。現行案は、第 3 節を R1 の画面のまま語りだけで触れる。見せたい場合は、
  テスト利用者に「Call now」でかけさせ、出たまま黙る。Hachi の挨拶のあと 20 秒ほど問いかけが続いて
  通話が終わり、「No response after all check-in prompts.」の Immediate action ケースができる。登録先の
  職員と家族に実際に通知が行くので、事前に知らせておく。ケース画面には引用がなく「This is an
  observation of silence; there is no resident quote.」と出る。
- **Edith の家族画面で Mood を見せるか**。承認がないままだと、タイルの Mood は「Not shared」で、14 日
  グリッドは 5 行になる。Residents の Edith のカードで「Record first-use approval」を記録すれば Mood の共有も
  有効になる（Edith は停止中・合成なので電話はかからない）。ただし架空の人物の承認を記録することになる
  ので、API で `shareMood` だけを立てる方が筋はよい。このまま撮っても、台本の語りとは食い違わない。
- **ナレーションの言語**。英語で書いてあるが、日本国内審査なら日本語ナレーション＋英語字幕にもできる。
- **冒頭の映像**。実写素材を使うか、タイトルカードだけで済ませるか。

### 画面収録のメモ

- 本番 URL をそのまま使う。職員画面は `/staff`（待ち行列）と `/staff/residents`、家族画面は `/family`。
- 待ち行列は 15 秒ごとに自動で読み直す。数や枠が撮影中に動くことがあるので、止めたい場面は短く撮る。
- 待ち行列の絞り込みは「Filter cases」の中にある。広い画面では開き、携帯の幅では 1 行に畳まれる。
  絞り込みは URL に残る（`?urgency=action` など）。その URL を開けば、同じ絞り込みから撮り直せる。
- 「Nobody has been reached」「Not fully checked」「Check-in calls have stopped.」「Asked for a phone call」の
  枠は、該当があるときだけ出る。前の 2 つが出ていない日は、第 5 節の 2 文目を画面なしで読む。
- 札と色の意味は、待ち行列の「What the colours and icons mean」を開くと出る。色は赤・橙・黄・灰が緊急度、
  緑が良好・完了、青の破線が Hachi 側の問題。指標のバーの各記号は、カーソル・フォーカス・タップで説明が出る。
- Edith のケース画面の「Screening questions」は、合成の通話に標準化質問が入っていないので、見出しの札が
  「Not enough answers yet」になる。内訳は「Each area and the instruments」に畳まれている。映り込むのは
  構わないが、寄らない。
- Edith の録音の挨拶は合成の台本なので、「AI であること」「録音していること」は言っていない（実際の
  電話では言う）。第 2 節の語りは実際の電話の説明として読む。
- 家族画面は携帯の画面幅で撮ると見やすい。14 日グリッドは 7 日ずつ 2 段になる。家族ログインに複数の
  利用者が出たら、Edith Carter を選ぶ。Edith は停止中なので、上部に「Daily calls are paused」と出る。
  「Alerts on this phone」の「Turn on alerts」は本番でプッシュ通知を設定していないので押さない。
