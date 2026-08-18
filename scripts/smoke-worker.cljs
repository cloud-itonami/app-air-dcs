#!/usr/bin/env nbb
;; smoke-worker — 実際にビルドされた bundle を import して叩く。
;;
;; ここが「deploy される成果物」に触る唯一の検査である。テスト
;; (test/air_dcs/route_test.cljc) はソースの判断を固定するが、bundle が本当に
;; Worker の形で答えるかは言えない —— export の形、shadow の
;; :advanced-optimization、`shadow.resource/inline` で焼いた CSS、そして
;; `APP_CAPABILITIES` の JSON decode（worker.cljs 側にしか無い）は、どれも
;; ビルドを通って初めて存在する。
;;
;; Usage:  nbb scripts/smoke-worker.cljs [<dist/worker.js>]
;; Exit:   0 全て期待どおり · 1 期待と違う · 2 判定できなかった（bundle が無い等）

(require '["node:fs" :as fs] '["node:path" :as path] '["node:url" :as url]
         '[clojure.string :as str])

(def bundle
  "ESM の import は相対パスを package 名と読むので、必ず絶対パスに直してから
  file:// URL にする（`dist/worker.js` をそのまま渡すと『Cannot find package
  dist』になる。実測）。"
  (let [a (first (remove #(str/starts-with? % "--") *command-line-args*))]
    (.resolve path (or a "dist/worker.js"))))

(def failures (atom []))
(def checks (atom 0))
(defn check! [label expected actual]
  (swap! checks inc)
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" label "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))))

(when-not (.existsSync fs bundle)
  (println (str "UNDETERMINED\tno bundle at " bundle))
  (println "Refusing to report a pass: build it first (see docs/operator-quickstart.md S4).")
  (js/process.exit 2))

;; ── 二つの印 ────────────────────────────────────────────────────────────────
;; 値の露出を「出てはいけない 1 個」だけで測ると、**「全部隠す」実装でも通る**。
;; 逆に「出なければいけない 1 個」だけだと「全部出す」実装が通る。両方置く。
;;
;; 実在しそうな値（"yoro" 等）を印にしない: 他の文言と偶然一致しうるうえ、
;; 引用符ごと探すと renderer が " を &quot; に escape するので**決して一致
;; しない** = 構造的に落ちない検査になる（app-ongakuka の移行で実測）。
(def hidden-sentinel
  "env の VALUE。ページにもレスポンスにも出てはならない。"
  "SENTINEL-HIDDEN-4c81ab")

(def shown-sentinel
  "env の VALUE で、ページが**出すことになっている**もの（XRPC の中継先）。
  これが出ていなければ『値を隠せている』の合格は『何も描いていない』と
  区別できない。"
  "SENTINEL-SHOWN-7f2d9e")

(def router-url
  "中継先。**`.invalid` は RFC 2606 で決して解決しない**ので、多段パスの検査が
  本物の DNS（mcp.etzhayyim.com が今日 NXDOMAIN であること）に寄りかからない。
  検査したいのは『多段が単一セグメントと同じ扱いか』であって、上流の生死ではない。"
  (str "https://router-" shown-sentinel ".invalid/xrpc/com.etzhayyim.mcp.message"))

(def capabilities
  "wrangler.jsonc の APP_CAPABILITIES **そのままの文字列**。ここを config から
  離して書き写すと、decode の検査ではなく写経の検査になる。"
  "[\"processCheckIn\",\"processBoardingPass\",\"acceptBaggage\"]")

(def env #js {"APP_NANOID" "a1rd3cs0"
              "APP_UI_TYPE" hidden-sentinel
              "APP_CAPABILITIES" capabilities
              "AGENTGATEWAY_MCP_ROUTER_URL" router-url})

