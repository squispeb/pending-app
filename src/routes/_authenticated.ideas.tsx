import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/ideas')({
  component: IdeasLayout,
})

function IdeasLayout() {
  return <Outlet />
}
