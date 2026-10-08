# デモ動画の台本（3 分以内）

Google Cloud AI Builder Cup 2026 提出用。本番環境 <https://hachicall-nao.web.app> をそのまま画面収録する。

ナレーションは英語（製品も README も英語、利用者も英語話者）。合計 **397 語 / 約 2 分 51 秒**（3 分まで 9 秒の余裕）。読み上げ速度は 1 分あたり 150 語を想定。

収録前の準備は「[収録前のチェックリスト](#収録前のチェックリスト)」を参照。

---

## 1. 問題提起（0:00–0:23 / 58 語）

**画面**：日本の団地や住宅街の静かな映像、またはタイトルカード「Hachi — a daily AI check-in call」。

> Japan has a growing number of older people living alone. Among them are long-term residents who
> came from abroad and are most comfortable in English. Check-in services here are mostly in
> Japanese. Their families are often overseas. Care staff cannot phone everyone, every day.
>
> And a check-in app never reaches them. The device by the chair is a landline. So Hachi needs
> nothing but a telephone.

## 2. 電話の様子（0:23–0:58 / 57 語 + 音声 12 秒）

**画面**：Edith のケース画面「What was said」の音声プレイヤーを開き、つまみを先頭（0:00）に戻して再生する。プレイヤーの音源は通話全体の録音なので、Hachi の自己紹介から聞かせられる。音声が主役なので、ナレーションは音声の前後に分けて入れる。再生中はプレイヤーの下にある会話の文字起こしも映る。

> Hachi phones each resident once a day for a short chat. It says who it is, that it is an AI, and
> that the call is recorded.

（ここで通話音声を 10〜12 秒流す。「Good morning Edith, this is Hachi calling for our daily chat.」から、
本人が体調と睡眠について答えるところまで）

> Health and meals come up inside the small talk, and Hachi picks up topics from earlier calls. It
> listens for two things: **what** they say, and **how** they say it.

## 3. 緊急（R1）（0:58–1:18 / 49 語）

**画面**：緊急ケースのケース画面。上部の「Immediate action」バッジ → 「What was said」の該当発言と音声
→ 「Notifications」で職員と家族への通知が届いた記録。

> **保留中**：どのケースを映すかは未決定。「[あとで決めること](#あとで決めること)」を参照。

> When someone says something dangerous — chest pain, a fall they cannot get up from — a rule on the
> transcript and Gemini both catch it during the call. Hachi asks them to call an ambulance, opens
> an emergency case, and phones staff and family to bridge them in.

**字幕で補う**：Hedged wording counts. Past events, other people and denials do not.

## 4. 話し方の変化（R3）（1:18–1:46 / 70 語）

**画面**：Edith のケース画面。まず「What was said」の中にある言い直しの証拠（1:15 付近の
「from the from the bakery」）を再生し、言い直しを耳で聞かせる。続いて「Speech over time」のグラフを
ゆっくり見せる。帯（usual range）から最新の点が外れているところ、「Outside usual range」バッジ、凡例。
最後に待ち行列（Needs attention）に戻り、「Review soon」の札と 1 行の理由を見せる。

Edith のケース画面では「Notifications」が「No notifications were sent for this case.」になる。これは
正しい動作で、「Review soon」は職員が待ち行列で見るだけ、誰にも通知しない段階という設計のとおり。

> The third signal is the quiet one. Hachi measures how the resident speaks: how long they take to
> answer, how often they correct themselves, how varied their words are. Each measure is compared
> only with **their own** twenty-eight-day baseline — never with other people. Here, Edith repeats
> herself mid-sentence, and her answers have moved outside her usual range. No diagnosis — a sign
> of change, with the recording as evidence.

## 5. 家族の画面（1:46–2:10 / 60 語）

**画面**：家族ダッシュボード。一言まとめ → 6 つの領域タイル → 「The last two weeks at a glance」の 14 日グリッド → 「What keeps coming up」。

> Family see a different view. One sentence about what their mother said and did. Six areas of
> daily life. Fourteen days at a glance, so a change shows up as a shape. And what keeps coming up
> lately.
>
> What they do not see: the recordings, the transcript, and anything about how she speaks. That
> boundary is enforced in the API.

## 6. 仕組み（2:10–2:30 / 51 語）

**画面**：`architecture.png`。サービス名を順に軽くハイライト。

> Twilio streams the call to Cloud Run, which relays it to the Gemini Live API. Recordings go to
> Cloud Storage, transcripts to Firestore. After the call, Gemini reviews it with structured
> output, while the speech measures come from the recording itself. Cloud Tasks and Scheduler drive
> the dialling, analysis and alerts.

## 7. 評価と限界（2:30–2:51 / 52 語）

**画面**：`docs/eval/r3-synthetic.md` の結果表、または結果を書いたカード。最後にタイトルカードと URL。

> On synthetic recordings, all ten people with a scripted change were detected, and none of the ten
> stable people were flagged. Clean synthetic speech is far easier than real phone audio — treat
> that as an upper bound. Hachi does not diagnose. It tells staff who to look at first, and why.

---

## 収録前のチェックリスト

### 決めたこと

- **古いテストケースは残す**。待ち行列には Test Resident のケースが 5 件（R1 が 3 件、R2 が 2 件）
  残っている。これは実際の電話で検知できた記録なので、あえて映す。待ち行列の画面に出るのは名前と
  利用者 ID だけで、電話番号は出ない。

### 必ず対応するもの

1. **Test Resident のケース画面には実際の電話番号が 2 か所出る**。見出しの下に利用者の番号
   （`CasePage.tsx` 79 行目）、「Notifications」の行に通知先の番号（同 112 行目）。この画面を映すなら
   両方ぼかす。合成デモ利用者は職員・家族の連絡先が空なので、どちらも出ない。
2. **音量**。通話音声を流す区間はナレーションを止める。音声は左右で話者が分かれているステレオなので、
   収録時はモノラルにまとめる。

### あとで決めること

- **緊急（R1）の場面をどう撮るか（保留中）**。選択肢は 3 つ。
  - 合成の緊急デモ利用者を 1 人追加する。R1/R2 の評価シナリオ（`eval/r12-scenario.ts`）に胸の痛みや
    転倒の台本が揃っているので、音声合成に流せば、聞ける証拠付きの緊急ケースが作れる。個人情報は
    入らず、「Notifications」に通知の記録も出る。作業は 1〜2 時間程度。
  - Test Resident の実際の通話を使い、上記 2 か所をぼかす。
  - 画面を映さず、語りと図だけで済ませる。ただし「Notifications」で通知が届いた証跡を見せられない。
- **ナレーションの言語**。英語で書いてあるが、日本国内審査なら日本語ナレーション＋英語字幕にもできる。
- **冒頭の映像**。実写素材を使うか、タイトルカードだけで済ませるか。

### 画面収録のメモ

- 本番 URL をそのまま使う。職員画面は `/staff`、家族画面は `/family`。
- 家族画面は携帯の画面幅で撮ると 14 日グリッドが見やすい。
- 合成デモ利用者は名前に「(synthetic demo)」が付く。審査員に合成データと伝わるので、隠さない。
