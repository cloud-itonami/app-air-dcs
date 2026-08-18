# app-air-dcs

**air-dcs（airline departure control system）—— チェックイン・搭乗券・手荷物・
ロードシート・APIS・ターンアラウンドを扱う appview。** この repo が持つのは
**その公開面（appview）だけ**である。業務そのものは MCP router の先
（AgentGateway / pod 側 LangServer）にあり、ここには無い —— 薄い edge であって、
実装ではない。

`etzhayyim/root` の `60-apps/etzhayyim-project-air-dcs` からの抽出物で、
**2026-08-18 に appview を TypeScript/Svelte から ClojureScript へ移行した**
（[ADR-0001](docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn)）。
数字はすべて `scripts/verify-docs-claims.cljs` が tree から再計算して検査する。

## deploy されるものは、いま読んでいるソースである

```
src/air_dcs/route.cljc    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/air_dcs/view.cljc     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/air_dcs/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js            ← wrangler.jsonc の "main" が指すもの
```

移行前、`main` は `svelte/.svelte-kit/cloudflare/_worker.js` を指していた ——
**tree に無く、tree の何もそれをビルドしない**（実測: `.svelte-kit` / `_worker`
に一致する tracked file は **0 件**、ディレクトリも存在しない）。同時に、読み手が
開く `src/app.ts` は **tracked file のどれからも参照されていなかった**（実測:
`git grep 'app.ts'` の当たりは `README.md` 6 件と `docs/operator-quickstart.md`
5 件、つまり散文だけ。root の `package.json` の script は `tsc --noEmit` 1 本きり
で、root に `tsconfig.json` が無いので入力ゼロで終わる）。**「読めるアプリ」と
「deploy されるアプリ」が別で、しかも前者はどの bundle にも入っていなかった。**

いまは `main` が指す bundle が上のソースからコンパイルされたものなので、その形は
構造的に起こり得ない。検証器が **shadow の出力先と wrangler の `main` と export
の ns 名の 3 つが噛み合っていること**を検査し、噛み合わなくなれば落ちる。

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認。deploy された面が答えることを外から確かめられる |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `air-dcs.route/routes` で、ページもそこから描く。** 移行前の
ページは `routeCount: 0` / `routes: []` / `vars: []` を literal で持っており、
隣の `wrangler.jsonc` が route 2・var 8・capability 3 を宣言していることに
気づけないまま『No public route is declared next to this app surface.』と印字し、
自分のパスを抽出元モノレポの `60-apps/etzhayyim-project-air-dcs/…` と名乗って
いた。いまは route 表も env のキーも capability も渡す側が持ち、ページは描くだけ
なので、両者がずれる余地が無い。

`/xrpc/` の後ろは **1 セグメントに制限しない**。deploy されていた SvelteKit の
route は `[...path]`（rest parameter）だったので `/xrpc/a/b` は nsid `"a/b"` と
して上流へ渡っていた。移行はその意味論を変えていない —— 空（`/xrpc` と
`/xrpc/`）だけが 400 `Missing XRPC method` で、文言も SvelteKit 版のままである。
**絞るのは移行ではなく方針変更**なので、やるなら別の決定として記録する。

## いま在るもの — 25 ファイル

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/air_dcs/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/air_dcs/route_test.cljc`（7 tests / 37 assertions） |
| 検査スクリプト（nbb） | `scripts/{smoke-worker.cljs, verify-docs-claims.cljs}` |
| ビルド | `deps.edn` / `shadow-cljs.edn` / `.gitignore` |
| Worker 設定 | `wrangler.jsonc` |
| actor 記述子 | `kotodama.jsonld` |
| 参照実装（**移行対象外**） | `kotoba/`（TypeScript 5 本 + package/tsconfig、下記） |
| 由来・権利・識別 | `NOTICE` / `README.edn` / `migration.edn` / `MIGRATION-TODO.md` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/adr/0001-*.edn` |

