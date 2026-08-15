# Operator quickstart — app-air-dcs

Every claim in [`../README.md`](../README.md) was produced by walking this file
on 2026-08-16 against `03d6248`. It is written to be re-walked: each section
states what it measures, and the ones that could not be measured say so in §9
rather than being quietly dropped.

## §0 What will get in your way

1. **Nothing here is deployed and nothing here resolves.** Four hostnames are
   NXDOMAIN (§10). Do not debug a network path; there is none.
2. **`git` in the west checkout prints `error: could not read IPC response`** on
   some commands. It is an fsmonitor warning on this workstation, not a repo
   fault — the command's output is still correct. Add `-c core.fsmonitor=false`
   if it bothers you.
3. **npm 11.16 cannot install `kotoba/`'s dependencies.** Both `@etzhayyim/sdk`
   and `@etzhayyim/sdk-mock` are git dependencies, and the nested install npm
   runs to prepare them dies with `EALLOWSCRIPTS` (*"--allow-scripts is not
   allowed in project-scoped installs"*). Adding an `allowScripts` field does not
   help — the rejection happens inside the nested install, not yours. §6 works
   around it; §9 records what that costs.
4. **`esbuild --loader=ts` is rejected** when the input is a file rather than
   stdin. Drop the flag; esbuild infers from the `.ts` extension.
5. **There is no `.gitignore`.** Building inside the checkout would leave
   `node_modules/` and `.svelte-kit/` untracked. Everything below builds in
   scratch copies under `/tmp` so the checkout stays byte-clean (§11).

Set this once:

```bash
REPO=~/github/com-junkawasaki/orgs/cloud-itonami/app-air-dcs
```

Some sections read upstream `etzhayyim/root`. If you have a local clone, use it —
but **check it is not shallow first**, because a shallow clone answers ancestry
questions wrongly and confidently:

```bash
git -C "$UP" rev-parse --is-shallow-repository    # must print false
```

The commands below use `gh api` instead, which has no such failure mode.

## §1 Provenance — is this really a verbatim copy?

`migration.edn` makes four checkable claims: revision, tree, file count, bytes.

```bash
TREE=f489880e05a1c34c043cb6de9e8b3bb989cfbf62
REV=0c30514ab1ac7f929b1c796f2d03594117fae2d7

gh api repos/etzhayyim/root/commits/$REV \
  --jq '{sha:.sha, date:.commit.committer.date, msg:(.commit.message|split("\n")[0])}'
# → 2026-07-19, "refactor(apps): extract nineteen-file band (#3256)"
```

Pull the claimed tree and compare it blob-for-blob with what is checked in.
`git rev-parse` reads stdin, so it must not be called inside a `while read` loop
over the same stream — build two sorted lists and join them instead:

```bash
gh api "repos/etzhayyim/root/git/trees/$TREE?recursive=1" \
  --jq '.tree[] | select(.type=="blob") | "\(.sha)\t\(.path)"' | sort -k2 > /tmp/up.tsv
git -C "$REPO" ls-tree -r HEAD | awk '{print $3"\t"$4}' | sort -k2 > /tmp/local.tsv

while IFS=$'\t' read -r usha upath; do
  lsha=$(awk -F'\t' -v p="$upath" '$2==p {print $1}' /tmp/local.tsv)
  [ "$lsha" = "$usha" ] || echo "DRIFT: $upath up=$usha local=${lsha:-MISSING}"
done < /tmp/up.tsv
echo "compared: $(wc -l < /tmp/up.tsv)"        # → 20, with no DRIFT lines
```

Byte total, and the files this repo added on top:

```bash
gh api "repos/etzhayyim/root/git/trees/$TREE?recursive=1" \
  --jq '[.tree[] | select(.type=="blob") | .size] | add'     # → 67306
comm -13 <(cut -f2 /tmp/up.tsv | sort) <(cut -f2 /tmp/local.tsv | sort)
# → README.edn  migration.edn  (+ README.md and docs/operator-quickstart.md
#    once this change lands — all four are in :allowed-additions)
```

**An empty DRIFT list is only meaningful next to a non-zero `compared:` count.**
If the tree fetch failed, the loop would also print nothing.

## §2 The app is gone upstream; the contract is not

```bash
gh api repos/etzhayyim/root/contents/60-apps --jq '.[].name'
# → etzhayyim-project-organism        (one entry; air-dcs is not there)

gh api repos/etzhayyim/root/contents/00-contracts/bpmn/com/etzhayyim/air-dcs \
  --jq '.[].name'
# → acceptBaggage.bpmn computeLoadSheet.bpmn issueDepartureControl.bpmn
#   processBoardingPass.bpmn processCheckIn.bpmn reconcileBaggage.bpmn
#   trackTurnaround.bpmn transmitApis.bpmn
```

That is the path `src/app.ts` names in its `/health` payload, and it is live on
`main` today. Fetch the eight and read their io-mappings — this is where the
README's tables come from:

```bash
mkdir -p /tmp/dcs-bpmn && cd /tmp/dcs-bpmn
for f in acceptBaggage computeLoadSheet issueDepartureControl processBoardingPass \
         processCheckIn reconcileBaggage trackTurnaround transmitApis; do
  gh api "repos/etzhayyim/root/contents/00-contracts/bpmn/com/etzhayyim/air-dcs/$f.bpmn" \
    --jq .content | base64 -d > "$f.bpmn"
done

for f in *.bpmn; do
  echo "### ${f%.bpmn}"
  echo -n "  job: "; grep -o 'taskDefinition type="[^"]*"' "$f" | head -1 | sed 's/.*type="//;s/"//'
  echo -n "  in : "; grep -o '<zeebe:input source="={[^"]*}"' "$f" | head -1 | sed 's/.*={//;s/}//'
  echo -n "  out: "; grep -o '<zeebe:output source="=[^"]*" target="[^"]*"' "$f" \
                     | sed 's/.*target="//;s/"//' | tr '\n' ' '; echo
done
```

Read the `out:` lines against `kotoba/src/types.ts`. `computeLoadSheet` **returns**
`zfwKg towKg lmcStatus`; `ComputeLoadSheetInput` **takes** all three. Same
inversion for `acceptBaggage`→`tagNo`, `processCheckIn`→`seatNo`. That is the
README's "contract's outputs are kotoba's inputs" table.

`issueDepartureControl` is the counter-example — compare it to `updateDeparture`:

```bash
grep -o 'input source="={[^"]*}"' issueDepartureControl.bpmn | head -1 \
  | sed 's/.*={//;s/}//' | tr -d ' ' | tr ',' '\n' | cut -d: -f1 | tr '\n' ' '
# → flightNo depDate atd delayReason delayMins gate callerDid

git -C "$REPO" show HEAD:kotoba/src/types.ts \
  | awk '/export interface UpdateDepartureInput /,/^}/' \
  | grep -oE '^[[:space:]]+[a-zA-Z0-9]+\??:' | tr -d ' :?' | tr '\n' ' '
# → flightNo depDate status atd gate delayReason delayMins
```

Six domain fields identical; `callerDid` contract-only, `status` kotoba-only.

## §3 What the contract asks for and nothing here provides

`grep -l` is used deliberately below: it answers *which files*, so an empty answer
is visibly empty rather than a `0` that reads like a clean scan.

The pathspec exclusions are **load-bearing**: this README and this quickstart both
name all fourteen identifiers in prose, so without `':!README.md' ':!docs/'` the
search finds itself and the check reports hits that are not code.

```bash
for s in vertexId callerDid pnrIdHash paxManifestHash boardingPassRef \
         boardingPassBarcode transmissionRef reconcileStatus variance \
         targetTime milestone tagNo totalCargoKg destCountry; do
  printf "  %-22s " "$s"
  hits=$(git -C "$REPO" grep -lF "$s" HEAD -- . ':!README.md' ':!docs/' 2>/dev/null \
           | sed 's|^HEAD:||' | tr '\n' ' ')
  echo "${hits:-— absent from every migrated file}"
done
# → all fourteen: absent
```

Confirm the exclusion is not hiding a real hit by dropping it — the only files
that should appear are the two this change added:

```bash
git -C "$REPO" grep -lF vertexId HEAD -- . | sed 's|^HEAD:||'
# → README.md  docs/operator-quickstart.md      (prose, not code)
```

Then read the method-name alignment, which is finer than it looks:

```bash
cd /tmp/dcs-build 2>/dev/null || { rm -rf /tmp/dcs-build && mkdir -p /tmp/dcs-build && \
  git -C "$REPO" archive HEAD | tar -x -C /tmp/dcs-build && cd /tmp/dcs-build; }

node -e '
const fs=require("fs");
const methods=JSON.parse(fs.readFileSync("src/app.ts","utf8").match(/methods: (\[[^\]]*\])/)[1]);
const exp=fs.readFileSync("kotoba/src/index.ts","utf8").match(/export \{([^}]*)\}/s)[1]
            .split(",").map(s=>s.trim()).filter(Boolean);
for (const m of methods) {
  const ci = exp.find(e => e.toLowerCase() === m.toLowerCase() && e !== m);
  console.log(`  ${m.padEnd(24)} exact=${exp.includes(m)?"YES":"no "}  ${ci?"case-differs-only: "+ci:""}`);
}'
# → processCheckIn  no   case-differs-only: processCheckin
#   processBoardingPass  no          issueDepartureControl  no
#   the other five: exact
```

## §4 The dispatcher's `methods` list does not gate routing

`src/app.ts` is a normal fetch handler, so run it directly with a stub upstream.
The `esbuild` comes from the svelte devDependencies:

```bash
cd /tmp/dcs-build/svelte && npm install          # postinstall warnings are fine
mkdir -p /tmp/dcs-dispatch && cp /tmp/dcs-build/src/app.ts /tmp/dcs-dispatch/app.ts
/tmp/dcs-build/svelte/node_modules/.bin/esbuild /tmp/dcs-dispatch/app.ts \
  --format=esm --outfile=/tmp/dcs-dispatch/app.mjs        # no --loader; see §0.4
```

```bash
cat > /tmp/dcs-dispatch/probe.mjs <<'EOF'
import handler from './app.mjs';
const seen = [];
globalThis.fetch = async (url, init) => {
  seen.push({ url: String(url), secret: init?.headers?.['x-internal-secret'] });
  return new Response(JSON.stringify({ stub: true }), { status: 200 });
};
const env = { APP_NANOID: 'a1rd3cs0' };
const call = async (path, init) => {
  const res = await handler.fetch(new Request('https://air-dcs.etzhayyim.com' + path, init), env);
  return { status: res.status, body: (await res.text()).slice(0, 90) };
};
const P = 'com.etzhayyim.apps.airDcs.';
console.log('declared    :', JSON.stringify(await call('/xrpc/' + P + 'processCheckIn',        { method:'POST', body:'{}' })));
console.log('FABRICATED  :', JSON.stringify(await call('/xrpc/' + P + 'thisMethodDoesNotExist',{ method:'POST', body:'{}' })));
console.log('kotoba-only :', JSON.stringify(await call('/xrpc/' + P + 'registerFlight',        { method:'POST', body:'{}' })));
console.log('wrong prefix:', JSON.stringify(await call('/xrpc/com.example.other',              { method:'POST', body:'{}' })));
console.log('bad json    :', JSON.stringify(await call('/xrpc/' + P + 'processCheckIn',        { method:'POST', body:'{'  })));
console.log('--- what the stub was actually asked for ---');
for (const s of seen) console.log('   ', s.url, '| x-internal-secret =', JSON.stringify(s.secret));
EOF
cd /tmp/dcs-dispatch && node probe.mjs
```

Observed: the declared method, the **fabricated** method and a kotoba-only name
all return 200 and all reach the stub. A foreign NSID prefix returns 404 and a
malformed body returns 400 — so the handler is not simply passing everything, and
the negative results above are real. Every forwarded call carried
`x-internal-secret: ""`.

Confirm the secret is genuinely unset rather than supplied elsewhere:

```bash
node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/dcs-build/wrangler.jsonc","utf8")
           .replace(/^\s*\/\/.*$/gm,""));
console.log("routes:", j.routes.length, "vars:", Object.keys(j.vars).length);
console.log("DISPATCHER_URL:", "DISPATCHER_URL" in j.vars,
            " DISPATCHER_INTERNAL_SECRET:", "DISPATCHER_INTERNAL_SECRET" in j.vars);'
# → routes: 2 vars: 8 / both false
```

Two routes and eight vars — against which `svelte/src/routes/+page.svelte`
hardcodes `"routeCount": 0, "routes": [], "vars": []`.

## §5 `computeLoadSheet` computes nothing

First, statically — the body has no arithmetic:

```bash
git -C "$REPO" show HEAD:kotoba/src/registry.ts \
  | awk '/^export async function computeLoadSheet/,/^}/' \
  | grep -E 'zfwKg|towKg|fuelKg'
# → three validation-list entries and three pass-through assignments. Nothing else.
```

Then dynamically. Do §6 first so the mock is installed, then drop this in:

```bash
cd /tmp/dcs-build/kotoba && cat > test/impossible-probe.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import { registerFlight, computeLoadSheet, reconcileBaggage } from "../src/index.js";

describe("what does compute/reconcile actually check?", () => {
  it("accepts a take-off weight BELOW the zero-fuel weight", async () => {
    const e: any = new MockEtzhayyim({ did: "did:web:air-dcs.etzhayyim.com" });
    await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10" });
    const r = await computeLoadSheet(e, { flightNo: "GF101", depDate: "2026-06-10",
      zfwKg: "62000", towKg: "1", fuelKg: "10000" });   // −61,999 kg of fuel
    expect(r.status).toBe("computed");
  });
  it("accepts parts that do not sum to the total", async () => {
    const e: any = new MockEtzhayyim({ did: "did:web:air-dcs.etzhayyim.com" });
    await registerFlight(e, { flightNo: "GF101", depDate: "2026-06-10" });
    const r = await reconcileBaggage(e, { flightNo: "GF101", depDate: "2026-06-10",
      totalBags: 142, loadedCount: 999, offloadedCount: 999, missingCount: 999 });
    expect(r.status).toBe("reconciled");
  });
});
EOF
npx vitest run test/impossible-probe.test.ts     # → 2 passed
rm -f test/impossible-probe.test.ts
```

Both pass. The assertions are deliberately written the "wrong" way round — they
assert acceptance — so a green run is the finding, not a clean bill of health.

## §6 Run the tests

The dependency wall from §0.3 is here. The workaround rests on two facts you can
check yourself. First, the real SDK is a **type-only** import, erased at runtime:

```bash
git -C "$REPO" grep -n '@etzhayyim/sdk' HEAD -- kotoba/src
# → kotoba/src/registry.ts:16:import type { Etzhayyim } from "@etzhayyim/sdk";
```

Second, the mock is standalone:

```bash
rm -rf /tmp/dcs-sdk && mkdir -p /tmp/dcs-sdk && cd /tmp/dcs-sdk
git clone -q https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git sdk-mock
git -C sdk-mock checkout -q c857ff9be5310bf433bfe1e8d3c0f677e213d667   # the pinned SHA
grep -n '@etzhayyim/sdk' sdk-mock/src/index.ts
# → two hits, both inside comments. Nothing is imported.
```

So neither the tests nor the code under test need the real SDK **at runtime**.
Install the mock from disk with its unused dependency removed:

```bash
node -e 'const fs=require("fs"),f="/tmp/dcs-sdk/sdk-mock/package.json";
const p=JSON.parse(fs.readFileSync(f,"utf8"));delete p.dependencies;
fs.writeFileSync(f,JSON.stringify(p,null,2));'

cd /tmp/dcs-build/kotoba
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
delete p.dependencies;
p.devDependencies={"@etzhayyim/sdk-mock":"file:/tmp/dcs-sdk/sdk-mock","typescript":"^5.6.0","vitest":"^4.1.0"};
fs.writeFileSync("package.json",JSON.stringify(p,null,2));'

npm install --ignore-scripts
npx vitest run
# → Test Files  1 passed (1)
#         Tests  10 passed (10)
```

**This edits `/tmp/dcs-build`, never `$REPO`.** §9 records what the workaround
gives up.

## §7 Do the tests discriminate? (eight mutants)

Ten green tests prove nothing until you have seen them go red. Each mutation must
be verified to have **applied** — a replace that silently matches nothing produces
a red-free run indistinguishable from a surviving mutant. `run_mut` says `NO-OP`
in that case and restores.

```bash
cd /tmp/dcs-build/kotoba
cp src/registry.ts /tmp/dcs-registry.orig.ts
cp src/types.ts    /tmp/dcs-types.orig.ts

run_mut () {
  name="$1"; script="$2"
  cp /tmp/dcs-registry.orig.ts src/registry.ts; cp /tmp/dcs-types.orig.ts src/types.ts
  node -e "$script" || { echo "  $name -> NO-OP (pattern not found) — did not apply"; \
                         cp /tmp/dcs-registry.orig.ts src/registry.ts; return; }
  echo "  $name -> $(npx vitest run 2>&1 | grep -E '^ +Tests +' | head -1)"
  cp /tmp/dcs-registry.orig.ts src/registry.ts; cp /tmp/dcs-types.orig.ts src/types.ts
}
```

| # | mutation | result |
|---|---|---|
| M1 | `registerFlight` dedup: drop the `alreadyExists` return | **1 failed** / 9 passed |
| M2 | `isDecimalString` always accepts | **3 failed** / 7 passed |
| M3 | `flightExists` FK check always true | **3 failed** / 7 passed |
| M4 | `processCheckin` `encryptedWrite` → plaintext `write` | **3 failed** / 7 passed |
| M5 | `transmitApis` `encryptedWrite` → plaintext `write` | **2 failed** / 8 passed |
| M6 | `listFlights` drops its `status`+`gate` filters | **1 failed** / 9 passed |
| M7 | `trackTurnaround` drops the prior-timestamp merge | **1 failed** / 9 passed |
| M8 | `processCheckin` required-field check always accepts | **1 failed** / 9 passed |

Eight applied, eight killed. Restore and confirm the baseline is green again —
otherwise you have measured a broken tree, not a killed mutant:

```bash
cp /tmp/dcs-registry.orig.ts src/registry.ts
cp /tmp/dcs-types.orig.ts    src/types.ts
npx vitest run          # → Tests  10 passed (10)
```

## §8 The two mutants that are killed by the wrong assertion

M4 and M5 both go red, so the table above looks clean. It is not. **Read which
test failed, not how many.**

### M5: the plaintext assertion is not what catches plaintext

```bash
cd /tmp/dcs-build/kotoba
npx vitest run --reporter=verbose 2>&1 | grep apisManifest    # under M5
```

The failure is at `test/air-dcs.test.ts:195`, `expect(ok.keyId).toBeTruthy()` —
the receipt's *shape*. Line 198, the assertion the test is named for, is
`expect(e.count("com.etzhayyim.apps.airDcs.flightDeparture")).toBe(0)`: it counts
a collection `transmitApis` never writes to, so it is `0` either way.

Prove it by keeping the receipt shape intact — this is M5**b**, and it is the
decisive one:

```bash
cp /tmp/dcs-registry.orig.ts src/registry.ts
node -e 'const fs=require("fs");const f="src/registry.ts";let s=fs.readFileSync(f,"utf8");const b=s;
s=s.replace(`  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: APIS_MANIFEST_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("apis", input.manifestId),
  });`,
`  const plain = await e.write({ collection: APIS_MANIFEST_INNER_TYPE, record: body as unknown as Record<string, unknown>, rkey: rkeyOf("apis", input.manifestId) }); const receipt = { uri: plain.uri, keyId: "not-a-real-key" }; /*M5b*/`);
if(s===b){console.error("NO-OP");process.exit(1)};fs.writeFileSync(f,s);'
grep -c 'M5b' src/registry.ts                    # → 1, the mutation applied
npx vitest run --reporter=verbose 2>&1 | grep -E 'apisManifest|coverage rollup'
cp /tmp/dcs-registry.orig.ts src/registry.ts
```

