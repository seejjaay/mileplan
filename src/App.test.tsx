import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders skip link', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
  })
})
