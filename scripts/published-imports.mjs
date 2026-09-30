import ts from "typescript";

/** Validate actual unfurled JSR upload sources, including dynamic imports. */
export function checkPublishedImports(name, files) {
  const errors = [];
  for (const [path, bytes] of files) {
    if (!/\.(ts|tsx|js|mjs|mts)$/.test(path)) continue;
    const sf = ts.createSourceFile(
      path,
      new TextDecoder().decode(bytes),
      ts.ScriptTarget.Latest,
      true,
    );
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
        if (name !== "@molgpu/io" || (!dynamic && !typeOnly)) {
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
