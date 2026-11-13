import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  REGISTRATION_LEGAL_VERSION,
  registrationLegalDocuments,
} from '../../packages/protocol/src/registration-legal.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = createRequire(path.join(root, 'apps/desktop/package.json'))('typescript');
const lib = path.join(root, 'apps/desktop/src/lib');
const file = ts.createSourceFile(
  'app-language.ts',
  fs.readFileSync(path.join(lib, 'app-language.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const catalog = {};
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(file) === 'translations' &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    for (const item of node.initializer.properties) {
      if (!ts.isPropertyAssignment(item) || !ts.isArrayLiteralExpression(item.initializer))
        continue;
      const values = item.initializer.elements;
      if (!values.every((v) => ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)))
        throw new Error('Nonliteral translation');
      catalog[item.name.text] = { en: values[0].text, 'zh-CN': values[1].text };
    }
  }
  ts.forEachChild(node, visit);
}
visit(file);
for (const language of ['be', 'es', 'ka', 'kk']) {
  const items = JSON.parse(
    fs.readFileSync(path.join(lib, `app-language.${language}.json`), 'utf8'),
  );
  for (const [key, value] of Object.entries(items)) (catalog[key] ??= {})[language] = value;
}
for (const name of [
  'review-translations.json',
  'game-translations.json',
  'interaction-translations.json',
]) {
  const items = JSON.parse(fs.readFileSync(path.join(lib, name), 'utf8'));
  for (const [key, values] of Object.entries(items)) catalog[key] = { ...catalog[key], ...values };
}
const overrides = JSON.parse(
  fs.readFileSync(path.join(root, 'apps/android-native/native-language-overrides.json'), 'utf8'),
);
for (const [key, values] of Object.entries(overrides)) {
  if (values.length !== 6) throw new Error(`Incomplete native translation: ${key}`);
  catalog[key] = Object.fromEntries(
    ['en', 'zh-CN', 'kk', 'be', 'ka', 'es'].map((language, index) => [language, values[index]]),
  );
}
if (process.argv.includes('--apple')) {
  const resources = path.join(root, 'apps/apple/App/Resources/Localization');
  const overrides = { 'zh-CN': 'zh-Hans' };
  for (const language of ['ru', 'en', 'zh-CN', 'kk', 'be', 'ka', 'es']) {
    const directory = path.join(resources, (overrides[language] ?? language) + '.lproj');
    fs.mkdirSync(directory, { recursive: true });
    const lines = Object.entries(catalog).flatMap(([key, translations]) => {
      const value = language === 'ru' ? key : translations[language];
      return value ? [JSON.stringify(key) + ' = ' + JSON.stringify(value) + ';'] : [];
    });
    fs.writeFileSync(path.join(directory, 'Localizable.strings'), lines.join('\n') + '\n');
  }
  console.log('Bundled shared translations for Apple');
  process.exit(0);
}
const output = path.join(root, 'apps/android-native/app/src/main/assets/native-translations.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(catalog));
fs.writeFileSync(
  path.join(path.dirname(output), 'registration-legal.json'),
  JSON.stringify({ version: REGISTRATION_LEGAL_VERSION, ...registrationLegalDocuments }),
);
console.log(`Bundled ${Object.keys(catalog).length} native translation keys`);
