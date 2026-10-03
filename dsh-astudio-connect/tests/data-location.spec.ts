import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  resolveAstudioDataRoot,
  resolveSessionPath,
  resolveAcodeHomes,
  sessionPathIn,
  userDataDir,
  ASTUDIO_STORAGE_REGISTRY_KEY,
  ASTUDIO_DATA_ROOT_ENV,
  ASTUDIO_AUTH_FILE_ENV,
  type LocationEnvironment,
} from '../src/data-location.ts'

/** Build a mock LocationEnvironment for tests. */
function mockLocation(overrides: Partial<LocationEnvironment> = {}): LocationEnvironment {
  return {
    env: {},
    homeDir: '/tmp/home',
    homeDirs: () => ['/tmp/home'],
    spawn: () => {
      throw new Error('spawn should not be called in tests')
    },
    ...overrides,
  }
}

/** A mock spawn that returns "no registry value found" (status 1). */
function spawnNoRegistry(): LocationEnvironment['spawn'] {
  return () => ({
    status: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from('ERROR: The system was unable to find the specified registry key or value'),
  }) as never
}

describe('resolveAstudioDataRoot', () => {
  it('uses ASTUDIO_DATA_ROOT env var when set', () => {
    const result = resolveAstudioDataRoot(mockLocation({
      env: { [ASTUDIO_DATA_ROOT_ENV]: 'D:/Custom/AStudio Data' },
    }))
    expect(result.dataRoot).toBe('D:/Custom/AStudio Data')
    expect(result.source).toBe('env')
  })

  it('ignores empty ASTUDIO_DATA_ROOT', () => {
    const result = resolveAstudioDataRoot(mockLocation({
      env: { [ASTUDIO_DATA_ROOT_ENV]: '' },
      spawn: spawnNoRegistry(),
    }))
    // Should fall through to other sources
    expect(result.source).not.toBe('env')
  })

  it('queries registry on Windows when env is not set', () => {
    // Mock spawn that returns a registry value
    const mockSpawn = (): LocationEnvironment['spawn'] => {
      return () => ({
        status: 0,
        stdout: Buffer.from(
          `HKEY_CURRENT_USER\\Software\\AStudioStorage\n` +
          `    ProductionDataRoot    REG_SZ    D:\\Program Files\\AStudio Data\n`,
        ),
        stderr: Buffer.alloc(0),
      }) as never
    }

    const result = resolveAstudioDataRoot(mockLocation({
      env: {},
      spawn: mockSpawn(),
    }))

    // On Windows, registry is queried and returns the value
    if (process.platform === 'win32') {
      expect(result.dataRoot).toBe('D:\\Program Files\\AStudio Data')
      expect(result.source).toBe('registry')
    } else {
      // On non-Windows, falls through to default candidates
      expect(result.source).not.toBe('registry')
    }
  })

  it('falls back to default locations when no env or registry', () => {
    // Use a homeDir that won't have AStudio installed, and inject
    // looksLikeDataRoot to return false so no default candidate matches
    const result = resolveAstudioDataRoot(mockLocation({
      env: { LOCALAPPDATA: '/tmp/localappdata' },
      homeDir: '/tmp/home',
      spawn: spawnNoRegistry(),
      looksLikeDataRoot: () => false,
    }))
    // Should try default locations but none will exist, so source is 'none'
    expect(result.source).toBe('none')
    expect(result.dataRoot).toBeUndefined()
  })
})

describe('resolveSessionPath', () => {
  it('uses authFile override when provided', () => {
    const result = resolveSessionPath({ authFile: '/custom/session.json' })
    expect(result.path).toBe('/custom/session.json')
    expect(result.source).toBe('env')
  })

  it('uses ASTUDIO_AUTH_FILE env var when authFile is not provided', () => {
    const result = resolveSessionPath(
      {},
      mockLocation({ env: { [ASTUDIO_AUTH_FILE_ENV]: '/env/session.json' } }),
    )
    expect(result.path).toBe('/env/session.json')
    expect(result.source).toBe('env')
  })

  it('falls back to data root session path', () => {
    const result = resolveSessionPath(
      {},
      mockLocation({
        env: { [ASTUDIO_DATA_ROOT_ENV]: join('/data', 'root') },
        spawn: spawnNoRegistry(),
      }),
    )
    const expectedPath = join(join('/data', 'root'), 'userdata', 'astron-session.json')
    expect(result.path).toBe(expectedPath)
    expect(result.source).toBe('data-root')
  })

  it('returns undefined when no data root is found', () => {
    const result = resolveSessionPath({}, mockLocation({
      spawn: spawnNoRegistry(),
      looksLikeDataRoot: () => false,
    }))
    expect(result.path).toBeUndefined()
    expect(result.source).toBe('none')
  })
})

describe('userDataDir', () => {
  it('joins dataRoot with userdata', () => {
    const expected = join('/data/root', 'userdata')
    expect(userDataDir('/data/root')).toBe(expected)
  })
})

describe('sessionPathIn', () => {
  it('joins dataRoot with userdata/astron-session.json', () => {
    const expected = join('/data/root', 'userdata', 'astron-session.json')
    expect(sessionPathIn('/data/root')).toBe(expected)
  })
})

describe('resolveAcodeHomes', () => {
  it('includes the data root runtime acode-home first', () => {
    const homes = resolveAcodeHomes(mockLocation({
      env: { [ASTUDIO_DATA_ROOT_ENV]: join('/data', 'root') },
      homeDir: '/tmp/home',
      spawn: spawnNoRegistry(),
    }))
    const expectedFirst = join(join('/data', 'root'), 'runtime', 'acode-home')
    expect(homes[0]).toBe(expectedFirst)
    expect(homes[1]).toBe(join('/tmp/home', '.acode'))
  })

  it('includes ~/.acode even without a data root', () => {
    const homes = resolveAcodeHomes(mockLocation({
      homeDir: '/tmp/home',
      spawn: spawnNoRegistry(),
      looksLikeDataRoot: () => false,
    }))
    expect(homes).toHaveLength(1)
    expect(homes[0]).toBe(join('/tmp/home', '.acode'))
  })
})

describe('constants', () => {
  it('has the expected registry key', () => {
    expect(ASTUDIO_STORAGE_REGISTRY_KEY).toBe('HKCU\\Software\\AStudioStorage')
  })

  it('has the expected env var names', () => {
    expect(ASTUDIO_DATA_ROOT_ENV).toBe('ASTUDIO_DATA_ROOT')
    expect(ASTUDIO_AUTH_FILE_ENV).toBe('ASTUDIO_AUTH_FILE')
  })
})
