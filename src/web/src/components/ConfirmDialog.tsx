import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'

interface Props {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', danger = true, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed">{message}</div>
    </Modal>
  )
}
