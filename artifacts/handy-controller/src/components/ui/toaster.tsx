import { useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

const SWIPE_THRESHOLD = 50

interface ToastItemProps {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactElement
  dismiss: (id: string) => void
  [key: string]: unknown
}

function ToastItem({ id, title, description, action, dismiss, ...props }: ToastItemProps) {
  const touchStartX = useRef<number | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    if (deltaX < -SWIPE_THRESHOLD) {
      dismiss(id)
    }
    touchStartX.current = null
  }

  return (
    <Toast
      key={id}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      {...props}
    >
      <div
        aria-hidden="true"
        className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-foreground/20"
      />
      <div className="grid gap-1 mt-2">
        {title && <ToastTitle>{title}</ToastTitle>}
        {description && (
          <ToastDescription>{description}</ToastDescription>
        )}
      </div>
      {action}
      <ToastClose />
    </Toast>
  )
}

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <ToastItem
            key={id}
            id={id}
            title={title}
            description={description}
            action={action}
            dismiss={dismiss}
            {...props}
          />
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
