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

**画面**：Edith のケース画面「What was said」の音声プレイヤーを開き、つまみを先頭（0:00）に戻して再生する。プレイヤーの音源は通話全体の録音なので、Hachi の自己紹介から聞かせられる。音声が主役なので、ナレーションは音声の前後に分けて入れる。再生中はプレイヤーの下にある会話の文字起こしも映る。

> Hachi phones each resident once a day. It says who it is, that it is an AI, and that the call is
> recorded.

（ここで通話音声を 10〜12 秒流す。「Good morning Edith, this is Hachi calling for our daily chat.」から、
本人が体調と睡眠について答えるところまで）

> Health and meals come up in the small talk, with two standard screening questions a day. It
> listens for two things: **what** they say, and **how** they say it.

**字幕で補う**：Calls begin only after the resident agrees, and staff record that agreement.

## 3. 緊急（R1）と沈黙（0:55–1:16 / 52 語）

**画面**：緊急ケースのケース画面。上部の「Immediate action」バッジとその横の意味の一文 → 「What was said」の
該当発言と音声 → 「Notifications」で職員と家族への通知が届いた記録。

> **保留中**：どのケースを映すかは未決定。「[あとで決めること](#あとで決めること)」を参照。

> When someone says something dangerous — chest pain, a fall they cannot get up from — a rule and
> Gemini both catch it during the call. Hachi asks them to call an ambulance and phones staff and
> family to bridge them in. Silence counts too: picking up but never answering is flagged at once.

**字幕で補う**：Hedged wording counts. Past events, other people and denials do not.

最後の一文は、出たのに 3 回の問いかけに一度も答えなかった通話のこと。この場合も Immediate action の
ケースになり、通常の R1 と同じく職員と家族に通知が行く（三者通話はつながない）。

## 4. 話し方の変化（R3）（1:16–1:40 / 62 語）

**画面**：Edith のケース画面。まず「What was said」の中にある言い直しの証拠（1:15 付近の
「from the from the bakery」）を再生し、言い直しを耳で聞かせる。続いて「Speech over time」のグラフを
ゆっくり見せる。帯（usual range）から最新の点が外れているところ、「Outside usual range」バッジ、凡例。

Edith のケース画面では「Notifications」が「No notifications were sent for this case.」になる。これは
正しい動作で、「Review soon」は職員が待ち行列で見るだけ、誰にも通知しない段階という設計のとおり。

> The third signal is the quiet one: how the resident speaks — how long they take to answer, how
> often they correct themselves, how varied their words are. Each measure is compared only with
> **their own** twenty-eight-day baseline. Here, Edith repeats herself mid-sentence, and her answers
> have moved outside her usual range. No diagnosis — a sign of change, with the recording as
> evidence.

## 5. 職員の待ち行列（1:40–2:01 / 51 語）

**画面**：待ち行列（Needs attention）。上部の 3 つの数（Need attention / Keeping an eye on / Residents
registered）→ Urgency の絞り込みで「Review soon」を押し、Edith のカードの札と 1 行の理由を見せる
→「All levels」に戻す。「Nobody has been reached.」や「Not fully checked.」の枠が出ていれば、そこで止めて
見せる。最後にテスト利用者（ID が `test-` で始まる最新の利用者）のケース画面で「Call now」を押して
確認文を出し、「Cancel」で閉じる（電話番号はぼかす。チェックリスト参照）。

> Staff work from one queue, most urgent first, each case with a one-line reason. Hachi also lists
> what it could not do — a resident nobody reached, a call not fully checked — so a quiet day is
> never mistaken for a good one. To hear from someone now, staff press Call now.

## 6. 家族の画面（2:01–2:19 / 45 語）

**画面**：家族ダッシュボード（Daily calls with Edith Carter）。最新の通話の一言まとめと領域ごとの
タイル →「The last two weeks at a glance」の 14 日グリッド →「What keeps coming up」。

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
  残っている。これは実際の電話で検知できた記録なので、あえて映す。待ち行列の画面に出るのは名前と
  1 行の理由、通知の記録だけで、電話番号は出ない。件数は収録前に数え直す。
- **画面には架空の実名だけを出す**。デモ利用者とテスト利用者には「Edith Carter」「Kenji Mori」のような
  架空の名前を付け、「(synthetic demo)」「Test Resident」や「Synthetic demo resident, not a real person」は
  出さない。合成データであることはナレーション（第 8 節）と字幕で伝える。名前の一覧は
  `services/analyzer/eval/demo-names.json`。

### 必ず対応するもの

1. **本番に最新の main が出ているか確かめる**。台本は #31（gateway probe）まで取り込んだ main に合わせて
   ある。待ち行列の上部に 3 つの数と Urgency の絞り込みが出ていなければ、本番が古い。
2. **Test Resident の画面には実際の電話番号が出る**。ケース画面では見出しの下の 1 行（ルール名・日時・
   電話番号）、「About this person」の Assigned staff（職員の番号とメール）、「Notifications」の各行の
   通知先。「Call now」を押したときの確認文「Ring … on … now?」にも番号が出る。利用者一覧（Residents）の
   カードにも番号が出る。映すならすべてぼかす。合成デモ利用者は連絡先が空なので、どれも出ない。
3. **「Call now」は Test Resident でしか出ない**。合成デモ利用者は電話をかけない設計なので、ボタン自体が
   出ない。Test Resident でも、初回承認（first-use approval）が記録されていなければ出ない。Residents で
   「Approval needed」になっていないか確かめる。収録では確認文を出して「Cancel」で閉じる。押し切ると
   本当に電話がかかる（スタッフ通話は 10 分に 1 回まで）。
4. **Edith の家族画面に Mood 行と一言まとめが出るか確かめる**。家族への気分・孤独感の共有は初回承認に
   含まれるようになり、承認のない利用者では Mood の行が消え、一言まとめは「Here is what came up in the
   latest call.」、通話ごとの要約は非表示になる。合成デモ利用者は承認の仕組みより前に作ったので、
   このままだと 5 領域・汎用の一文になるはず。ナレーションは領域の数も一言まとめの中身も言わないように
   したので、どちらでも成り立つ。6 領域で見せたいなら「[あとで決めること](#あとで決めること)」を参照。
5. **音量**。通話音声を流す区間はナレーションを止める。音声は左右で話者が分かれているステレオなので、
   収録時はモノラルにまとめる。

### あとで決めること

- **緊急（R1）の場面をどう撮るか（保留中）**。選択肢は 3 つ。
  - 合成の緊急デモ利用者を 1 人追加する。R1/R2 の評価シナリオ（`eval/r12-scenario.ts`）に胸の痛みや
    転倒の台本が揃っているので、音声合成に流せば、聞ける証拠付きの緊急ケースが作れる。個人情報は
    入らず、「Notifications」に通知の記録も出る。作業は 1〜2 時間程度。
  - Test Resident の実際の通話を使い、上記の電話番号をすべてぼかす。
  - 画面を映さず、語りと図だけで済ませる。ただし「Notifications」で通知が届いた証跡を見せられない。
- **沈黙の場面を画面で見せるか**。現行案は、第 3 節を R1 の画面のまま語りだけで触れる。見せたい場合は、
  Test Resident に「Call now」でかけさせ、出たまま黙る。Hachi の挨拶のあと 20 秒ほど問いかけが続いて
  通話が終わり、「No response after all check-in prompts.」の Immediate action ケースができる。登録先の
  職員と家族に実際に通知が行くので、事前に知らせておく。ケース画面には引用がなく「This is an
  observation of silence; there is no resident quote.」と出る。
- **Edith の家族画面を 6 領域にするか**。Residents の Edith のカードで「Record first-use approval」を記録
  すれば Mood の共有も有効になる（Edith は停止中・合成なので電話はかからない）。ただし架空の人物の
  承認を記録することになるので、API で `shareMood` だけを立てる方が筋はよい。5 領域のまま撮っても、
  台本の語りとは食い違わない。
- **ナレーションの言語**。英語で書いてあるが、日本国内審査なら日本語ナレーション＋英語字幕にもできる。
- **冒頭の映像**。実写素材を使うか、タイトルカードだけで済ませるか。

### 画面収録のメモ

- 本番 URL をそのまま使う。職員画面は `/staff`（待ち行列）と `/staff/residents`、家族画面は `/family`。
- 待ち行列は 15 秒ごとに自動で読み直す。数や枠が撮影中に動くことがあるので、止めたい場面は短く撮る。
- 待ち行列の絞り込みは URL に残る（`?urgency=action` など）。その URL を開けば、同じ絞り込みから撮り直せる。
- 「Nobody has been reached.」「Not fully checked.」「Check-in calls have stopped.」「Asked for a phone call」の
  枠は、該当があるときだけ出る。前の 2 つが出ていない日は、第 5 節の 2 文目を画面なしで読む。
- Edith のケース画面の「Screening questions」は、合成の通話に標準化質問が入っていないので、すべて未回答に
  なる。映り込むのは構わないが、寄らない。
- Edith の録音の挨拶は合成の台本なので、「AI であること」「録音していること」は言っていない（実際の
  電話では言う）。第 2 節の語りは実際の電話の説明として読む。
- 家族画面は携帯の画面幅で撮ると 14 日グリッドが見やすい。「Alerts on this phone」の「Turn on alerts」は
  本番でプッシュ通知を設定していないので押さない。
- 合成デモ利用者は名前に「(synthetic demo)」が付き、画面にも「Synthetic demo resident, not a real person」と
  出る。審査員に合成データと伝わるので、隠さない。
