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
//   c006cac (pre-v0.11.0) -> bare-object fires 3x on connect()/translateWda()
//   c4d60ce (pre-v0.11.1) -> platform-parity fires on page.swipe(), 5 vs 4
//   HEAD with the screenshot fix reverted -> platform-parity fires on the return
//   HEAD as shipped -> 0 findings
//
// platform-parity alone was a differential check: it compared the two pages
// against EACH OTHER, so it was blind to (a) a declaration wrong the same way on
// both platforms and (b) the 13 of 32 page members that exist on one platform
// only and therefore have no counterpart to disagree with. Rules 3 and 4 below
// fix that by checking each page member against its own source — the function it
// forwards to, and what its own body does with the argument — which gives a
// notion of "wrong" rather than only "these two disagree".
//
// Rules 3/4 validated the same way:
//   c4d60ce (pre-v0.11.1) -> forwarded-default fires on page.swipe(), from source
//     alone, with no cross-platform comparison in play
//   HEAD with the swipe default removed on BOTH pages -> rules 1+2 report "OK",
//     forwarded-default still fires (the exact blind spot above)
//   HEAD as shipped -> optional-in-fact fired on iOS-only page.unlock(pin), a real
//     defect no parity check could ever see; fixed in the same commit
//
// RESIDUAL GAP: rule 4 reads `x || y` as "the body handles x being absent". It
// would misread a fallback that itself throws (`pin || required()`) as a default.
// No such code exists in either page today; left unguarded deliberately, because
// the failure mode is a visible false positive a human dismisses, not a wrong
// type shipped to an adopter.
//
// RESIDUAL GAP: rules 3/4 give an absolute notion of correct for parameter
// optionality — the defect class that actually shipped twice. A return type that
// is wrong identically on both platforms is still only caught where `tsc` itself
// catches it (a JSDoc @returns that contradicts the returned expression); a lie
// laundered through a cast, as `screenshot()` once was, is not detected here.
import ts from 'typescript';
import { resolve, sep } from 'node:path';
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

// ---- RULES 3 & 4: every page member, checked against its own source -----
// Rules 1 and 2 read the built .d.ts. These two read `src/` instead, because
// the evidence they need — what a wrapper forwards to, and what its body does
// when an argument is missing — exists only in the body, which a .d.ts drops.
const srcDir = resolve(typesDir, '..', 'src');
const srcFiles = ['index.js', 'ios.js'].map(f => resolve(srcDir, f));
const srcProgram = ts.createProgram(srcFiles, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowJs: true, checkJs: true, strict: true, skipLibCheck: true, noEmit: true,
});
const srcChecker = srcProgram.getTypeChecker();

