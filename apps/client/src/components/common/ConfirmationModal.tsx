/**
 * The dialog behind `confirm()` (design sheet f48, f61), built on the shared
 * Modal: S width, Cancel focused first when it is destructive, solid rose for
 * the button that cannot be undone.
 *
 * `requireText`: the person types this (a pipeline's name) before the
 * destructive button wakes up. For losses that cannot be undone and are easy
 * to aim at the wrong row.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({
  isOpen, title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDangerous, requireText, onConfirm, onCancel,
}: ConfirmationModalProps) {
  const [typed, setTyped] = useState('');
  // Clear what was typed each time the dialog opens (set during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setTyped('');
  }
  const ready = !requireText || typed.trim() === requireText;
  return (
    <Modal
      open={isOpen}
      onClose={onCancel}
      size="sm"
      title={title}
      icon={isDangerous ? <AlertTriangle /> : <HelpCircle />}
      iconTone={isDangerous ? 'fail' : 'neutral'}
      dirty={typed.length > 0}
      onSubmit={() => ready && onConfirm()}
      footer={
        <>
          <Button variant="ghost" data-cancel={isDangerous ? '' : undefined} data-autofocus={isDangerous && !requireText ? '' : undefined} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={isDangerous ? 'danger-solid' : 'primary'} disabled={!ready} onClick={onConfirm} data-autofocus={!isDangerous ? '' : undefined}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="text-[14px] leading-relaxed text-fg-2 [text-wrap:pretty]">{message}</div>
      {requireText && (
        <Field className="mt-4" label={<>Type <span className="font-mono text-fg">{requireText}</span> to confirm</>}>
          <Input mono value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      )}
    </Modal>
  );
}