(defn- call [h method path]
  (let [req (js/Request. (str "https://air-dcs.etzhayyim.com" path) #js {:method method})]
    (-> (js/Promise.resolve ((.-fetch h) req env #js {}))
        (.then (fn [res] (-> (.text res)
                             (.then (fn [body] {:status (.-status res)
                                                :ct (.get (.-headers res) "content-type")
                                                :allow (.get (.-headers res) "allow")
                                                :cors (.get (.-headers res) "access-control-allow-methods")
                                                :body body}))))))))

(-> (js/import (.-href (.pathToFileURL url bundle)))
    (.then
     (fn [m]
       (let [h (.-default m)]
         (check! "default export has fetch" true (fn? (.-fetch h)))
         (-> (js/Promise.all
              #js [(call h "GET" "/") (call h "GET" "/health")
                   (call h "POST" "/xrpc/") (call h "OPTIONS" "/xrpc/x")
                   (call h "GET" "/nope") (call h "POST" "/health")
                   (call h "GET" "/xrpc/x") (call h "POST" "/xrpc/a/b")
                   (call h "POST" "/xrpc/com.etzhayyim.apps.airDcs.processCheckIn")
                   (call h "GET" "/_app/meta")])
             (.then
              (fn [[page health bad pre nf mna wrong-xrpc multi single meta]]
                (check! "GET / status" 200 (:status page))
                (check! "GET / is html" true (str/includes? (or (:ct page) "") "text/html"))
                ;; ページは route 表から描かれる。表にある path が全部出ていること。
                (doseq [p ["/health" "/xrpc/:nsid"]]
                  (check! (str "page advertises " p) true (str/includes? (:body page) p)))
                ;; APP_CAPABILITIES を decode して 3 本すべてを完全修飾で出す。
                ;; 移行前のページは routeCount:0 / routes:[] / vars:[] を焼いて
                ;; いて、隣の config が宣言する 3 つを一つも出せなかった。
                (doseq [c ["processCheckIn" "processBoardingPass" "acceptBaggage"]]
                  (check! (str "page advertises " c) true
                          (str/includes? (:body page) (str "com.etzhayyim.apps.airDcs." c))))
                ;; 値の露出は**二つの印**で挟む。片方だけでは
                ;; 「全部隠す」も「全部出す」も通ってしまう。
                (check! "page shows a var key" true (str/includes? (:body page) "APP_NANOID"))
                (check! "page hides the hidden env value" false
                        (str/includes? (:body page) hidden-sentinel))
                (check! "page shows the env value it is supposed to show" true
                        (str/includes? (:body page) shown-sentinel))
                ;; DDS の CSS が bundle に焼かれている。**採点（design-quality）
                ;; ではこれを言えない** —— デザインシステムを一切入れずに描いた
                ;; ページでも 96.63 で min 95 を通る（quickstart S3 で実測）。
                (check! "page carries the design system" true (str/includes? (:body page) "dads-table"))

                (check! "GET /health status" 200 (:status health))
                (check! "health names its routes" true (str/includes? (:body health) "/xrpc/:nsid"))
                (check! "health names its methods" true
                        (str/includes? (:body health) "com.etzhayyim.apps.airDcs.acceptBaggage"))
                (check! "health names the actor" true
                        (str/includes? (:body health) "did:web:air-dcs.etzhayyim.com"))
                (check! "health does not leak env values" false
                        (str/includes? (:body health) hidden-sentinel))

                ;; nsid 無しの XRPC は 400。文言は SvelteKit 版のまま。
                (check! "POST /xrpc/ status" 400 (:status bad))
                (check! "POST /xrpc/ reason" true (str/includes? (:body bad) "Missing XRPC method"))

                ;; 多段パスは **単一セグメントと同じ扱い**。deploy されていた
                ;; SvelteKit の [...path] がそうしていた。ここは `.invalid` の
                ;; router へ向けているので、本物の DNS に依存しない。
                (check! "POST /xrpc/a/b is not rejected" false (= 400 (:status multi)))
                (check! "POST /xrpc/a/b is treated exactly like a single segment"
                        (:status single) (:status multi))
                (check! "an unreachable router is not hidden behind a 200" 502 (:status single))
                (check! "the 502 names the router it could not reach" true
                        (str/includes? (:body single) shown-sentinel))

                (check! "OPTIONS preflight" 204 (:status pre))
                (check! "OPTIONS advertises methods" "POST,OPTIONS" (:cors pre))
                (check! "unknown path" 404 (:status nf))
                ;; 撤去した src/app.ts の別名。持ち越していない。
                (check! "/_app/meta was not carried over" 404 (:status meta))
                (check! "wrong method on /health" 405 (:status mna))
                (check! "wrong method on /xrpc" 405 (:status wrong-xrpc))
                (check! "405 names the allowed methods" "POST, OPTIONS" (:allow wrong-xrpc))

                ;; 実行本数の床。検査が黙って 0 本になったら「合格」と言わない。
                (when (< @checks 25)
                  (println (str "UNDETERMINED\tonly " @checks " checks ran; expected at least 25"))
                  (js/process.exit 2))

                (let [f @failures]
                  (if (seq f)
                    (do (println (str "FAILED\t" (count f) " of " @checks " check(s): " (str/join ", " f)))
                        (js/process.exit 1))
                    (do (println (str "OK\t" @checks " checks — the built bundle answers as the route table says"))
                        (js/process.exit 0))))))))))
    (.catch (fn [e]
              (println (str "UNDETERMINED\tcould not exercise the bundle: " (.-message e)))
              (js/process.exit 2))))
