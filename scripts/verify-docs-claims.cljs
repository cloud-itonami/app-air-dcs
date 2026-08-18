#!/usr/bin/env nbb
;; verify-docs-claims — README.md と docs/operator-quickstart.md が述べる数と
;; 存在・不在を tree から再計算し、食い違えば落とす。
;;
;; 移行前、この repo の要になる事実は **欠陥** だった: deploy される Worker は
;; `svelte/.svelte-kit/cloudflare/_worker.js`（tracked file が 1 件も一致しない
;; パスで、tree の何もそれをビルドしない）で、アプリケーションらしく読める
;; `src/app.ts` は tracked file のどれからも参照されていなかった。その欠陥は
;; 閉じたので、claim は**閉じたこと**を主張する。しかも静かに戻ってこられない
;; ように書いてある —— appview の TypeScript / Svelte は「合計バイト数が減った」
;; ではなく **パスを名指しして不在**を検査する。
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> は先頭、既定 ".")
;; Exit:   0 全 claim が成立 · 1 claim が偽 · 2 答えられなかった

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[cljs.reader :as edn]
         '[clojure.string :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 25
   :preserved-bytes 55370              ; 移行が 1 バイトも触っていない 11 ファイル
   :appview-ts-or-svelte-files 0
   :kotoba-ts-files 5                  ; 移行対象外の参照実装スライス（README §「kotoba/ は移していない」）
   :kotoba-files 7                     ; 同上、拡張子を問わない総数 —— 黙って育たない床
   :canonical-source-files 4           ; src/ + test/ の .cljc/.cljs
   :declared-vars 8
   :declared-routes 2
   :declared-capabilities 3
   :wrangler-main "dist/worker.js"
   :framework "cljs-esm-worker"
   :shadow-output-dir "dist"
   :shadow-export 'air-dcs.worker/handler})

;; 移行が 1 バイトも変えていないファイル。`wrangler.jsonc` と `migration.edn` は
;; **意図的に変更**したので、ここではなく下の内容 claim で検査する。
(def preserved
  {"MIGRATION-TODO.md" "14fd6f6f4162f03eb87fe422a1e370055985431cc54b4cfa09ea7f9b7c4d025e"
   "NOTICE" "9d3bd5678f857c647a465987cd8538580215416648991fd9de47e6dc648544f0"
   "README.edn" "a2846d224d6bc058ad4c5f0703cc118100c6bb398932db1b6b218edbed930510"
   "kotodama.jsonld" "cf5906a65a2dff20b7dc63f0a685ee8a18e9b35a1307646bff2ab92f9f0b8329"
   "kotoba/package.json" "165140d01aa412276250ed9ebd223ff4c6e705ef6bfb0bf765a68de949e93848"
   "kotoba/src/index.ts" "310d8f6d690733c8e1bb85338349983fe160a8758b663bb33e210b4c5c15e24c"
   "kotoba/src/registry.ts" "d3992c253dcd2dacc06b56ec89e719c4a01cbf5d4637b553b1160cf5c99ded47"
   "kotoba/src/types.ts" "8391035901159816eaf384efde1c174a234e4e2a9c1b50fe03a4e7b7425f16e6"
   "kotoba/test/air-dcs.test.ts" "38eabb749631af140423599e0555e74cf7c2bf73a1b93d1ce1db01e7355a8b8f"
   "kotoba/tsconfig.json" "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts" "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"})

;; 移行が**撤去**したもの、パス名で。バイト合計は「TypeScript が消えた」と
;; 言えない。これは言えるし、どれか 1 つでも戻れば落ちる。
(def removed-by-migration
  ["package.json"
   "src/app.ts"
   "svelte/package.json"
   "svelte/src/app.html"
   "svelte/src/routes/+page.svelte"
   "svelte/src/routes/xrpc/[...path]/+server.ts"
   "svelte/svelte.config.js"
   "svelte/tsconfig.json"
   "svelte/vite.config.ts"])

