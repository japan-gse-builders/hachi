// Lets Node run the TypeScript sources directly (with --experimental-transform-types): maps the
// workspace packages to their src/ and `./x.js` imports to `./x.ts`, as the TypeScript build does.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const ALIASES = {
  '@hachi/core': new URL('packages/core/src/index.ts', root).href,
  '@hachi/store': new URL('packages/store/src/index.ts', root).href,
  '@hachi/cloud': new URL('packages/cloud/src/index.ts', root).href,
};

registerHooks({
  resolve(specifier, context, next) {
    if (ALIASES[specifier]) return { url: ALIASES[specifier], shortCircuit: true };
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return { url: ts.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
