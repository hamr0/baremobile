// Catch adopter-visible declaration defects in the SHIPPED .d.ts, before publish.
//
// WHY THIS EXISTS, and why the adopter compile gate is not enough. That gate
// (publish.yml) compiles a hand-written quickstart against the packed tarball —
// so it only covers the API surface the quickstart happens to touch. It missed
// v0.11.1's `page.swipe()` defect for exactly that reason: the quickstart calls
// tap/type/snapshot/screenshot/findByText and never calls swipe. Enumerating
// every method by hand does not scale and silently rots as methods are added.
// This checks a PROPERTY of the whole surface instead, so a new method is
// covered the day it is written.
//
// Run: node scripts/check-adopter-types.mjs   (needs `npm run build:types` first)
// Exits non-zero with a per-finding explanation.
//
// Validated against real history, not a fixture built to pass:
//   c006cac (pre-v0.11.0) -> bare-object fires 4x on connect()/translateWda()
//   c4d60ce (pre-v0.11.1) -> platform-parity fires on page.swipe(), 5 vs 4
//   HEAD with the screenshot fix reverted -> platform-parity fires on the return
//   HEAD as shipped -> 0 findings
//
// KNOWN GAP, stated rather than papered over: platform-parity compares the two
// pages against EACH OTHER, so a declaration that is wrong on BOTH platforms in
// the same way is invisible to it. It catches divergence, not agreed-upon error.
import ts from 'typescript';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const typesDir = resolve(process.argv[2] ?? 'types');
const entries = ['index.d.ts', 'ios.d.ts'].map(f => resolve(typesDir, f));

for (const f of entries) {
  if (!existsSync(f)) {
    console.error(`missing ${f} — run \`npm run build:types\` first.`);
    process.exit(2);
  }
}

const program = ts.createProgram(entries, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const findings = [];

const exportsOf = (file) => {
  const sf = program.getSourceFile(file);
  const mod = sf && checker.getSymbolAtLocation(sf);
  return mod ? checker.getExportsOfModule(mod) : [];
};
const callSig = (sym) => {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return null;
  return checker.getSignaturesOfType(
    checker.getTypeOfSymbolAtLocation(sym, decl), ts.SignatureKind.Call)[0] ?? null;
};

// ---- RULE 1: no bare `object` in an exported return type ----------------
// A bare `object` accepts no property access, so an adopter cannot read
// anything off it without casting. This is what `@returns {object}` in JSDoc
// generates, and it is never what an adopter wants.
for (const file of entries) {
  for (const sym of exportsOf(file)) {
    const sig = callSig(sym);
    if (!sig) continue;
    const ret = checker.getReturnTypeOfSignature(sig);
    const candidates = [ret, checker.getAwaitedType?.(ret) ?? ret];
    const hit = candidates.some(ty =>
      (ty.isUnion() ? ty.types : [ty]).some(p => checker.typeToString(p) === 'object'));
    if (hit) {
      findings.push({
        rule: 'bare-object',
        where: `${sym.getName()}() in ${file.split('/').pop()}`,
        detail: 'returns a bare `object`, which accepts no property access — an adopter '
              + 'cannot read a single field off it. Give the JSDoc @returns a real shape, '
              + 'or drop the annotation and let tsc infer it from what the function returns.',
      });
    }
  }
}

// ---- RULE 2: the two platform pages must agree on shared methods --------
// Android and iOS deliberately implement the same page API (docs/product/prd.md).
// Where they diverge on a method they BOTH have, one of them is wrong: it either
// forces an argument the other defaults, or claims a different result type.
const pageOf = (file) => {
  const connect = exportsOf(file).find(s => s.getName() === 'connect');
  const sig = connect && callSig(connect);
  if (!sig) return null;
  const ret = checker.getReturnTypeOfSignature(sig);
  return checker.getAwaitedType?.(ret) ?? ret;
};

const android = pageOf(entries[0]);
const ios = pageOf(entries[1]);

if (android && ios) {
  const iosProps = new Map(ios.getProperties().map(p => [p.getName(), p]));
  // `Buffer` and `Buffer<ArrayBuffer>` are one type rendered two ways
  // (@types/node made Buffer generic) — normalise before comparing.
  const norm = (t) => t.replace(/Buffer<[^>]*>/g, 'Buffer');
  // An `any` side is loose, not wrong: it makes no claim to contradict. Flagging
  // it would fail the gate on pre-existing looseness rather than on a defect.
  const isLoose = (t) => /\bany\b/.test(t);

  for (const aSym of android.getProperties()) {
    const name = aSym.getName();
    const iSym = iosProps.get(name);
    if (!iSym) continue;                       // platform-only method — fine
    const aSig = callSig(aSym), iSig = callSig(iSym);
    if (!aSig || !iSig) continue;              // a plain field, not a method

    const required = (sig) => sig.getParameters().filter(p => {
      const d = p.valueDeclaration ?? p.declarations?.[0];
      return d && !d.questionToken && !d.initializer && !d.dotDotDotToken;
    }).length;

    const ar = required(aSig), ir = required(iSig);
    if (ar !== ir) {
      const [more, fewer] = ar > ir ? ['Android', 'iOS'] : ['iOS', 'Android'];
      findings.push({
        rule: 'platform-parity',
        where: `page.${name}()`,
        detail: `Android declares ${ar} required parameter(s), iOS declares ${ir}. `
              + `${more} forces an argument ${fewer} defaults — give the wrapper on `
              + `${more} the same default, so the idiomatic call compiles on both.`,
      });
    }

    const aRet = norm(checker.typeToString(checker.getReturnTypeOfSignature(aSig)));
    const iRet = norm(checker.typeToString(checker.getReturnTypeOfSignature(iSig)));
    if (!isLoose(aRet) && !isLoose(iRet) && aRet !== iRet) {
      findings.push({
        rule: 'platform-parity',
        where: `page.${name}()`,
        detail: `Android returns ${aRet}, iOS returns ${iRet}. The same method on both `
              + `pages should carry the same declared result — one of these is wrong `
              + `about what it actually hands back.`,
      });
    }
  }
}

for (const f of findings) {
  console.log(`${f.rule}: ${f.where}\n    ${f.detail}\n`);
}

if (findings.length) {
  console.log(`${findings.length} adopter-visible declaration defect(s) — see above.`);
  process.exit(1);
}
console.log('adopter-visible declarations OK (bare-object, platform-parity).');
