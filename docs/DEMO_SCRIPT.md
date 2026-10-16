# デモ動画の台本（3 分以内）

Google Cloud AI Builder Cup 2026 提出用。本番環境 <https://hachicall.web.app> をそのまま画面収録する。

## この台本の前提

- **Hachi は世界中の英語話者のための製品で、日本は最初の地域**。動画もその順で語る。問題（一人暮らしの
  高齢者、遠くに住む家族、毎日は電話できない職員、アプリが届かない人）はどの国でも同じなので、まずそれを
  言う。日本は「どこから始めたか」として 2 回だけ出す（第 2 節と第 9 節）。
- **主人公は Edith 一人**。「日本にいる外国人」としてではなく、「一人暮らしで、息子が遠くに住む人」として
  紹介する。どの国の視聴者にも、自分の親や祖父母に重なるように。
- **聞き手は英語を話す世界中の人**。英語が母語でない審査員や視聴者も含む。そのため次の 3 つを守る。
  - **ゆっくり読む**。1 分あたり 130 語で計算している（英語母語話者向けの標準は 150 語）。
  - **字幕を全編に焼き込む**。ナレーションも通話音声もすべて英語字幕を出す。音を出さずに見る人と、
    聞き取りが苦手な人のため。
  - **平易な英語にする**。慣用句、略語、受け身、長い修飾句は使わない。1 文に言いたいことは 1 つ。
    数字は語で読む。
- **日本だけの話はナレーションに出さない**。119、+81、日本語の窓口などは、海外の視聴者には関係がない。
  通話中に救急車を呼ぶよう促す場面も「an ambulance」と言う。
- **今できないことを、できるように言わない**。現在は英語のみ、日本国内のみ（SMS は +81 のみ、通話中に
  案内する救急番号は 119、時刻は日本時間）。世界展開は「次にやること」として最後に一度だけ言う。日本向けの
  前提はコードの各所にあるので、「電話番号を変えるだけで世界で使える」とは言わない。

合計 **315 語 / 約 2 分 51 秒**（ナレーション 2 分 25 秒 ＋ 音声 17 秒 ＋ 場面転換の間 8 秒）。3 分まで
9 秒の余裕がある。語数は引用（`>`）のナレーションだけを空白区切りで数えた値。

