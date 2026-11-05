import { render, screen } from '@testing-library/react'
import { Markdown } from './Markdown'

describe('Markdown', () => {
  it('renders emphasis and lists as elements', () => {
    render(<Markdown>{'**Bold** and\n\n- one\n- two'}</Markdown>)
    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('never turns raw HTML into elements', () => {
    const { container } = render(<Markdown>{'<script>alert(1)</script> <img src=x onerror="alert(1)"> <iframe src="x"></iframe>'}</Markdown>)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('opens links in a new tab with noopener', () => {
    render(<Markdown>{'[docs](https://example.com/docs)'}</Markdown>)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('drops javascript: links', () => {
    render(<Markdown>{'[bad](javascript:alert(1))'}</Markdown>)
    const href = screen.getByText('bad').closest('a')?.getAttribute('href') ?? ''
    expect(href.toLowerCase()).not.toContain('javascript')
  })
})
