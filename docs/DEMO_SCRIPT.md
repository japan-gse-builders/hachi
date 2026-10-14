# デモ動画の台本（3 分以内）

Google Cloud AI Builder Cup 2026 提出用。本番環境 <https://hachicall.web.app> をそのまま画面収録する。

## この台本の前提

- **聞き手は英語を話す世界中の人**。英語が母語でない審査員や視聴者も含む。そのため次の 3 つを守る。
  - **ゆっくり読む**。1 分あたり 130 語で計算している（英語母語話者向けの標準は 150 語）。
  - **字幕を全編に焼き込む**。ナレーションも通話音声もすべて英語字幕を出す。音を出さずに見る人と、
    聞き取りが苦手な人のため。
  - **平易な英語にする**。慣用句、略語、早口になる長い修飾句は使わない。数字は語で読む。
- **問題は世界共通、出発点が日本**。一人暮らしの高齢者、遠くに住む家族、毎日は電話できない職員、
  アプリが届かない層。この 4 つはどの国でも同じ。日本にいる英語話者は、そこに「地域の支援が日本語」と
  いう言葉の壁が重なるので、最初に取り組む相手として最も切実。台本は「世界の問題 → 日本から始める →
  次は世界の英語話者へ」の順で語る。
- **今できないことを、できるように言わない**。現在は英語のみ、日本国内のみ（SMS は +81 のみ、通話中に
  案内する救急番号は 119）。世界展開は「次にやること」として最後に一度だけ言う。

合計 **329 語 / 約 2 分 56 秒**（ナレーション 2 分 32 秒 ＋ 音声 17 秒 ＋ 場面転換の間 7 秒）。
語数は引用（`>`）のナレーションだけを空白区切りで数えた値で、「one-line」のようなハイフン語は 1 語と数える。

