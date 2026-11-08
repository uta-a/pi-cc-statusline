# pi-cc-statusline

pi のフッターを、次の 1 行のステータスラインに置き換える pi 拡張です。

```
 Opus 5.5 medium · Context 95% left · 5h 81% left
```

すべての項目を出した場合

```
 Opus 5.5 medium · Context 95% left · 5h 81% left · Weekly 63% left · Cache 97% hit · 89 tok/s
```

## 項目

| 名前 | 表示 | 内容 |
|---|---|---|
| `model` | `Opus 5.5 medium` | モデル名と思考レベル。`Claude Opus 5.5 1M` は `Opus 5.5` のように縮める。思考に対応しないモデルでは思考レベルを出さない |
| `context` | `Context 95% left` | コンテキストの残り（`ctx.getContextUsage()`） |
| `5h` | `5h 81% left` | Claude のプランの 5 時間枠の残り |
| `weekly` | `Weekly 63% left` | Claude のプランの週間枠の残り |
| `cache` | `Cache 97% hit` | 今のブランチのキャッシュヒット率。`cacheRead ÷ (input + cacheRead + cacheWrite)` |
| `speed` | `89 tok/s` | 直近 5 応答の出力速度。出力トークンの合計 ÷ 所要時間（リクエスト開始〜応答終了）の合計 |

初期値は `model` `context` `5h` の 3 つです。

- `5h` と `weekly` は応答ヘッダー `anthropic-ratelimit-unified-{5h,7d}-utilization` / `-reset` から読む。組み込みの Anthropic プロバイダーと pi-claude-bridge のどちらもこのヘッダーを渡す
- 残量の項目は、残りが 20% 以下で theme の `warning`、10% 以下で `error` の色に変わる
- `5h` と `weekly` の値は最後に読んだものを保存し、次のセッションでは最初の応答を待たずに表示する。リセット時刻を過ぎた値は 100% として扱う
- 値がまだ分からない項目（Anthropic 以外のプロバイダーでの `5h` など）は表示しない
- `speed` の所要時間は最初のトークンまでの待ちを含むので、純粋な生成速度よりやや低めに出る。delta の届いた時刻で測らないのは、Claude Code が delta を最後にまとめて送ることがあり、数百 tok/s のような過大な値になるため

## 設定（/statusline）

`/statusline` を引数なしで実行すると、項目の表示と順番を選ぶ画面が開きます。

```
 Status line

 ❯ ☑ 1 model    モデルと思考レベル
   ☑ 2 context  コンテキスト残量
   ☑ 3 5h       5 時間枠の残量
   ☐   weekly   週間枠の残量
   ☐   cache    キャッシュヒット率
   ☐   speed    出力速度 (tok/s)

 Preview Opus 5.5 medium · Context 95% left · 5h 81% left
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
/statusline model context 5h weekly cache speed   # この順で表示
/statusline reset                                  # 初期値に戻す
```

設定は `~/.pi/agent/pi-cc-statusline-settings.json` に、`5h` と `weekly` の値は `~/.pi/agent/pi-cc-statusline-cache.json` に保存します。

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
