import ts from "typescript";
import { posix } from "node:path";

const SOURCE = /\.(ts|tsx|js|mjs|mts)$/;

/**
 * Validate actual unfurled JSR upload sources, including dynamic imports.
 * `entries` are the package's export targets ("/src/index.ts"). In io, Mol*
 * stays out of the static module graph: a file may import Mol* statically
 * only if it is not an entry and no published file imports it statically,
 * so it is reachable through import() alone.
 */
export function checkPublishedImports(
  name,
  files,
  entries = ["/src/index.ts"],
) {
  const errors = [];
  const parsed = [...files]
    .filter(([path]) => SOURCE.test(path))
    .map(([path, bytes]) => [
      path,
      ts.createSourceFile(
        path,
        new TextDecoder().decode(bytes),
        ts.ScriptTarget.Latest,
        true,
      ),
    ]);
  // Files some published file imports statically (value or re-export).
  const staticTargets = new Set(entries);
  for (const [path, sf] of parsed) {
    for (const node of sf.statements) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith(".") &&
        !(node.isTypeOnly || node.importClause?.isTypeOnly)
      ) {
        staticTargets.add(
          posix.join(posix.dirname(path), node.moduleSpecifier.text),
        );
      }
    }
  }
  for (const [path, sf] of parsed) {
    const lazyOnly = !staticTargets.has(path);
    const check = (specifier, dynamic = false, typeOnly = false) => {
      if (/^(\.|\/|node:)/.test(specifier)) return;
      const where = `${path}: ${specifier}`;
      if (!/^(jsr:|npm:)/.test(specifier)) {
        errors.push(`bare or unsupported published import ${where}`);
      }
      if (
        /^jsr:@molgpu\//.test(specifier) &&
        !/^jsr:@molgpu\/[^@/]+@\^\d+\.\d+\.\d+(\/|$)/.test(specifier)
      ) {
        errors.push(`internal dependency must use a caret JSR range: ${where}`);
      }
      if (/^npm:\/?@use-gpu\//.test(specifier) && name !== "@molgpu/viewer") {
        if (
          !(["@molgpu/timeline", "@molgpu/geo"].includes(name) &&
            path.startsWith("/src/internal/") &&
            /^npm:\/?@use-gpu\/core@/.test(specifier))
        ) {
          errors.push(`use.gpu import violates the package wall: ${where}`);
        }
      }
      if (
        /^npm:\/?@use-gpu\//.test(specifier) &&
        !/^npm:\/?@use-gpu\/[^@/]+@0\.20\.0(\/|$)/.test(specifier)
      ) {
        errors.push(`use.gpu must match exact reviewed pin 0.20.0: ${where}`);
      }
      if (/^npm:\/?molstar(?:@|\/|$)/.test(specifier)) {
        if (name !== "@molgpu/io" || (!dynamic && !typeOnly && !lazyOnly)) {
          errors.push(`Mol* must be a dynamic import in io: ${where}`);
        }
        if (!/^npm:\/?molstar@5\.11\.0(\/|$)/.test(specifier)) {
          errors.push(`Mol* must match tested pin 5.11.0: ${where}`);
        }
      }
    };
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ) {
        check(
          node.moduleSpecifier.text,
          false,
          node.isTypeOnly || node.importClause?.isTypeOnly,
        );
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
          check(node.arguments[0].text, true);
        } else {errors.push(
            `${path}: published dynamic import must have a literal specifier`,
          );}
      } else if (
        ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) check(node.argument.literal.text, false, true);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const ref of sf.typeReferenceDirectives) check(ref.fileName);
  }
  return errors;
}
