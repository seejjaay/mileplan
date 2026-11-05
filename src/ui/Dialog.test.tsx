import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from './Dialog'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Confirm">
        <button>First</button>
        <button>Last</button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('traps focus and restores to opener on Esc', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Confirm' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    // Tab many times: focus never leaves the dialog
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
