# pi-cc-statusline

pi のフッターを、次の 1 行のステータスラインに置き換える pi 拡張です。

```
 Opus 5.5 medium · Context 95% left · 5h 81% left
```

- **モデル名と思考レベル**（灰色）: `Claude Opus 5.5 1M` は `Opus 5.5` のように縮めて表示する。思考に対応しないモデルでは思考レベルを出さない
- **Context N% left**（青緑 `#83beb2`）: `ctx.getContextUsage()` から計算した、コンテキストの残り
- **5h N% left**（薄紫 `#bc99d4`）: Claude のプランの 5 時間枠の残り。応答ヘッダー `anthropic-ratelimit-unified-5h-utilization` / `-reset` から読む。組み込みの Anthropic プロバイダーと pi-claude-bridge のどちらもこのヘッダーを渡す
- 残りが 20% 以下になると theme の `warning`、10% 以下で `error` の色に変わる
- 5h の値は最後に読んだものを `~/.pi/agent/pi-cc-statusline.json` に保存し、次のセッションでは最初の応答を待たずに表示する。リセット時刻を過ぎた値は 100% として扱う
- 値がまだ分からない項目（Anthropic 以外のプロバイダーでの 5h、コンパクション直後のコンテキストなど）は表示しない
- 他の拡張が `setStatus` で出すステータスは 2 行目に表示する
- 他のパッケージ（better-claude-code-ui など）も `session_start` でフッターを設定するため、すべての `session_start` ハンドラーが終わった後にフッターを設定して上書きする
- pi-subagents の子プロセス（`PI_SUBAGENT_CHILD` / `PI_SUBAGENT_PARENT_SESSION`）では何もしない

## インストール

```bash
pi install git:github.com/uta-a/pi-cc-statusline
```

バージョンを固定する場合は `pi install git:github.com/uta-a/pi-cc-statusline@v0.1.0`。更新は `pi update --extensions`。

一度だけ試す場合は、clone して `pi -e ./extension/index.ts`。

## 開発

```bash
npm test          # node --test（Node 22.6+ の型ストリップで実行）
npm run preview   # サンプルを端末に描画
```
