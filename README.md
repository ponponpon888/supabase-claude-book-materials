# Supabase × Claude Code 本番運用の教科書 — 読者向け教材

無料β版・全9章の学習用教材です。本は https://zenn.dev/shingokumon/books/supabase-claude-prod-review で公開します。

## ダウンロード

[教材一式をZIPでダウンロード](https://github.com/ponponpon888/supabase-claude-book-materials/archive/refs/heads/main.zip)し、任意の場所へ展開してください。実行するフォルダーは、展開先の `package.json` がある場所です。

## できること

- `books/`：第0〜8章の本文。教材内のプレビュー設定は未公開です。
- `WORKBOOK.md`：演習の記入シート、到達点の自己確認、用語表。
- `review-rls.mjs`：第3章のSQLを直接読み込む、DB単体38項目の試験。
- `sql/book_tasks.sql`：第3章から書き出した教材SQL。
- `articles/`：RLSの試験を考える入口記事。
- `evidence/`：実行環境と検証範囲を記録したJSON。

## Windows PowerShellでDB単体試験を動かす

Node.js 24系とnpmが必要です。PowerShellを `package.json` があるフォルダーで開き、次の操作を一つずつ実行します。

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
```

```powershell
npm.cmd run check:db
```

成功の目印は終了コード0と、JSON内の `total: 38`、`passed: 38`、`failed: 0` です。macOS／Linuxでは `npm.cmd` を `npm` に読み替えます。初回の依存パッケージ取得にはネットワークを使います。

## 本文のプレビュー

```powershell
npm.cmd run preview
```

表示されたローカルURLをブラウザーで開きます。構造・HTMLを検査する場合は `npm.cmd run check:preview` を実行します。停止は Ctrl+C です。

## 確認した範囲と限界

2026年11月4日、Windows 11／PowerShell 5.1／Node.js 24.13.0で、依存パッケージのインストール、DB単体38項目、無料9章・記事1本のZenn構造・HTML確認が成功しました。LinuxでもNode.js 24.22.1、PGlite 0.5.14、PostgreSQL 18.6を使って確認しています。

DB単体試験の `auth.users` と `auth.uid()` は試験用の代用品です。実際のSupabase Auth、JWT署名、HTTP、Claude Codeの実機操作、実際の変更・復旧を検証したものではありません。Supabaseの契約やクラウドプロジェクト、APIキーは、このDB単体試験には不要です。

SQLは新規の使い捨て検証環境を想定しています。試験用authスキーマやロールの定義を、業務用Supabaseへコピーしないでください。

## この教材の対象

ログインと基本CRUDを実装したことがあり、SQL・Git・HTTPの基礎を知っている方を想定しています。完成アプリ一式やログイン画面の構築手順は収録していません。第9〜14章の発展編は含みません。

学習中に気づいた誤記や再現できない手順は、秘密値を含めず、このリポジトリのIssuesへ報告できます。
