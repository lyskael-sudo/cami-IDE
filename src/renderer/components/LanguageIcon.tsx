import type { CSSProperties } from 'react'
import { File } from 'lucide-react'
import cIcon from 'simple-icons/icons/c.svg?url'
import cppIcon from 'simple-icons/icons/cplusplus.svg?url'
import cssIcon from 'simple-icons/icons/css.svg?url'
import dockerIcon from 'simple-icons/icons/docker.svg?url'
import goIcon from 'simple-icons/icons/go.svg?url'
import htmlIcon from 'simple-icons/icons/html5.svg?url'
import javascriptIcon from 'simple-icons/icons/javascript.svg?url'
import jsonIcon from 'simple-icons/icons/json.svg?url'
import phpIcon from 'simple-icons/icons/php.svg?url'
import pythonIcon from 'simple-icons/icons/python.svg?url'
import rubyIcon from 'simple-icons/icons/ruby.svg?url'
import rustIcon from 'simple-icons/icons/rust.svg?url'
import typescriptIcon from 'simple-icons/icons/typescript.svg?url'
import yamlIcon from 'simple-icons/icons/yaml.svg?url'
import { languageForPath } from '../store/editorStore'

interface LanguageBrand {
  icon: string
  color: string
}

const LANGUAGE_BRANDS: Record<string, LanguageBrand> = {
  c: { icon: cIcon, color: '#A8B9CC' },
  cpp: { icon: cppIcon, color: '#00599C' },
  css: { icon: cssIcon, color: '#663399' },
  dockerfile: { icon: dockerIcon, color: '#2496ED' },
  go: { icon: goIcon, color: '#00ADD8' },
  html: { icon: htmlIcon, color: '#E34F26' },
  javascript: { icon: javascriptIcon, color: '#F7DF1E' },
  json: { icon: jsonIcon, color: '#CBCB41' },
  php: { icon: phpIcon, color: '#777BB4' },
  python: { icon: pythonIcon, color: '#3776AB' },
  ruby: { icon: rubyIcon, color: '#CC342D' },
  rust: { icon: rustIcon, color: '#DEA584' },
  typescript: { icon: typescriptIcon, color: '#3178C6' },
  yaml: { icon: yamlIcon, color: '#CB171E' }
}

export function LanguageIcon({
  filePath,
  size = 15
}: {
  filePath: string
  size?: number
}): React.JSX.Element {
  const brand = LANGUAGE_BRANDS[languageForPath(filePath)]
  if (!brand) {
    return <File size={size - 1} strokeWidth={1.7} aria-hidden="true" />
  }

  const style: CSSProperties = {
    width: size,
    height: size,
    color: brand.color,
    maskImage: `url("${brand.icon}")`,
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskImage: `url("${brand.icon}")`,
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain'
  }

  return <span className="language-icon" style={style} aria-hidden="true" />
}