Passport number, nationality and date of birth are now stored **in the clear**,
and the test named *"seals passenger manifest via encryptedWrite, never
plaintext"* **passes**. The only failure is `coverage rollup`, for the unrelated
reason that the E2E scan no longer counts the record.

### M4: the read-cap assertion holds in both directions

Under M4 the test named *"enforces read-cap: a non-recipient DID cannot decrypt
the checkin"* also passes. The reason is in the mock:

```bash
grep -n 'private store\|private encStore' /tmp/dcs-sdk/sdk-mock/src/index.ts
```

Both are **per-instance** fields, so a second `MockEtzhayyim` shares nothing with
the first. Show that the assertion is insensitive to the thing it names:

```bash
cd /tmp/dcs-build/kotoba && cat > test/readcap-probe.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import { processCheckin, listCheckins } from "../src/index.js";

describe("what does the read-cap test measure?", () => {
  it("holds with NOTHING ever written", async () => {
    const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
    expect((await listCheckins(outsider)).total).toBe(0);
  });
  it("holds even when the outsider IS a named recipient", async () => {
    const e: any = new MockEtzhayyim({ did: "did:web:air-dcs.etzhayyim.com" });
    await processCheckin(e, { checkinId: "chk1", flightNo: "GF101", depDate: "2026-06-10",
      passengerName: "Alice", pnrRef: "ABC123", recipients: ["did:web:outsider.example"] });
    const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
    expect((await listCheckins(outsider)).total).toBe(0);
  });
});
EOF
npx vitest run test/readcap-probe.test.ts        # → 2 passed
rm -f test/readcap-probe.test.ts
```

