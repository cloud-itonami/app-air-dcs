# operator-quickstart — app-air-dcs

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 10 分
（`shadow-cljs` の初回ビルドを除く）。Cloudflare のアカウントは要らない
（§8 の deploy だけが要る）。

出力はすべて 2026-08-18 に実際に walk した結果である。**walk していない節は
walk していないと書いてある**（§7 の `kotoba/`）。

## §0 前提

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| nbb | `npx --yes nbb --version` | v1.4.208 |
| clojure / java | ビルド時のみ | — |
| wrangler | §6 のみ | 4.69.0 |

このワークスペースの west checkout では **remote は `origin` ではなく org 名**
（`cloud-itonami`）である。`git fetch origin` が失敗しても repo が壊れている
わけではない。`error: could not read IPC response` が付いてくるのは fsmonitor
デーモンの不調で、`-c core.fsmonitor=false` を付ければ消える。

## §1 書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-air-dcs.git
cd app-air-dcs
REPO=$PWD
npx --yes nbb scripts/verify-docs-claims.cljs .        # <dir> は先頭に置く
```

実際の出力（先頭と末尾）:

```
SCANNED	25
PASS	tracked-files	expected=25	actual=25
PASS	preserved-bytes	expected=55370	actual=55370
PASS	preserved-files-unchanged	expected=[]	actual=[]
PASS	removed-by-migration-absent	expected=[]	actual=[]
PASS	appview-ts-or-svelte-files	expected=0	actual=0
PASS	kotoba-ts-files	expected=5	actual=5
PASS	canonical-source-files	expected=4	actual=4
...
PASS	warnings-are-errors	expected=true	actual=true
PASS	warnings-as-errors-not-misplaced	expected=true	actual=true
PASS	capabilities-agree-across-config	expected=true	actual=true
PASS	page-renders-the-data	expected=true	actual=true
OK	every claim in README.md and docs/operator-quickstart.md holds
```

**25 claim / exit 0。** exit 1 = 食い違い、**exit 2 = 判定できなかった**
（tree を読み切れなかったという別の答えで、「検査して問題なし」と混ぜない）。

この検査には移行の不変条件が入っている: appview の TypeScript と Svelte が
戻っていないこと（撤去した 9 パスの不在 + `.ts`/`.svelte`/`.js` の総数 +
appview 用 node ビルド設定の不在）、`wrangler.jsonc` の `main` が shadow の
出力先を指していること、`assets` / `rules` / `compatibility_flags` の残骸が
戻っていないこと、**`:warnings-as-errors` が `:compiler-options` に在ること**、
そしてページが route 表と `APP_CAPABILITIES` から描かれていること。

### custody は「継承 20 以外は全部 migration.edn が名指ししている」で閉じる

`migration.edn` は出所を `etzhayyim/root@0c30514a` の tree `f489880e`
（20 ファイル / 67,306 バイト）と宣言する。移行後、その 20 は
**11 が無改変**（sha256 固定）・**9 が撤去**・**1（`wrangler.jsonc`）が意図的に
変更**に分かれた。それ以外の 14 ファイルは `:allowed-additions` が名指ししており、
`additions-match-allowed` claim が**集合として一致すること**を検査する。

**この claim は最初に自分の誤りを捕まえた。** `README.edn` を「継承」の側に
数えて書いたところ、期待と実際が 1 件ずれて落ちた —— 元の `migration.edn` が
`README.edn` を addition と宣言していたからで、20 という数はそれで初めて合う。

## §2 テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので nbb だけで回る。

**ライブラリは `deps.edn` が pin している sha で走らせる。** この workstation の
共有 west checkout は `jp-go-digital-design-system` を `0a02180`（2026-08-12）で
持っており、pin の `2e2d191`（2026-08-17）より 5 日古い。そのまま classpath に
載せると**テストする source と bundle に入る source が別のライブラリ**になる。
pin した sha は clojure が `~/.gitlibs` に展開済みなのでそこを使う。

```bash
G=~/.gitlibs/libs/io.github.kotoba-lang
DDS=$G/jp-go-digital-design-system/2e2d191e9e1731ce6865c79dab163a5d74249053
HTML=$G/html/aa57f2730c87b7c2752151ed1a5f2e402c2ac71e
CSS=$G/css/6eda5ee28ec177b9e09fdbee92c55a050b18cf7d
CP="src:test:$DDS/src:$DDS/resources:$HTML/src:$CSS/src"

