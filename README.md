# pi-cc-statusline

pi のフッターを、次の 1 行のステータスラインに置き換える pi 拡張です。

```
 Opus 5.5 medium · main* · Context 95% left · 5h 81% left
```

すべての項目を出した場合

```
 Opus 5.5 medium · main* · Context 95% left · 5h 81% left · Weekly 63% left · Cache 97% hit · 89 tok/s
```

## 項目

| 名前 | 表示 | 内容 |
|---|---|---|
| `model` | `Opus 5.5 medium` | モデル名と思考レベル。`Claude Opus 5.5 1M` は `Opus 5.5` のように縮める。思考に対応しないモデルでは思考レベルを出さない |
| `branch` | `main*` | Git ブランチ名（青色）。未コミットの変更・未追跡ファイルがある場合は `*`。Git 管理外は非表示、detached HEAD は短縮コミットID |
| `context` | `Context 95% left` | コンテキストの残り（`ctx.getContextUsage()`） |
| `5h` | `5h 81% left` | メインモデルのプロバイダーの 5 時間枠の残り |
| `weekly` | `Weekly 63% left` | メインモデルのプロバイダーの週間枠の残り |
| `cache` | `Cache 97% hit` | 今のブランチのキャッシュヒット率。`cacheRead ÷ (input + cacheRead + cacheWrite)` |
| `speed` | `89 tok/s` | 直近 5 応答の出力速度。出力トークンの合計 ÷ 所要時間（リクエスト開始〜応答終了）の合計 |

初期値は `model` `branch` `context` `5h` の 4 つです。既存の設定は保持するため、ブランチを追加するには `/statusline` で `branch` を有効にしてください。

- モデル名は明るめのグレー（`#b5b5b5`）、ブランチは青（`#7aa2d6`）で表示する
- Git 状態は描画を妨げない非同期処理で約 2 秒ごとに確認する

- `5h` と `weekly` は応答ヘッダー `anthropic-ratelimit-unified-{5h,7d}-utilization` / `-reset` から読む。組み込みの Anthropic プロバイダーと pi-claude-bridge のどちらもこのヘッダーを渡す
- `opencode-go` は `GET https://opencode.ai/zen/go/v1/usage`、`openai-codex`（GPT / ChatGPT プラン）は `GET https://chatgpt.com/backend-api/wham/usage`（いずれも認証付き・読み取りのみ）から枠を取得し、セッション開始時・モデル切替時・応答後に更新する。Codex は期間で 5 時間・週間枠を判別するため、週間枠だけのプランにも対応する。通常の OpenAI API キー課金にはプラン枠を表示しない
- 残量の項目は、残りが 20% 以下で theme の `warning`、10% 以下で `error` の色に変わる
- プランの値はプロバイダーごとに分けて保存し、メインモデルのプロバイダーのものだけを表示する。別のプロバイダー（サブエージェントや別モデル）の応答で上書きされない
- 応答ヘッダーにはプロバイダー名が無いため、ヘッダーはその直後に届くメッセージの `provider` に紐づけて保存する。応答中にモデルを切り替えても、別のプロバイダーの値として記録されない
- 値はプロバイダーごとに保存し、次のセッションでは同じプロバイダーなら最初の応答を待たずに表示する。リセット時刻を過ぎた値は 100% として扱う
- 値がまだ分からない項目（そのプロバイダーで最初の応答がまだの `5h`、Anthropic 以外のプロバイダーでの `5h` など）は表示しない。旧形式のキャッシュはプロバイダーを特定できないので読み捨て、次の応答で作り直す
- `speed` の所要時間は最初のトークンまでの待ちを含むので、純粋な生成速度よりやや低めに出る。delta の届いた時刻で測らないのは、Claude Code が delta を最後にまとめて送ることがあり、数百 tok/s のような過大な値になるため

## 設定（/statusline）

`/statusline` を引数なしで実行すると、項目の表示と順番を選ぶ画面が開きます。

```
 Status line

 ❯ ☑ 1 model    モデルと思考レベル
   ☑ 2 branch   Git ブランチ（未コミット時 *）
   ☑ 3 context  コンテキスト残量
   ☑ 4 5h       5 時間枠の残量
   ☐   weekly   週間枠の残量
   ☐   cache    キャッシュヒット率
   ☐   speed    出力速度 (tok/s)

 Preview Opus 5.5 medium · main · Context 95% left · 5h 81% left
```

| キー | 操作 |
|---|---|
| ↑ / ↓ | 項目を選ぶ |
| space | 表示・非表示を切り替える |
| shift+↑ / shift+↓（または `[` / `]`） | 選んだ項目を上下に動かす |
| r | 初期値に戻す |
| enter | 保存する |
| esc | 変更を捨てて閉じる |

引数で直接指定もできます（項目名は補完できます）。

```
/statusline model branch context 5h weekly cache speed   # この順で表示
/statusline reset                                  # 初期値に戻す
```

設定は `~/.pi/agent/pi-cc-statusline-settings.json` に、`5h` と `weekly` の値は `~/.pi/agent/pi-cc-statusline-cache.json` にプロバイダーごとに保存します。

## その他

- 他の拡張が `setStatus` で出すステータスは 2 行目に表示する
- 他のパッケージ（better-claude-code-ui など）も `session_start` でフッターを設定するため、すべての `session_start` ハンドラーが終わった後にフッターを設定して上書きする
- pi-subagents の子プロセス（`PI_SUBAGENT_CHILD` / `PI_SUBAGENT_PARENT_SESSION`）では何もしない

## インストール

```bash
pi install git:github.com/uta-a/pi-cc-statusline
```

バージョンを固定する場合は `pi install git:github.com/uta-a/pi-cc-statusline@v0.2.1`。更新は `pi update --extensions`。

一度だけ試す場合は、clone して `pi -e ./extension/index.ts`。

## 開発

```bash
npm test          # node --test（Node 22.6+ の型ストリップで実行）
npm run preview   # サンプルを端末に描画
```