収録前の準備は「[収録前のチェックリスト](#収録前のチェックリスト)」を参照。

各場面の画面のイメージは [storyboard/index.html](storyboard/index.html)（ブラウザで開く）。画面はローカル
プレビューの架空データで撮ったもので、本番とは件数・日付・人物の並びが異なる。第 6 節の緊急ケースは、
本番にまだない場面の完成イメージ。

## 全体の流れ

| # | 場面 | 時間 | 語数 | 見せたいこと |
|---|---|---|---|---|
| 1 | 通話の声から入る | 0:00–0:05 | 0 | 最初の 5 秒で「電話の AI」だと分かる |
| 2 | 問題と出発点 | 0:05–0:35 | 62 | 世界共通の問題、日本から始める理由、電話だけで足りる |
| 3 | 毎日の電話 | 0:35–1:05 | 43 | AI だと名乗る、雑談の中で聞く、「何を」と「どう」 |
| 4 | 職員の待ち行列 | 1:05–1:22 | 34 | 誰から見るか、その理由、つながらなかった人 |
| 5 | Edith の小さな変化（R3） | 1:22–1:47 | 46 | 本人の過去 4 週間とだけ比べる、録音が証拠 |
| 6 | 緊急（R1）と沈黙 | 1:47–2:08 | 44 | 通話を終える前に動く、家族と職員をつなぐ |
| 7 | 家族の画面 | 2:08–2:25 | 34 | 家族に見せないものを API が守る |
| 8 | 仕組み | 2:25–2:39 | 30 | Gemini Live API と Cloud Run、緊急は予算で止めない |
| 9 | 評価とこれから | 2:39–2:56 | 36 | 正直な評価、次は世界の英語話者へ |

前の版からの主な変更：冒頭を通話音声にした。待ち行列 → Edith のカード → ケース画面と、職員の操作の
順に 1 人の話としてつないだ。言葉の壁を「日本から始める理由」に位置づけ直した。「Call now」の実演は
電話番号をぼかす手間と事故の危険に見合わないので、任意にした。

---

## 1. 通話の声から入る（0:00–0:05）

**画面**：黒地に通話音声の字幕だけ。続けてタイトルカード「Hachi — a daily check-in call. All you need
is a phone.」

**音声**：Edith の通話の冒頭を 5 秒。「Good morning Edith, this is Hachi calling for our daily chat.」と
最初の問いかけまで。ナレーションはない。

## 2. 問題と出発点（0:05–0:35 / 62 語）

**画面**：タイトルカードのあと、住宅街の静かな映像か、固定電話のある部屋の写真。「older English
speakers in Japan」のところで地図や文字カード（例「Starting in Japan」）。

> All over the world, more older people live alone. Their families often live far away, and care
> staff cannot phone everyone every day. We are starting where that gap is widest: older English
> speakers in Japan, where local services speak Japanese. Many will never use an app; the device by
> their chair is a landline. So Hachi needs nothing but a telephone.

## 3. 毎日の電話（0:35–1:05 / 43 語 + 音声 9 秒）

**画面**：Edith Carter のケース画面。上部（「Review soon」の札、名前、最後につながった日、9 つの指標の
バー）と「What was said」。引用の下の音声プレイヤーを、Hachi の挨拶の直後（本人が答え始めるところ）
まで進めて再生する。プレイヤーは引用の位置から始まるが、音源は通話全体なので位置は動かせる。再生前に
「Whole conversation」を開いておくと、再生中に文字起こしも映る。

**字幕で補う（1 回だけ）**：All people shown are fictional. ケース画面が初めて映るところで出す。

> Every day, Hachi calls. It says it is an AI and that the call is recorded. Then it simply chats.

（ここで通話音声を 9 秒。本人が体調と睡眠について答えるところ）

> Health and meals come up naturally, with two short screening questions. Hachi listens to what
> people say, and to how they say it.

**字幕で補う**：Calls start only after the person agrees, and staff record that agreement.

Edith の録音は合成の台本なので、挨拶で「AI であること」「録音していること」は言っていない（実際の
電話では言う）。ナレーションは実際の電話の説明として読む。

## 4. 職員の待ち行列（1:05–1:22 / 34 語）

**画面**：待ち行列（Needs attention）。件数の枠（緊急度ごとの未対応件数と Patients registered。0 件は
灰色）→ 緊急度別のレーンを上から下へ（各レーンの見出しに札と件数）→「Review soon」の
レーンにある Edith Carter のカード（札、1 行の理由、暮らしの状況の一行）で止める。2 文目では
「Nobody has been reached」か「Not fully checked」の枠を映す。出ていない日は画面なしで読む。最後に
Edith のカードを押してケース画面へ移り、第 5 節につなぐ。

広い画面（ページ幅 1200px 以上）では左にレーン、右に件数と枠が並ぶので 1 画面に収まる。絞り込み
（「Filter cases」）は使わない。広い画面では開いた状態で表示されるので、撮影前に見出しを押して閉じる。

9 つの指標のバーはケース画面の上部にだけ出る。待ち行列のカードにも出す作りはあるが、API がまだその
データ（`signals`）を送っていないので、今は出ない。

> Staff start from one queue that says who to look at first, and why. The queue also shows who Hachi
> could not reach, so a quiet day is never mistaken for a good one.

## 5. Edith の小さな変化（R3）（1:22–1:47 / 46 語 + 音声 3 秒）

**画面**：Edith のケース画面。まず「What was said」の言い直しの証拠（1:15 付近の「from the from the
bakery」。引用の下に「In their own words · … · 1:15 in」）を再生する。続いて「Speech over time」を
ゆっくり見せる。見出し横の札（「Clear change」など）→「Changed in the latest call: …」の一文 → 指標ごとの
札（Time to answer / Stops and restarts / Word variety / Staying on topic）→ グラフで「Usual for Edith」の
帯から最新の点（ひし形）が外れているところ。最新の点にカーソルを置くと、日付と値と「(usual … to …)」
が出る。

> Edith is marked "Review soon". Nothing she said was alarming. But listen.

（ここで言い直しの音声を 3 秒）

> She is restarting her sentences more often than she usually does. Hachi compares her only with
> herself, over the past four weeks. Not a diagnosis: a sign of change, with the recording as
> evidence.

**要確認**：2 文目は「Stops and restarts」が変化している前提。収録前に画面で変化した指標を確かめ、
違えば合わせて言い換える（例：Time to answer なら「She is taking longer to answer than she usually
does.」）。

Edith の「Who was told」は「No notifications were sent for this case.」になる。「Review soon」は誰にも
通知せず、職員が待ち行列で見るだけの段階なので、これで正しい。映っても構わない。

## 6. 緊急（R1）と沈黙（1:47–2:08 / 44 語）

**画面**：緊急ケースのケース画面。上部の「Immediate action」の札（赤、「!!」）と意味の一文「Possible
immediate danger to life or health. Act now.」→「What was said」の該当発言と音声 →「Who was told」で
職員と家族への通知の記録（各行に配信状態の札）。

> **要決定**：どのケースを映すか。「[あとで決めること](#あとで決めること)」を参照。

> If someone is in danger now, like chest pain or a fall, Hachi acts during the call. It asks them to
> call an ambulance if they can, and phones staff and family to join the call. Picking up and saying
> nothing is noticed too.

**字幕で補う**：Hedged wording counts. Past events, other people and denials do not.

最後の一文は、電話に出たのに問いかけに一度も答えなかった通話のこと。通話中の問いかけを使い切ると
Immediate action のケースになり、職員と家族に通知が行く（三者通話はつながない）。

## 7. 家族の画面（2:08–2:25 / 34 語）

**画面**：家族ダッシュボード（見出し「Daily calls with Edith Carter」）を携帯の画面幅で。上部の状態の枠
（「Mostly well」のような一言と一文）→「Today's call, …」の領域ごとのタイル →「The last two weeks at a
glance」の 14 日グリッド →「What keeps coming up」。状態の一言は最新の通話で決まるので、収録前に
確かめる。

> Family get a simpler view: today's call, two weeks at a glance, and what keeps coming up. They
> never get recordings, transcripts or speech analysis, so Edith can talk freely. The API enforces
> that.

## 8. 仕組み（2:25–2:39 / 30 語）

**画面**：`architecture.png`。サービス名を順に軽くハイライトする。最後の一文で `docs/COST_CONTROL.md`
の「3. 二つの上限の順序」の表に切り替える。

> Twilio streams the call through Cloud Run to the Gemini Live API, and Gemini reviews every call
> afterwards. A monthly AI budget can pause routine calls, never an emergency alert.

## 9. 評価とこれから（2:39–2:56 / 36 語）

**画面**：`docs/eval/r3-synthetic.md` の結果表、または結果を書いたカード（「Synthetic recordings · 10/10
changes found · 0/10 false alarms」）。「Next」のところで世界地図か文字カード。最後にタイトルカードと URL。

> On synthetic recordings, Hachi caught all ten scripted changes with no false alarms; real phone
> audio will be harder. Today, Hachi calls English speakers in Japan. Next, English speakers
> anywhere. All they need is a phone.

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
4. **Edith の変化した指標を確かめる**（第 5 節のナレーション 2 文目に合わせる）。
5. **Edith の肖像を赤いベレー帽に変える**。動画の Edith は `grandmother-3`（Grandmother in a red beret and
   brown coat）に決めた。海外から来た人だと伝わりやすいため。本番は名前から自動で `grandmother-1`（着物姿）が
   付いているので、Patients で Edith Carter を開き、編集画面の肖像の選択で赤いベレー帽を選んで保存する。
   `infra/assign-portraits.mjs` は肖像がすでにある人を変えないので、あとで実行しても戻らない。Runway などで
   Edith の実写風の映像を作るときも、この肖像を参照画像にする。
6. **Edith の家族画面の Mood を確かめる**。気分・孤独感の共有は初回承認に含まれる。承認のない利用者では
   Mood のタイルが「Not shared」になり、14 日グリッドから Mood の行が消え、上部の一文は領域から作った
   汎用の文になる。デモ利用者はこの状態のはず。ナレーションは領域の数も一言の中身も言わないので、
   どちらでも成り立つ。
7. **音量と字幕**。通話音声の区間はナレーションを止める。音声は左右で話者が分かれているステレオなので、
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
  Call now.」（9 語、約 4 秒）を足すと 3 分を超えるので、どこかを削る。
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
  出たら Edith Carter を選ぶ。Edith は停止中なので、上部に「Daily calls are paused」と出る。「Turn on
  alerts」は本番でプッシュ通知を設定していないので押さない。