Both pass. Denial and entitlement return the same `0`.

**Fixing them** means asserting against the collection the function writes
(`APIS_MANIFEST_INNER_TYPE`, not `flightDeparture`) and giving the outsider a view
of the *same* store rather than a fresh instance. Neither fix is attempted here —
this file measures, it does not repair.

## §9 What could not be walked, and what that costs

- **`npm install` as written in `kotoba/package.json` does not complete** on npm
  11.16.0 / node 26.3.0 (§0.3). §6 substitutes a local checkout of the mock at
  the pinned SHA. The substitution is sound at runtime — type-only import,
  standalone mock, both verified — but it means **the suite has not been run
  against `@etzhayyim/sdk` itself**. If the real SDK's `Etzhayyim` interface has
  drifted from what `registry.ts` calls, these tests would not show it.
- **`kotoba` typecheck fails and cannot be fixed without the real SDK.**
  `npx tsc --noEmit` in `/tmp/dcs-build/kotoba` exits **2** with 9 errors: one
  `TS2307 Cannot find module '@etzhayyim/sdk'` and eight `TS7006` implicit-`any`
  parameters downstream of it. Whether the package typechecks against the pinned
  SDK is **unknown** — not passing, not failing, unmeasured.
- **Root `npm run typecheck` is not a check.** There is no root `tsconfig.json`
  and no input files:

  ```bash
  rm -rf /tmp/dcs-root && mkdir -p /tmp/dcs-root
  git -C "$REPO" archive HEAD | tar -x -C /tmp/dcs-root
  cd /tmp/dcs-root && npm install --ignore-scripts
  npm run typecheck > /tmp/tc.txt 2>&1; echo "exit=$?"
  grep -c 'error TS' /tmp/tc.txt        # → 0   (not "no errors" — no files)
  ```

  `exit=1` with **zero** `error TS` lines is the signature: it failed without
  looking at anything. Do not cite the banner's line count — it varies with the
  resolved tsc version.
