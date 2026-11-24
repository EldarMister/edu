const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const file = resolve(__dirname, '../src/features/admin/pages/warehouse/RecipeBatchPreview.tsx');
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function render(portions, preview, showCosts = true) {
  const moduleExports = {};
  const stubs = {
    '@/lib/format': { money: (value) => value + ' сом' },
    '@/lib/api': { apiError: String },
    './recipe-preview-api': { useRecipePreview: (input) => ({ data: input ? preview : undefined }) },
    './recipe-draft-values': { recipeQuantity: (amount, unit) => amount + ' ' + unit },
    './units': { unitLabel: (unit) => unit === 'pcs' ? 'шт' : 'г' },
  };
  new Function('exports', 'require', code)(moduleExports, (path) => stubs[path] ?? require(path));
  return renderToStaticMarkup(React.createElement(moduleExports.RecipeBatchPanel, {
    input: { inputPortions: portions }, preview, pending: false, showCosts,
  }));
}

const egg = { ingredientId: 'egg', name: 'Яйцо', amount: 0.5, amountUnit: 'pcs', stockWriteoffAmount: 1 };
const preview = { items: [egg], output: { amount: 30, unit: 'g' }, compositionFoodCost: 14,
  batch: { items: [{ ingredientId: 'egg', stockWriteoffAmount: 1 }], compositionCost: 14 } };

test('one portion shows the gross, whole piece written off, and net yield', () => {
  const html = render(1, preview);
  assert.match(html, /0.5 шт/);
  assert.match(html, /Спишется 1 шт/);
  assert.match(html, /30 г/);
  assert.match(html, /14 сом/);
});

test('two portions use the server batch total and split its cost per portion', () => {
  const html = render(2, preview);
  assert.match(html, /1 шт/);
  assert.doesNotMatch(html, /Спишется/);
  assert.match(html, /60 г/);
  assert.match(html, /14 сом/);
  assert.match(html, /7 сом/);
  assert.doesNotMatch(html, /28 сом/);
  assert.doesNotMatch(render(2, preview, false), /сом/);
  assert.doesNotMatch(render(2, { ...preview, batch: { ...preview.batch, compositionCost: null } }), /сом/);
});