**appview の TypeScript / Svelte / JavaScript は 5 本から 0 本、正本言語
（`.cljs`/`.cljc`）は 0 本から 4 本になった。** 移行前の 5 本は `src/app.ts` /
`svelte/src/routes/xrpc/[...path]/+server.ts` / `svelte/src/routes/+page.svelte` /
`svelte/svelte.config.js` / `svelte/vite.config.ts`。この 2 つの数は検証器の
claim なので、TS が戻れば落ちる —— 撤去した 9 パスに戻る場合
（`removed-by-migration-absent`）も、別名で入る場合
（`appview-ts-or-svelte-files`）も、別々の claim が捕まえる。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）
—— superproject の skill `kotoba-uiux` が定める新規 UI の base。色・寸法は
`--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも置かない。
app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**。

**この 100.00 が証明していないことを 2 つ測ってある。** (1) デザインシステムの
CSS を**一切入れずに**同じページを描いても **96.63 で min 95 を通る**
（`jp-go-dds.page` が `ext-css` を無条件に差し込むため）。(2) gate が赤くなる
こと自体は確かめた —— 描画済みページから viewport meta を 1 個消すと **88.76 /
exit 1**。**「95 を超えた」は「デザインシステムが入っている」の証明ではない。**
それを言うのは §「検証」の smoke（ビルド出力の中に `dads-table` を探す）の方で
ある。

## `kotoba/` は移していない（移行対象外）— 4 つ測ってからそう決めた

`kotoba/` は air-dcs の記録層の**参照実装スライス**で、`@etzhayyim/sdk` に依存する
TypeScript 5 本（`registry.ts` 23,507 バイトを含む）と 10 本のテストからなる。
**これは appview ではないので、この移行の対象ではない。** 拡張子が `.ts` である
ことは撤去の理由にならない —— 撤去の基準は「動かない経路か」であって「TypeScript
か」ではない（README の「持ち越さなかったもの」が使っているのと同じ基準）。
その基準を当てた結果:

| 測ったこと | 実測（2026-08-18） |
|---|---|
| deploy される bundle に入っているか | **入っていない**。`main` は `dist/worker.js`、それは `src/` からコンパイルされる。bundle 内に `kotoba/` の識別子は **0 件** |
| 移行が置き換えたコードから import されているか | **0 件**。撤去した `src/app.ts` / `svelte/**` の 3 本とも、`kotoba` からの import を 1 つも持たない。`wrangler.jsonc` も参照しない |
| 依存は解決するか | **する**。`@etzhayyim/sdk` / `sdk-mock` の git 依存は `git ls-remote` が HEAD を返す（GitHub 側で `kotoba-lang/sdk` / `sdk-mock` へリダイレクト） |
| repo に占める大きさ | **51,399 / 161,296 バイト = 31.9%**、7 ファイル |

**動かない経路ではない。ただ appview ではないだけである。**「テンプレートが
『TypeScript は全部消す』と書いていたから」で repo の 3 割を消すのは移行ではなく
破壊なので、**1 バイトも触っていない** —— 7 ファイルの sha256 と、`.ts` 5 本 /
総数 7 という 2 つの本数を検証器に固定した（黙って育つのも減るのも落ちる）。
同型の先例 `cloud-itonami/app-analytics` / `app-cowork` も同じ扱いにしている。

cljs へ移すのは**別の決定**で、`@etzhayyim/sdk` の型面に cljs の顔を用意する
ところから始まる。

移行前に測って記録された、**`kotoba/` にいまも在る欠陥**（移行はこれを直さない）:

- **2 つのテストが、名前の付いた安全性を測っていない。** `"seals passenger
  manifest via encryptedWrite, never plaintext"` の平文 assertion は
  `e.count("com.etzhayyim.apps.airDcs.flightDeparture")` を `0` と比べるが、
  `transmitApis` はそのコレクションに**どんな条件でも書かない**ので、旅券番号を
  平文で保存する版に書き換えても**通る**。`"enforces read-cap: a non-recipient
  DID cannot decrypt the checkin"` は 2 つ目の `MockEtzhayyim` を見ており、
  mock の store は instance 私有なので、**何も書いていない時**にも
  **outsider が正当な recipient である時**にも同じ `0` を返す。
- **`computeLoadSheet` は算術演算子を 1 つも含まない。** take-off weight 1 kg と
  zero-fuel weight 62,000 kg（燃料マイナス 62 トン）を受け取って
  `status: "computed"` を返す。`reconcileBaggage` も同型で、`totalBags: 142` の
  隣に `loadedCount: 999, offloadedCount: 999, missingCount: 999` を受け取って
  `status: "reconciled"` を返す。
- **4 つのメソッド語彙が食い違う。** `wrangler.jsonc` と `kotodama.jsonld` が 3、
  撤去した `src/app.ts` が 8、`kotoba` が 17。検証器は**前 2 者が一致すること
  だけ**を検査する（`capabilities-agree-across-config`）—— 移行はこの食い違いを
  直さないが、片方だけ動くのを見えるようにする。

これらは migration より前に測られた記録であり、**この移行では再実行していない**
（`kotoba/` の vitest は walk していない。docs/operator-quickstart.md §7）。

## 持ち越さなかったもの（黙って消していない）

移行前の `src/app.ts` にあって **どこにも deploy されていなかった**経路のうち、
次は**意図的に移していない**。

| 経路 | 移さなかった測定上の理由 |
|---|---|
| `/xrpc/<nsid>` → `dispatcher.etzhayyim.com` 中継 | 宛先が **NXDOMAIN**（1.1.1.1、2026-08-18）。かつ `DISPATCHER_URL` / `DISPATCHER_INTERNAL_SECRET` が `wrangler.jsonc` の vars 8 個に**無い** —— 移しても `x-internal-secret: ""` を送るだけの経路になる |
| `GET /_app/meta` | `/health` の別名。`/_app/` は SvelteKit の内部名前空間で残す理由が無い。移行後も 404（unit test と smoke の両方で固定） |
| NSID prefix の allowlist（`NSID_PREFIX` 検査） | **deploy されていた route はこれを持っていない**。足すのは移行ではなく新しい方針である。ページは宣言された 3 メソッドを「宣言」として表示し、「許可リスト」とは書かない |
| `/health` payload の `methods` 8 本と `bpmn:` パス | `methods` は `app.ts` 自身が routing に使っていない飾りだった。`bpmn` の値は抽出元モノレポのパスで、この repo では誰にとっても偽 |

**動かない経路を移植して「移行済み」と言わないため**である。必要になった時点で
`route.cljc` に足し、テストと binding を伴って戻す。

## 移行で意図的に変えたところ（挙動の差分）

`/xrpc` の中継そのもの（ヘッダの引き継ぎ、`host` を落とすこと、jsonrpc の封筒、
`result` / `structuredContent` の剥がし方、上流が ok でなければそのステータスで
素通しすること、payload に `error` があれば 502、`cache-control: no-store`）は
SvelteKit 版と同じである。違うのは次の 4 点だけ。

1. **`/health` を足した。** 上流も binding も要らないので「動かない経路」では
   なく、deploy された面が答えていることを外から確かめられるようになる。
2. **404 と、上流に到達できなかったときの応答を JSON にした。** SvelteKit は
   どちらも framework の HTML エラーページを返していた。`mcp.etzhayyim.com` は
   NXDOMAIN なので**中継の既定の結末は到達失敗**であり、それを 200 でも HTML
   でも隠さず `502 {"error":"MCP router unreachable"}` を返す。
3. **`x-etzhayyim-bff` の値を `sveltekit-edge-bff` → `cljs-worker` に変えた。**
   名乗りは事実なので嘘にしない。`APP_FRAMEWORK` も同時に `cljs-esm-worker` に
   してある。
4. **`wrangler.jsonc` から 3 つのブロックを外した。**
   - `assets`（`./svelte/.svelte-kit/cloudflare/client`）—— 指す先を作るものが消えた
   - `rules` の `CompiledWasm`（`**/*.wasm`）—— tree の `.wasm` は **0 件**（実測）
   - `compatibility_flags` の `nodejs_compat` / `nodejs_als` —— `adapter-cloudflare`
     の要件だった。外したうえで、**この bundle が node builtin に触らないこと**
     （`node:` / `AsyncLocalStorage` / `async_hooks` の出現が **0 件**）と
     **flag 無しの workerd で実際に答えること**を確かめてある（下記「検証」）。

`migration.edn` も意図的に変えた: `:identity :allowed-additions` に移行が足した
14 ファイルを加えた。**この README が自分で課した「ファイルを足したらそのリストに
足す」という規則**に従ったもので、検証器の `additions-match-allowed` が
**継承 20 ファイル以外の全部**がそのリストと一致することを機械で守る。

## 呼び先が 1 つも解決しない（移行では直らない）

| ホスト | 役割 | DNS（2026-08-18 実測、`@1.1.1.1`） |
|---|---|---|
| `air-dcs.etzhayyim.com` | 公開ホスト（wrangler の route） | **NXDOMAIN** |
| `a1rd3cs0.etzhayyim.com` | 同（nanoid 側） | **NXDOMAIN** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **NXDOMAIN** |
| `dispatcher.etzhayyim.com` | `app.ts` の中継先（持ち越さず） | **NXDOMAIN** |
| `etzhayyim.com` | apex | NOERROR（104.21.51.111 / 172.67.179.128） |

deploy 先も中継先も、いま存在しない。したがって `kotodama.jsonld` が宣言する
`did:web:air-dcs.etzhayyim.com` も解決しない（`did:web` は
`https://air-dcs.etzhayyim.com/.well-known/did.json` を要求する）。
`/xrpc/` は到達できなければ **502 を返す** —— 成功と同じ形で隠さない。