- **Nothing was deployed and no live endpoint of this app was called.**
  `wrangler deploy` was not run: the routes point at hostnames that do not exist
  and the actor descriptor is unresolvable. The only network calls made were the
  DNS lookups and `curl`s in §10.
- **`vertexId` was not traced.** All eight processes return it, nothing here
  produces it, and where it was meant to come from is outside this repository.
- **The `pnrIdHash` vs sealed-plaintext divergence was not adjudicated.** Both are
  defensible; which one is intended is a decision, not a measurement.

## §10 DNS and reachability

```bash
for h in air-dcs.etzhayyim.com a1rd3cs0.etzhayyim.com \
         dispatcher.etzhayyim.com mcp.etzhayyim.com etzhayyim.com; do
  for ns in 1.1.1.1 8.8.8.8 9.9.9.9; do
    printf "%-28s @%-8s " "$h" "$ns"
    dig +short +time=3 +tries=1 @$ns "$h" A | tr '\n' ' '
    dig +time=3 +tries=1 @$ns "$h" A | grep -m1 -o 'status: [A-Z]*'
  done
done
```

Twelve NXDOMAIN for the four service names; `NOERROR` with two A records for the
apex, on all three resolvers. The zone is not broken:

```bash
dig +short NS etzhayyim.com          # → vivienne / everton .ns.cloudflare.com
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 12 https://etzhayyim.com/
# → 200
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://air-dcs.etzhayyim.com/health
# → 000    (does not resolve)
```

