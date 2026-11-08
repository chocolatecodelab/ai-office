import { PaginatedItems } from './PaginatedItems.tsx'
import { createElement, type ReactNode } from 'react'
import { lexer, type MarkedToken, type Token } from 'marked'

// Render document tokens through React, never raw HTML. Images stay as alt text.
function content(tokens:Token[]):ReactNode {
  return tokens.map((raw,key)=>{
    const token=raw as MarkedToken
    switch(token.type) {
      case 'space': case 'def': return null
      case 'heading': return createElement(`h${Math.min(6,token.depth+3)}`,{key},content(token.tokens))
      case 'paragraph': return <p key={key}>{content(token.tokens)}</p>
      case 'text': return <span key={key}>{token.tokens ? content(token.tokens) : token.text}</span>
      case 'strong': return <strong key={key}>{content(token.tokens)}</strong>
      case 'em': return <em key={key}>{content(token.tokens)}</em>
      case 'del': return <del key={key}>{content(token.tokens)}</del>
      case 'escape': return <span key={key}>{token.text}</span>
      case 'codespan': return <code key={key}>{token.text}</code>
      case 'code': return <pre key={key}><code>{token.text}</code></pre>
      case 'html': return <code key={key}>{token.text}</code>
      case 'br': return <br key={key}/>
      case 'hr': return <hr key={key}/>
      case 'image': return <span key={key}>{token.text}</span>
      case 'link': return /^https?:\/\//i.test(token.href) ? <a key={key} href={token.href} target="_blank" rel="noopener noreferrer">{content(token.tokens)}</a> : <span key={key}>{content(token.tokens)}</span>
      case 'blockquote': return <blockquote key={key}>{content(token.tokens)}</blockquote>
      case 'list': return createElement(token.ordered?'ol':'ul',{key,...(token.ordered?{start:token.start || 1}:{})},token.items.map((item,i)=><li key={i}>{item.task && <span>{item.checked?'[x] ':'[ ] '}</span>}{content(item.tokens)}</li>))
      case 'table': return <PaginatedItems key={key} items={token.rows} scope={JSON.stringify(token.header)} label="baris">{rows=><div className="markdown-table"><table><thead><tr>{token.header.map((cell,i)=><th key={i}>{content(cell.tokens)}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{content(cell.tokens)}</td>)}</tr>)}</tbody></table></div>}</PaginatedItems>
      default: return <span key={key}>{raw.raw}</span>
    }
  })
}

export function ReadOnlyMarkdown({text}:{text:string}) {
  return <div className="readable-markdown">{content(lexer(text,{gfm:true}))}</div>
}
