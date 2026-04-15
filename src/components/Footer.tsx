export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer mt-4 px-4 pb-6 pt-4 text-[var(--ink-soft)]">
      <div className="page-wrap text-center">
        <p className="m-0 text-xs">
          &copy; {year} Pending App
        </p>
      </div>
    </footer>
  )
}