収録前の準備は「[収録前のチェックリスト](#収録前のチェックリスト)」を参照。

各場面の画面のイメージは [storyboard/poster.png](storyboard/poster.png)（1 枚の全体図）と
[storyboard/index.html](storyboard/index.html)（場面ごと。ブラウザで開く）。字幕入りのコマは
`storyboard/frames.html` が元で、台本を変えたら `storyboard/render.sh` で書き出し直す。仮の声と字幕を
付けた下書き動画は `node docs/storyboard/video/build.mjs` で作れる（ナレーションの文は `build.mjs` の中にも
あるので、台本と一緒に直す）。第 3〜7 節の画面は、架空の Edith と Walter を足したローカルプレビューを
`docs/storyboard/video/record.mjs` が実際に操作して収録する（手順は `record.mjs` の先頭）。画面はローカル
プレビューの架空データで撮ったもので、本番とは件数・日付・人物の並びが異なる。第 2 節の最初のコマは
映像素材の代わりの生成画像、第 6 節の緊急ケースは本番にまだない場面の完成イメージ、第 8 節の構成図は案。

アニメーションで作り直したピッチ動画（約 2 分 52 秒）は `node docs/storyboard/pitch/build.mjs` で
`docs/storyboard/pitch/out/hachi-pitch.mp4` に書き出す（macOS の `say`、Google Chrome、ffmpeg が必要）。
この版は本書の台本を元に短く組み直したもので、合成録音の評価（第 9 節）には触れない。セリフと
ナレーションは `pitch/build.mjs`、画面とアニメーションは `pitch/pitch.html` にある。`pitch.html` を
ブラウザで開くと、`build.mjs --audio` で作った音声付きで試写できる。

## 全体の流れ

| # | 場面 | 時間 | 語数 | 見せたいこと |
|---|---|---|---|---|
| 1 | 通話の声から入る | 0:00–0:05 | 0 | 最初の 5 秒で「電話の AI」だと分かる |
| 2 | 世界の問題と出発点 | 0:05–0:29 | 49 | どの国にもある問題、電話なら届く、日本から始める |
| 3 | Edith と毎日の電話 | 0:29–1:00 | 46 | 主人公の紹介、AI だと名乗る、「何を」と「どう」 |
| 4 | 職員の待ち行列 | 1:00–1:16 | 32 | 誰から見るか、その理由、つながらなかった人 |
| 5 | Edith の小さな変化（R3） | 1:16–1:40 | 43 | 本人の過去 4 週間とだけ比べる、録音が証拠 |
| 6 | 緊急（R1）と沈黙（R4） | 1:40–2:01 | 44 | 通話を終える前に動く、家族と職員をつなぐ |
| 7 | 家族の画面 | 2:01–2:18 | 34 | 家族に見せないものを API が守る |
| 8 | 仕組み | 2:18–2:33 | 31 | Gemini Live API と Cloud Run、緊急は予算で止めない |
| 9 | 評価とこれから | 2:33–2:51 | 36 | 正直な評価、今は日本、次は世界の英語話者へ |

---

## 1. 通話の声から入る（0:00–0:05）

**画面**：黒地に通話音声の字幕だけ。続けてタイトルカード「Hachi — a daily check-in call. All you need
is a phone.」

**音声**：Edith の通話の冒頭を 5 秒。「Good morning Edith, this is Hachi calling for our daily chat.」と
最初の問いかけまで。ナレーションはない。

## 2. 世界の問題と出発点（0:05–0:29 / 49 語）

**画面**：前半は一人で暮らす高齢者の部屋と電話の映像。特定の国だと分かる看板や文字は映さない。
「they still answer the phone」で文字カード「All Hachi needs is a phone.」。最後の一文で文字カード
「Starting in Japan」（小さく「One of the oldest societies in the world. Local services speak Japanese.」）。

> Around the world, more older people live alone. Family is often far away, and care staff cannot
> call everyone every day. Many will never use an app, but they still answer the phone. We are
> starting with English speakers in Japan, one of the oldest societies in the world.

「電話だけで足りる」はタイトルカードと第 9 節の締めでも言うので、ここでは文字カードに任せて語らない。
英語話者を選んだ理由（地域の支援が日本語）も文字カードの小さな文字に任せる。「the world's oldest
society」とは言わない（国の数え方によっては日本が 1 位でない）。

## 3. Edith と毎日の電話（0:29–1:00 / 46 語 + 音声 9 秒）

**画面**：Edith Carter のケース画面。上部（「Review soon」の札、名前、最後につながった日、9 つの指標の
バー）と「What was said」。引用の下の音声プレイヤーを、Hachi の挨拶の直後（本人が答え始めるところ）
まで進めて再生する。プレイヤーは引用の位置から始まるが、音源は通話全体なので位置は動かせる。再生前に
「Whole conversation」を開いておくと、再生中に文字起こしも映る。

**字幕で補う（1 回だけ）**：All people shown are fictional. ケース画面が初めて映るところで出す。

> Meet Edith. She lives alone, and her son is far away. Hachi calls her every day. It says it is an AI
> and that the call is recorded.

（ここで通話音声を 9 秒。本人が体調と睡眠について答えるところ）

> Health and meals come up naturally. Hachi listens to what she says, and to how she says it.

**字幕で補う**：Calls start only after the person agrees, and staff record that agreement.

**字幕で補う**：Each call also includes two questions from standard health checklists.

Edith の紹介は `services/analyzer/eval/demo-names.json` の暮らしの状況（「Lives alone. Son Michael phones
from overseas on Sundays.」）に合わせている。待ち行列のカードにもこの一行が出る。

Edith の録音は合成の台本なので、挨拶で「AI であること」「録音していること」は言っていない（実際の
電話では言う）。ナレーションは実際の電話の説明として読む。

標準化質問（1 回の通話で 2 問）はナレーションから外し、字幕にした。Edith のケース画面の「Screening
questions」は「Not enough answers yet」なので、語ると画面と食い違って見える。

## 4. 職員の待ち行列（1:00–1:16 / 32 語）

**画面**：待ち行列（Needs attention）。件数の枠（緊急度ごとの未対応件数と Patients registered。0 件は
灰色）→ 緊急度別のレーンを上から下へ（各レーンの見出しに札と件数）→「Review soon」の
レーンにある Edith Carter のカード（札、1 行の理由、暮らしの状況の一行）で止める。2 文目では
「Nobody has been reached」か「Not fully checked」の枠を映す。出ていない日は画面なしで読む。最後に
Edith のカードを押してケース画面へ移り、第 5 節につなぐ。

広い画面（ページ幅 1200px 以上）では左にレーン、右に件数と枠が並ぶので 1 画面に収まる。絞り込み
（「Filter cases」）は使わない。広い画面では開いた状態で表示されるので、撮影前に見出しを押して閉じる。

9 つの指標のバーはケース画面の上部にだけ出る。待ち行列のカードにも出す作りはあるが、API がまだその
データ（`signals`）を送っていないので、今は出ない。

> Staff start from one queue that says who to look at first, and why. It also shows who Hachi could
> not reach, so a missed call never looks like a good day.

## 5. Edith の小さな変化（R3）（1:16–1:40 / 43 語 + 音声 3 秒）

**画面**：Edith のケース画面。「Review soon」の札が映っている状態で始める。まず「What was said」の
言い直しの証拠（1:15 付近の「from the from the bakery」。引用の下に「In their own words · … · 1:15 in」）を
再生する。続いて「Speech over time」をゆっくり見せる。見出し横の札（「Clear change」など）→「Changed in
the latest call: …」の一文 → 指標ごとの札（Time to answer / Stops and restarts / Word variety / Staying on
topic）→ グラフで「Usual for Edith」の帯から最新の点（ひし形）が外れているところ。最新の点にカーソルを
置くと、日付と値と「(usual … to …)」が出る。

> Nothing Edith said was alarming. But listen.

（ここで言い直しの音声を 3 秒）

> She is slower to answer than usual, and restarts her sentences more often. Hachi compares her only
> with herself, over the past four weeks. Not a diagnosis: a sign of change, with the recording as
> evidence.

2 文目は Edith（評価の `syn-c1`）の台本どおり。台本の変化は「答えるまでの時間が 70〜100% 延びる」で、
評価では Time to answer と Stops and restarts の 2 つが変化した指標として出た
（[r3-synthetic.md](eval/r3-synthetic.md)）。本番でどちらかの札が変化を示していなければ、その半分を削る。

Edith の「Who was told」は「No notifications were sent for this case.」になる。「Review soon」は誰にも
通知せず、職員が待ち行列で見るだけの段階なので、これで正しい。映っても構わない。

## 6. 緊急（R1）と沈黙（R4）（1:40–2:01 / 44 語）

**画面**：緊急ケースのケース画面。上部の「Immediate action」の札（赤、「!!」）と意味の一文「Possible
immediate danger to life or health. Act now.」→「What was said」の該当発言と音声 →「Who was told」で
職員と家族への通知の記録（各行に配信状態の札）。

> **要決定**：どのケースを映すか。「[あとで決めること](#あとで決めること)」を参照。

> If someone is in danger now, like chest pain or a fall, Hachi acts during the call. It asks them to
> call an ambulance if they can, and phones staff and family to join the call. Answering and saying
> nothing raises an alert too.

**字幕で補う**："It's probably nothing, but my chest hurts" still counts. Past events and other people's
problems do not.

最後の一文は、電話に出たのに問いかけに一度も答えなかった通話のこと。通話中の問いかけを使い切ると
Immediate action のケースになり、職員と家族に通知が行く（三者通話はつながない）。

## 7. 家族の画面（2:01–2:18 / 34 語）

**画面**：家族ダッシュボード（見出し「Daily calls with Edith Carter」）を携帯の画面幅で。上部の状態の枠
は映さず（下の段落を参照）、「Today's call, …」の領域ごとのタイル →「The last two weeks at a glance」の
14 日グリッド →「What keeps coming up」の順に下へ送る。

> Families get a simpler view: today's call, two weeks at a glance, and what keeps coming up. They
> never get recordings, transcripts or speech analysis, so Edith can talk freely. The API enforces
> that.

家族画面は、通話が停止中か初回承認が記録されていない利用者では、上部に「Daily calls are paused」と出す
（次の通話の時刻が出ない）。Edith はこの状態のはずで、第 3 節で「Hachi calls her every day」と言った
あとなので矛盾して見える。状態の枠の下から撮り始める。架空の人物に承認を記録して消すことはしない。

## 8. 仕組み（2:18–2:33 / 31 語）

**画面**：英語の構成図。サービス名を順に軽くハイライトする。最後の一文で `docs/COST_CONTROL.md`
の「3. 二つの上限の順序」の表に切り替える。

リポジトリの `architecture.png` はラベルが日本語で、図が大きな黒い画面の中央に小さく描かれているので、
そのままでは使えない。英語で、通話中（電話 → Twilio → Cloud Run → Gemini Live API）と通話後（Cloud Storage
→ Gemini → Firestore → 職員・家族の画面と通知）の 2 段に分けた図を作る。案は `storyboard/frames.html` の
`11-arch`。

> Twilio streams the call through Cloud Run to the Gemini Live API, and Gemini reviews every call
> afterwards. A monthly AI budget can pause routine calls, but never an emergency alert.

## 9. 評価とこれから（2:33–2:51 / 36 語）

**画面**：`docs/eval/r3-synthetic.md` の結果表、または結果を書いたカード（「Synthetic recordings · 10/10
changes found · 0/10 false alarms」）。「Today」で日本の文字カード、「Next」で世界地図か文字カード。最後に
タイトルカードと URL。

> On synthetic recordings, Hachi found all ten scripted changes, with no false alarms. Real phone audio
> will be harder. Today, Hachi calls English speakers in Japan. Next, English speakers anywhere. All
> they need is a phone.

「ten」は 2 つのシードで 5 人ずつ、合わせて 10 人の変化。期待どおりの緊急度だったのは各シード 5 人中 4 人
だが、ナレーションでは言わない。聞かれたらそう答える。

R1/R2 の合成評価（`docs/eval/r12-synthetic.md`）は 100% / 94% と数字はよいが、キーワード規則を同じ
データで 1 回直したあとの値なので、ナレーションでは使わない。聞かれたらそう答える。

---

## 収録前のチェックリスト

### 決めたこと

- **古いテストケースは残す**。待ち行列にはテスト利用者（実際の電話で試した利用者）のケースが残って
  いる。実際の電話で検知できた記録なので、あえて映す。待ち行列のカードには名前、1 行の理由、暮らしの
  状況の一行、誰に知らせたか（「✓ Staff」など）だけが出て、電話番号は出ない。件数は収録前に数え直す。
- **画面には架空の名前だけを出す**。名前は `services/analyzer/eval/demo-names.json` から付く。デモ利用者は
  Edith Carter、Walter Hughes、Margaret Ellis など、担当職員は Aiko Tanaka。テスト利用者には、作った順に
  `testResidents` の名前（Kenji Mori、Hana Takeda、…）が付く。デモ利用者は内部では `synthetic: true` の
  ままで、連絡先がなく、電話もかけない。
- **架空の人物だと字幕で 1 回伝える**。画面には人物が架空だと示すものがない。第 9 節の語りは録音が
  合成だと言うが、映っている人物のことは言わない。
- **「Call now」は実演しない**。押し切ると本当に電話がかかり、確認文に電話番号が出る。入れたい場合は
  「[あとで決めること](#あとで決めること)」を参照。

### 必ず対応するもの

1. **本番に最新の画面が出ているか確かめる**。待ち行列が緊急度別のレーンに分かれ、カードに色付きの札が
   出て、ケース画面の上部に 9 つの指標のバーが出て、職員画面の呼び方が「Patients」になっていること。
2. **本番の名前を架空の名前に揃える**。`node infra/rename-demo-residents.mjs <project-id>` をまずそのまま
   実行し（dry run。変更を表示するだけ）、内容を確かめてから `--apply` を付けて実行する。デモ利用者
   （`demo-`）とテスト利用者（`test-`）、担当職員、家族の名前が変わる。デモ利用者を入れ直すなら
   `npm run seed:demo -w @hachi/analyzer -- --reset --org <組織 ID>`。最後の通話が当日になるので、家族
   画面の札が「Talked today」になり、今日の列も埋まる。家族ログインの設定も消えるので
   `--family-login-of <residentId>` も付ける。
3. **電話番号を映さない**。テスト利用者のケース画面には実際の電話番号が出る（右上の「Phone」、「About this
   person」の Assigned staff、「Who was told」の各行）。Patients のカードと詳細画面にも出る。映すなら
   すべてぼかす。待ち行列のカードと「Nobody has been reached」の枠には出ない。デモ利用者は連絡先が空。
4. **Edith の変化した指標を確かめる**（第 5 節のナレーション 2 文目に合わせる）。Time to answer と Stops
   and restarts の両方が変化を示していること。
5. **Edith の肖像を赤いベレー帽に変える**。動画の Edith は `grandmother-3`（Grandmother in a red beret and
   brown coat）に決めた。本番は名前から自動で `grandmother-1`（着物姿）が付いているので、Patients で
   Edith Carter を開き、編集画面の肖像の選択で赤いベレー帽を選んで保存する。
   `infra/assign-portraits.mjs` は肖像がすでにある人を変えないので、あとで実行しても戻らない。Runway などで
   Edith の実写風の映像を作るときも、この肖像を参照画像にする。
6. **Edith の家族画面の Mood を確かめる**。気分・孤独感の共有は初回承認に含まれる。承認のない利用者では
   Mood のタイルが「Not shared」になり、14 日グリッドから Mood の行が消え、上部の一文は領域から作った
   汎用の文になる。デモ利用者はこの状態のはず。ナレーションは領域の数も一言の中身も言わないので、
   どちらでも成り立つ。
7. **家族画面の「Daily calls are paused」を映さない**。状態の枠の下から撮る（第 7 節を参照）。
8. **音量と字幕**。通話音声の区間はナレーションを止める。音声は左右で話者が分かれているステレオなので、
   モノラルにまとめる。通話音声にも英語字幕を付ける（Edith の合成音声は聞き取りやすいが、電話の
   音質では聞き取りにくい人がいる）。

### あとで決めること

- **緊急（R1）の場面をどう撮るか（要決定、推奨は 1）**。
  1. **合成の緊急デモ利用者を 1 人追加する（推奨）**。R1/R2 の評価シナリオ（`eval/r12-scenario.ts`）に
     胸の痛みや転倒の台本があるので、音声合成に流せば、聞ける証拠付きの緊急ケースが作れる。個人情報は
     入らず、「Who was told」に通知の記録も出る。作業は 1〜2 時間程度。この動画で最も強い場面なので、
     手間をかける価値がある。
  2. テスト利用者の実際の通話を使い、電話番号をすべてぼかす。
  3. 画面を映さず、語りと図だけで済ませる。通知が届いた証跡は見せられない。
- **沈黙の場面を画面で見せるか**。現行案は語りだけ。見せる場合は、テスト利用者に「Call now」でかけて、
  出たまま黙る。20 秒ほど問いかけが続いて通話が終わり、「No response after all check-in prompts.」の
  Immediate action ケースができる。登録先の職員と家族に実際に通知が行くので、事前に知らせておく。
- **「Call now」を入れるか**。入れるなら第 4 節の最後に、テスト利用者のケース画面で押して確認文
  「Ring … on … now?」を出し、「Cancel」で閉じる。確認文の電話番号はぼかす。テスト利用者でも、
  初回承認が記録されていなければボタンは出ない。ナレーションに「To hear from someone now, staff press
  Call now.」（9 語、約 4 秒）を足しても 3 分には収まるが、余裕は 5 秒になる。
- **ナレーションの声**。はっきりした標準的な発音なら、英国式・米国式は問わない。合成音声を使うなら
  Cloud Text-to-Speech で、Hachi の声とは別の声にする（視聴者が混同しないように）。

### 画面収録のメモ

- 本番 URL をそのまま使う。職員画面は `/staff`（待ち行列）と `/staff/residents`（Patients）、家族画面は
  `/family`。
- 待ち行列は 15 秒ごとに自動で読み直す。数や枠が撮影中に動くことがあるので、止めたい場面は短く撮る。
- 緊急度の呼び名は、待ち行列のレーン見出しでもケース画面の札でも「Immediate action / Review today /
  Review soon / Monitor」。
- 「Nobody has been reached」「Not fully checked」「Check-in calls have stopped.」「Asked for a phone call」の
  枠は、該当があるときだけ出る。
- 札と色の意味は、待ち行列の「What the colours and icons mean」を開くと出る。赤・橙・黄・灰が緊急度、
  緑が良好・完了、青の破線が Hachi 側の問題。
- Edith のケース画面の「Screening questions」は、合成の通話に標準化質問が入っていないので「Not enough
  answers yet」になる。映り込むのは構わないが、寄らない。
- 家族画面は携帯の画面幅で撮る。14 日グリッドは 7 日ずつ 2 段になる。家族ログインに複数の利用者が
  出たら Edith Carter を選ぶ。「Turn on alerts」は本番でプッシュ通知を設定していないので押さない。
