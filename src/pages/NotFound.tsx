import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Empty } from '../components/ui'

export function NotFound() {
  return (
    <Empty
      icon={<Compass size={22} />}
      title="Page not found"
      description="That route doesn't exist."
      action={
        <Link to="/" className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]">
          Back to dashboard
        </Link>
      }
    />
  )
}