// The page object is the literal carrying a `platform` key — the one thing both
// pages declare and nothing else in these files does.
const pageLiterals = [];
for (const file of srcFiles) {
  const sf = srcProgram.getSourceFile(file);
  if (!sf) { console.error(`missing ${file}`); process.exit(2); }
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n) &&
        n.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === 'platform')) {
      pageLiterals.push({ file, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
if (pageLiterals.length !== 2) {
  console.error(`expected 2 page literals (one per platform), found ${pageLiterals.length} — `
              + `the anchor for rules 3/4 has moved; fix the checker rather than the count.`);
  process.exit(2);
}

// Optional three ways: `p?`, `p = x`, `...rest` — or, in JS source, a bracketed
// JSDoc tag (`@param {T} [p]`), which is how these files say it.
const optionalDecl = (d) => !!d && (
  !!d.questionToken || !!d.initializer || !!d.dotDotDotToken ||
  ts.getJSDocParameterTags(d).some(t => t.isBracketed));
let members = 0, covered = 0;

for (const { file, node } of pageLiterals) {
  const short = file.split('/').pop();
  for (const prop of node.properties) {
    if (!prop.name || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    members++;
    const fn = ts.isMethodDeclaration(prop) ? prop
      : (ts.isPropertyAssignment(prop) &&
         (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)))
        ? prop.initializer : null;
    if (!fn?.body || !fn.parameters.length) continue;
    covered++;

    // Key parameters by SYMBOL, not by name text. A nested closure is free to
    // shadow a parameter name (`list.forEach(duration => ...)`), and a text
    // match would blame the outer parameter for what the inner one does —
    // verified: it produced a false positive on rule 3 and masked a real
    // finding on rule 4 before this was symbol-based.
    const paramOf = new Map();
    for (const p of fn.parameters) {
      if (!ts.isIdentifier(p.name)) continue;
      const sym = srcChecker.getSymbolAtLocation(p.name);
      if (sym) paramOf.set(sym, p);
    }

    // RULE 3 — forwarded-default: a parameter handed straight to another of our
    // functions, at a position that function defaults, but declared required
    // here. This is exactly the v0.11.1 `swipe()` defect, caught without
    // reference to the other platform.
    const walk = (n) => {
      if (ts.isCallExpression(n)) {
        const sig = srcChecker.getResolvedSignature(n);
        if (sig) {
          n.arguments.forEach((arg, i) => {
            if (!ts.isIdentifier(arg)) return;
            // A spread earlier in the call contributes an unknown number of
            // arguments, so this argument's syntactic index is no longer the
            // callee's parameter index. Nothing can be concluded — say so by
            // skipping, rather than comparing against the wrong parameter.
            if (n.arguments.some((a, j) => j < i && ts.isSpreadElement(a))) return;
            const wp = paramOf.get(srcChecker.getSymbolAtLocation(arg));
            if (!wp || optionalDecl(wp)) return;
            const cp = sig.getParameters()[i];
            const cd = cp && (cp.valueDeclaration ?? cp.declarations?.[0]);
            if (!cd || !ts.isParameter(cd) || !optionalDecl(cd)) return;
            // Only functions we own. Forwarding into a builtin (`Number(ref)`)
            // says nothing about our contract — measured: that exclusion is
            // what took this rule from 1 false positive to 0 on the real tree.
            if (!cd.getSourceFile().fileName.startsWith(srcDir + sep)) return;
            findings.push({
              rule: 'forwarded-default',
              where: `page.${name}() in ${short}`,
              detail: `parameter \`${arg.text}\` is passed to \`${n.expression.getText()}\` at `
                    + `position ${i}, which defaults it (\`${cd.getText()}\`) — but the wrapper `
                    + `restates it without a default, so adopters are forced to supply an `
                    + `argument the implementation would have filled in. Give the wrapper the `
                    + `same default.`,
            });
          });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(fn.body);

    // RULE 4 — optional-in-fact: a required parameter whose every use in the
    // body sits on the left of `||` / `??`. The body already says what happens
    // when it is absent; the declaration should say it may be absent.
    for (const [sym, wp] of paramOf) {
      if (optionalDecl(wp)) continue;
      // Carry the parent down the walk instead of reading `node.parent`. Parent
      // pointers exist here only as a side effect of having built the type
      // checker; depending on that would break silently if this ever ran before
      // the checker was created.
      // A shorthand property (`post({ pin })`) is a real use of the parameter,
      // but `getSymbolAtLocation` there resolves to the PROPERTY, not the value.
      // Missing it would read a genuinely-required parameter as fallback-only —
      // verified: this exact probe produced a false positive before the switch.
      const symOf = (id, parent) =>
        parent && ts.isShorthandPropertyAssignment(parent)
          ? srcChecker.getShorthandAssignmentValueSymbol(parent)
          : srcChecker.getSymbolAtLocation(id);
      const uses = [];
      const collect = (n, parent) => {
        if (ts.isIdentifier(n) && symOf(n, parent) === sym) uses.push({ n, parent });
        ts.forEachChild(n, (c) => collect(c, n));
      };
      collect(fn.body, undefined);
      if (!uses.length) continue;
      const fallbackOnly = uses.every(({ n, parent }) =>
        parent && ts.isBinaryExpression(parent) && parent.left === n &&
        (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
         parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken));
      if (fallbackOnly) {
        findings.push({
          rule: 'optional-in-fact',
          where: `page.${name}() in ${short}`,
          detail: `parameter \`${wp.name.text}\` is used only as \`${uses[0].parent.getText().split('\n')[0]}\` — `
                + `the body already defines the behaviour when it is absent, yet the declaration `
                + `forces every adopter to pass it. Mark it optional (\`@param {T} [${wp.name.text}]\`).`,
        });
      }
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
console.log(`adopter-visible declarations OK (bare-object, platform-parity, `
          + `forwarded-default, optional-in-fact) — ${covered} of ${members} page members `
          + `carry parameters and were checked against their own source.`);