cat > /tmp/dcs-run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'air-dcs.route-test)
(run-tests 'air-dcs.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/dcs-run.cljs
```

実際の出力:

```
Testing air-dcs.route-test

Ran 7 tests containing 37 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` の後ろは **1 セグメントに制限しない**（deploy されて
いた `[...path]` と同じ意味論。空だけが 400 `Missing XRPC method`）、prefix の外の
NSID も中継する（撤去した `src/app.ts` の allowlist は持ち越していない）、
`/_app/meta` は 404、MCP router の URL 解決（空白だけの設定は未設定として扱う）、
`result` / `structuredContent` の剥がし方（空 body は `{}`）、`APP_CAPABILITIES`
の名前 → 完全修飾 NSID、そして**ページが渡された値から描かれること**
（route 表を差し替えれば表示も変わる。固定値を焼いていたら落ちる）。

## §3 ページを描画して採点する

```bash
CP="src:$DDS/src:$DDS/resources:$HTML/src:$CSS/src"
cat > /tmp/dcs-render.cljs <<'EOF'
(require '["node:fs" :as fs] '[air-dcs.view :as view] '[air-dcs.route :as route])
(def dds-css (first (remove #(clojure.string/starts-with? % "--") *command-line-args*)))
(def out (second (remove #(clojure.string/starts-with? % "--") *command-line-args*)))
(let [css (.readFileSync fs dds-css "utf8")]
  (.writeFileSync fs out
    (view/render {:css css :routes route/routes
                  :methods (route/capability-nsids
                             ["processCheckIn" "processBoardingPass" "acceptBaggage"])
                  :vars [:AGENTGATEWAY_MCP_ROUTER_URL :APP_CAPABILITIES :APP_DESCRIPTION
                         :APP_DISPLAY_NAME :APP_FRAMEWORK :APP_NANOID
                         :APP_PERFORMER_TYPE :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
                  :actor route/actor-did}))
  (println "wrote" (.-size (.statSync fs out)) "bytes to" out))
EOF
npx --yes nbb --classpath "$CP" /tmp/dcs-render.cljs "$DDS/resources/jp_go_dds/dds.css" /tmp/dcs-page.html

K=~/github/com-junkawasaki/orgs/kotoba-lang
cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/dcs-page.html --min 95
```

実際の出力:

```
wrote 83466 bytes to /tmp/dcs-page.html

design-quality audit — 1 page(s)
  100.00  /tmp/dcs-page.html
aggregate: 100.00
findings (headroom-first):
  (none — converged)
gate: aggregate 100.00 >= min 95.00 -> PASS      (exit 0)
```

### この 100.00 が証明していないこと（2 つとも測った）

| やったこと | 点 | gate |
|---|---|---|
| そのまま | 100.00 | PASS (exit 0) |
| **デザインシステムの CSS を一切入れずに描く**（`:css ""`） | **96.63** | **PASS (exit 0)** |
| 描画済みページから `<meta name=viewport>` を 1 個消す | 88.76 | FAIL (exit 1) |

真ん中の行が要点である。`jp-go-dds.page` が `ext-css` を無条件に差し込むので、
デザインシステムが 1 バイトも入っていなくても min 95 を通る。
**「95 を超えた」は「デザインシステムが入っている」の証明ではない。** それを
言うのは §5 の smoke（ビルド出力の中に `dads-table` を探す）の方である。
3 行目は「この gate が赤くなること自体はある」ことの確認。

## §4 bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
ls -la dist/worker.js && shasum -a 256 dist/worker.js
```

lock を他セッションが持っていると **exit 2** で拒否される。**迂回しない** ——
これはエラーではなく順番待ちである（この walk では 1 回だけ 45 秒待った）。

実際の出力（末尾）:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 51.80s)
-rw-r--r--  254640  dist/worker.js
b8d8ae3a26ba08b4e1774e6498a4ccbb648128c816d4a7e40b8f68afd819279b  dist/worker.js
```

### 「ビルドが通った」を検査にする（2026-08-18 実測）

`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` を入れた。
入れる前は、存在しない var を参照しても shadow は **WARNING** を出して **exit 0**
し、最初のリクエストで落ちる bundle を書いていた —— **落ちようがない検査**だった。

この repo で 2 通り実際に走らせた。`src/air_dcs/worker.cljs:150` の
`route/dispatch` を、存在しない `route/dispatch-nonexistent` に改名する:

| `:warnings-as-errors` の置き場所 | build exit | 出力 | `dist/worker.js` |
|---|---|---|---|
| **`:compiler-options`**（正しい） | **1** | `ERROR … Use of undeclared Var air-dcs.route/dispatch-nonexistent`, `:shadow.build.compiler/warning-as-error true` | **b8d8ae3a…（1 バイトも動かない）** |
| `:build-options`（間違い） | **0** | `Build completed. (55 files, 1 compiled, 1 warnings, 18.74s)` | **0c5ee8ed…（新しい壊れた bundle を書く）** |

2 行目の bundle を §5 の smoke に食わせると:

```
UNDETERMINED	could not exercise the bundle: Cannot read properties of undefined (reading 'h')
(exit 2)
```

**緑のビルドが、最初のリクエストで落ちる bundle を出荷していた。** キーを
`:build-options` に置くと shadow は**黙って無視する**（読むのは
`[:compiler-options :warnings-as-errors]`）ので、置き場所を間違えた「修正」は
この option が防ぐはずの失敗そのものになる。だから
`scripts/verify-docs-claims.cljs` は置き場所を **EDN として読んで**確かめる ——
grep では駄目である（`shadow-cljs.edn` のコメント自身が両方の語を含むので、
部分文字列の検査は間違った置き場所でも通ってしまう）。

## §5 ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。§2 のテストは判断を固定するが、
**export の形・`:advanced-optimization`・`shadow.resource/inline` で焼いた CSS・
`APP_CAPABILITIES` の JSON decode** は、ビルドを通って初めて存在する。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

実際の出力（30 行すべて PASS、抜粋）:

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	GET / is html	expected=true	actual=true
PASS	page advertises /health	expected=true	actual=true
PASS	page advertises /xrpc/:nsid	expected=true	actual=true
PASS	page advertises processCheckIn	expected=true	actual=true
PASS	page advertises processBoardingPass	expected=true	actual=true
PASS	page advertises acceptBaggage	expected=true	actual=true
PASS	page shows a var key	expected=true	actual=true
PASS	page hides the hidden env value	expected=false	actual=false
PASS	page shows the env value it is supposed to show	expected=true	actual=true
PASS	page carries the design system	expected=true	actual=true
PASS	GET /health status	expected=200	actual=200
PASS	health names its routes / methods / actor	expected=true	actual=true
PASS	health does not leak env values	expected=false	actual=false
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	POST /xrpc/ reason	expected=true	actual=true
PASS	POST /xrpc/a/b is not rejected	expected=false	actual=false
PASS	POST /xrpc/a/b is treated exactly like a single segment	expected=502	actual=502
PASS	an unreachable router is not hidden behind a 200	expected=502	actual=502
PASS	the 502 names the router it could not reach	expected=true	actual=true
PASS	OPTIONS preflight	expected=204	actual=204
PASS	OPTIONS advertises methods	expected="POST,OPTIONS"	actual="POST,OPTIONS"
PASS	unknown path	expected=404	actual=404
PASS	/_app/meta was not carried over	expected=404	actual=404
PASS	wrong method on /health	expected=405	actual=405
PASS	wrong method on /xrpc	expected=405	actual=405
PASS	405 names the allowed methods	expected="POST, OPTIONS"	actual="POST, OPTIONS"
OK	30 checks — the built bundle answers as the route table says      (exit 0)
```

**bundle が無ければ exit 2**（「判定できなかった」であって合格ではない）。
実行本数の床も置いてある（25 本を下回ったら合格と言わずに 2 で終わる）。

### 印を 2 つ使う理由

値の露出を「出てはいけない 1 個」だけで測ると、**「何も描かない」実装でも通る**。
逆に「出なければいけない 1 個」だけだと「全部出す」実装が通る。だから env の値を
2 つ渡す —— `APP_UI_TYPE` に **出てはいけない印**、
`AGENTGATEWAY_MCP_ROUTER_URL` に **出なければいけない印**。

実在しそうな値（`"yoro"` 等）を印にしない: 他の文言と偶然一致しうるうえ、引用符
ごと探すと renderer が `"` を `&quot;` に escape するので**決して一致しない** =
構造的に落ちない検査になる（同型の移行 `app-ongakuka` で実測された罠）。

### 多段パスの検査は DNS に寄りかからない

router の URL に **`.invalid`**（RFC 2606 で決して解決しない TLD）を使い、
`/xrpc/a/b` と `/xrpc/com.etzhayyim.apps.airDcs.processCheckIn` を**同じ扱いか**で
比べる。検査したいのは「多段が単一セグメントと同じか」であって上流の生死では
ないので、`mcp.etzhayyim.com` が今日 NXDOMAIN であることに寄りかからせない。

## §6 compat flag を外したので、workerd で実際に動くことを確かめる

`compatibility_flags` の `nodejs_compat` / `nodejs_als` は `adapter-cloudflare` の
要件だったので外した。**外したなら、外した状態で動くことを見る。**

```bash
cd "$REPO"
npx --yes wrangler dev --local --port 8801 --ip 127.0.0.1
# 別の端末で
curl -s -o /tmp/p.html -w 'status=%{http_code} ct=%{content_type} bytes=%{size_download}\n' http://127.0.0.1:8801/
curl -s http://127.0.0.1:8801/health
curl -s -X POST -w '\nstatus=%{http_code}\n' http://127.0.0.1:8801/xrpc/
curl -s -X OPTIONS -D - -o /dev/null http://127.0.0.1:8801/xrpc/x
curl -s -X POST -w '\nstatus=%{http_code}\n' http://127.0.0.1:8801/xrpc/a/b
curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:8801/_app/meta
```

実際の出力（wrangler 4.69.0、`compatibility_date` 2025-03-17、**flag なし**）:

```
[wrangler:info] Ready on http://127.0.0.1:8801
status=200 ct=text/html; charset=utf-8 bytes=83466
{"ok":true,"app":"air-dcs","runtime":"cljs","actor":"did:web:air-dcs.etzhayyim.com",
 "nanoid":"a1rd3cs0","routes":["/","/health","/xrpc/:nsid"],
 "methods":["com.etzhayyim.apps.airDcs.processCheckIn",
            "com.etzhayyim.apps.airDcs.processBoardingPass",
            "com.etzhayyim.apps.airDcs.acceptBaggage"]}
{"error":"Missing XRPC method"}                                          status=400
HTTP/1.1 204 No Content / access-control-allow-methods: POST,OPTIONS
{"error":"MCP router unreachable","detail":"internal error; reference = …",
 "url":"https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}       status=502
status=404                                                              (/_app/meta)
{"error":"Not Found","routes":["GET /","GET /health","POST /xrpc/:nsid"]} status=404
```

ビルド済み bundle に `node:` / `AsyncLocalStorage` / `async_hooks` の出現は
**それぞれ 0 件**（`grep -c` 実測）。workerd の log の ERROR 行は **1 行だけ**で、
それは NXDOMAIN な router への外向き fetch（`POST /xrpc/a/b` の直前に出て、直後の
行が `POST /xrpc/a/b 502 Bad Gateway`）—— handler が捕まえて 502 にしている。
**bundle 由来の runtime エラーは 0 件。**

**workerd が返したページは §3 で採点したものと byte 単位で同一**である
（sha256 `f0a4013a9655e1b245607d51a421d9eed98efb4261bc6a9765bf87595a657bf6`、
83,466 バイト）。採点した artifact と deploy される artifact が同じものであること
を、名前ではなく hash で確かめてある。そのページに `yoro`（`APP_UI_TYPE` の**値**）
は **0 回**出る。

## §7 `kotoba/` — この walk では走らせていない

`kotoba/`（TypeScript 5 本 + 10 テスト、`@etzhayyim/sdk` 依存）は**移行対象外**
で、1 バイトも触っていない —— bundle に入っておらず、移行が置き換えたコードから
import されておらず、しかし依存は解決し tree の 31.9% を占める（README の表）。
「deploy されていない」だけでは撤去の理由にならない。`vitest` は**この walk では回していない**ので、
ここに出力は載せない。移行前の audit が記録した所見（2 つの盲目のテスト、算術を
1 つも持たない `computeLoadSheet`）は README の該当節にあり、それは**当時の測定
であってこの walk の測定ではない**。

走らせたいなら:

```bash
cd "$REPO/kotoba" && npm install && npx vitest run
```

`@etzhayyim/sdk` / `sdk-mock` の git 依存は生きている（`git ls-remote` が HEAD を
返す。GitHub 側で `kotoba-lang/sdk` / `kotoba-lang/sdk-mock` へリダイレクトされる）。

## §8 deploy

```bash
cd "$REPO" && npx wrangler deploy
```

**この walk では deploy していない。** そして route が指すホストは解決しない。

```bash
for h in air-dcs.etzhayyim.com a1rd3cs0.etzhayyim.com mcp.etzhayyim.com \
         dispatcher.etzhayyim.com etzhayyim.com; do
  dig "$h" @1.1.1.1 | grep -o 'status: [A-Z]*' | head -1
done
```

実測（2026-08-18T11:06Z）: 上 4 つが **NXDOMAIN**、apex `etzhayyim.com` だけが
NOERROR（104.21.51.111 / 172.67.179.128）。deploy が成功しても誰も到達できず、
到達できたとしても `/xrpc/` の中継は **502** を返す（成功と同じ形で隠さない）。

superproject の deploy guard は `origin/main` を含む checkout からの deploy しか
許さない点も併せて注意。

## §9 gate を先に赤くする

**緑を受け取る前に、その検査が赤くなるところを見る。** 9 つやった。

| # | 壊したもの | 落ちた検査 | 落ち方 |
|---|---|---|---|
| 1 | `:warnings-as-errors` を `:build-options` へ移す | 検証器 | `warnings-are-errors` / `warnings-as-errors-not-misplaced` の 2 件だけ、exit 1 |
| 2 | `src/air_dcs/leftover.ts` を足す | 検証器 | `tracked-files` / `appview-ts-or-svelte-files` / `additions-match-allowed` の 3 件、exit 1 |
| 3 | `kotoba/src/types.ts` に 1 行足す | 検証器 | `preserved-bytes` / `preserved-files-unchanged` の 2 件、exit 1 |
| 4 | `wrangler` の `main` を SvelteKit の出力に戻す | 検証器 | `wrangler-main` / `shadow-builds-that-main` の 2 件、exit 1 |
| 5 | ページが固定の route 表を描くようにする | 検証器 / テスト | `page-renders-the-data` 1 件 / テスト 3 assertion（`page-shows-the-real-data` 2 + `page-does-not-bake-a-count` 1） |
| 6 | 空のディレクトリに向ける | 検証器 | `SCANNED 0` → **exit 2**（0 とも 1 とも別） |
| 7 | `/xrpc/a/b` を 400 に絞る | テスト | `dispatch-xrpc` 1 assertion |
| 8 | `kotoba/stray.json` を足す | 検証器 | `tracked-files` / `kotoba-files` / `additions-match-allowed` の 3 件、exit 1 |
| 9 | `kotoba/src/types.ts` を消す | 検証器 | `tracked-files` / `preserved-bytes` / `preserved-files-unchanged` / `kotoba-ts-files` / `kotoba-files` の 5 件、exit 1 |

smoke（ビルド済み bundle）にも 4 つ:

| # | 壊したもの | 落ちた検査 |
|---|---|---|
| 10 | `dist/worker.js` を退かす | **exit 2** `UNDETERMINED no bundle at …` |
| 11 | bundle の中の `"/xrpc/:nsid"` を書き換える | `page advertises /xrpc/:nsid` / `health names its routes` の 2 件 |
| 12 | bundle の中の `AGENTGATEWAY_MCP_ROUTER_URL` を別名にする | `page shows the env value it is supposed to show` / `the 502 names the router it could not reach` の 2 件（**出るべき方の印**） |
| 13 | worker が env の **値**をページに渡すようにして再ビルド | `page hides the hidden env value` の **1 件だけ**（**出てはいけない方の印**） |

そしてビルド gate に 2 つ（§4 の表）。

### 外した mutation を「実演」に数えない

2 回、当てそこねた。どちらも**緑が返ってきたことを実演にしなかった**。

1. `/xrpc/a/b` を 400 に絞るつもりの patch が、アンカー文字列の括弧の数を間違えて
   **1 バイトも書き換えていなかった**。テストは 7/37 で緑のまま。以後、patch に
   `assert old in s` を付けて、当たらなければ patch 自体が落ちるようにした。
2. env の値を漏らすつもりの patch が、view と worker の両方を変えて**描画ごと
   壊した**。smoke は `UNDETERMINED could not exercise the bundle:
   Doesn't support name: [object Object]`（exit 2）を返した —— これは
   「印の検査が discriminate する」の証明ではなく「壊れた bundle は叩けない」の
   証明でしかない。worker の 1 行だけを変える形に直したら、狙った 1 件だけが
   落ちた（上の表 #13）。

**壊したものと報告されたものが一致することを確かめる。**

### 元に戻ったことを hash で確かめる

全部戻して再ビルドしたら、`dist/worker.js` の sha256 は
`b8d8ae3a26ba08b4e1774e6498a4ccbb648128c816d4a7e40b8f68afd819279b` ——
**mutation を当てる前と 1 バイトも違わない。**

## §10 ここに無いもの

- `dispatcher.etzhayyim.com` への中継 / `/_app/meta` / NSID prefix の allowlist ——
  移行前の `src/app.ts` にあり、**どこにも deploy されていなかった**経路。宛先が
  NXDOMAIN、または binding が `wrangler.jsonc` に無いので**持ち越していない**
  （README の「持ち越さなかったもの」）
- 業務そのもの（MCP router の先の AgentGateway / pod 側 LangServer にある）
- `kotoba/` の cljs 化（§7。別の決定が要る）
- `MIGRATION-TODO.md` の Charter §2(a) codemod
