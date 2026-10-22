import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const PACKAGE_DIR = resolve(here, '..')
export const REPO_ROOT = resolve(PACKAGE_DIR, '../..')
/** 산출물 위치 — web 이 /assets/{sheet}.json 으로 읽는다 */
export const OUTPUT_DIR = resolve(REPO_ROOT, 'apps/web/public/assets')
export const PREVIEW_PATH = resolve(PACKAGE_DIR, 'preview.png')