Four missing labels under a healthy Cloudflare zone. Two further probes explain
the README's identity rows:

```bash
curl -sS --max-time 8 https://etzhayyim.com/.well-known/did.json | head -12
# → 200: did:web:etzhayyim.com, Ed25519 key-0, PDS https://pds.aozora.app
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://etzhayyim.com/ns/kotodama/v1
# → 404    the @context every kotodama.jsonld in this fleet declares
```

The parent DID resolves; the app's child DID cannot, and the JSON-LD context is
absent. Adding the DNS labels is a zone change, not an outage to debug — but read
"Where to start" in the README before adding any.

## §11 What is deployed (build the bundle and search all of it)

```bash
cd /tmp/dcs-build/svelte
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- npm run build
head -c 200 .svelte-kit/cloudflare/_worker.js
# → import { Server } from "./../output/server/index.js";
#   import { manifest, ... } from "./../cloudflare-tmp/manifest.js";
```

The `resource-guard` wrapper is this workspace's rule for concurrent heavy
builds, not a property of the app. Note the imports cross directory boundaries,
so the closure is three directories, not one:

```bash
B=/tmp/dcs-build/svelte/.svelte-kit
find "$B/cloudflare" "$B/cloudflare-tmp" "$B/output/server" -type f | wc -l   # → 41

probe() { n=$(grep -rlF "$2" "$B/cloudflare" "$B/cloudflare-tmp" "$B/output/server" \
                2>/dev/null | wc -l | tr -d ' '); printf "  %-8s [%s] %s\n" "$1" "$n" "$2"; }
for s in 'x-etzhayyim-xrpc-method' 'AGENTGATEWAY_MCP_ROUTER_URL' \
         'mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message' 'sveltekit-edge-bff'; do
  probe svelte "$s"; done
for s in 'edge-proxy+agentgateway-mcp+langserver' 'dispatcher.etzhayyim.com' \
         'DISPATCHER_INTERNAL_SECRET' 'x-internal-secret' '_app/meta' \
         'issueDepartureControl' 'a1rd3cs0'; do probe dispatch "$s"; done
for s in 'com.etzhayyim.apps.airDcs.flightDeparture' 'com.etzhayyim.apps.airDcs.apisManifest' \
         'encryptedWrite' 'reconcileBaggage' 'transmitApis' 'loadSheetDidFor'; do
  probe kotoba "$s"; done
```

svelte 4/4 present, dispatcher 0/7, kotoba 0/6. **The svelte probes are what make
this a measurement rather than a failed grep**: if they came back `[0]` too, the
search itself would be broken.

## §12 Leave the checkout clean

```bash
git -C "$REPO" -c core.fsmonitor=false status --short    # → (empty)
rm -rf /tmp/dcs-build /tmp/dcs-sdk /tmp/dcs-dispatch /tmp/dcs-bpmn /tmp/dcs-root
```
