/**
 * The bundled plugin version, read from package.json so the CLI and the
 * host-reported diagnostics always agree with the installed package.
 *
 * @module dsh-astudio-connect/version
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The package.json beside the compiled source. */
function packageJsonPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'package.json')
}

/** Bundled plugin version (semver). */
export const ASTUDIO_CONNECT_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath(), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
