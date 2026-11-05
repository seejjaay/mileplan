import ReactMarkdown from 'react-markdown'

/**
 * Renders user-written Markdown. No rehype-raw, so raw HTML never becomes elements, and
 * react-markdown's default URL transform drops javascript: links.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-2 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