;; 抽出元 `etzhayyim/root` の tree f489880e が持っていた 20 ファイル =
;; 上の preserved(11) + removed(9) + 意図的に変更した wrangler.jsonc。
;; migration.edn の :allowed-additions がこれ以外の全部を名指ししているか、で
;; custody を閉じる。
(def inherited
  "抽出元 tree f489880e の 20 ファイル。`README.edn` は preserved に sha256 を
  固定してあるが**継承ではなく追加**（元の migration.edn の :allowed-additions が
  そう宣言している）なので、ここから外す —— 20 という数はそれで初めて合う。
  最初にこれを取り違えて書いたところ、下の :additions-match-allowed が実際に
  落ちて教えてくれた。"
  (-> (into #{"wrangler.jsonc"} (concat (keys preserved) removed-by-migration))
      (disj "README.edn")))

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git -c core.fsmonitor=false ls-files"
                       #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256")
           (.update (.readFileSync fs (str root "/" rel)))
           (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))
(defn parse-json [s] (try (js->clj (.parse js/JSON s) :keywordize-keys false)
                          (catch :default _ nil)))
(defn parse-edn [s] (try (edn/read-string s) (catch :default _ nil)))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  ;; 入力ゼロを clean と読ませない床。
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :preserved-bytes (:preserved-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    (check! :preserved-files-unchanged []
            (vec (sort (keep (fn [[f want]]
                               (let [got (sha256 f)]
                                 (when-not (= want got) (str f " " (or got "MISSING")))))
                             preserved))))

    ;; appview の TypeScript / Svelte は消えた、パス名で
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))
    ;; …そして別名でも戻ってこない。`kotoba/` は移行対象外なので除く。
    (check! :appview-ts-or-svelte-files (:appview-ts-or-svelte-files claims)
            (count (filter #(and (not (str/starts-with? % "kotoba/"))
                                 (re-find #"\.(ts|svelte|js|mjs|cjs)$" %))
                           files)))
    ;; 移行対象外の参照実装スライス。黙って増えたり消えたりしないよう固定する。
    ;; `kotoba/` は appview ではない —— どの bundle にも入らず、移行が置き換えた
    ;; コード（撤去した src/app.ts / svelte/**）のどれからも import されておらず
    ;; （実測 0 件）、依存（@etzhayyim/sdk, sdk-mock）は今日も解決する。だから
    ;; 「deploy されていないから消す」の対象ではない。**触っていないことを
    ;; sha256 で固定し、黙って育たないよう本数も固定する。**
    (check! :kotoba-ts-files (:kotoba-ts-files claims)
            (count (filter #(and (str/starts-with? % "kotoba/") (str/ends-with? % ".ts")) files)))
    (check! :kotoba-files (:kotoba-files claims)
            (count (filter #(str/starts-with? % "kotoba/") files)))
    (check! :canonical-source-files (:canonical-source-files claims)
            (count (filter #(and (or (str/starts-with? % "src/") (str/starts-with? % "test/"))
                                 (re-find #"\.(cljs|cljc|clj|kotoba)$" %))
                           files)))
    ;; appview を作る node/TypeScript のビルド設定は 1 つも残っていない
    ;; （`kotoba/` のものは移行対象外なので数えない）
    (check! :no-appview-node-build-config []
            (vec (filter #(and (not (str/starts-with? % "kotoba/"))
                               (re-find #"(^|/)(package\.json|package-lock\.json|tsconfig\.json|vite\.config\.ts|vitest\.config\.ts|svelte\.config\.js)$" %))
                         files)))

    ;; custody: 継承 20 ファイル以外は全部 migration.edn が名指ししているか。
    ;; 「ファイルを足したらそのリストに足す」は README が自分で課した規則で、
    ;; ここがそれを機械で守る。
    (let [m (parse-edn (or (slurp* "migration.edn") ""))]
      (if (nil? m)
        (undet! "migration.edn unreadable or not EDN")
        (do
          (check! :custody-source-tracked-files 20 (get-in m [:source :tracked-files]))
          (check! :additions-match-allowed
                  (vec (sort (get-in m [:identity :allowed-additions])))
                  (vec (sort (remove inherited files)))))))

    ;; deploy される bundle は、この tree のソースからビルドされる
    (let [w (some-> (slurp* "wrangler.jsonc") strip-jsonc parse-json)
          k (some-> (slurp* "kotodama.jsonld") parse-json)
          sh (parse-edn (or (slurp* "shadow-cljs.edn") ""))]
      (if (or (nil? w) (nil? k) (nil? sh))
        (undet! "wrangler.jsonc / kotodama.jsonld / shadow-cljs.edn unreadable")
        (let [b (get-in sh [:builds :worker])]
          (check! :wrangler-main (:wrangler-main claims) (get w "main"))
          (check! :declared-vars (:declared-vars claims) (count (get w "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get w "routes")))
          (check! :framework (:framework claims) (get-in w ["vars" "APP_FRAMEWORK"]))
          ;; 旧 config は消える SvelteKit client dir を serve していた
          (check! :no-stale-assets-binding true (nil? (get w "assets")))
          ;; .wasm は tree に 1 つも無いので CompiledWasm の rule は inert だった
          (check! :no-wasm-in-tree true (empty? (filter #(str/ends-with? % ".wasm") files)))
          (check! :no-compiled-wasm-rule true (nil? (get w "rules")))
          ;; nodejs_compat / nodejs_als は adapter-cloudflare の要件だった。
          ;; 外したうえで flag 無しの workerd で実際に答えることを確かめてある
          ;; （docs/operator-quickstart.md S6）。
          (check! :no-node-compat-flags true (nil? (get w "compatibility_flags")))
          (check! :shadow-builds-that-main true
                  (and (= (:output-dir b) (:shadow-output-dir claims))
                       (= (get-in b [:modules :worker :exports 'default]) (:shadow-export claims))
                       (str/includes? (str (get w "main"))
                                      (str (:shadow-output-dir claims) "/worker.js"))))
          ;; ⚠ ここは **EDN として読んで**確かめる。grep では駄目である ——
          ;; shadow-cljs.edn のコメントが :warnings-as-errors と :compiler-options
          ;; の両方を含んでいるので、部分文字列の検査は**置き場所を間違えていても
          ;; 通ってしまう**。それはこの option が防ぐはずの失敗（落ちようのない
          ;; 検査）そのものである。
          (check! :warnings-are-errors true
                  (true? (get-in b [:compiler-options :warnings-as-errors])))
          (check! :warnings-as-errors-not-misplaced true
                  (nil? (get-in b [:build-options :warnings-as-errors])))
          ;; 2 つの設定ファイルが同じ capability 一覧を宣言していること。
          ;; 移行はこれを直さない（どちらも移行前から在る）が、片方だけ動くのを
          ;; 見えるようにする。
          (let [wc (parse-json (get-in w ["vars" "APP_CAPABILITIES"]))
                kc (get-in k ["profile" "capabilities"])]
            (check! :declared-capabilities (:declared-capabilities claims) (count wc))
            (check! :capabilities-agree-across-config true (= wc kc))))))

    ;; ページは route **表**と宣言された capability を描く。焼いた数ではない ——
    ;; 移行前のページは `routeCount: 0` / `routes: []` / `vars: []` を literal で
    ;; 持っていて、隣の wrangler.jsonc が route 2 / var 8 / capability 3 を宣言
    ;; していることに気づけなかった。構造で主張する（部分文字列の禁止ではない:
    ;; 「旧欠陥を説明する docstring」で落ちる検査は散文についての検査であって、
    ;; コードについての検査ではない）。
    (let [v (slurp* "src/air_dcs/view.cljc")
          w (slurp* "src/air_dcs/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-the-data true
                (and (str/includes? v "[{:keys [routes methods vars mcp-url actor built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")
                     (str/includes? w ":methods (decode-capabilities")))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f))))
        (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds")
        (js/process.exit 0))))