## 由来（custody）

`migration.edn` は出所を `etzhayyim/root@0c30514a` の tree `f489880e`（20 ファイル
/ 67,306 バイト）と宣言する。移行後の状態:

- 継承した 20 のうち **11 ファイル（55,370 バイト）は 1 バイトも変わっていない**
  （sha256 を検証器に固定）—— `MIGRATION-TODO.md` / `NOTICE` / `README.edn` /
  `kotodama.jsonld` / `kotoba/` の 7 本
- **9 ファイルは移行で撤去した**（`package.json` / `src/app.ts` / `svelte/` の 7 本）。
  検証器はその 9 パスを名指しで「不在であること」を検査する —— byte 合計は
  「TypeScript が消えた」と言えない
- **`wrangler.jsonc` は意図的に変更した**（`main` の付け替え + 上記 3 ブロックの
  撤去 + `APP_FRAMEWORK`）

## 残っている欠陥（移行では直っていない）

1. **ホストが 1 つも解決しない**（上表）。deploy するか retire するかは別の決定。
2. **`kotodama.jsonld` の `@context`（`https://etzhayyim.com/ns/kotodama/v1`）は
   404。** 文書は JSON-LD の形をしているだけで expand できない。
3. **`kotoba/` の 2 つの盲目のテストと、計算しない `computeLoadSheet`。**
   航空機出発管理にとって規制側の半分（この機体は合法に積まれているか、手荷物は
   全部数えられているか）が、まさに存在しない半分である。
