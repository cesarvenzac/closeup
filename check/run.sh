#!/bin/sh
# What someone installing the package gets, before it's published (npm run check): builds it,
# packs it as npm would, installs the tarball in two throwaway projects (TypeScript resolving it
# as NodeNext and as a bundler does) and typechecks and runs check/consumer.ts there.
set -eu
package=$(cd "$(dirname "$0")/.." && pwd)
# The package's own TypeScript, or the one above it when it's developed inside the site.
tsc=$(cd "$package" && node -p 'require.resolve("typescript/bin/tsc")')
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

(cd "$package" && npm run build --silent && npm pack --silent --pack-destination "$work" >/dev/null)
tarball=$(ls "$work"/*.tgz)
echo "Packed $(basename "$tarball"): $(tar -tzf "$tarball" | sed 's|^package/||' | tr '\n' ' ')"

for resolution in NodeNext bundler; do
  project="$work/$resolution"
  mkdir -p "$project"
  cp "$package/check/consumer.ts" "$project/consumer.ts"
  module=$([ "$resolution" = NodeNext ] && echo NodeNext || echo ESNext)
  printf '{"type":"module","private":true}\n' > "$project/package.json"
  printf '{"compilerOptions":{"module":"%s","moduleResolution":"%s","target":"ES2022","strict":true,"skipLibCheck":false,"types":[],"outDir":"out"},"files":["consumer.ts"]}\n' "$module" "$resolution" > "$project/tsconfig.json"
  (cd "$project" && npm install --silent --no-audit --no-fund --offline "$tarball" && node "$tsc" -p . && node out/consumer.js | sed "s/^/$resolution: /" | cut -c1-120)
done
