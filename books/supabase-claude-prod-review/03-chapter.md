---
title: "第3章 権限表からRLSを設計する"
free: true
---

AとBは、どちらもログイン済みです。それでも、Aには見せてよいメモをBには見せられません。この違いを、画面の表示条件だけに頼らず、データベースが判断できる形にします。

**この章の到達点：** 誰が・どの行の・どの列を扱うかを、GRANTとRLSへ対応させられる。

## 「ログイン済み」より細かく決める

対応メモでは、ログイン済みのAがBのメモを読めてはいけません。認証は誰が操作しているかを確認すること、認可はその人が何をしてよいかを決めることです。

まず、次の表を作ります。教材では匿名サインインを使わず、通常のテストアカウントAとBを使います。Supabase Authの匿名サインインも`authenticated`ロールになるため、`anon`ロールとは区別が必要です。[公式資料](https://supabase.com/docs/guides/database/postgres/row-level-security)

| 操作者と対象 | 読む | 作る | 更新 | 削除 |
| --- | --- | --- | --- | --- |
| 未ログイン | 不可 | 不可 | 不可 | 不可 |
| AがAのメモを操作 | 可 | 可 | 可 | 可 |
| AがBのメモを操作 | 不可 | 不可 | 不可 | 不可 |
| BがBのメモを操作 | 可 | 可 | 可 | 可 |

## GRANTとRLSを一緒に設計する

GRANTは、そのロールがテーブルで操作を行えるかを決めます。RLSは、許された操作をどの行に対して行えるかを絞ります。両方が必要です。[公式資料](https://supabase.com/docs/guides/database/postgres/row-level-security)

Supabaseは、新しく作るテーブルのData APIへの公開について、明示的なGRANTを必要とする変更を案内しています。2026年10月30日から既存プロジェクトにも適用するという告知で、既存テーブルのGRANTは維持されると説明しています。各プロジェクトの実際の状態は確認が必要です。[公式資料](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

「以前はテーブルを作るだけで使えた」という経験に頼らず、GRANT、RLS、ポリシーを同じ変更として管理します。アクセスできないときに、最初からRLSを無効にして原因を探すのは避けましょう。

## 所有者モデルの教材SQL

以下は、新規の使い捨て検証環境に作る`book_tasks`の例です。既存の業務テーブルへ実行するためのSQLではありません。Supabase Authがあり、AとBの通常アカウントを用意できる環境を前提にしています。このSQLと権限の振る舞いは、一時的なPostgreSQL環境で38項目を確認済みです。Supabaseへの接続試験とは区別してください。具体的な検証範囲と再実行手順は第4章に記載します。

## SQLを試す前の準備

実際のSupabaseで試す場合は、次の準備を行います。この接続手順は今回未実測です。サービスの画面名は変わり得るため、現行の公式資料と照合してください。

1. 自分が管理し、業務データのない専用の検証プロジェクトを選ぶ。課金や新規作成が必要な場合は、利用するプランを確認する。
2. Supabase Authに通常のテストユーザーAとBを用意する。自分が受信を管理する検証用アドレスを使い、メール認証が必要なら完了させる。匿名サインインはこの教材では使わない。
3. AとBのユーザーIDを控える。キー、パスワード、アクセストークンは記録表へ載せない。
4. `public.book_tasks`がまだ存在しないこと、Data APIで`public`が対象スキーマになっていることを確認する。
5. 下のSQLを検証用SQLエディターで一度だけ適用する。既にmigration管理している教材環境では、使用中CLIのヘルプを確認してmigrationファイルに入れる。
6. 実際のアクセス試験は、publishable keyと各ユーザーの正しいセッションを使う。SQLエディターの管理権限のままで取得できても、RLS試験の合格にはしない。

SQLは新規作成用です。再実行時の「既に存在する」というエラーを隠すために、`IF NOT EXISTS`を足したり既存テーブルを削除したりしないでください。既存状態と教材の定義を照合してから、別の分離環境でやり直します。

```sql
begin;

create table public.book_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  summary text not null check (char_length(summary) between 1 and 500),
  status text not null default 'open'
    check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

create index book_tasks_owner_idx on public.book_tasks (owner_id);

alter table public.book_tasks enable row level security;
revoke all on table public.book_tasks from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, delete on table public.book_tasks to authenticated;
grant insert (owner_id, summary, status)
  on table public.book_tasks to authenticated;
grant update (summary, status)
  on table public.book_tasks to authenticated;

create policy book_tasks_read_own
  on public.book_tasks for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy book_tasks_create_own
  on public.book_tasks for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy book_tasks_update_own
  on public.book_tasks for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy book_tasks_delete_own
  on public.book_tasks for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;
```

UPDATEの`USING`は更新対象の行、`WITH CHECK`は更新後の行について条件を表します。ここでは両方を明記しています。さらに列のGRANTで更新を`summary`と`status`に限定しているため、所有者の書き換えは通常その前段の列権限で拒否されます。将来`owner_id`の更新権限を広げても、更新後の所有者をRLSで検査する意図を残しています。PostgreSQLでは`WITH CHECK`を省略した場合に`USING`の条件が使われる場合があるため、「省略すると必ず所有者を書き換えられる」という説明は正確ではありません。[公式資料](https://www.postgresql.org/docs/18/sql-createpolicy.html)

更新には対応するSELECTポリシーも必要です。また、この例の`owner_id`は「作成した本人」を表します。店舗の全スタッフで共有するメモへ、そのまま流用しないでください。共有には所属情報と、その所属を誰が変更できるかの設計が必要です。

本書のSQLでは、利用者が挿入できる列を`owner_id`・`summary`・`status`、更新できる列を`summary`・`status`に絞っています。`id`と`created_at`はDBの既定値で設定します。削除履歴や保持期間はまだ含めていません。`owner_id`には外部キーがあるため、参照するメモが残っているユーザーの削除は制約で止まります。退会処理には、保持・匿名化・削除の方針を別途設計してください。

## 別の経路も確認する

同じ操作に適用される通常の許可ポリシーが複数ある場合、条件がORで組み合わされます。本人限定のポリシーがあっても、別に全行を許可するポリシーを追加すれば、見える範囲が広がります。既存ポリシー全体を確認してください。[公式資料](https://www.postgresql.org/docs/18/sql-createpolicy.html)

元のテーブルにRLSがあっても、特権を使うサーバーAPI、ビュー、関数の設定によって、異なる権限でデータを取得する経路ができます。ビューを追加したときは、所有者と呼び出し側のどちらの権限で評価するかも確認します。PostgreSQL 15以降の`security_invoker`は、その確認対象の一つです。[公式資料](https://supabase.com/docs/guides/database/postgres/row-level-security)

## SQLを、三つの問いに分けて読む

初見でSQL全体を覚える必要はありません。次の対応をたどってください。

| 問い | この教材の答え | SQLで確認する場所 |
| --- | --- | --- |
| 操作してよいのは誰か | 通常のログインユーザー | `authenticated`へのGRANTとポリシーの`TO` |
| どの行を扱えるか | `owner_id`が本人のIDである行 | `auth.uid()`と`owner_id`の比較 |
| 何を書き換えられるか | 本文と状態だけ | `grant update (summary, status)` |

RLSの条件で行を絞り、列のGRANTで更新できる項目を絞ります。この教材では両方を使い、所有者、ID、作成日時の変更を許さない設計にしています。[公式資料](https://www.postgresql.org/docs/18/sql-grant.html)

たとえばAが自分のメモの本文を更新するときは、更新対象の列が許可され、その行の所有者がAであることが必要です。Bが同じIDを指定しても、Bに見せる行の条件には一致しません。第4章では、Aの更新が反映されることと、Bの更新では行が変わらないことを対にして観測します。

**章末の作業：** 自分のアプリのテーブルを一つ選び、誰が・誰の行を・どの操作で扱えるかを書き、その表とポリシーを照合する。

## 演習：共有へ変えるなら、何が足りないか

同じ店舗のAとBがメモを共有したくなりました。`owner_id = auth.uid()`を残したまま画面だけ共有表示にすればよいでしょうか。

:::details 解答例と判断の理由
この条件は本人の行だけを許すため、共有の業務ルールを表していません。店舗と所属の関係、操作ごとの役割、所属を変更できる人を先に定義します。単に全ログインユーザーを許可すると、別店舗にも範囲が広がり得ます。SQLの変更前に、新しい権限表と店舗をまたぐ拒否試験が必要です。
:::