4. **`MIGRATION-TODO.md` の Charter §2(a) codemod が未着手。** ただしその文書自身
   が記録した scan は、除去すべきパターンを**一つも検出していない**。
5. **`NOTICE` が参照する `CHARTER-RIDER.md` はこの repo に無い**（upstream 側）。

## 検証

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .       # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
2026-08-18 の実測では **25 claim すべて PASS**。

| 何を | どこで踏めるか | 2026-08-18 の実測 |
|---|---|---|
| テスト（ビルド不要） | quickstart §2 | 7 tests / 37 assertions、0 failures |
| ページの採点 | quickstart §3 | 100.00 / 100、gate 95 PASS |
| bundle のビルド | quickstart §4 | 55 files / 12 compiled / 0 warnings / 51.80s、254,640 バイト |
| **ビルド済み bundle を叩く** | quickstart §5 | 30 項目 PASS、exit 0 |
| **compat flag 無しの workerd** | quickstart §6 | `wrangler dev --local` で 200/200/400/204/404/502/404 |
| **各 gate を先に赤くする** | quickstart §9 | 15 mutation、それぞれ対応する検査だけが落ちた（外した 2 件も記録） |

下 2 つが「deploy される成果物」に触る唯一の検査である。**workerd が返した
ページは §3 で採点したページと sha256 が同一**（`f0a4013a…`、83,466 バイト）
なので、採点した artifact と出荷される artifact が同じものであることは名前では
なく hash で確かめてある。
