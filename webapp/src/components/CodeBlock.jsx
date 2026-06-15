import { useState } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import json from 'highlight.js/lib/languages/json'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import python from 'highlight.js/lib/languages/python'
import hcl from 'highlight.js/lib/languages/go'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('python', python)
hljs.registerLanguage('hcl', hcl)
hljs.registerLanguage('terraform', hcl)
hljs.registerLanguage('tf', hcl)

export default function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false)

  let highlighted
  try {
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(children, { language }).value
    } else {
      highlighted = hljs.highlightAuto(children).value
    }
  } catch {
    highlighted = children
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="code-block">
      <div className="code-block__header">
        <div className="code-block__dots">
          <span className="code-block__dot code-block__dot--red" />
          <span className="code-block__dot code-block__dot--yellow" />
          <span className="code-block__dot code-block__dot--green" />
        </div>
        {language && <span className="code-block__lang">{language}</span>}
        <button
          className={`code-block__copy ${copied ? 'code-block__copy--copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}
