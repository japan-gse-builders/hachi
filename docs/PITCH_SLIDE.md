# スライド1枚ぶんの原稿 —「なぜ電話か」

提出用スライドに入れる1枚。リポジトリ外のスライドに貼るための原稿なので、ここには文言だけ置く。

他社・他実装の名前は出さない。比較対象は「アプリ前提の見守りサービス」という一般名詞にする。

---

## タイトル

> **Reaching the people an app never reaches**

## 本文（1行）

> Hachi needs a telephone. That is the entire requirement.

## 比較表

| | What the resident needs |
|---|---|
| **Hachi** | A telephone. Any telephone. |
| A typical app-based check-in service | A smartphone, the app installed, an account, notifications allowed, and the habit of opening it |

## 下に小さく（話者が読み上げる想定、スライドには出さなくてもよい）

> Many are in their eighties and living alone. The device by the chair is a landline. And the family
> who would help them install an app is in another country — which is why they are alone.

## 話すときの要点

1. **電話は妥協ではなく選択**。アプリで届く層と、この製品が届けたい層は重なっていない。
2. **選択にはコストが伴った**。Twilio Media Streams と Gemini Live の双方向中継、μ-law 8 kHz ↔ PCM の変換、ステレオ録音、通話中の緊急判定、三者通話ブリッジ。ブラウザで喋らせるだけなら、どれも要らなかった。
3. **電話にしかない制約が、逆に手がかりになった**。「既読」も「最終ログイン」もないので、出たのに話さないことが唯一残る信号になる（R4）。

## 使わない言い回し

- 「電話にも対応」— 対応ではなく、これが唯一の経路である。
- 「スマホがなくても使える」— 否定形だと妥協に聞こえる。「電話があれば足りる」と肯定形で言う。
